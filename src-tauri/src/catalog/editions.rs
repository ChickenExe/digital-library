//! Collected editions: a book or series given its own designed home in the
//! app (its own theme, structure and typography), e.g. Holy Scripture in the
//! order of the Orthodox canon.
//!
//! An edition is a list of sections and slots. Each slot points at a catalog
//! volume (or notes that none exists in the public-domain catalog), and is
//! annotated with ownership and reading progress from the library.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::State;
use ts_rs::TS;

use super::gutenberg::PROVIDER;
use super::{store, CatalogEntry, CatalogState};
use crate::db::books;
use crate::error::{AppError, AppResult};
use crate::state::AppState;

/// Where a slot's text comes from.
#[derive(Clone, Copy)]
enum Src {
    /// King James Version, one Gutenberg volume per book.
    Kjv(&'static str),
    /// Douay-Rheims: used for the deuterocanonical books, and for Esther and
    /// Daniel, whose Greek additions the Orthodox canon includes.
    Dr(&'static str),
    /// Contained in another volume (e.g. the Epistle of Jeremiah is Baruch ch. 6).
    Within(&'static str, &'static str),
    /// A standalone work (used for "From the Tradition").
    Work(&'static str),
    /// No public-domain edition in the catalog (yet).
    Missing,
}

struct Slot(&'static str, &'static str, Src);

struct SectionDef {
    id: &'static str,
    numeral: &'static str,
    title: &'static str,
    greek: &'static str,
    part: &'static str,
    slots: &'static [Slot],
}

struct EditionDef {
    id: &'static str,
    theme: &'static str,
    title: &'static str,
    original: &'static str,
    subtitle: &'static str,
    blurb: &'static str,
    /// The whole edition as a single volume, if one exists.
    single_volume: Option<&'static str>,
    sections: &'static [SectionDef],
}

use Src::*;

const OT: &str = "Old Testament";
const NT: &str = "New Testament";

/// Holy Scripture in the order of the Orthodox canon: the Old Testament after
/// the Septuagint (including the Anagignoskomena), the New Testament in the
/// Slavonic order (the General Epistles before St Paul's).
const SCRIPTURE: EditionDef = EditionDef {
    id: "scripture",
    theme: "orthodox",
    title: "Holy Scripture",
    original: "Ἡ Ἁγία Γραφή",
    subtitle: "In the order of the Orthodox canon",
    blurb: "Seventy-six books, from Genesis to the Revelation, arranged as the Orthodox Church reads them: \
            the Old Testament after the Septuagint, with the books the Fathers called anagignoskomena, \
            “those to be read”.",
    single_volume: Some("10"),
    sections: &[
        SectionDef {
            id: "law",
            numeral: "I",
            title: "The Law",
            greek: "ΝΟΜΟΣ",
            part: OT,
            slots: &[
                Slot("Genesis", "ΓΕΝΕΣΙΣ", Kjv("8001")),
                Slot("Exodus", "ΕΞΟΔΟΣ", Kjv("8002")),
                Slot("Leviticus", "ΛΕΥΙΤΙΚΟΝ", Kjv("8003")),
                Slot("Numbers", "ΑΡΙΘΜΟΙ", Kjv("8004")),
                Slot("Deuteronomy", "ΔΕΥΤΕΡΟΝΟΜΙΟΝ", Kjv("8005")),
            ],
        },
        SectionDef {
            id: "history",
            numeral: "II",
            title: "History",
            greek: "ΙΣΤΟΡΙΚΑ",
            part: OT,
            slots: &[
                Slot("Joshua", "ΙΗΣΟΥΣ ΝΑΥΗ", Kjv("8006")),
                Slot("Judges", "ΚΡΙΤΑΙ", Kjv("8007")),
                Slot("Ruth", "ΡΟΥΘ", Kjv("8008")),
                Slot("1 Kingdoms", "ΒΑΣΙΛΕΙΩΝ Α΄", Kjv("8009")),
                Slot("2 Kingdoms", "ΒΑΣΙΛΕΙΩΝ Β΄", Kjv("8010")),
                Slot("3 Kingdoms", "ΒΑΣΙΛΕΙΩΝ Γ΄", Kjv("8011")),
                Slot("4 Kingdoms", "ΒΑΣΙΛΕΙΩΝ Δ΄", Kjv("8012")),
                Slot("1 Chronicles", "ΠΑΡΑΛΕΙΠΟΜΕΝΩΝ Α΄", Kjv("8013")),
                Slot("2 Chronicles", "ΠΑΡΑΛΕΙΠΟΜΕΝΩΝ Β΄", Kjv("8014")),
                Slot("1 Esdras", "ΕΣΔΡΑΣ Α΄", Missing),
                Slot("Ezra", "ΕΣΔΡΑΣ Β΄", Kjv("8015")),
                Slot("Nehemiah", "ΝΕΕΜΙΑΣ", Kjv("8016")),
                Slot("Tobit", "ΤΩΒΙΤ", Dr("8317")),
                Slot("Judith", "ΙΟΥΔΙΘ", Dr("8318")),
                Slot("Esther", "ΕΣΘΗΡ", Dr("8319")),
                Slot("1 Maccabees", "ΜΑΚΚΑΒΑΙΩΝ Α΄", Dr("8345")),
                Slot("2 Maccabees", "ΜΑΚΚΑΒΑΙΩΝ Β΄", Dr("8346")),
                Slot("3 Maccabees", "ΜΑΚΚΑΒΑΙΩΝ Γ΄", Missing),
            ],
        },
        SectionDef {
            id: "wisdom",
            numeral: "III",
            title: "Wisdom",
            greek: "ΠΟΙΗΤΙΚΑ",
            part: OT,
            slots: &[
                Slot("Psalms", "ΨΑΛΜΟΙ", Kjv("8019")),
                Slot("Job", "ΙΩΒ", Kjv("8018")),
                Slot("Proverbs", "ΠΑΡΟΙΜΙΑΙ", Kjv("8020")),
                Slot("Ecclesiastes", "ΕΚΚΛΗΣΙΑΣΤΗΣ", Kjv("8021")),
                Slot("Song of Songs", "ΑΣΜΑ ΑΣΜΑΤΩΝ", Kjv("8022")),
                Slot("Wisdom of Solomon", "ΣΟΦΙΑ ΣΟΛΟΜΩΝΤΟΣ", Dr("8325")),
                Slot("Wisdom of Sirach", "ΣΟΦΙΑ ΣΕΙΡΑΧ", Dr("8326")),
            ],
        },
        SectionDef {
            id: "prophets",
            numeral: "IV",
            title: "The Prophets",
            greek: "ΠΡΟΦΗΤΙΚΑ",
            part: OT,
            slots: &[
                Slot("Hosea", "ΩΣΗΕ", Kjv("8028")),
                Slot("Amos", "ΑΜΩΣ", Kjv("8030")),
                Slot("Micah", "ΜΙΧΑΙΑΣ", Kjv("8033")),
                Slot("Joel", "ΙΩΗΛ", Kjv("8029")),
                Slot("Obadiah", "ΑΒΔΙΟΥ", Kjv("8031")),
                Slot("Jonah", "ΙΩΝΑΣ", Kjv("8032")),
                Slot("Nahum", "ΝΑΟΥΜ", Kjv("8034")),
                Slot("Habakkuk", "ΑΜΒΑΚΟΥΜ", Kjv("8035")),
                Slot("Zephaniah", "ΣΟΦΟΝΙΑΣ", Kjv("8036")),
                Slot("Haggai", "ΑΓΓΑΙΟΣ", Kjv("8037")),
                Slot("Zechariah", "ΖΑΧΑΡΙΑΣ", Kjv("8038")),
                Slot("Malachi", "ΜΑΛΑΧΙΑΣ", Kjv("8039")),
                Slot("Isaiah", "ΗΣΑΪΑΣ", Kjv("8023")),
                Slot("Jeremiah", "ΙΕΡΕΜΙΑΣ", Kjv("8024")),
                Slot("Baruch", "ΒΑΡΟΥΧ", Dr("8330")),
                Slot("Lamentations", "ΘΡΗΝΟΙ", Kjv("8025")),
                Slot("Epistle of Jeremiah", "ΕΠΙΣΤΟΛΗ ΙΕΡΕΜΙΟΥ", Within("8330", "Baruch, chapter 6")),
                Slot("Ezekiel", "ΙΕΖΕΚΙΗΛ", Kjv("8026")),
                Slot("Daniel", "ΔΑΝΙΗΛ", Dr("8332")),
            ],
        },
        SectionDef {
            id: "gospels",
            numeral: "V",
            title: "The Gospels",
            greek: "ΕΥΑΓΓΕΛΙΑ",
            part: NT,
            slots: &[
                Slot("Matthew", "ΚΑΤΑ ΜΑΤΘΑΙΟΝ", Kjv("8040")),
                Slot("Mark", "ΚΑΤΑ ΜΑΡΚΟΝ", Kjv("8041")),
                Slot("Luke", "ΚΑΤΑ ΛΟΥΚΑΝ", Kjv("8042")),
                Slot("John", "ΚΑΤΑ ΙΩΑΝΝΗΝ", Kjv("8043")),
            ],
        },
        SectionDef {
            id: "acts",
            numeral: "VI",
            title: "Acts & General Epistles",
            greek: "ΠΡΑΞΕΙΣ · ΚΑΘΟΛΙΚΑΙ",
            part: NT,
            slots: &[
                Slot("Acts", "ΠΡΑΞΕΙΣ", Kjv("8044")),
                Slot("James", "ΙΑΚΩΒΟΥ", Kjv("8059")),
                Slot("1 Peter", "ΠΕΤΡΟΥ Α΄", Kjv("8060")),
                Slot("2 Peter", "ΠΕΤΡΟΥ Β΄", Kjv("8061")),
                Slot("1 John", "ΙΩΑΝΝΟΥ Α΄", Kjv("8062")),
                Slot("2 John", "ΙΩΑΝΝΟΥ Β΄", Kjv("8063")),
                Slot("3 John", "ΙΩΑΝΝΟΥ Γ΄", Kjv("8064")),
                Slot("Jude", "ΙΟΥΔΑ", Kjv("8065")),
            ],
        },
        SectionDef {
            id: "pauline",
            numeral: "VII",
            title: "Epistles of St Paul",
            greek: "ΕΠΙΣΤΟΛΑΙ ΠΑΥΛΟΥ",
            part: NT,
            slots: &[
                Slot("Romans", "ΠΡΟΣ ΡΩΜΑΙΟΥΣ", Kjv("8045")),
                Slot("1 Corinthians", "ΠΡΟΣ ΚΟΡΙΝΘΙΟΥΣ Α΄", Kjv("8046")),
                Slot("2 Corinthians", "ΠΡΟΣ ΚΟΡΙΝΘΙΟΥΣ Β΄", Kjv("8047")),
                Slot("Galatians", "ΠΡΟΣ ΓΑΛΑΤΑΣ", Kjv("8048")),
                Slot("Ephesians", "ΠΡΟΣ ΕΦΕΣΙΟΥΣ", Kjv("8049")),
                Slot("Philippians", "ΠΡΟΣ ΦΙΛΙΠΠΗΣΙΟΥΣ", Kjv("8050")),
                Slot("Colossians", "ΠΡΟΣ ΚΟΛΟΣΣΑΕΙΣ", Kjv("8051")),
                Slot("1 Thessalonians", "ΠΡΟΣ ΘΕΣΣΑΛΟΝΙΚΕΙΣ Α΄", Kjv("8052")),
                Slot("2 Thessalonians", "ΠΡΟΣ ΘΕΣΣΑΛΟΝΙΚΕΙΣ Β΄", Kjv("8053")),
                Slot("1 Timothy", "ΠΡΟΣ ΤΙΜΟΘΕΟΝ Α΄", Kjv("8054")),
                Slot("2 Timothy", "ΠΡΟΣ ΤΙΜΟΘΕΟΝ Β΄", Kjv("8055")),
                Slot("Titus", "ΠΡΟΣ ΤΙΤΟΝ", Kjv("8056")),
                Slot("Philemon", "ΠΡΟΣ ΦΙΛΗΜΟΝΑ", Kjv("8057")),
                Slot("Hebrews", "ΠΡΟΣ ΕΒΡΑΙΟΥΣ", Kjv("8058")),
            ],
        },
        SectionDef {
            id: "revelation",
            numeral: "VIII",
            title: "Revelation",
            greek: "ΑΠΟΚΑΛΥΨΙΣ",
            part: NT,
            slots: &[Slot("Revelation", "ΑΠΟΚΑΛΥΨΙΣ ΙΩΑΝΝΟΥ", Kjv("8066"))],
        },
        SectionDef {
            id: "tradition",
            numeral: "IX",
            title: "From the Tradition",
            greek: "ΠΑΡΑΔΟΣΙΣ",
            part: "Tradition",
            slots: &[
                Slot("Hymns of the Greek Church", "ΥΜΝΟΙ", Work("27848")),
                Slot("Hymns from the East", "ΥΜΝΟΙ", Work("28479")),
                Slot("Leaves from St. John Chrysostom", "ΙΩΑΝΝΗΣ ΧΡΥΣΟΣΤΟΜΟΣ", Work("62447")),
                Slot("Saint John Chrysostom, His Life and Times", "ΙΩΑΝΝΗΣ ΧΡΥΣΟΣΤΟΜΟΣ", Work("53809")),
                Slot("Saint Athanasius, the Father of Orthodoxy", "ΑΘΑΝΑΣΙΟΣ", Work("27707")),
                Slot("The Religious Spirit of the Slavs", "ΣΛΑΒΟΙ", Work("13388")),
            ],
        },
    ],
};

const EDITIONS: &[EditionDef] = &[SCRIPTURE];

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct EditionItem {
    /// Position within the edition's canon (1-based; tradition works continue the count).
    pub no: u32,
    pub name: String,
    pub greek: String,
    /// "KJV", "Douay-Rheims", or None for standalone works.
    pub translation: Option<String>,
    /// e.g. "In Baruch, chapter 6" or "No public-domain edition in the catalog yet".
    pub note: Option<String>,
    /// The catalog volume that holds this text (None when unavailable).
    pub entry: Option<CatalogEntry>,
    /// Reading progress (0–1) if it's in the library and has been opened.
    pub progress: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct EditionSection {
    pub id: String,
    pub numeral: String,
    pub title: String,
    pub greek: String,
    pub part: String,
    pub items: Vec<EditionItem>,
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
    /// Slots in the canon (excluding "From the Tradition").
    pub total: u32,
    /// Slots that have a text in the catalog.
    pub available: u32,
    /// Slots whose text is in the library.
    pub owned: u32,
    /// Slots read to the end.
    pub finished: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Edition {
    pub summary: EditionSummary,
    pub blurb: String,
    pub sections: Vec<EditionSection>,
    pub single_volume: Option<CatalogEntry>,
}

fn entry_for(catalog: &rusqlite::Connection, id: &str, owned: &HashMap<String, String>) -> AppResult<CatalogEntry> {
    let mut entry = store::get(catalog, PROVIDER, id)?.map(|d| d.entry).unwrap_or_else(|| CatalogEntry {
        provider: PROVIDER.into(),
        id: id.into(),
        title: id.into(),
        authors: vec![],
        language: Some("en".into()),
        categories: vec![],
        popularity: None,
        owned_book_id: None,
    });
    entry.owned_book_id = owned.get(id).cloned();
    Ok(entry)
}

fn build(def: &EditionDef, catalog: &rusqlite::Connection, library: &rusqlite::Connection) -> AppResult<Edition> {
    let owned = books::owned_from(library, PROVIDER)?;
    let progress = books::progress_map(library)?;
    let mut no = 0;
    let (mut total, mut available, mut owned_n, mut finished) = (0, 0, 0, 0);

    let sections = def
        .sections
        .iter()
        .map(|s| {
            let items = s
                .slots
                .iter()
                .map(|Slot(name, greek, src)| {
                    no += 1;
                    let (source, translation, note) = match *src {
                        Kjv(id) => (Some(id), Some("KJV"), None),
                        Dr(id) => (Some(id), Some("Douay-Rheims"), None),
                        Within(id, where_) => (Some(id), Some("Douay-Rheims"), Some(format!("In {where_}"))),
                        Work(id) => (Some(id), None, None),
                        Missing => (None, None, Some("No public-domain edition in the catalog yet".to_string())),
                    };
                    let entry = source.map(|id| entry_for(catalog, id, &owned)).transpose()?;
                    let progress = entry
                        .as_ref()
                        .and_then(|e| e.owned_book_id.as_ref())
                        .and_then(|book| progress.get(book).copied());
                    if !matches!(src, Work(_)) {
                        total += 1;
                        available += u32::from(entry.is_some());
                        owned_n += u32::from(entry.as_ref().is_some_and(|e| e.owned_book_id.is_some()));
                        finished += u32::from(progress.is_some_and(|p| p >= books::FINISHED_AT));
                    }
                    Ok(EditionItem {
                        no,
                        name: name.to_string(),
                        greek: greek.to_string(),
                        translation: translation.map(String::from),
                        note,
                        entry,
                        progress,
                    })
                })
                .collect::<AppResult<Vec<_>>>()?;
            Ok(EditionSection {
                id: s.id.into(),
                numeral: s.numeral.into(),
                title: s.title.into(),
                greek: s.greek.into(),
                part: s.part.into(),
                items,
            })
        })
        .collect::<AppResult<Vec<_>>>()?;

    Ok(Edition {
        summary: EditionSummary {
            id: def.id.into(),
            theme: def.theme.into(),
            title: def.title.into(),
            original: def.original.into(),
            subtitle: def.subtitle.into(),
            total,
            available,
            owned: owned_n,
            finished,
        },
        blurb: def.blurb.split_whitespace().collect::<Vec<_>>().join(" "),
        sections,
        single_volume: def.single_volume.map(|id| entry_for(catalog, id, &owned)).transpose()?,
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
    use crate::db::LIBRARY_MIGRATIONS;

    #[test]
    fn scripture_follows_the_orthodox_canon() {
        let cat = crate::db::open_in_memory(CATALOG_MIGRATIONS).unwrap();
        let lib = crate::db::open_in_memory(LIBRARY_MIGRATIONS).unwrap();
        let e = build(&SCRIPTURE, &cat, &lib).unwrap();

        let canon: Vec<&EditionItem> =
            e.sections.iter().filter(|s| s.part != "Tradition").flat_map(|s| &s.items).collect();
        assert_eq!(canon.len(), 76, "49 Old Testament + 27 New Testament books");
        let ot = e.sections.iter().filter(|s| s.part == OT).map(|s| s.items.len()).sum::<usize>();
        assert_eq!(ot, 49);
        assert_eq!((e.summary.total, e.summary.available, e.summary.owned), (76, 74, 0));

        // Septuagint order: the twelve minor prophets come before Isaiah.
        let names: Vec<&str> = canon.iter().map(|i| i.name.as_str()).collect();
        let pos = |n: &str| names.iter().position(|x| *x == n).unwrap();
        assert!(pos("Malachi") < pos("Isaiah"));
        // Slavonic order: the General Epistles before St Paul's.
        assert!(pos("Jude") < pos("Romans"));
        // The Epistle of Jeremiah lives in Baruch.
        let epj = canon.iter().find(|i| i.name == "Epistle of Jeremiah").unwrap();
        assert_eq!(epj.entry.as_ref().unwrap().id, "8330");
    }

    #[test]
    fn no_volume_is_assigned_to_two_canonical_books_by_accident() {
        let mut seen = std::collections::HashSet::new();
        for s in SCRIPTURE.sections {
            for Slot(name, _, src) in s.slots {
                if let Kjv(id) | Dr(id) | Work(id) = src {
                    assert!(seen.insert(*id), "{name} reuses volume {id}");
                }
            }
        }
    }
}
