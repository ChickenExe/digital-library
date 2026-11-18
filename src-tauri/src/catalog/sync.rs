//! Keeps catalog.db in step with the provider. Runs in the background; the UI
//! follows along through `catalog-status` events.

use flate2::read::GzDecoder;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::http::{header, StatusCode};
use tauri::{AppHandle, Emitter, Manager};

use super::gutenberg::{self, PROVIDER};
use super::{store, CatalogPhase, CatalogState, CatalogStatus};
use crate::db::books::now_ms;
use crate::error::{AppError, AppResult};

pub const CATALOG_STATUS: &str = "catalog-status";
/// The upstream catalog changes daily; a weekly refresh is plenty.
const STALE_AFTER_MS: i64 = 7 * 24 * 60 * 60 * 1000;

pub fn initial_status(conn: &rusqlite::Connection) -> AppResult<CatalogStatus> {
    let entries = store::count(conn)?;
    let synced_at = store::sync_state(conn, PROVIDER)?.map(|(at, _)| at);
    Ok(CatalogStatus {
        phase: if entries == 0 { CatalogPhase::Empty } else { CatalogPhase::Ready },
        entries,
        synced_at,
        message: None,
    })
}

pub fn is_stale(status: &CatalogStatus) -> bool {
    status.entries == 0 || status.synced_at.is_none_or(|at| now_ms() - at > STALE_AFTER_MS)
}

fn update(app: &AppHandle, f: impl FnOnce(&mut CatalogStatus)) {
    let state = app.state::<CatalogState>();
    let snapshot = match state.status.lock() {
        Ok(mut s) => {
            f(&mut s);
            s.clone()
        }
        Err(_) => return,
    };
    let _ = app.emit(CATALOG_STATUS, snapshot);
}

/// Starts a sync unless one is already running.
pub fn spawn(app: AppHandle, force: bool) {
    tauri::async_runtime::spawn(async move {
        if let Err(e) = run(&app, force).await {
            log::warn!("catalog sync failed: {e}");
            update(&app, |s| {
                s.phase = CatalogPhase::Error;
                s.message = Some(e.to_string());
            });
        }
    });
}

struct Running<'a>(&'a AtomicBool);
impl Drop for Running<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

