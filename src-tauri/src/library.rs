//! On-disk layout of the managed library.
//!
//! ```text
//! <app data>/
//!   library.db
//!   Library/
//!     books/<id>.<ext>     the imported file (a copy, never the user's original)
//!     covers/<id>.<ext>    extracted or generated cover image
//!     incoming/            in-flight downloads (emptied on launch)
//! ```

use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone)]
pub struct LibraryPaths {
    pub db: PathBuf,
    pub books: PathBuf,
    pub covers: PathBuf,
    pub thumbs: PathBuf,
    pub incoming: PathBuf,
}

impl LibraryPaths {
    pub fn new(app_data: &Path) -> AppResult<Self> {
        let root = app_data.join("Library");
        let paths = Self {
            db: app_data.join("library.db"),
            books: root.join("books"),
            covers: root.join("covers"),
            thumbs: root.join("covers").join("thumbs"),
            incoming: root.join("incoming"),
        };
        // Leftovers from an interrupted download are useless; start clean.
        let _ = std::fs::remove_dir_all(&paths.incoming);
        for dir in [&paths.books, &paths.covers, &paths.thumbs, &paths.incoming] {
            std::fs::create_dir_all(dir)?;
        }
        Ok(paths)
    }

    /// Resolves a stored relative file name, refusing anything that could escape the folder.
    pub fn book_file(&self, name: &str) -> AppResult<PathBuf> {
        safe_join(&self.books, name)
    }

    pub fn cover_file(&self, name: &str) -> AppResult<PathBuf> {
        safe_join(&self.covers, name)
    }

    /// Thumbnail for a book's cover (always JPEG), keyed by book id and width.
    pub fn thumb_file(&self, book_id: &str, width: u32) -> AppResult<PathBuf> {
        let name = if width == crate::thumbs::THUMB_WIDTH {
            format!("{book_id}.jpg")
        } else {
            format!("{book_id}-{width}.jpg")
        };
        safe_join(&self.thumbs, &name)
    }

    pub fn remove_thumb(&self, book_id: &str) {
        for width in [crate::thumbs::THUMB_WIDTH, crate::thumbs::THUMB_WIDTH_SMALL] {
            if let Ok(p) = self.thumb_file(book_id, width) {
                let _ = std::fs::remove_file(p);
            }
        }
    }
}

fn safe_join(base: &Path, name: &str) -> AppResult<PathBuf> {
    let valid = !name.is_empty()
        && !name.contains(['/', '\\'])
        && name != "."
        && name != "..";
    if !valid {
        return Err(AppError::Invalid(format!("bad file name {name:?}")));
    }
    Ok(base.join(name))
}

/// Picks an image extension from magic bytes (falls back to the given hint).
pub fn image_extension(bytes: &[u8], hint: Option<&str>) -> &'static str {
    match bytes {
        [0xFF, 0xD8, 0xFF, ..] => "jpg",
        [0x89, b'P', b'N', b'G', ..] => "png",
        [b'G', b'I', b'F', ..] => "gif",
        [b'R', b'I', b'F', b'F', _, _, _, _, b'W', b'E', b'B', b'P', ..] => "webp",
        _ => match hint.map(str::to_ascii_lowercase).as_deref() {
            Some("image/png") | Some("png") => "png",
            Some("image/svg+xml") | Some("svg") => "svg",
            Some("image/webp") | Some("webp") => "webp",
            Some("image/gif") | Some("gif") => "gif",
            _ => "jpg",
        },
    }
}

pub fn mime_for(file_name: &str) -> &'static str {
    match file_name.rsplit('.').next().map(str::to_ascii_lowercase).as_deref() {
        Some("epub") => "application/epub+zip",
        Some("pdf") => "application/pdf",
        Some("mobi") => "application/x-mobipocket-ebook",
        Some("fb2") => "application/x-fictionbook+xml",
        Some("cbz") => "application/vnd.comicbook+zip",
        Some("png") => "image/png",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("svg") => "image/svg+xml",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_traversal() {
        let p = LibraryPaths {
            db: "x".into(),
            books: "/lib/books".into(),
            covers: "/lib/covers".into(),
            thumbs: "/lib/covers/thumbs".into(),
            incoming: "/lib/incoming".into(),
        };
        assert!(p.book_file("abc.epub").is_ok());
        for bad in ["../x", "..", "a/b", "a\\b", ""] {
            assert!(p.book_file(bad).is_err(), "{bad}");
        }
    }
}
