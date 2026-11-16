//! catalog.db queries.

use rusqlite::{params, params_from_iter, types::Value, Connection, OptionalExtension, Row};
use std::collections::HashMap;

use super::gutenberg::{CatalogRecord, Detail};
use super::{CatalogEntry, CatalogPage, CatalogQuery};
use crate::error::AppResult;

const ENTRY_COLUMNS: &str =
    "e.provider, e.source_id, e.title, e.authors, e.language, e.categories, e.popularity";

fn map_entry(row: &Row<'_>) -> rusqlite::Result<CatalogEntry> {
    let authors: String = row.get(3)?;
    let categories: String = row.get(5)?;
    Ok(CatalogEntry {
        provider: row.get(0)?,
        id: row.get(1)?,
        title: row.get(2)?,
        authors: serde_json::from_str(&authors).unwrap_or_default(),
        language: row.get(4)?,
        categories: serde_json::from_str(&categories).unwrap_or_default(),
        popularity: row.get(6)?,
        owned_book_id: None,
    })
}

pub fn count(conn: &Connection) -> AppResult<u32> {
    Ok(conn.query_row("SELECT COUNT(*) FROM entries", [], |r| r.get(0))?)
}

pub fn sync_state(conn: &Connection, provider: &str) -> AppResult<Option<(i64, Option<String>)>> {
    Ok(conn
        .query_row(
            "SELECT synced_at, last_modified FROM sync_state WHERE provider = ?",
            [provider],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?)
}

pub fn set_sync_state(
    conn: &Connection,
    provider: &str,
    synced_at: i64,
    last_modified: Option<&str>,
) -> AppResult<()> {
    conn.execute(
        "INSERT INTO sync_state (provider, synced_at, last_modified) VALUES (?1, ?2, ?3)
         ON CONFLICT (provider) DO UPDATE
            SET synced_at = excluded.synced_at,
                last_modified = COALESCE(excluded.last_modified, sync_state.last_modified)",
        params![provider, synced_at, last_modified],
    )?;
    Ok(())
}

/// Bulk upsert of a provider's full catalog, then rebuilds the search index.
/// Upserting (rather than delete + insert) keeps cached details and rowids.
#[cfg(test)]
pub fn replace_catalog<'a>(
    conn: &mut Connection,
    provider: &str,
    records: impl IntoIterator<Item = &'a CatalogRecord>,
) -> AppResult<()> {
    replace_catalog_with(conn, provider, |emit| {
        for r in records {
            emit(r)?;
        }
        Ok(())
    })
}

/// Bulk upsert where records are pushed by `source` (lets callers stream them).
pub fn replace_catalog_with(
    conn: &mut Connection,
    provider: &str,
    source: impl FnOnce(&mut dyn FnMut(&CatalogRecord) -> AppResult<()>) -> AppResult<()>,
) -> AppResult<()> {
    let tx = conn.transaction()?;
    tx.execute(
        "DELETE FROM entry_categories WHERE entry_rowid IN (SELECT rowid FROM entries WHERE provider = ?)",
        [provider],
    )?;
    {
        let mut upsert = tx.prepare(
            "INSERT INTO entries (provider, source_id, title, authors, language, issued, subjects, categories)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT (provider, source_id) DO UPDATE SET
                title = excluded.title, authors = excluded.authors, language = excluded.language,
                issued = excluded.issued, subjects = excluded.subjects, categories = excluded.categories
             RETURNING rowid",
        )?;
        let mut categorize =
            tx.prepare("INSERT OR IGNORE INTO entry_categories (category, entry_rowid) VALUES (?, ?)")?;
        source(&mut |r: &CatalogRecord| {
            let rowid: i64 = upsert.query_row(
                params![
                    provider,
                    r.id,
                    r.title,
                    serde_json::to_string(&r.authors).unwrap_or_default(),
                    r.language,
                    r.issued,
                    serde_json::to_string(&r.subjects).unwrap_or_default(),
                    serde_json::to_string(&r.categories).unwrap_or_default(),
                ],
                |row| row.get(0),
            )?;
            for c in &r.categories {
                categorize.execute(params![c, rowid])?;
            }
            Ok(())
        })?;
    }
    tx.execute("INSERT INTO entries_fts (entries_fts) VALUES ('rebuild')", [])?;
    tx.execute("INSERT INTO entries_fts (entries_fts) VALUES ('optimize')", [])?;
    tx.commit()?;
    Ok(())
}

