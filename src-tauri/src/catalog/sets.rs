//! Sets: curated groups of books to collect (an author's novels, a series, a
//! genre's essentials). Ownership comes from the library's `source_*` columns,
//! so acquiring a book from Discover fills its slot automatically.

use serde::{Deserialize, Serialize};
use tauri::State;
use ts_rs::TS;

use super::gutenberg::PROVIDER;
use super::{store, CatalogEntry, CatalogState};
use crate::db::books;
use crate::error::AppResult;
use crate::state::AppState;

struct SetDef {
    id: &'static str,
    title: &'static str,
    blurb: &'static str,
    /// (Gutenberg id, title, author) in reading order.
    items: &'static [(&'static str, &'static str, &'static str)],
}

const SETS: &[SetDef] = &[
    SetDef {
        id: "austen",
        title: "The Austen Six",
        blurb: "Every completed Jane Austen novel, in order of publication.",
        items: &[
            ("161", "Sense and Sensibility", "Jane Austen"),
            ("1342", "Pride and Prejudice", "Jane Austen"),
            ("141", "Mansfield Park", "Jane Austen"),
            ("158", "Emma", "Jane Austen"),
            ("121", "Northanger Abbey", "Jane Austen"),
            ("105", "Persuasion", "Jane Austen"),
        ],
    },
    SetDef {
        id: "holmes",
        title: "The Sherlock Holmes canon",
        blurb: "All four novels and five story collections.",
        items: &[
            ("244", "A Study in Scarlet", "Arthur Conan Doyle"),
            ("2097", "The Sign of the Four", "Arthur Conan Doyle"),
            ("1661", "The Adventures of Sherlock Holmes", "Arthur Conan Doyle"),
            ("834", "The Memoirs of Sherlock Holmes", "Arthur Conan Doyle"),
            ("2852", "The Hound of the Baskervilles", "Arthur Conan Doyle"),
            ("108", "The Return of Sherlock Holmes", "Arthur Conan Doyle"),
            ("3289", "The Valley of Fear", "Arthur Conan Doyle"),
            ("2350", "His Last Bow", "Arthur Conan Doyle"),
            ("69700", "The Case-Book of Sherlock Holmes", "Arthur Conan Doyle"),
        ],
    },
    SetDef {
        id: "gothic",
        title: "Gothic essentials",
        blurb: "From the first Gothic novel to the fin-de-siècle masters.",
        items: &[
            ("696", "The Castle of Otranto", "Horace Walpole"),
            ("84", "Frankenstein", "Mary Wollstonecraft Shelley"),
            ("10007", "Carmilla", "Joseph Sheridan Le Fanu"),
            ("43", "The Strange Case of Dr. Jekyll and Mr. Hyde", "Robert Louis Stevenson"),
            ("174", "The Picture of Dorian Gray", "Oscar Wilde"),
            ("345", "Dracula", "Bram Stoker"),
            ("209", "The Turn of the Screw", "Henry James"),
        ],
    },
    SetDef {
        id: "bronte",
        title: "The Brontë sisters",
        blurb: "Charlotte, Emily and Anne: five novels from one parsonage.",
        items: &[
            ("1260", "Jane Eyre", "Charlotte Brontë"),
            ("768", "Wuthering Heights", "Emily Brontë"),
            ("767", "Agnes Grey", "Anne Brontë"),
            ("969", "The Tenant of Wildfell Hall", "Anne Brontë"),
            ("9182", "Villette", "Charlotte Brontë"),
        ],
    },
];

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CollectionSet {
    pub id: String,
    pub title: String,
    pub blurb: String,
    pub items: Vec<CatalogEntry>,
    pub owned: u32,
    pub total: u32,
}

#[tauri::command(async)]
pub fn collection_sets(
    catalog: State<'_, CatalogState>,
    library: State<'_, AppState>,
) -> AppResult<Vec<CollectionSet>> {
    let owned = books::owned_from(&*library.conn()?, PROVIDER)?;
    let conn = catalog.conn()?;
    SETS.iter()
        .map(|def| {
            let items: Vec<CatalogEntry> = def
                .items
                .iter()
                .map(|(id, title, author)| {
                    // Prefer the live index (popularity, language); fall back to the static definition.
                    let mut entry = store::get(&conn, PROVIDER, id)?.map(|d| d.entry).unwrap_or_else(|| {
                        CatalogEntry {
                            provider: PROVIDER.into(),
                            id: id.to_string(),
                            title: title.to_string(),
                            authors: vec![author.to_string()],
                            language: Some("en".into()),
                            categories: vec![],
                            popularity: None,
                            owned_book_id: None,
                        }
                    });
                    entry.title = title.to_string(); // curated, consistent titles
                    entry.owned_book_id = owned.get(*id).cloned();
                    Ok(entry)
                })
                .collect::<AppResult<_>>()?;
            let owned_count = items.iter().filter(|e| e.owned_book_id.is_some()).count() as u32;
            Ok(CollectionSet {
                id: def.id.into(),
                title: def.title.into(),
                blurb: def.blurb.into(),
                total: items.len() as u32,
                owned: owned_count,
                items,
            })
        })
        .collect()
}
