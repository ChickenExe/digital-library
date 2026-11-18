//! Discover commands.

use futures_util::StreamExt;
use std::path::Path;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::AsyncWriteExt;

use super::gutenberg::{self, PROVIDER};
use super::{
    store, sync, CatalogDetail, CatalogPage, CatalogQuery, CatalogRow, CatalogState, CatalogStatus,
    DownloadProgress, Offer, CURATED_ROWS,
};
use crate::commands::LIBRARY_CHANGED;
use crate::db::books::{self, now_ms, Origin};
use crate::error::{AppError, AppResult};
use crate::import::{self, Outcome};
use crate::models::Book;
use crate::state::AppState;
use crate::stream::StreamState;

pub const CATALOG_DOWNLOAD: &str = "catalog-download";
const DETAIL_TTL_MS: i64 = 30 * 24 * 60 * 60 * 1000;
const MAX_DOWNLOAD_BYTES: u64 = 300 * 1024 * 1024;

fn check(provider: &str, id: &str) -> AppResult<()> {
    if provider != PROVIDER || !gutenberg::valid_id(id) {
        return Err(AppError::Invalid(format!("unknown listing {provider}/{id}")));
    }
    Ok(())
}

fn owned(library: &AppState) -> AppResult<std::collections::HashMap<String, String>> {
    books::owned_from(&*library.conn()?, PROVIDER)
}

#[tauri::command]
pub fn catalog_status(catalog: State<'_, CatalogState>) -> AppResult<CatalogStatus> {
    catalog.status.lock().map(|s| s.clone()).map_err(|_| AppError::Invalid("status lock poisoned".into()))
}

#[tauri::command]
pub fn catalog_sync(app: AppHandle, force: bool) {
    sync::spawn(app, force);
}

/// The Discover front page: most popular, then curated category rows.
#[tauri::command(async)]
pub fn catalog_home(
    catalog: State<'_, CatalogState>,
    library: State<'_, AppState>,
    language: Option<String>,
) -> AppResult<Vec<CatalogRow>> {
    let owned = owned(&library)?;
    let conn = catalog.conn()?;
    let lang = language.as_deref();
    let popular = store::top(&conn, None, lang, 24)?;
    // Like any storefront front page, a book appears in at most one row.
    let mut seen: std::collections::HashSet<String> = popular.iter().map(|e| e.id.clone()).collect();
    let mut rows = vec![CatalogRow {
        id: "popular".into(),
        title: "Most read right now".into(),
        category: None,
        entries: popular,
    }];
    for (id, title, category) in CURATED_ROWS {
        let entries: Vec<_> = store::top(&conn, Some(category), lang, 80)?
            .into_iter()
            .filter(|e| seen.insert(e.id.clone()))
            .take(18)
            .collect();
        rows.push(CatalogRow {
            id: id.to_string(),
            title: title.to_string(),
            category: Some(category.to_string()),
            entries,
        });
    }
    rows.retain(|r| r.entries.len() >= 4);
    for row in &mut rows {
        store::annotate_owned(&mut row.entries, &owned);
    }
    Ok(rows)
}

#[tauri::command(async)]
pub fn catalog_search(
    catalog: State<'_, CatalogState>,
    library: State<'_, AppState>,
    query: CatalogQuery,
) -> AppResult<CatalogPage> {
    let owned = owned(&library)?;
    let mut page = store::search(&*catalog.conn()?, &query)?;
    store::annotate_owned(&mut page.entries, &owned);
    Ok(page)
}

/// Listing details. Summary/downloads are fetched from the provider on first
/// view and cached; if that fails we still return what the index knows.
#[tauri::command]
pub async fn catalog_detail(app: AppHandle, provider: String, id: String) -> AppResult<CatalogDetail> {
    check(&provider, &id)?;
    let catalog = app.state::<CatalogState>();
    let library = app.state::<AppState>();
    let mut stored = store::get(&*catalog.conn()?, &provider, &id)?
        .ok_or_else(|| AppError::NotFound(format!("listing {provider}/{id}")))?;

    if stored.fetched_at.is_none_or(|at| now_ms() - at > DETAIL_TTL_MS) {
        match fetch_detail(&catalog.http, &id).await {
            Ok(detail) => {
                store::save_detail(&*catalog.conn()?, &provider, &id, &detail, now_ms())?;
                stored.detail = detail;
            }
            // Keep showing what the index already knows.
            Err(e) => log::warn!("detail fetch failed for {id}: {e}"),
        }
    }

    stored.entry.owned_book_id = books::find_by_origin(&*library.conn()?, &provider, &id)?;
    Ok(CatalogDetail {
        entry: stored.entry,
        summary: stored.detail.summary,
        downloads: stored.detail.downloads,
        reading_level: stored.detail.reading_level,
        subjects: stored.subjects,
        issued: stored.issued,
        web_url: gutenberg::web_url(&id),
        offer: Offer::Free,
    })
}