/// Replaces popularity ranks: `ids[0]` becomes rank 1.
pub fn set_popularity(conn: &mut Connection, provider: &str, ids: &[String]) -> AppResult<()> {
    let tx = conn.transaction()?;
    tx.execute("UPDATE entries SET popularity = NULL WHERE provider = ?", [provider])?;
    {
        let mut stmt =
            tx.prepare("UPDATE entries SET popularity = ?3 WHERE provider = ?1 AND source_id = ?2")?;
        for (i, id) in ids.iter().enumerate() {
            stmt.execute(params![provider, id, (i + 1) as i64])?;
        }
    }
    tx.commit()?;
    Ok(())
}

/// Most popular works, optionally within a category.
pub fn top(
    conn: &Connection,
    category: Option<&str>,
    language: Option<&str>,
    limit: u32,
) -> AppResult<Vec<CatalogEntry>> {
    let (sql, args): (String, Vec<Value>) = match category {
        Some(cat) => (
            // Unranked works fall back to catalogue order (lower PG ids skew towards canon).
            format!(
                "SELECT {ENTRY_COLUMNS} FROM entry_categories c JOIN entries e ON e.rowid = c.entry_rowid
                 WHERE c.category = ?1 AND (?2 IS NULL OR e.language = ?2)
                 ORDER BY e.popularity IS NULL, e.popularity, e.rowid LIMIT ?3"
            ),
            vec![cat.to_string().into(), language.map(String::from).into(), (limit as i64).into()],
        ),
        None => (
            format!(
                "SELECT {ENTRY_COLUMNS} FROM entries e
                 WHERE e.popularity IS NOT NULL AND (?1 IS NULL OR e.language = ?1)
                 ORDER BY e.popularity LIMIT ?2"
            ),
            vec![language.map(String::from).into(), (limit as i64).into()],
        ),
    };
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(args), map_entry)?.collect::<Result<_, _>>()?;
    Ok(rows)
}

fn fts_query(input: &str) -> Option<String> {
    let terms: Vec<String> = input
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| !t.is_empty())
        .map(|t| format!("\"{t}\"*"))
        .collect();
    (!terms.is_empty()).then(|| terms.join(" "))
}

/// Search and/or browse a category. Relevance is blended with popularity so
/// "pride" finds *Pride and Prejudice* before obscure sermons about pride.
pub fn search(conn: &Connection, q: &CatalogQuery) -> AppResult<CatalogPage> {
    let limit = q.limit.unwrap_or(48).clamp(1, 200) as i64;
    let offset = q.offset.unwrap_or(0) as i64;
    let fts = q.search.as_deref().and_then(fts_query);

    let mut from = String::from("FROM entries e");
    let mut filters = vec!["1 = 1".to_string()];
    let mut args: Vec<Value> = Vec::new();
    if let Some(fts) = &fts {
        from.push_str(" JOIN entries_fts f ON f.rowid = e.rowid");
        filters.push("entries_fts MATCH ?".into());
        args.push(fts.clone().into());
    }
    if let Some(cat) = &q.category {
        filters.push("e.rowid IN (SELECT entry_rowid FROM entry_categories WHERE category = ?)".into());
        args.push(cat.clone().into());
    }
    if let Some(lang) = &q.language {
        filters.push("e.language = ?".into());
        args.push(lang.clone().into());
    }
    let where_sql = filters.join(" AND ");

    let total: u32 =
        conn.query_row(&format!("SELECT COUNT(*) {from} WHERE {where_sql}"), params_from_iter(args.iter()), |r| r.get(0))?;

    let order = if fts.is_some() {
        // bm25 is negative (lower = better); popular titles get up to an 8-point boost.
        "bm25(entries_fts, 10.0, 6.0, 1.0)
           - CASE WHEN e.popularity IS NULL THEN 0 ELSE 8.0 * (1.0 - e.popularity / 1000.0) END"
    } else {
        "e.popularity IS NULL, e.popularity, e.rowid"
    };
    let mut page_args = args;
    page_args.push(limit.into());
    page_args.push(offset.into());
    let mut stmt = conn.prepare(&format!(
        "SELECT {ENTRY_COLUMNS} {from} WHERE {where_sql} ORDER BY {order} LIMIT ? OFFSET ?"
    ))?;
    let entries = stmt.query_map(params_from_iter(page_args), map_entry)?.collect::<Result<_, _>>()?;
    Ok(CatalogPage { entries, total })
}

pub struct StoredDetail {
    pub entry: CatalogEntry,
    pub subjects: Vec<String>,
    pub issued: Option<String>,
    pub detail: Detail,
    pub fetched_at: Option<i64>,
}

