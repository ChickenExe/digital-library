//! Book repository. All SQL touching `books`, `authors` and `books_fts` lives here.

use rusqlite::{params, params_from_iter, Connection, OptionalExtension, Row, Transaction};

use crate::error::{AppError, AppResult};
use crate::models::{
    Book, BookFormat, BookQuery, CoverState, LibraryStats, ReadingProgress, Shelf, SortKey,
};

/// A book is "finished" once progress crosses this threshold.
pub const FINISHED_AT: f64 = 0.98;

/// Everything needed to insert a freshly imported book.
#[derive(Debug, Clone)]
pub struct NewBook {
    pub id: String,
    pub title: String,
    pub authors: Vec<String>,
    pub description: Option<String>,
    pub publisher: Option<String>,
    pub language: Option<String>,
    pub published: Option<String>,
    pub isbn: Option<String>,
    pub format: BookFormat,
    pub file_name: String,
    pub original_name: String,
    pub file_size: i64,
    pub file_hash: String,
    pub page_count: Option<u32>,
    pub cover_file: Option<String>,
    pub cover_state: CoverState,
    pub origin: Option<Origin>,
}

/// The catalog listing a book was acquired from.
#[derive(Debug, Clone)]
pub struct Origin {
    pub provider: String,
    pub id: String,
}

/// Paths of files that belong to a deleted book, so the caller can remove them.
pub struct BookFiles {
    pub file_name: String,
    pub cover_file: Option<String>,
}

const SELECT_BOOK: &str = "
    SELECT b.id, b.title, b.description, b.publisher, b.language, b.published, b.isbn,
           b.format, b.file_size, b.page_count, b.cover_state, b.cover_updated_at, b.favorite,
           b.added_at, p.locator, p.percent, p.updated_at,
           (SELECT json_group_array(name) FROM (
                SELECT a.name FROM book_authors ba JOIN authors a ON a.id = ba.author_id
                WHERE ba.book_id = b.id ORDER BY ba.position)) AS authors,
           b.volume_no
    FROM books b
    LEFT JOIN reading_progress p ON p.book_id = b.id";

fn map_book(row: &Row<'_>) -> rusqlite::Result<Book> {
    let format: String = row.get(7)?;
    let cover_state: String = row.get(10)?;
    let locator: Option<String> = row.get(14)?;
    let authors_json: String = row.get(17)?;
    Ok(Book {
        id: row.get(0)?,
        title: row.get(1)?,
        description: row.get(2)?,
        publisher: row.get(3)?,
        language: row.get(4)?,
        published: row.get(5)?,
        isbn: row.get(6)?,
        format: BookFormat::parse(&format).unwrap_or(BookFormat::Epub),
        file_size: row.get(8)?,
        page_count: row.get(9)?,
        cover_state: CoverState::parse(&cover_state),
        cover_version: row.get(11)?,
        favorite: row.get(12)?,
        added_at: row.get(13)?,
        progress: match locator {
            Some(locator) => Some(ReadingProgress {
                locator,
                percent: row.get(15)?,
                updated_at: row.get(16)?,
            }),
            None => None,
        },
        authors: serde_json::from_str(&authors_json).unwrap_or_default(),
        volume: row.get::<_, Option<u32>>(18)?.unwrap_or_default(),
    })
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or_default()
}

/// "The Left Hand of Darkness" -> "left hand of darkness"
pub fn sort_title(title: &str) -> String {
    let lower = title.trim().to_lowercase();
    for article in ["the ", "a ", "an "] {
        if let Some(rest) = lower.strip_prefix(article) {
            return rest.trim_start().to_string();
        }
    }
    lower
}

