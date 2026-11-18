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
    include_str!("../../migrations/0005_more_formats.sql"),
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
    if current as usize >= migrations.len() {
        return Ok(());
    }
    // Some migrations rebuild a table (SQLite can't drop a CHECK constraint in
    // place). Dropping the old table with foreign keys on would cascade-delete
    // its children, so keys are off while migrating (the pragma is a no-op
    // inside a transaction) and checked before each commit instead.
    conn.pragma_update(None, "foreign_keys", false)?;
    let result = (|| -> AppResult<()> {
        for (index, sql) in migrations.iter().enumerate().skip(current as usize) {
            let tx = conn.transaction()?;
            tx.execute_batch(sql)?;
            let broken: Option<String> = tx
                .query_row("PRAGMA foreign_key_check", [], |r| r.get(0))
                .ok();
            if let Some(table) = broken {
                return Err(crate::error::AppError::Invalid(format!(
                    "migration {} broke a reference in {table}",
                    index + 1
                )));
            }
            tx.pragma_update(None, "user_version", (index + 1) as i64)?;
            tx.commit()?;
            log::info!("applied migration {}", index + 1);
        }
        Ok(())
    })();
    conn.pragma_update(None, "foreign_keys", true)?;
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Rebuilding `books` (0005) must keep the rows that reference it.
    #[test]
    fn format_migration_keeps_progress_and_authors() {
        let mut conn = Connection::open_in_memory().unwrap();
        configure(&conn).unwrap();
        migrate(&mut conn, &LIBRARY_MIGRATIONS[..4]).unwrap();
        conn.execute_batch(
            "INSERT INTO books (id, title, sort_title, format, file_name, original_name, file_size, file_hash, added_at, updated_at, volume_no)
               VALUES ('b1', 'T', 't', 'epub', 'b1.epub', 'x.epub', 1, 'h', 1, 1, 1);
             INSERT INTO authors (id, name, sort_name) VALUES (1, 'A', 'A');
             INSERT INTO book_authors VALUES ('b1', 1, 0);
             INSERT INTO reading_progress VALUES ('b1', 'cfi', 0.5, 1);",
        )
        .unwrap();
        migrate(&mut conn, LIBRARY_MIGRATIONS).unwrap();
        let count = |sql: &str| conn.query_row(sql, [], |r| r.get::<_, i64>(0)).unwrap();
        assert_eq!(count("SELECT COUNT(*) FROM reading_progress"), 1);
        assert_eq!(count("SELECT COUNT(*) FROM book_authors"), 1);
        assert_eq!(count("PRAGMA foreign_keys"), 1);
        // New formats are accepted, and deleting still cascades.
        conn.execute("UPDATE books SET format = 'mobi'", []).unwrap();
        conn.execute("DELETE FROM books", []).unwrap();
        assert_eq!(count("SELECT COUNT(*) FROM reading_progress"), 0);
    }
}
