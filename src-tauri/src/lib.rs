mod commands;
mod db;
mod error;
mod import;
mod library;
mod models;
mod protocol;
mod state;

use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

use library::LibraryPaths;
use protocol::Kind;
use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .register_asynchronous_uri_scheme_protocol("book", |ctx, req, res| {
            protocol::handle(Kind::Book, ctx, req, res)
        })
        .register_asynchronous_uri_scheme_protocol("cover", |ctx, req, res| {
            protocol::handle(Kind::Cover, ctx, req, res)
        })
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let paths = LibraryPaths::new(&data_dir)?;
            let conn = db::open(&paths.db)?;
            log::info!("library at {}", data_dir.display());
            app.manage(AppState { db: Mutex::new(conn), paths });
            import_launch_args(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_books,
            commands::get_book,
            commands::library_stats,
            commands::import_paths,
            commands::delete_book,
            commands::set_favorite,
            commands::save_progress,
            commands::save_cover,
            commands::mark_cover_missing,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Digital Library");
}

/// Files passed on the command line (`DigitalLibrary.exe book.epub`) are imported
/// on launch. This is how Windows "Open with" / file associations hand us files.
fn import_launch_args(app: AppHandle) {
    let inputs: Vec<PathBuf> = std::env::args_os()
        .skip(1)
        .map(PathBuf::from)
        .filter(|p| p.exists())
        .collect();
    if inputs.is_empty() {
        return;
    }
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let report = import::import_all(&state.db, &state.paths, &inputs, |_, _, _| {});
        log::info!(
            "launch import: {} added, {} duplicates, {} failed",
            report.imported.len(),
            report.duplicates.len(),
            report.failed.len()
        );
        let _ = app.emit(commands::LIBRARY_CHANGED, ());
    });
}