/// "Ursula K. Le Guin" -> "le guin, ursula k." (good-enough heuristic; editable later)
pub fn sort_name(name: &str) -> String {
    let name = name.trim();
    if name.contains(',') {
        return name.to_lowercase();
    }
    let parts: Vec<&str> = name.split_whitespace().collect();
    match parts.len() {
        0 | 1 => name.to_lowercase(),
        _ => {
            // Keep surname particles ("Le Guin", "van Gogh", "de la Cruz") with the surname.
            const PARTICLES: &[&str] = &[
                "da", "de", "del", "della", "der", "des", "di", "du", "la", "le", "st.", "ten",
                "ter", "van", "von",
            ];
            let mut split = parts.len() - 1;
            while split > 1 && PARTICLES.contains(&parts[split - 1].to_lowercase().as_str()) {
                split -= 1;
            }
            let (given, family) = parts.split_at(split);
            format!("{}, {}", family.join(" "), given.join(" ")).to_lowercase()
        }
    }
}

/// Turns free text into a safe FTS5 prefix query: `ursu le` -> `"ursu"* "le"*`.
fn fts_query(input: &str) -> Option<String> {
    let terms: Vec<String> = input
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| !t.is_empty())
        .map(|t| format!("\"{t}\"*"))
        .collect();
    (!terms.is_empty()).then(|| terms.join(" "))
}

