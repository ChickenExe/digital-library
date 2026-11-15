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
    let mut request = state.http.get(gutenberg::CATALOG_CSV_URL);
    if let (false, Some(lm)) = (force, &last_modified) {
        request = request.header(header::IF_MODIFIED_SINCE, lm);
    }
    let response = request.send().await?;
    let new_last_modified = response
        .headers()
        .get(header::LAST_MODIFIED)
        .and_then(|v| v.to_str().ok())
        .map(String::from);

    if response.status() != StatusCode::NOT_MODIFIED {
        let bytes = response.error_for_status()?.bytes().await?;
        update(app, |s| {
            if !has_entries {
                s.phase = CatalogPhase::Indexing;
            }
            s.message = Some("Indexing the catalog…".into());
        });
        let worker = app.clone();
        let entries = tauri::async_runtime::spawn_blocking(move || -> AppResult<u32> {
            let records = gutenberg::parse_catalog(GzDecoder::new(&bytes[..]))?;
            let state = worker.state::<CatalogState>();
            let mut conn = state.conn()?;
            store::replace_catalog(&mut conn, PROVIDER, &records)?;
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
    for page in 0..gutenberg::POPULAR_PAGES {
        let xml = match fetch_text(&state.http, &gutenberg::popular_page_url(page)).await {
            Ok(xml) => xml,
            Err(e) => {
                log::warn!("popularity page {page} failed: {e}");
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
