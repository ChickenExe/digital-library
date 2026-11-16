//! SQLite connections + forward-only migrations tracked via `PRAGMA user_version`.
//!
//! Two databases:
//! - `library.db`: the user's books. Precious; migrations are append-only.
//! - `catalog.db`: an index of remote catalogs. A cache; safe to delete and rebuild.

pub mod books;

use rusqlite::Connection;
use std::path::Path;

use crate::error::AppResult;

/// Library migrations. Append only — never edit a shipped migration.
pub const LIBRARY_MIGRATIONS: &[&str] = &[
    include_str!("../../migrations/0001_init.sql"),
    include_str!("../../migrations/0002_book_source.sql"),
    include_str!("../../migrations/0003_volume_numbers.sql"),
    include_str!("../../migrations/0004_locations_cache.sql"),
];

pub fn open(path: &Path, migrations: &[&str]) -> AppResult<Connection> {
    let mut conn = Connection::open(path)?;
    configure(&conn)?;
    migrate(&mut conn, migrations)?;
    Ok(conn)
}

#[cfg(test)]
pub fn open_in_memory(migrations: &[&str]) -> AppResult<Connection> {
    let mut conn = Connection::open_in_memory()?;
    configure(&conn)?;
    migrate(&mut conn, migrations)?;
    Ok(conn)
}

fn configure(conn: &Connection) -> AppResult<()> {
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA foreign_keys = ON;
         PRAGMA busy_timeout = 5000;",
    )?;
    Ok(())
}

fn migrate(conn: &mut Connection, migrations: &[&str]) -> AppResult<()> {
    let current: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    for (index, sql) in migrations.iter().enumerate().skip(current as usize) {
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", (index + 1) as i64)?;
        tx.commit()?;
        log::info!("applied migration {}", index + 1);
    }
    Ok(())
}