/// Book details from gutenberg.org's OPDS page, or from Gutendex when it's down.
async fn fetch_detail(http: &reqwest::Client, id: &str) -> AppResult<gutenberg::Detail> {
    if !gutenberg::primary_down() {
        match sync::fetch_text(http, &gutenberg::detail_url(id)).await {
            Ok(xml) => return Ok(gutenberg::parse_detail(&xml)),
            Err(e) => {
                log::warn!("detail from gutenberg.org failed for {id}: {e}");
                gutenberg::mark_primary_down();
            }
        }
    }
    let json = sync::fetch_text(http, &gutenberg::gutendex_detail_url(id)).await?;
    gutenberg::parse_gutendex(&json)?
        .into_iter()
        .find(|b| b.id == id)
        .map(|b| b.detail)
        .ok_or_else(|| AppError::NotFound(format!("book {id} on gutendex")))
}

/// "Get": downloads the EPUB and runs it through the normal import pipeline,
/// so acquired books are indistinguishable from imported ones.
#[tauri::command]
pub async fn catalog_acquire(app: AppHandle, provider: String, id: String) -> AppResult<Book> {
    check(&provider, &id)?;
    let library = app.state::<AppState>();
    if let Some(book_id) = books::find_by_origin(&*library.conn()?, &provider, &id)? {
        return books::get(&*library.conn()?, &book_id);
    }

    let file = library.paths.incoming.join(format!("{provider}-{id}-{}.epub", uuid::Uuid::now_v7()));
    // If the book is being read on demand, keep exactly that file, so the
    // reading position and highlights (CFIs) carry over unchanged.
    let streamed = app.state::<StreamState>().get(&format!("{provider}/{id}"));
    let result = async {
        match streamed.as_ref().and_then(|s| s.temp_file.clone()) {
            Some(copy) => {
                tokio::fs::copy(&copy, &file).await?;
            }
            None => download(&app, &provider, &id, &file, streamed.as_ref().map(|s| s.url.clone())).await?,
        }
        let worker = app.clone();
        let path = file.clone();
        let origin = Origin { provider: provider.clone(), id: id.clone() };
        tauri::async_runtime::spawn_blocking(move || -> AppResult<Book> {
            let state = worker.state::<AppState>();
            let mut conn = state.conn()?;
            let book_id = match import::import_file(&mut conn, &state.paths, &path, Some(origin.clone()))? {
                Outcome::Imported(book) => book.id,
                Outcome::Duplicate(existing) => existing,
            };
            // Notes and the reading position from reading it on demand move to the library copy.
            books::adopt_stream(&mut conn, &origin.provider, &origin.id, &book_id)?;
            books::get(&conn, &book_id)
        })
        .await
        .map_err(|e| AppError::Invalid(e.to_string()))?
    }
    .await;
    let _ = tokio::fs::remove_file(&file).await;

    let book = result?;
    let _ = app.emit(LIBRARY_CHANGED, ());
    Ok(book)
}

/// `preferred` is tried first (the file a streamed copy was read from).
async fn download(app: &AppHandle, provider: &str, id: &str, target: &Path, preferred: Option<String>) -> AppResult<()> {
    let http = &app.state::<CatalogState>().http;
    let mut last_err: Option<AppError> = None;
    let preferred = preferred.map(|url| gutenberg::EpubSource { url, max_bytes: None });
    for source in preferred.into_iter().chain(gutenberg::epub_sources(id)) {
        let url = &source.url;
        let response = match http.get(url).send().await {
            Ok(r) if r.status().is_success() => r,
            Ok(r) => {
                // 404: this variant doesn't exist; 5xx: server trouble. Either way, try the next source.
                if r.status().is_server_error() {
                    if gutenberg::is_primary(url) {
                        gutenberg::mark_primary_down();
                    }
                    last_err = Some(AppError::Network(format!("HTTP {}", r.status())));
                }
                continue;
            }
            Err(e) => {
                log::warn!("download from {url} failed: {e}");
                if gutenberg::is_primary(url) {
                    gutenberg::mark_primary_down();
                }
                last_err = Some(e.into());
                continue;
            }
        };
        let total = response.content_length();
        if let (Some(max), Some(t)) = (source.max_bytes, total) {
            if t > max {
                continue; // e.g. a 25 MB illustrated edition on the slow mirror
            }
        }
        if total.is_some_and(|t| t > MAX_DOWNLOAD_BYTES) {
            return Err(AppError::Invalid("this book is too large to download".into()));
        }

        let mut out = tokio::fs::File::create(target).await?;
        let mut stream = response.bytes_stream();
        let (mut received, mut last_emit) = (0u64, 0u64);
        let progress = |received| DownloadProgress {
            provider: provider.to_string(),
            id: id.to_string(),
            received,
            total,
        };
        while let Some(chunk) = stream.next().await {
            let chunk = chunk?;
            received += chunk.len() as u64;
            if received > MAX_DOWNLOAD_BYTES {
                return Err(AppError::Invalid("this book is too large to download".into()));
            }
            out.write_all(&chunk).await?;
            if received - last_emit >= 128 * 1024 {
                last_emit = received;
                let _ = app.emit(CATALOG_DOWNLOAD, progress(received));
            }
        }
        out.flush().await?;
        let _ = app.emit(CATALOG_DOWNLOAD, progress(received));
        return Ok(());
    }
    Err(last_err.unwrap_or_else(|| AppError::NotFound("no EPUB edition is available for this book".into())))
}
