//! Types shared with the frontend. `ts-rs` generates `src/bindings/*.ts`
//! from these when running `cargo test` (see `npm run bindings`).

use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum BookFormat {
    Epub,
    Pdf,
    /// Kindle: MOBI, AZW, AZW3 (KF8), PRC — DRM-free only.
    Mobi,
    /// FictionBook 2, plain (`.fb2`) or zipped (`.fbz`, `.fb2.zip`).
    Fb2,
    /// Comic book archive (zip of images).
    Cbz,
}

impl BookFormat {
    /// The stored format for an imported file extension (`txt` becomes an EPUB).
    pub fn from_extension(ext: &str) -> Option<Self> {
        match ext.to_ascii_lowercase().as_str() {
            "epub" | "txt" => Some(Self::Epub),
            "pdf" => Some(Self::Pdf),
            "mobi" | "azw" | "azw3" | "prc" => Some(Self::Mobi),
            "fb2" | "fbz" => Some(Self::Fb2),
            "cbz" => Some(Self::Cbz),
            _ => None,
        }
    }
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Epub => "epub",
            Self::Pdf => "pdf",
            Self::Mobi => "mobi",
            Self::Fb2 => "fb2",
            Self::Cbz => "cbz",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "epub" => Some(Self::Epub),
            "pdf" => Some(Self::Pdf),
            "mobi" => Some(Self::Mobi),
            "fb2" => Some(Self::Fb2),
            "cbz" => Some(Self::Cbz),
            _ => None,
        }
    }
}

/// `pending` means the backend could not extract a cover and the frontend
/// should render one (e.g. first page of a PDF via pdf.js).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum CoverState {
    Present,
    Pending,
    Missing,
}

impl CoverState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Present => "present",
            Self::Pending => "pending",
            Self::Missing => "missing",
        }
    }
    pub fn parse(s: &str) -> Self {
        match s {
            "present" => Self::Present,
            "pending" => Self::Pending,
            _ => Self::Missing,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Book {
    pub id: String,
    pub title: String,
    pub authors: Vec<String>,
    pub description: Option<String>,
    pub publisher: Option<String>,
    pub language: Option<String>,
    pub published: Option<String>,
    pub isbn: Option<String>,
    pub format: BookFormat,
    #[ts(type = "number")]
    pub file_size: i64,
    pub page_count: Option<u32>,
    pub cover_state: CoverState,
    /// Changes whenever the cover file changes; append to cover URLs to bust caches.
    #[ts(type = "number")]
    pub cover_version: i64,
    pub favorite: bool,
    #[ts(type = "number")]
    pub added_at: i64,
    pub progress: Option<ReadingProgress>,
    /// Permanent collector's number, in order of acquisition ("No. 042").
    pub volume: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ReadingProgress {
    pub locator: String,
    pub percent: f64,
    #[ts(type = "number")]
    pub updated_at: i64,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum SortKey {
    #[default]
    Recent,
    Title,
    Author,
    LastRead,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Shelf {
    #[default]
    All,
    Reading,
    Favorites,
    Finished,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export, optional_fields)]
pub struct BookQuery {
    pub search: Option<String>,
    pub shelf: Shelf,
    pub format: Option<BookFormat>,
    pub sort: SortKey,
    /// Return at most this many books (e.g. Home's "latest 7").
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ImportReport {
    pub imported: Vec<Book>,
    pub duplicates: Vec<String>,
    pub failed: Vec<ImportFailure>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ImportFailure {
    pub path: String,
    pub reason: String,
}

/// Emitted on the `import-progress` event while an import runs.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ImportProgress {
    pub done: u32,
    pub total: u32,
    pub current: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LibraryStats {
    pub total: u32,
    pub reading: u32,
    pub favorites: u32,
    pub finished: u32,
    /// Distinct authors in the collection.
    pub authors: u32,
}
