//! Import pipeline: hash → de-dupe → extract metadata → copy into library → insert.

pub mod epub;
pub mod pdf;

use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use crate::db::books::{self, NewBook, Origin};
use crate::error::{AppError, AppResult};
use crate::library::{image_extension, LibraryPaths};
use crate::models::{Book, BookFormat, CoverState, ImportFailure, ImportReport};

/// Metadata pulled out of a file, before it becomes a `NewBook`.
#[derive(Debug, Default, Clone)]
pub struct Extracted {
    pub title: Option<String>,
    pub authors: Vec<String>,
    pub description: Option<String>,
    pub publisher: Option<String>,
    pub language: Option<String>,
    pub published: Option<String>,
    pub isbn: Option<String>,
    pub page_count: Option<u32>,
    pub cover: Option<Cover>,
}

#[derive(Debug, Clone)]
pub struct Cover {
    pub bytes: Vec<u8>,
    pub media_type: Option<String>,
}

pub enum Outcome {
    Imported(Book),
    /// The same file (by content hash) is already in the library, with this id.
    Duplicate(String),
}

/// Expands folders recursively and keeps only supported files.
pub fn collect_files(paths: &[PathBuf]) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for path in paths {
        if path.is_dir() {
            for entry in walkdir::WalkDir::new(path).follow_links(true).into_iter().flatten() {
                if entry.file_type().is_file() && format_of(entry.path()).is_some() {
                    out.push(entry.into_path());
                }
            }
        } else {
            out.push(path.clone());
        }
    }
    out.sort();
    out.dedup();
    out
}

pub fn format_of(path: &Path) -> Option<BookFormat> {
    path.extension().and_then(|e| e.to_str()).and_then(BookFormat::from_extension)
}

pub fn hash_file(path: &Path) -> AppResult<String> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1 << 16];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hasher.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

/// Imports a single file. Metadata extraction runs before anything touches disk,
/// and the DB insert runs last, so a failure never leaves a half-imported book.
pub fn import_file(
    conn: &mut rusqlite::Connection,
    paths: &LibraryPaths,
    source: &Path,
    origin: Option<Origin>,
) -> AppResult<Outcome> {
    let format = format_of(source).ok_or_else(|| {
        AppError::Unsupported(
            source.extension().and_then(|e| e.to_str()).unwrap_or("no extension").to_string(),
        )
    })?;
    let hash = hash_file(source)?;
    if let Some(existing) = books::find_by_hash(conn, &hash)? {
        if let Some(origin) = &origin {
            books::set_origin(conn, &existing, origin)?;
        }
        return Ok(Outcome::Duplicate(existing));
    }

    let extracted = match format {
        BookFormat::Epub => epub::extract(source)?,
        // A PDF we can't parse metadata from is still readable; fall back to the filename.
        BookFormat::Pdf => pdf::extract(source).unwrap_or_else(|e| {
            log::warn!("pdf metadata failed for {}: {e}", source.display());
            Extracted::default()
        }),
    };

    let id = uuid::Uuid::now_v7().to_string();
    let file_name = format!("{id}.{}", format.as_str());
    let original_name =
        source.file_name().and_then(|n| n.to_str()).unwrap_or("untitled").to_string();
    let target = paths.book_file(&file_name)?;
    std::fs::copy(source, &target)?;

    let mut written = vec![target];
    let result = (|| {
        let (cover_file, cover_state) = match &extracted.cover {
            Some(cover) => {
                let ext = image_extension(&cover.bytes, cover.media_type.as_deref());
                let name = format!("{id}.{ext}");
                let path = paths.cover_file(&name)?;
                std::fs::write(&path, &cover.bytes)?;
                written.push(path);
                // Thumbnail now, while the bytes are in memory (grids only ever load these).
                let thumb = paths.thumb_file(&id, crate::thumbs::THUMB_WIDTH)?;
                crate::thumbs::write_for(&cover.bytes, &thumb);
                written.push(thumb);
                (Some(name), CoverState::Present)
            }
            // PDFs get a first-page thumbnail rendered by the frontend.
            None if format == BookFormat::Pdf => (None, CoverState::Pending),
            None => (None, CoverState::Missing),
        };

        let new_book = NewBook {
            id: id.clone(),
            title: extracted
                .title
                .clone()
                .filter(|t| !t.trim().is_empty())
                .unwrap_or_else(|| title_from_file_name(source)),
            authors: extracted.authors.clone(),
            description: extracted.description.clone(),
            publisher: extracted.publisher.clone(),
            language: extracted.language.clone(),
            published: extracted.published.clone(),
            isbn: extracted.isbn.clone(),
            format,
            file_name: file_name.clone(),
            original_name,
            file_size: std::fs::metadata(source)?.len() as i64,
            file_hash: hash,
            page_count: extracted.page_count,
            cover_file,
            cover_state,
            origin,
        };
        books::insert(conn, &new_book)?;
        books::get(conn, &id)
    })();

    match result {
        Ok(book) => Ok(Outcome::Imported(book)),
        Err(e) => {
            for path in written {
                let _ = std::fs::remove_file(path);
            }
            Err(e)
        }
    }
}

