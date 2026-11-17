//! Collected editions: a book given its own designed showcase page (its own
//! theme, art and reading palette), e.g. the Holy Bible in an Orthodox theme.
//!
//! An edition offers one or more complete single volumes (e.g. translations).
//! Navigating within a volume (Genesis → Revelation) happens in the reader's
//! Contents panel, not on the edition page.

use serde::{Deserialize, Serialize};
use tauri::State;
use ts_rs::TS;

use super::gutenberg::PROVIDER;
use super::{store, CatalogEntry, CatalogState};
use crate::db::books;
use crate::error::{AppError, AppResult};
use crate::state::AppState;

struct VolumeDef {
    label: &'static str,
    note: &'static str,
    /// Gutenberg id of the complete volume.
    id: &'static str,
}

struct EditionDef {
    id: &'static str,
    theme: &'static str,
    title: &'static str,
    original: &'static str,
    subtitle: &'static str,
    blurb: &'static str,
    /// A short passage shown on the page (public-domain translation).
    verse: (&'static str, &'static str),
    /// First is the default.
    volumes: &'static [VolumeDef],
}

const BIBLE: EditionDef = EditionDef {
    id: "bible",
    theme: "orthodox",
    title: "Holy Bible",
    original: "Ἡ Ἁγία Γραφή",
    subtitle: "Old & New Testaments",
    blurb: "The Scriptures, kept the way the Church has kept them: in the dark, by lamplight, \
            surrounded by the faces of the saints.",
    verse: (
        "And the light shineth in darkness; and the darkness comprehended it not.",
        "John 1:5",
    ),
    volumes: &[
        VolumeDef { label: "King James Version", note: "66 books · 1611", id: "10" },
        VolumeDef {
            label: "Douay-Rheims",
            note: "73 books, incl. Tobit, Judith, Wisdom, Sirach, Baruch & Maccabees",
            id: "8300",
        },
    ],
};

const EDITIONS: &[EditionDef] = &[BIBLE];

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct EditionVolume {
    pub label: String,
    pub note: String,
    pub entry: CatalogEntry,
    /// Reading progress (0–1) once the volume is in the library and opened.
    pub progress: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct EditionSummary {
    pub id: String,
    /// Selects the edition's visual theme in the UI.
    pub theme: String,
    pub title: String,
    pub original: String,
    pub subtitle: String,
    /// Furthest progress across the edition's volumes, if any has been read.
    pub progress: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Edition {
    pub summary: EditionSummary,
    pub blurb: String,
    pub verse: String,
    pub verse_ref: String,
    pub volumes: Vec<EditionVolume>,
}

fn build(def: &EditionDef, catalog: &rusqlite::Connection, library: &rusqlite::Connection) -> AppResult<Edition> {
    let owned = books::owned_from(library, PROVIDER)?;
    let progress = books::progress_map(library)?;
    let volumes: Vec<EditionVolume> = def
        .volumes
        .iter()
        .map(|v| {
            let mut entry = store::get(catalog, PROVIDER, v.id)?.map(|d| d.entry).unwrap_or_else(|| CatalogEntry {
                provider: PROVIDER.into(),
                id: v.id.into(),
                title: format!("{} ({})", def.title, v.label),
                authors: vec![],
                language: Some("en".into()),
                categories: vec![],
                popularity: None,
                owned_book_id: None,
            });
            entry.owned_book_id = owned.get(v.id).cloned();
            let progress = entry.owned_book_id.as_ref().and_then(|b| progress.get(b).copied());
            Ok(EditionVolume { label: v.label.into(), note: v.note.into(), entry, progress })
        })
        .collect::<AppResult<_>>()?;

    let furthest = volumes.iter().filter_map(|v| v.progress).fold(None, |a: Option<f64>, p| Some(a.map_or(p, |a| a.max(p))));
    Ok(Edition {
        summary: EditionSummary {
            id: def.id.into(),
            theme: def.theme.into(),
            title: def.title.into(),
            original: def.original.into(),
            subtitle: def.subtitle.into(),
            progress: furthest,
        },
        blurb: def.blurb.split_whitespace().collect::<Vec<_>>().join(" "),
        verse: def.verse.0.into(),
        verse_ref: def.verse.1.into(),
        volumes,
    })
}

#[tauri::command(async)]
pub fn edition_summaries(
    catalog: State<'_, CatalogState>,
    library: State<'_, AppState>,
) -> AppResult<Vec<EditionSummary>> {
    let lib = library.conn()?;
    let cat = catalog.conn()?;
    EDITIONS.iter().map(|d| build(d, &cat, &lib).map(|e| e.summary)).collect()
}

#[tauri::command(async)]
pub fn edition(catalog: State<'_, CatalogState>, library: State<'_, AppState>, id: String) -> AppResult<Edition> {
    let def = EDITIONS
        .iter()
        .find(|d| d.id == id)
        .ok_or_else(|| AppError::NotFound(format!("edition {id}")))?;
    build(def, &*catalog.conn()?, &*library.conn()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalog::CATALOG_MIGRATIONS;
    use crate::db::books::{insert, save_progress, NewBook, Origin};
    use crate::db::LIBRARY_MIGRATIONS;
    use crate::models::{BookFormat, CoverState};

    #[test]
    fn bible_offers_volumes_and_tracks_progress() {
        let cat = crate::db::open_in_memory(CATALOG_MIGRATIONS).unwrap();
        let mut lib = crate::db::open_in_memory(LIBRARY_MIGRATIONS).unwrap();
        let e = build(&BIBLE, &cat, &lib).unwrap();
        assert_eq!(e.volumes.iter().map(|v| v.entry.id.as_str()).collect::<Vec<_>>(), ["10", "8300"]);
        assert!(e.summary.progress.is_none());

        insert(
            &mut lib,
            &NewBook {
                id: "b".into(),
                title: "KJV".into(),
                authors: vec![],
                description: None,
                publisher: None,
                language: None,
                published: None,
                isbn: None,
                format: BookFormat::Epub,
                file_name: "b.epub".into(),
                original_name: "b.epub".into(),
                file_size: 1,
                file_hash: "h".into(),
                page_count: None,
                cover_file: None,
                cover_state: CoverState::Missing,
                origin: Some(Origin { provider: PROVIDER.into(), id: "10".into() }),
            },
        )
        .unwrap();
        save_progress(&lib, "b", "cfi", 0.25).unwrap();
        let e = build(&BIBLE, &cat, &lib).unwrap();
        assert_eq!(e.volumes[0].entry.owned_book_id.as_deref(), Some("b"));
        assert_eq!(e.summary.progress, Some(0.25));
    }
}
