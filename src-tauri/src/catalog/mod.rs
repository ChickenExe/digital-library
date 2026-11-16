//! Discover: browsing and acquiring books from remote catalogs.
//!
//! Remote catalogs are mirrored into a local index (`catalog.db`) so browsing
//! and search are instant and work offline; only details, covers and the book
//! files themselves are fetched on demand.
//!
//! Today there is one provider, Project Gutenberg (free, public domain). The
//! `provider` column/field everywhere is the seam where a first-party store
//! (paid listings from publishers) plugs in later — see docs/STOREFRONT.md.

pub mod commands;
pub mod gutenberg;
pub mod sets;
pub mod store;
pub mod sync;

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Mutex, MutexGuard};
use tokio::sync::Semaphore;
use ts_rs::TS;

use crate::error::{AppError, AppResult};

pub const CATALOG_MIGRATIONS: &[&str] = &[include_str!("../../migrations/catalog/0001_catalog.sql")];

/// Managed state for everything Discover-related.
pub struct CatalogState {
    pub db: Mutex<Connection>,
    pub http: reqwest::Client,
    /// Disk cache of remote cover images.
    pub covers_dir: PathBuf,
    pub syncing: AtomicBool,
    pub status: Mutex<CatalogStatus>,
    /// Caps concurrent cover fetches so a fast scroll doesn't hammer the provider.
    pub cover_permits: Semaphore,
}

impl CatalogState {
    pub fn conn(&self) -> AppResult<MutexGuard<'_, Connection>> {
        self.db.lock().map_err(|_| AppError::Invalid("catalog lock poisoned".into()))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CatalogEntry {
    pub provider: String,
    pub id: String,
    pub title: String,
    pub authors: Vec<String>,
    pub language: Option<String>,
    pub categories: Vec<String>,
    /// 1 = most popular.
    pub popularity: Option<u32>,
    /// Set when this listing is already in the user's library.
    pub owned_book_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CatalogDetail {
    pub entry: CatalogEntry,
    pub summary: Option<String>,
    pub downloads: Option<u32>,
    pub reading_level: Option<String>,
    pub subjects: Vec<String>,
    pub issued: Option<String>,
    /// The listing's public web page.
    pub web_url: String,
    /// Price is always free today; modelled now so paid listings slot in later.
    pub offer: Offer,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", tag = "kind")]
#[ts(export)]
pub enum Offer {
    Free,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CatalogRow {
    pub id: String,
    pub title: String,
    /// The category to browse when the user clicks "See all" (None = popular).
    pub category: Option<String>,
    pub entries: Vec<CatalogEntry>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export, optional_fields)]
pub struct CatalogQuery {
    pub search: Option<String>,
    pub category: Option<String>,
    pub language: Option<String>,
    pub offset: Option<u32>,
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CatalogPage {
    pub entries: Vec<CatalogEntry>,
    pub total: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum CatalogPhase {
    /// Never synced.
    Empty,
    Downloading,
    Indexing,
    /// Index usable; popularity ranks still being fetched.
    Ranking,
    Ready,
    /// Last sync failed (the existing index, if any, is still usable).
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CatalogStatus {
    pub phase: CatalogPhase,
    pub entries: u32,
    #[ts(type = "number | null")]
    pub synced_at: Option<i64>,
    pub message: Option<String>,
}

/// Emitted on `catalog-download` while a book downloads.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DownloadProgress {
    pub provider: String,
    pub id: String,
    #[ts(type = "number")]
    pub received: u64,
    #[ts(type = "number | null")]
    pub total: Option<u64>,
}

/// Curated Discover rows: (row id, display title, catalog category).
pub const CURATED_ROWS: &[(&str, &str, &str)] = &[
    ("classics", "Timeless classics", "Classics of Literature"),
    ("scifi", "Science fiction & fantasy", "Science-Fiction & Fantasy"),
    ("mystery", "Mystery & suspense", "Crime, Thrillers and Mystery"),
    ("romance", "Romance", "Romance"),
    ("adventure", "Adventure", "Adventure"),
    ("myth", "Myths & legends", "Mythology, Legends & Folklore"),
    ("poetry", "Poetry", "Poetry"),
    ("philosophy", "Philosophy", "Philosophy & Ethics"),
    ("young", "For young readers", "Children & Young Adult Reading"),
    ("humour", "Humour", "Humour"),
    ("travel", "Travel writing", "Travel Writing"),
    ("plays", "Plays", "Plays/Films/Dramas"),
];
