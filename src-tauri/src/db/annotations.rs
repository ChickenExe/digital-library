//! Highlights and notes. All SQL touching `annotations` lives here.

use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::db::books::now_ms;
use crate::error::{AppError, AppResult};
use crate::models::{Annotation, AnnotationPatch, HighlightColor, NewAnnotation};

const MAX_LOCATOR: usize = 64 * 1024;
const MAX_QUOTE: usize = 8 * 1024;
const MAX_NOTE: usize = 32 * 1024;
const MAX_REF: usize = 128;

const SELECT: &str = "SELECT id, book_ref, locator, quote, note, color, chapter, position, created_at, updated_at
                      FROM annotations";

fn map(row: &Row<'_>) -> rusqlite::Result<Annotation> {
    let color: String = row.get(5)?;
    Ok(Annotation {
        id: row.get(0)?,
        book_ref: row.get(1)?,
        locator: row.get(2)?,
        quote: row.get(3)?,
        note: row.get(4)?,
        color: HighlightColor::parse(&color),
        chapter: row.get(6)?,
        position: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

/// Cuts a string to at most `max` bytes without splitting a character.
fn clip(s: &str, max: usize) -> String {
    if s.len() <= max {
        return s.to_string();
    }
    let mut end = max;
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    s[..end].to_string()
}

/// Empty and whitespace-only notes are stored as "no note".
fn clean_note(note: Option<&str>) -> AppResult<Option<String>> {
    match note.map(str::trim) {
        Some(n) if n.len() > MAX_NOTE => Err(AppError::Invalid("note is too long".into())),
        Some("") | None => Ok(None),
        Some(n) => Ok(Some(n.to_string())),
    }
}

/// A book's annotations in reading order.
pub fn list(conn: &Connection, book_ref: &str) -> AppResult<Vec<Annotation>> {
    let mut stmt = conn.prepare(&format!("{SELECT} WHERE book_ref = ? ORDER BY position, created_at"))?;
    let items = stmt.query_map([book_ref], map)?.collect::<Result<Vec<_>, _>>()?;
    Ok(items)
}

pub fn get(conn: &Connection, id: &str) -> AppResult<Annotation> {
    conn.query_row(&format!("{SELECT} WHERE id = ?"), [id], map)
        .optional()?
        .ok_or_else(|| AppError::NotFound(format!("annotation {id}")))
}

pub fn create(conn: &Connection, new: &NewAnnotation) -> AppResult<Annotation> {
    if new.book_ref.is_empty() || new.book_ref.len() > MAX_REF {
        return Err(AppError::Invalid("bad book reference".into()));
    }
    if new.locator.is_empty() || new.locator.len() > MAX_LOCATOR {
        return Err(AppError::Invalid("bad annotation locator".into()));
    }
    if !new.position.is_finite() {
        return Err(AppError::Invalid("position must be a finite number".into()));
    }
    let id = uuid::Uuid::now_v7().to_string();
    let now = now_ms();
    conn.execute(
        "INSERT INTO annotations (id, book_ref, locator, quote, note, color, chapter, position, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
        params![
            id,
            new.book_ref,
            new.locator,
            clip(new.quote.trim(), MAX_QUOTE),
            clean_note(new.note.as_deref())?,
            new.color.as_str(),
            new.chapter.as_deref().map(|c| clip(c.trim(), 512)),
            new.position.clamp(0.0, 1.0),
            now,
        ],
    )?;
    get(conn, &id)
}

pub fn update(conn: &Connection, id: &str, patch: &AnnotationPatch) -> AppResult<Annotation> {
    let current = get(conn, id)?;
    let note = match &patch.note {
        Some(n) => clean_note(Some(n))?,
        None => current.note,
    };
    let color = patch.color.unwrap_or(current.color);
    conn.execute(
        "UPDATE annotations SET note = ?2, color = ?3, updated_at = ?4 WHERE id = ?1",
        params![id, note, color.as_str(), now_ms()],
    )?;
    get(conn, id)
}

pub fn delete(conn: &Connection, id: &str) -> AppResult<()> {
    if conn.execute("DELETE FROM annotations WHERE id = ?", [id])? == 0 {
        return Err(AppError::NotFound(format!("annotation {id}")));
    }
    Ok(())
}

/// Moves every annotation from one book reference to another (a streamed book
/// that has just been added to the library).
pub fn rekey(conn: &Connection, from: &str, to: &str) -> AppResult<usize> {
    Ok(conn.execute("UPDATE annotations SET book_ref = ?2 WHERE book_ref = ?1", params![from, to])?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{open_in_memory, LIBRARY_MIGRATIONS};

    fn new(book_ref: &str, position: f64) -> NewAnnotation {
        NewAnnotation {
            book_ref: book_ref.into(),
            locator: "epubcfi(/6/4!/4/2,/1:0,/1:12)".into(),
            quote: "  It is a truth  ".into(),
            note: None,
            color: HighlightColor::Yellow,
            chapter: Some("Chapter 1".into()),
            position,
        }
    }

    #[test]
    fn create_list_update_delete() {
        let conn = open_in_memory(LIBRARY_MIGRATIONS).unwrap();
        let later = create(&conn, &new("book-a", 0.5)).unwrap();
        let earlier = create(&conn, &new("book-a", 0.1)).unwrap();
        create(&conn, &new("book-b", 0.2)).unwrap();

        assert_eq!(earlier.quote, "It is a truth", "quotes are trimmed");
        let listed: Vec<_> = list(&conn, "book-a").unwrap().into_iter().map(|a| a.id).collect();
        assert_eq!(listed, vec![earlier.id.clone(), later.id.clone()], "reading order");

        let noted = update(&conn, &later.id, &AnnotationPatch { note: Some(" Irony ".into()), color: Some(HighlightColor::Blue) })
            .unwrap();
        assert_eq!(noted.note.as_deref(), Some("Irony"));
        assert_eq!(noted.color, HighlightColor::Blue);

        // Changing only the colour keeps the note; an empty note clears it.
        let recoloured = update(&conn, &later.id, &AnnotationPatch { note: None, color: Some(HighlightColor::Pink) }).unwrap();
        assert_eq!(recoloured.note.as_deref(), Some("Irony"));
        let cleared = update(&conn, &later.id, &AnnotationPatch { note: Some("   ".into()), color: None }).unwrap();
        assert_eq!(cleared.note, None);
        assert_eq!(cleared.color, HighlightColor::Pink);

        delete(&conn, &later.id).unwrap();
        assert!(delete(&conn, &later.id).is_err());
        assert_eq!(list(&conn, "book-a").unwrap().len(), 1);
    }

    #[test]
    fn rejects_bad_input() {
        let conn = open_in_memory(LIBRARY_MIGRATIONS).unwrap();
        let mut bad = new("book", 0.0);
        bad.locator.clear();
        assert!(create(&conn, &bad).is_err());
        let mut bad = new("book", f64::NAN);
        assert!(create(&conn, &bad).is_err());
        bad = new("", 0.0);
        assert!(create(&conn, &bad).is_err());
        let mut long = new("book", 0.0);
        long.note = Some("x".repeat(MAX_NOTE + 1));
        assert!(create(&conn, &long).is_err());
    }

    #[test]
    fn clips_on_char_boundaries() {
        let s = "é".repeat(10); // 2 bytes each
        assert_eq!(clip(&s, 5), "éé");
    }

    #[test]
    fn rekeys_streamed_notes() {
        let conn = open_in_memory(LIBRARY_MIGRATIONS).unwrap();
        create(&conn, &new("gutenberg/1342", 0.3)).unwrap();
        assert_eq!(rekey(&conn, "gutenberg/1342", "book-id").unwrap(), 1);
        assert!(list(&conn, "gutenberg/1342").unwrap().is_empty());
        assert_eq!(list(&conn, "book-id").unwrap().len(), 1);
    }
}