/// Lists books for grids. Descriptions are omitted (they can be long and grids
/// never show them); use [`get`] for a single book's full record.
pub fn list(conn: &Connection, query: &BookQuery) -> AppResult<Vec<Book>> {
    let mut sql = format!("{SELECT_BOOK} WHERE 1 = 1");
    let mut args: Vec<String> = Vec::new();

    if let Some(fts) = query.search.as_deref().and_then(fts_query) {
        sql.push_str(" AND b.id IN (SELECT book_id FROM books_fts WHERE books_fts MATCH ?)");
        args.push(fts);
    }
    if let Some(format) = query.format {
        sql.push_str(" AND b.format = ?");
        args.push(format.as_str().to_string());
    }
    match query.shelf {
        Shelf::All => {}
        Shelf::Favorites => sql.push_str(" AND b.favorite = 1"),
        Shelf::Reading => sql.push_str(&format!(" AND p.percent < {FINISHED_AT}")),
        Shelf::Finished => sql.push_str(&format!(" AND p.percent >= {FINISHED_AT}")),
    }
    sql.push_str(match query.sort {
        SortKey::Recent => " ORDER BY b.added_at DESC",
        SortKey::Title => " ORDER BY b.sort_title COLLATE NOCASE ASC",
        SortKey::Author => {
            " ORDER BY (SELECT a.sort_name FROM book_authors ba JOIN authors a ON a.id = ba.author_id
                         WHERE ba.book_id = b.id ORDER BY ba.position LIMIT 1) IS NULL,
                       (SELECT a.sort_name FROM book_authors ba JOIN authors a ON a.id = ba.author_id
                         WHERE ba.book_id = b.id ORDER BY ba.position LIMIT 1) ASC,
                       b.sort_title ASC"
        }
        SortKey::LastRead => " ORDER BY p.updated_at IS NULL, p.updated_at DESC, b.added_at DESC",
    });
    if let Some(limit) = query.limit {
        sql.push_str(" LIMIT ?");
        args.push(limit.to_string());
    }

    let mut stmt = conn.prepare(&sql)?;
    let books = stmt
        .query_map(params_from_iter(args.iter()), |row| {
            let mut book = map_book(row)?;
            book.description = None;
            Ok(book)
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(books)
}

pub fn get(conn: &Connection, id: &str) -> AppResult<Book> {
    conn.query_row(&format!("{SELECT_BOOK} WHERE b.id = ?"), [id], map_book)
        .optional()?
        .ok_or_else(|| AppError::NotFound(format!("book {id}")))
}

/// `book id -> percent read` for every book that has been opened.
pub fn progress_map(conn: &Connection) -> AppResult<std::collections::HashMap<String, f64>> {
    let mut stmt = conn.prepare("SELECT book_id, percent FROM reading_progress")?;
    let map = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<Result<_, _>>()?;
    Ok(map)
}

pub fn get_locations(conn: &Connection, id: &str, chars_per: u32) -> AppResult<Option<String>> {
    Ok(conn
        .query_row(
            "SELECT data FROM book_locations WHERE book_id = ? AND chars_per = ?",
            params![id, chars_per],
            |r| r.get(0),
        )
        .optional()?)
}

pub fn save_locations(conn: &Connection, id: &str, chars_per: u32, data: &str) -> AppResult<()> {
    conn.execute(
        "INSERT INTO book_locations (book_id, chars_per, data) VALUES (?1, ?2, ?3)
         ON CONFLICT (book_id) DO UPDATE SET chars_per = excluded.chars_per, data = excluded.data",
        params![id, chars_per, data],
    )?;
    Ok(())
}

pub fn find_by_hash(conn: &Connection, hash: &str) -> AppResult<Option<String>> {
    Ok(conn
        .query_row("SELECT id FROM books WHERE file_hash = ?", [hash], |r| r.get(0))
        .optional()?)
}

/// Links an existing book to a catalog listing (e.g. the user imported the same file earlier).
pub fn set_origin(conn: &Connection, id: &str, origin: &Origin) -> AppResult<()> {
    conn.execute(
        "UPDATE books SET source_provider = ?2, source_id = ?3
         WHERE id = ?1 AND source_provider IS NULL",
        params![id, origin.provider, origin.id],
    )?;
    Ok(())
}

pub fn find_by_origin(conn: &Connection, provider: &str, source_id: &str) -> AppResult<Option<String>> {
    Ok(conn
        .query_row(
            "SELECT id FROM books WHERE source_provider = ? AND source_id = ?",
            [provider, source_id],
            |r| r.get(0),
        )
        .optional()?)
}

/// `source_id -> book id` for every book acquired from `provider`.
pub fn owned_from(conn: &Connection, provider: &str) -> AppResult<std::collections::HashMap<String, String>> {
    let mut stmt =
        conn.prepare("SELECT source_id, id FROM books WHERE source_provider = ?")?;
    let map = stmt
        .query_map([provider], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<Result<_, _>>()?;
    Ok(map)
}

pub fn file_name(conn: &Connection, id: &str) -> AppResult<Option<(String, String)>> {
    Ok(conn
        .query_row("SELECT file_name, format FROM books WHERE id = ?", [id], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .optional()?)
}

pub fn cover_file(conn: &Connection, id: &str) -> AppResult<Option<String>> {
    Ok(conn
        .query_row("SELECT cover_file FROM books WHERE id = ?", [id], |r| r.get(0))
        .optional()?
        .flatten())
}

pub fn insert(conn: &mut Connection, book: &NewBook) -> AppResult<()> {
    let tx = conn.transaction()?;
    let now = now_ms();
    // Collector's numbers come from a counter (not MAX+1) so they're never reused after a delete.
    let volume_no: i64 = tx.query_row(
        "UPDATE app_counters SET value = value + 1 WHERE name = 'volume_no' RETURNING value",
        [],
        |r| r.get(0),
    )?;
    tx.execute(
        "INSERT INTO books (id, title, sort_title, description, publisher, language, published,
                            isbn, format, file_name, original_name, file_size, file_hash,
                            page_count, cover_file, cover_state, cover_updated_at, added_at, updated_at,
                            source_provider, source_id, volume_no)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?17, ?17,
                 ?18, ?19, ?20)",
        params![
            book.id,
            book.title,
            sort_title(&book.title),
            book.description,
            book.publisher,
            book.language,
            book.published,
            book.isbn,
            book.format.as_str(),
            book.file_name,
            book.original_name,
            book.file_size,
            book.file_hash,
            book.page_count,
            book.cover_file,
            book.cover_state.as_str(),
            now,
            book.origin.as_ref().map(|o| &o.provider),
            book.origin.as_ref().map(|o| &o.id),
            volume_no,
        ],
    )?;
    set_authors(&tx, &book.id, &book.authors)?;
    tx.execute(
        "INSERT INTO books_fts (book_id, title, authors, description) VALUES (?, ?, ?, ?)",
        params![
            book.id,
            book.title,
            book.authors.join(", "),
            book.description.as_deref().unwrap_or("")
        ],
    )?;
    tx.commit()?;
    Ok(())
}

fn set_authors(tx: &Transaction<'_>, book_id: &str, authors: &[String]) -> AppResult<()> {
    tx.execute("DELETE FROM book_authors WHERE book_id = ?", [book_id])?;
    for (position, name) in authors.iter().enumerate() {
        tx.execute(
            "INSERT INTO authors (name, sort_name) VALUES (?1, ?2) ON CONFLICT (name) DO NOTHING",
            params![name, sort_name(name)],
        )?;
        tx.execute(
            "INSERT OR IGNORE INTO book_authors (book_id, author_id, position)
             SELECT ?1, id, ?2 FROM authors WHERE name = ?3",
            params![book_id, position as i64, name],
        )?;
    }
    Ok(())
}

pub fn delete(conn: &mut Connection, id: &str) -> AppResult<BookFiles> {
    let tx = conn.transaction()?;
    let files = tx
        .query_row(
            "SELECT file_name, cover_file FROM books WHERE id = ?",
            [id],
            |r| Ok(BookFiles { file_name: r.get(0)?, cover_file: r.get(1)? }),
        )
        .optional()?
        .ok_or_else(|| AppError::NotFound(format!("book {id}")))?;
    tx.execute("DELETE FROM books_fts WHERE book_id = ?", [id])?;
    tx.execute("DELETE FROM books WHERE id = ?", [id])?;
    // Annotations reference books loosely (they may belong to a streamed book), so no cascade.
    tx.execute("DELETE FROM annotations WHERE book_ref = ?", [id])?;
    // Drop authors that no longer have any books.
    tx.execute(
        "DELETE FROM authors WHERE id NOT IN (SELECT DISTINCT author_id FROM book_authors)",
        [],
    )?;
    tx.commit()?;
    Ok(files)
}

pub fn set_favorite(conn: &Connection, id: &str, favorite: bool) -> AppResult<()> {
    let changed = conn.execute(
        "UPDATE books SET favorite = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, favorite, now_ms()],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound(format!("book {id}")));
    }
    Ok(())
}

pub fn set_cover(conn: &Connection, id: &str, cover_file: Option<&str>) -> AppResult<()> {
    let state = if cover_file.is_some() { CoverState::Present } else { CoverState::Missing };
    conn.execute(
        "UPDATE books SET cover_file = ?2, cover_state = ?3, cover_updated_at = ?4, updated_at = ?4 WHERE id = ?1",
        params![id, cover_file, state.as_str(), now_ms()],
    )?;
    Ok(())
}

pub fn save_progress(conn: &Connection, id: &str, locator: &str, percent: f64) -> AppResult<()> {
    let percent = percent.clamp(0.0, 1.0);
    conn.execute(
        "INSERT INTO reading_progress (book_id, locator, percent, updated_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (book_id) DO UPDATE
            SET locator = excluded.locator, percent = excluded.percent, updated_at = excluded.updated_at",
        params![id, locator, percent, now_ms()],
    )?;
    Ok(())
}

/// Reading position in a streamed (not yet owned) catalog book.
pub fn stream_progress(conn: &Connection, provider: &str, source_id: &str) -> AppResult<Option<ReadingProgress>> {
    Ok(conn
        .query_row(
            "SELECT locator, percent, updated_at FROM stream_progress WHERE provider = ? AND source_id = ?",
            [provider, source_id],
            |r| Ok(ReadingProgress { locator: r.get(0)?, percent: r.get(1)?, updated_at: r.get(2)? }),
        )
        .optional()?)
}

pub fn save_stream_progress(conn: &Connection, provider: &str, source_id: &str, locator: &str, percent: f64) -> AppResult<()> {
    conn.execute(
        "INSERT INTO stream_progress (provider, source_id, locator, percent, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT (provider, source_id) DO UPDATE
            SET locator = excluded.locator, percent = excluded.percent, updated_at = excluded.updated_at",
        params![provider, source_id, locator, percent.clamp(0.0, 1.0), now_ms()],
    )?;
    Ok(())
}

/// A streamed book was added to the library: its notes and reading position
/// move to the library copy (an existing library position wins).
pub fn adopt_stream(conn: &mut Connection, provider: &str, source_id: &str, book_id: &str) -> AppResult<()> {
    let tx = conn.transaction()?;
    let key = format!("{provider}/{source_id}");
    crate::db::annotations::rekey(&tx, &key, book_id)?;
    tx.execute(
        "INSERT OR IGNORE INTO reading_progress (book_id, locator, percent, updated_at)
         SELECT ?3, locator, percent, updated_at FROM stream_progress WHERE provider = ?1 AND source_id = ?2",
        params![provider, source_id, book_id],
    )?;
    tx.execute("DELETE FROM stream_progress WHERE provider = ? AND source_id = ?", [provider, source_id])?;
    tx.commit()?;
    Ok(())
}

pub fn stats(conn: &Connection) -> AppResult<LibraryStats> {
    Ok(conn.query_row(
        &format!(
            "SELECT (SELECT COUNT(*) FROM books),
                    (SELECT COUNT(*) FROM reading_progress WHERE percent < {FINISHED_AT}),
                    (SELECT COUNT(*) FROM books WHERE favorite = 1),
                    (SELECT COUNT(*) FROM reading_progress WHERE percent >= {FINISHED_AT}),
                    (SELECT COUNT(DISTINCT author_id) FROM book_authors)"
        ),
        [],
        |r| {
            Ok(LibraryStats {
                total: r.get(0)?,
                reading: r.get(1)?,
                favorites: r.get(2)?,
                finished: r.get(3)?,
                authors: r.get(4)?,
            })
        },
    )?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;

    fn sample(id: &str, title: &str, authors: &[&str], hash: &str) -> NewBook {
        NewBook {
            id: id.into(),
            title: title.into(),
            authors: authors.iter().map(|a| a.to_string()).collect(),
            description: Some("A story about Gethen, a winter planet.".into()),
            publisher: None,
            language: Some("en".into()),
            published: None,
            isbn: None,
            format: BookFormat::Epub,
            file_name: format!("{id}.epub"),
            original_name: format!("{title}.epub"),
            file_size: 1024,
            file_hash: hash.into(),
            page_count: None,
            cover_file: None,
            cover_state: CoverState::Missing,
            origin: None,
        }
    }

    #[test]
    fn sort_helpers() {
        assert_eq!(sort_title("The Left Hand of Darkness"), "left hand of darkness");
        assert_eq!(sort_title("An Unkindness"), "unkindness");
        assert_eq!(sort_name("Ursula K. Le Guin"), "le guin, ursula k.");
        assert_eq!(sort_name("Ludwig van Beethoven"), "van beethoven, ludwig");
        assert_eq!(sort_name("Juana Inés de la Cruz"), "de la cruz, juana inés");
        assert_eq!(sort_name("Plato"), "plato");
    }

    #[test]
    fn insert_list_search_delete() {
        let mut conn = open_in_memory(crate::db::LIBRARY_MIGRATIONS).unwrap();
        insert(&mut conn, &sample("a", "The Left Hand of Darkness", &["Ursula K. Le Guin"], "h1")).unwrap();
        insert(&mut conn, &sample("b", "Café Society", &["Zadie Smith", "Ursula K. Le Guin"], "h2")).unwrap();

        let all = list(&conn, &BookQuery { sort: SortKey::Title, ..Default::default() }).unwrap();
        assert_eq!(all.iter().map(|b| b.id.as_str()).collect::<Vec<_>>(), ["b", "a"]);
        assert_eq!(all[0].authors, ["Zadie Smith", "Ursula K. Le Guin"]);

        // Prefix + diacritic-insensitive search.
        let hits = list(&conn, &BookQuery { search: Some("cafe soc".into()), ..Default::default() }).unwrap();
        assert_eq!(hits.len(), 1);
        let hits = list(&conn, &BookQuery { search: Some("guin".into()), ..Default::default() }).unwrap();
        assert_eq!(hits.len(), 2);
        // FTS syntax characters must not blow up the query.
        assert!(list(&conn, &BookQuery { search: Some("\"(*".into()), ..Default::default() }).is_ok());

        assert_eq!(find_by_hash(&conn, "h1").unwrap().as_deref(), Some("a"));

        save_progress(&conn, "a", "epubcfi(/6/4)", 0.5).unwrap();
        set_favorite(&conn, "b", true).unwrap();
        let limited = list(&conn, &BookQuery { limit: Some(1), ..Default::default() }).unwrap();
        assert_eq!(limited.len(), 1);
        assert!(limited[0].description.is_none(), "list omits descriptions");
        assert!(get(&conn, "a").unwrap().description.is_some());

        save_locations(&conn, "a", 1600, "[\"epubcfi(/6/2)\"]").unwrap();
        assert!(get_locations(&conn, "a", 1600).unwrap().is_some());
        assert!(get_locations(&conn, "a", 800).unwrap().is_none(), "different granularity is a miss");

        let s = stats(&conn).unwrap();
        assert_eq!((s.total, s.reading, s.favorites, s.finished, s.authors), (2, 1, 1, 0, 2));
        assert_eq!((get(&conn, "a").unwrap().volume, get(&conn, "b").unwrap().volume), (1, 2));
        let reading = list(&conn, &BookQuery { shelf: Shelf::Reading, ..Default::default() }).unwrap();
        assert_eq!(reading[0].progress.as_ref().unwrap().percent, 0.5);

        let origin = Origin { provider: "gutenberg".into(), id: "1342".into() };
        set_origin(&conn, "a", &origin).unwrap();
        assert_eq!(find_by_origin(&conn, "gutenberg", "1342").unwrap().as_deref(), Some("a"));
        assert_eq!(owned_from(&conn, "gutenberg").unwrap().get("1342").map(String::as_str), Some("a"));

        delete(&mut conn, "b").unwrap();
        assert!(get(&conn, "b").is_err());
        let authors: i64 = conn.query_row("SELECT COUNT(*) FROM authors", [], |r| r.get(0)).unwrap();
        assert_eq!(authors, 1, "orphaned authors are cleaned up");

        // Numbers are never reused after a delete.
        insert(&mut conn, &sample("c", "Emma", &["Jane Austen"], "h3")).unwrap();
        assert_eq!(get(&conn, "c").unwrap().volume, 3);
    }

    #[test]
    fn adopting_a_streamed_book_moves_notes_and_position() {
        use crate::db::annotations;
        use crate::models::{HighlightColor, NewAnnotation};
        let mut conn = open_in_memory(crate::db::LIBRARY_MIGRATIONS).unwrap();
        insert(&mut conn, &sample("lib", "Pride and Prejudice", &["Jane Austen"], "h")).unwrap();
        save_stream_progress(&conn, "gutenberg", "1342", "epubcfi(/6/8)", 0.25).unwrap();
        annotations::create(&conn, &NewAnnotation {
            book_ref: "gutenberg/1342".into(),
            locator: "epubcfi(/6/8!/4,/1:0,/1:5)".into(),
            quote: "truth".into(),
            note: Some("famous".into()),
            color: HighlightColor::Green,
            chapter: None,
            position: 0.25,
        })
        .unwrap();

        adopt_stream(&mut conn, "gutenberg", "1342", "lib").unwrap();
        assert_eq!(get(&conn, "lib").unwrap().progress.unwrap().locator, "epubcfi(/6/8)");
        assert!(stream_progress(&conn, "gutenberg", "1342").unwrap().is_none());
        assert_eq!(annotations::list(&conn, "lib").unwrap().len(), 1);

        // Deleting the book deletes its notes too.
        delete(&mut conn, "lib").unwrap();
        assert!(annotations::list(&conn, "lib").unwrap().is_empty());
    }
}
