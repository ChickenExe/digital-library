//! Tauri command handlers — the entire frontend ↔ backend API surface.
//! Keep these thin: validate input, call into `db`/`import`, map errors.

use std::path::PathBuf;
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::db::books;
use crate::error::{AppError, AppResult};
use crate::import;
use crate::library::image_extension;
use crate::models::{Book, BookQuery, ImportProgress, ImportReport, LibraryStats};
use crate::state::AppState;

/// Fired after anything that changes the catalogue, so every view can refresh.
pub const LIBRARY_CHANGED: &str = "library-changed";
pub const IMPORT_PROGRESS: &str = "import-progress";

#[tauri::command(async)]
pub fn list_books(state: State<'_, AppState>, query: BookQuery) -> AppResult<Vec<Book>> {
    books::list(&*state.conn()?, &query)
}

#[tauri::command(async)]
pub fn get_book(state: State<'_, AppState>, id: String) -> AppResult<Book> {
    books::get(&*state.conn()?, &id)
}

#[tauri::command(async)]
pub fn library_stats(state: State<'_, AppState>) -> AppResult<LibraryStats> {
    books::stats(&*state.conn()?)
}

/// Imports files and/or folders. Runs on a blocking thread and streams progress events.
#[tauri::command]
pub async fn import_paths(app: AppHandle, paths: Vec<String>) -> AppResult<ImportReport> {
    let inputs: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
    let worker = app.clone();
    let report = tauri::async_runtime::spawn_blocking(move || {
        let state = worker.state::<AppState>();
        import::import_all(&state.db, &state.paths, &inputs, |done, total, current| {
            let _ = worker.emit(
                IMPORT_PROGRESS,
                ImportProgress { done, total, current: current.to_string() },
            );
        })
    })
    .await
    .map_err(|e| AppError::Invalid(e.to_string()))?;

    if !report.imported.is_empty() {
        let _ = app.emit(LIBRARY_CHANGED, ());
    }
    Ok(report)
}

#[tauri::command(async)]
pub fn delete_book(app: AppHandle, state: State<'_, AppState>, id: String) -> AppResult<()> {
    let files = books::delete(&mut *state.conn()?, &id)?;
    // The row is gone; failing to delete a file only leaves an orphan, so don't error.
    let _ = std::fs::remove_file(state.paths.book_file(&files.file_name)?);
    if let Some(cover) = files.cover_file {
        let _ = std::fs::remove_file(state.paths.cover_file(&cover)?);
    }
    state.paths.remove_thumb(&id);
    let _ = app.emit(LIBRARY_CHANGED, ());
    Ok(())
}

#[tauri::command(async)]
pub fn set_favorite(state: State<'_, AppState>, id: String, favorite: bool) -> AppResult<Book> {
    let conn = state.conn()?;
    books::set_favorite(&conn, &id, favorite)?;
    books::get(&conn, &id)
}

#[tauri::command(async)]
pub fn save_progress(
    state: State<'_, AppState>,
    id: String,
    locator: String,
    percent: f64,
) -> AppResult<()> {
    if !percent.is_finite() {
        return Err(AppError::Invalid("percent must be a finite number".into()));
    }
    books::save_progress(&*state.conn()?, &id, &locator, percent)
}

/// Receives a cover rendered by the frontend as a raw binary body (no JSON
/// array-of-numbers overhead). The book id travels in the `x-book-id` header.
#[tauri::command]
pub fn save_cover(app: AppHandle, state: State<'_, AppState>, request: Request<'_>) -> AppResult<()> {
    let id = request
        .headers()
        .get("x-book-id")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| AppError::Invalid("missing x-book-id header".into()))?
        .to_string();
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(AppError::Invalid("expected a binary body".into()));
    };
    if bytes.is_empty() || bytes.len() > 10 * 1024 * 1024 {
        return Err(AppError::Invalid("cover must be between 1 byte and 10 MB".into()));
    }

    let conn = state.conn()?;
    let previous = books::cover_file(&conn, &id)?;
    let name = format!("{id}.{}", image_extension(bytes, None));
    std::fs::write(state.paths.cover_file(&name)?, bytes)?;
    state.paths.remove_thumb(&id); // regenerated lazily from the new cover
    books::set_cover(&conn, &id, Some(&name))?;
    if let Some(old) = previous.filter(|old| old != &name) {
        let _ = std::fs::remove_file(state.paths.cover_file(&old)?);
    }
    let _ = app.emit(LIBRARY_CHANGED, ());
    Ok(())
}

/// Called when the frontend could not render a cover either; stops retrying.
#[tauri::command(async)]
pub fn mark_cover_missing(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.paths.remove_thumb(&id);
    books::set_cover(&*state.conn()?, &id, None)
}

/// The window material behind the UI: "mica" on Windows 11 (the frontend then
/// lets it show through), otherwise "none" (the UI stays fully opaque).
#[tauri::command]
pub fn window_material() -> &'static str {
    #[cfg(windows)]
    {
        // Mica arrived in Windows 11 (build 22000); on Windows 10 the effect is a no-op.
        if windows_version::OsVersion::current().build >= 22000 {
            return "mica";
        }
    }
    "none"
}

/// Cached epub.js location map for a book, if one was saved at this granularity.
#[tauri::command(async)]
pub fn get_locations(state: State<'_, AppState>, id: String, chars_per: u32) -> AppResult<Option<String>> {
    books::get_locations(&*state.conn()?, &id, chars_per)
}

#[tauri::command(async)]
pub fn save_locations(state: State<'_, AppState>, id: String, chars_per: u32, data: String) -> AppResult<()> {
    if data.len() > 4 * 1024 * 1024 {
        return Err(AppError::Invalid("location map too large".into()));
    }
    books::save_locations(&*state.conn()?, &id, chars_per, &data)
}
