use rusqlite::Connection;
use std::sync::{Mutex, MutexGuard};

use crate::error::{AppError, AppResult};
use crate::library::LibraryPaths;

/// Managed Tauri state. A single connection behind a mutex is plenty for a
/// single-user desktop app; SQLite in WAL mode keeps writes fast.
pub struct AppState {
    pub db: Mutex<Connection>,
    pub paths: LibraryPaths,
}

impl AppState {
    pub fn conn(&self) -> AppResult<MutexGuard<'_, Connection>> {
        self.db.lock().map_err(|_| AppError::Invalid("database lock poisoned".into()))
    }
}