async fn run(app: &AppHandle, force: bool) -> AppResult<()> {
    let state = app.state::<CatalogState>();
    if state.syncing.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    let _running = Running(&state.syncing);

    let (has_entries, last_modified) = {
        let conn = state.conn()?;
        (store::count(&conn)? > 0, store::sync_state(&conn, PROVIDER)?.and_then(|(_, lm)| lm))
    };

    // 1. Catalogue CSV (≈6 MB gzipped, ≈78k works). Skipped if unchanged upstream.
    update(app, |s| {
        s.phase = if has_entries { CatalogPhase::Ranking } else { CatalogPhase::Downloading };
        s.message = Some("Checking for new books…".into());
    });
    // gutenberg.org first, then the PGLAF mirror (same file).
    let mut response = None;
    let mut last_err = None;
    for url in gutenberg::catalog_csv_urls() {
        let mut request = state.http.get(&url);
        if let (false, Some(lm)) = (force, &last_modified) {
            request = request.header(header::IF_MODIFIED_SINCE, lm);
        }
        match request.send().await {
            Ok(r) if r.status().is_success() || r.status() == StatusCode::NOT_MODIFIED => {
                response = Some(r);
                break;
            }
            Ok(r) => {
                log::warn!("catalog from {url}: HTTP {}", r.status());
                if gutenberg::is_primary(&url) && r.status().is_server_error() {
                    gutenberg::mark_primary_down();
                }
                last_err = Some(AppError::Network(format!("HTTP {}", r.status())));
            }
            Err(e) => {
                log::warn!("catalog from {url}: {e}");
                if gutenberg::is_primary(&url) {
                    gutenberg::mark_primary_down();
                }
                last_err = Some(e.into());
            }
        }
    }
    let Some(response) = response else {
        return Err(last_err.unwrap_or_else(|| AppError::Network("no catalog source reachable".into())));
    };
    let new_last_modified = response
        .headers()
        .get(header::LAST_MODIFIED)
        .and_then(|v| v.to_str().ok())
        .map(String::from);

    if response.status() != StatusCode::NOT_MODIFIED {
        let bytes = response.bytes().await?;
        update(app, |s| {
            if !has_entries {
                s.phase = CatalogPhase::Indexing;
            }
            s.message = Some("Indexing the catalog…".into());
        });
        let worker = app.clone();
        let entries = tauri::async_runtime::spawn_blocking(move || -> AppResult<u32> {
            let state = worker.state::<CatalogState>();
            let mut conn = state.conn()?;
            // Decompress → parse → insert as one stream: peak memory stays flat.
            store::replace_catalog_with(&mut conn, PROVIDER, |emit| {
                let mut failed = None;
                gutenberg::for_each_record(GzDecoder::new(&bytes[..]), |r| {
                    if failed.is_none() {
                        failed = emit(&r).err();
                    }
                })?;
                failed.map_or(Ok(()), Err)
            })?;
            store::count(&conn)
        })
        .await
        .map_err(|e| AppError::Invalid(e.to_string()))??;
        update(app, |s| {
            s.entries = entries;
            s.phase = CatalogPhase::Ranking;
            s.message = Some("Finding the most-read books…".into());
        });
    }

    // 2. Popularity ranking from the "most downloaded" feed. Best effort: a
    //    partial ranking is still useful, so stop quietly on errors.
    let mut ranked: Vec<String> = Vec::new();
    let pages = if gutenberg::primary_down() { 0 } else { gutenberg::POPULAR_PAGES };
    for page in 0..pages {
        let xml = match fetch_text(&state.http, &gutenberg::popular_page_url(page)).await {
            Ok(xml) => xml,
            Err(e) => {
                log::warn!("popularity page {page} failed: {e}");
                if page == 0 {
                    gutenberg::mark_primary_down();
                }
                break;
            }
        };
        let ids = gutenberg::parse_feed_ids(&xml);
        if ids.is_empty() {
            break;
        }
        for id in ids {
            if !ranked.contains(&id) {
                ranked.push(id);
            }
        }
    }
    // Fallback: Gutendex's most-downloaded pages, which also carry each book's
    // summary and download count, so the top ~1000 get details for free.
    if ranked.is_empty() {
        let mut details = Vec::new();
        let mut failures_in_a_row = 0;
        for page in 0..gutenberg::GUTENDEX_PAGES {
            // Gutendex occasionally drops a request: retry each page once before giving up.
            let mut books = Err(AppError::Network("not fetched".into()));
            for attempt in 0..2 {
                if attempt > 0 {
                    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                }
                books = match fetch_text(&state.http, &gutenberg::gutendex_popular_url(page)).await {
                    Ok(json) => gutenberg::parse_gutendex(&json),
                    Err(e) => Err(e),
                };
                if books.is_ok() {
                    break;
                }
            }
            match books {
                Ok(books) if !books.is_empty() => {
                    failures_in_a_row = 0;
                    for b in books {
                        if !ranked.contains(&b.id) {
                            ranked.push(b.id.clone());
                            details.push(b);
                        }
                    }
                }
                Ok(_) => break,
                // Some Gutendex pages consistently hang server-side: skip them and
                // keep going, so one bad page doesn't cost the rest of the ranking.
                Err(e) => {
                    log::warn!("gutendex page {page} failed, skipping: {e}");
                    failures_in_a_row += 1;
                    if failures_in_a_row >= 3 {
                        break;
                    }
                }
            }
        }
        let conn = state.conn()?;
        let now = now_ms();
        for b in &details {
            store::save_detail(&conn, PROVIDER, &b.id, &b.detail, now)?;
        }
    }
    {
        let mut conn = state.conn()?;
        if !ranked.is_empty() {
            store::set_popularity(&mut conn, PROVIDER, &ranked)?;
        }
        store::set_sync_state(&conn, PROVIDER, now_ms(), new_last_modified.as_deref())?;
    }

    let synced_at = now_ms();
    update(app, |s| {
        s.phase = CatalogPhase::Ready;
        s.synced_at = Some(synced_at);
        s.message = None;
    });
    log::info!("catalog sync complete ({} ranked)", ranked.len());
    Ok(())
}

pub async fn fetch_text(http: &reqwest::Client, url: &str) -> AppResult<String> {
    Ok(http
        .get(url)
        .timeout(std::time::Duration::from_secs(20))
        .send()
        .await?
        .error_for_status()?
        .text()
        .await?)
}