pub fn get(conn: &Connection, provider: &str, id: &str) -> AppResult<Option<StoredDetail>> {
    Ok(conn
        .query_row(
            &format!(
                "SELECT {ENTRY_COLUMNS}, e.subjects, e.issued, e.summary, e.downloads, e.reading_level,
                        e.detail_fetched_at
                 FROM entries e WHERE e.provider = ? AND e.source_id = ?"
            ),
            [provider, id],
            |r| {
                let subjects: String = r.get(7)?;
                Ok(StoredDetail {
                    entry: map_entry(r)?,
                    subjects: serde_json::from_str(&subjects).unwrap_or_default(),
                    issued: r.get(8)?,
                    detail: Detail { summary: r.get(9)?, downloads: r.get(10)?, reading_level: r.get(11)? },
                    fetched_at: r.get(12)?,
                })
            },
        )
        .optional()?)
}

pub fn save_detail(conn: &Connection, provider: &str, id: &str, d: &Detail, now: i64) -> AppResult<()> {
    conn.execute(
        "UPDATE entries SET summary = ?3, downloads = ?4, reading_level = ?5, detail_fetched_at = ?6
         WHERE provider = ?1 AND source_id = ?2",
        params![provider, id, d.summary, d.downloads, d.reading_level, now],
    )?;
    Ok(())
}

/// Marks entries the user already owns (`source_id -> book id`).
pub fn annotate_owned(entries: &mut [CatalogEntry], owned: &HashMap<String, String>) {
    for e in entries {
        e.owned_book_id = owned.get(&e.id).cloned();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalog::CATALOG_MIGRATIONS;

    fn rec(id: &str, title: &str, author: &str, cats: &[&str]) -> CatalogRecord {
        CatalogRecord {
            id: id.into(),
            title: title.into(),
            authors: vec![author.into()],
            language: Some("en".into()),
            issued: None,
            subjects: vec![],
            categories: cats.iter().map(|c| c.to_string()).collect(),
        }
    }

    #[test]
    fn sync_rank_browse_search() {
        let mut conn = crate::db::open_in_memory(CATALOG_MIGRATIONS).unwrap();
        let records = vec![
            rec("100", "Sermons on Pride", "A. Preacher", &["Religion/Spirituality"]),
            rec("1342", "Pride and Prejudice", "Jane Austen", &["Novels", "Romance"]),
            rec("84", "Frankenstein", "Mary Shelley", &["Novels", "Science-Fiction & Fantasy"]),
            rec("200", "Les Misérables", "Victor Hugo", &["Novels"]),
        ];
        replace_catalog(&mut conn, "gutenberg", records.iter()).unwrap();
        assert_eq!(count(&conn).unwrap(), 4);

        set_popularity(&mut conn, "gutenberg", &["84".into(), "1342".into()]).unwrap();
        let popular = top(&conn, None, Some("en"), 10).unwrap();
        assert_eq!(popular.iter().map(|e| e.id.as_str()).collect::<Vec<_>>(), ["84", "1342"]);

        let novels = top(&conn, Some("Novels"), None, 10).unwrap();
        assert_eq!(novels.iter().map(|e| e.id.as_str()).collect::<Vec<_>>(), ["84", "1342", "200"]);

        let hits = search(&conn, &CatalogQuery { search: Some("pride".into()), ..Default::default() }).unwrap();
        assert_eq!(hits.total, 2);
        assert_eq!(hits.entries[0].id, "1342", "popular title outranks obscure match");

        let accent = search(&conn, &CatalogQuery { search: Some("miserables".into()), ..Default::default() }).unwrap();
        assert_eq!(accent.entries[0].id, "200");

        let scifi = search(&conn, &CatalogQuery {
            category: Some("Science-Fiction & Fantasy".into()),
            ..Default::default()
        })
        .unwrap();
        assert_eq!(scifi.total, 1);

        // Re-sync keeps cached details.
        save_detail(&conn, "gutenberg", "1342", &Detail { summary: Some("S".into()), downloads: Some(5), reading_level: None }, 1).unwrap();
        replace_catalog(&mut conn, "gutenberg", records.iter()).unwrap();
        let d = get(&conn, "gutenberg", "1342").unwrap().unwrap();
        assert_eq!(d.detail.summary.as_deref(), Some("S"));
        assert_eq!(search(&conn, &CatalogQuery { search: Some("pride".into()), ..Default::default() }).unwrap().total, 2);
    }
}