/// Imports many files, reporting progress through `on_progress(done, total, current)`.
///
/// The connection is locked per file (not for the whole batch) so the UI can keep
/// querying the library while a large import runs.
pub fn import_all(
    conn: &Mutex<rusqlite::Connection>,
    paths: &LibraryPaths,
    inputs: &[PathBuf],
    mut on_progress: impl FnMut(u32, u32, &str),
) -> ImportReport {
    let files = collect_files(inputs);
    let total = files.len() as u32;
    let mut report = ImportReport::default();
    for (i, file) in files.iter().enumerate() {
        let display = file.file_name().and_then(|n| n.to_str()).unwrap_or_default();
        on_progress(i as u32, total, display);
        let result = match conn.lock() {
            Ok(mut guard) => import_file(&mut guard, paths, file, None),
            Err(_) => Err(AppError::Invalid("database lock poisoned".into())),
        };
        match result {
            Ok(Outcome::Imported(book)) => report.imported.push(book),
            Ok(Outcome::Duplicate(_)) => report.duplicates.push(file.display().to_string()),
            Err(e) => report.failed.push(ImportFailure {
                path: file.display().to_string(),
                reason: e.to_string(),
            }),
        }
    }
    on_progress(total, total, "");
    report
}

/// "the_name-of-the_wind" -> "The Name Of The Wind"
pub fn title_from_file_name(path: &Path) -> String {
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("Untitled");
    let words: Vec<String> = stem
        .split(['_', '-', '.'])
        .flat_map(str::split_whitespace)
        .map(|w| {
            let mut c = w.chars();
            match c.next() {
                Some(f) => f.to_uppercase().chain(c).collect(),
                None => String::new(),
            }
        })
        .collect();
    if words.is_empty() { "Untitled".into() } else { words.join(" ") }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn titles_from_file_names() {
        assert_eq!(title_from_file_name(Path::new("/x/the_name-of-the_wind.pdf")), "The Name Of The Wind");
        assert_eq!(title_from_file_name(Path::new("Dune.epub")), "Dune");
    }

    #[test]
    fn end_to_end_import_and_dedupe() {
        let dir = tempfile::tempdir().unwrap();
        let paths = LibraryPaths::new(&dir.path().join("data")).unwrap();
        let conn = Mutex::new(crate::db::open_in_memory(crate::db::LIBRARY_MIGRATIONS).unwrap());

        let src = dir.path().join("sample.epub");
        std::fs::write(&src, epub::tests::build_epub(true)).unwrap();

        let report = import_all(&conn, &paths, &[src.clone()], |_, _, _| {});
        assert_eq!(report.imported.len(), 1, "{:?}", report.failed);
        let book = &report.imported[0];
        assert_eq!(book.title, "A Wizard & a Sea");
        assert_eq!(book.cover_state, CoverState::Present);
        assert!(paths.book_file(&format!("{}.epub", book.id)).unwrap().exists());

        let again = import_all(&conn, &paths, &[src], |_, _, _| {});
        assert_eq!((again.imported.len(), again.duplicates.len()), (0, 1));

        let bogus = dir.path().join("notes.txt");
        std::fs::write(&bogus, "hi").unwrap();
        let failed = import_all(&conn, &paths, &[bogus], |_, _, _| {});
        assert_eq!(failed.failed.len(), 1);
    }
}
