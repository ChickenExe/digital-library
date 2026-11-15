//! Project Gutenberg provider.
//!
//! Uses only PG's official machine-readable feeds (as PG asks of automated
//! clients): the catalog CSV for the index, the OPDS feed for popularity and
//! per-book details, and the cache URLs for covers and EPUB files.

use quick_xml::events::Event;
use quick_xml::Reader;
use std::io::Read;

use crate::error::{AppError, AppResult};

pub const PROVIDER: &str = "gutenberg";
const BASE: &str = "https://www.gutenberg.org";

pub const CATALOG_CSV_URL: &str = "https://www.gutenberg.org/cache/epub/feeds/pg_catalog.csv.gz";
/// Pages of 25 entries fetched for the popularity ranking (≈1000 books).
pub const POPULAR_PAGES: u32 = 40;

pub fn popular_page_url(page: u32) -> String {
    format!("{BASE}/ebooks/search.opds/?sort_order=downloads&start_index={}", page * 25 + 1)
}
pub fn detail_url(id: &str) -> String {
    format!("{BASE}/ebooks/{id}.opds")
}
pub fn cover_url(id: &str) -> String {
    format!("{BASE}/cache/epub/{id}/pg{id}.cover.medium.jpg")
}
pub fn web_url(id: &str) -> String {
    format!("{BASE}/ebooks/{id}")
}
/// Preferred EPUB variants, best first (EPUB 3 with images → older fallbacks).
pub fn epub_urls(id: &str) -> [String; 3] {
    [
        format!("{BASE}/ebooks/{id}.epub3.images"),
        format!("{BASE}/ebooks/{id}.epub.images"),
        format!("{BASE}/ebooks/{id}.epub.noimages"),
    ]
}

/// PG ids are plain integers; anything else is rejected before building URLs.
pub fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 10 && id.bytes().all(|b| b.is_ascii_digit())
}

#[derive(Debug, Clone, PartialEq)]
pub struct CatalogRecord {
    pub id: String,
    pub title: String,
    pub authors: Vec<String>,
    pub language: Option<String>,
    pub issued: Option<String>,
    pub subjects: Vec<String>,
    pub categories: Vec<String>,
}

/// Parses `pg_catalog.csv` (already decompressed). Keeps text works only.
pub fn parse_catalog<R: Read>(reader: R) -> AppResult<Vec<CatalogRecord>> {
    let mut csv = csv::ReaderBuilder::new().has_headers(true).flexible(true).from_reader(reader);
    let headers = csv.headers().map_err(|e| AppError::Parse(e.to_string()))?.clone();
    let col = |name: &str| {
        headers
            .iter()
            .position(|h| h == name)
            .ok_or_else(|| AppError::Parse(format!("catalog CSV missing column {name}")))
    };
    let (id_c, type_c, issued_c, title_c, lang_c, authors_c, subjects_c, shelves_c) = (
        col("Text#")?,
        col("Type")?,
        col("Issued")?,
        col("Title")?,
        col("Language")?,
        col("Authors")?,
        col("Subjects")?,
        col("Bookshelves")?,
    );

    let mut out = Vec::with_capacity(80_000);
    for row in csv.records() {
        let Ok(row) = row else { continue };
        let get = |i: usize| row.get(i).unwrap_or("").trim();
        if get(type_c) != "Text" || !valid_id(get(id_c)) {
            continue;
        }
        let title = clean_title(get(title_c));
        if title.is_empty() {
            continue;
        }
        out.push(CatalogRecord {
            id: get(id_c).to_string(),
            title,
            authors: parse_authors(get(authors_c)),
            language: get(lang_c).split(';').next().map(str::trim).filter(|l| !l.is_empty()).map(String::from),
            issued: Some(get(issued_c).to_string()).filter(|s| !s.is_empty()),
            subjects: split_list(get(subjects_c)),
            categories: split_list(get(shelves_c))
                .into_iter()
                .filter_map(|s| s.strip_prefix("Category: ").map(String::from))
                .collect(),
        });
    }
    Ok(out)
}

fn split_list(s: &str) -> Vec<String> {
    s.split("; ").map(str::trim).filter(|s| !s.is_empty()).map(String::from).collect()
}

/// Titles can span lines (title + subtitle); keep the main title.
fn clean_title(raw: &str) -> String {
    let first = raw.lines().next().unwrap_or("").trim();
    first.trim_end_matches([':', ';', ',']).trim().to_string()
}

/// `"Austen, Jane, 1775-1817; Garnett, Constance [Translator]"` → `["Jane Austen"]`.
/// Contributors with a non-author role are only used when there is no author.
pub fn parse_authors(raw: &str) -> Vec<String> {
    let mut authors = Vec::new();
    let mut others = Vec::new();
    for part in raw.split("; ").map(str::trim).filter(|p| !p.is_empty()) {
        let (name, role) = match part.rfind(" [") {
            Some(i) if part.ends_with(']') => (&part[..i], Some(&part[i + 2..part.len() - 1])),
            _ => (part, None),
        };
        let Some(display) = display_name(name) else { continue };
        match role {
            None | Some("Author") => authors.push(display),
            Some(_) => others.push(display),
        }
    }
    let mut list = if authors.is_empty() { others } else { authors };
    list.dedup();
    list
}

/// `"Wells, H. G. (Herbert George), 1866-1946"` → `"H. G. Wells"`.
fn display_name(raw: &str) -> Option<String> {
    // Drop parenthesised expansions.
    let mut name = String::with_capacity(raw.len());
    let mut depth = 0;
    for c in raw.chars() {
        match c {
            '(' => depth += 1,
            ')' => depth = (depth as i32 - 1).max(0) as usize,
            c if depth == 0 => name.push(c),
            _ => {}
        }
    }
    let parts: Vec<&str> = name
        .split(',')
        .map(str::trim)
        .filter(|p| !p.is_empty())
        // Life dates and qualifiers: "1775-1817", "-1900?", "active 12th century", "BCE".
        .filter(|p| !p.chars().any(|c| c.is_ascii_digit()) && !p.starts_with("active"))
        .collect();
    match parts.as_slice() {
        [] => None,
        [single] => Some(single.to_string()),
        [family, given, ..] => Some(format!("{given} {family}")),
    }
}

/// Book ids from an OPDS acquisition feed page, in feed order.
pub fn parse_feed_ids(xml: &str) -> Vec<String> {
    let mut reader = Reader::from_str(xml);
    let mut in_entry = false;
    let mut in_id = false;
    let mut ids = Vec::new();
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => match e.local_name().as_ref() {
                "entry" => in_entry = true,
                "id" if in_entry => in_id = true,
                _ => {}
            },
            Ok(Event::End(e)) => match e.local_name().as_ref() {
                "entry" => in_entry = false,
                "id" => in_id = false,
                _ => {}
            },
            Ok(Event::Text(t)) if in_id => {
                // e.g. https://www.gutenberg.org/ebooks/2701.opds
                let text = t.xml10_content();
                if let Some(rest) = text.trim().rsplit("/ebooks/").next() {
                    if let Some(id) = rest.strip_suffix(".opds").filter(|id| valid_id(id)) {
                        if !ids.iter().any(|x| x == id) {
                            ids.push(id.to_string());
                        }
                    }
                }
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }
    ids
}

#[derive(Debug, Default, Clone, PartialEq)]
pub struct Detail {
    pub summary: Option<String>,
    pub downloads: Option<u32>,
    pub reading_level: Option<String>,
}

/// Pulls "Summary:", "Downloads:" and "Reading Level:" out of a book's OPDS page.
pub fn parse_detail(xml: &str) -> Detail {
    let mut reader = Reader::from_str(xml);
    let mut paragraphs: Vec<String> = Vec::new();
    let mut current: Option<String> = None;
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) if e.local_name().as_ref() == "p" => current = Some(String::new()),
            Ok(Event::End(e)) if e.local_name().as_ref() == "p" => {
                if let Some(p) = current.take() {
                    paragraphs.push(p.split_whitespace().collect::<Vec<_>>().join(" "));
                }
            }
            Ok(Event::Text(t)) => {
                if let Some(p) = current.as_mut() {
                    p.push_str(&t.xml10_content());
                }
            }
            Ok(Event::GeneralRef(r)) => {
                if let Some(p) = current.as_mut() {
                    match r.resolve_char_ref() {
                        Ok(Some(c)) => p.push(c),
                        _ => p.push_str(match &*r {
                            "amp" => "&",
                            "lt" => "<",
                            "gt" => ">",
                            "quot" => "\"",
                            "apos" => "'",
                            _ => " ",
                        }),
                    }
                }
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }

    let field = |label: &str| {
        paragraphs.iter().find_map(|p| p.strip_prefix(label).map(|v| v.trim().to_string()))
    };
    Detail {
        summary: field("Summary:").map(|s| {
            s.replace("(This is an automatically generated summary.)", "").trim().to_string()
        }),
        downloads: field("Downloads:").and_then(|d| d.replace(',', "").parse().ok()),
        reading_level: field("Reading Level:").map(|r| {
            // "Reading ease score: 69.2 (8th & 9th grade). Neither easy nor difficult to read."
            r.split_once(". ").map(|(_, rest)| rest.trim_end_matches('.').to_string()).unwrap_or(r)
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn author_names() {
        assert_eq!(parse_authors("Austen, Jane, 1775-1817"), ["Jane Austen"]);
        assert_eq!(parse_authors("Wells, H. G. (Herbert George), 1866-1946"), ["H. G. Wells"]);
        assert_eq!(
            parse_authors("Tolstoy, Leo, graf, 1828-1910; Garnett, Constance, 1861-1946 [Translator]"),
            ["Leo Tolstoy"]
        );
        assert_eq!(parse_authors("Homer, 751? BCE-651? BCE"), ["Homer"]);
        assert_eq!(parse_authors("Lang, Andrew, 1844-1912 [Editor]"), ["Andrew Lang"], "editor used when no author");
        assert!(parse_authors("").is_empty());
    }

    #[test]
    fn parses_catalog_csv() {
        let csv = "Text#,Type,Issued,Title,Language,Authors,Subjects,LoCC,Bookshelves\n\
            1342,Text,1998-06-01,Pride and Prejudice,en,\"Austen, Jane, 1775-1817\",\"England -- Fiction; Love stories\",PR,\"Best Books Ever Listings; Category: Novels; Category: Romance\"\n\
            2,Text,1972-12-01,\"The United States Bill of Rights\nThe Ten Original Amendments\",en,United States,,JK,\n\
            9999,Sound,2000-01-01,An Audio Book,en,,,,\n\
            42,Text,2001-01-01,Les Misérables,fr; en,\"Hugo, Victor, 1802-1885\",,,Category: Novels\n";
        let rows = parse_catalog(csv.as_bytes()).unwrap();
        assert_eq!(rows.len(), 3, "sound recordings are skipped");
        assert_eq!(rows[0].title, "Pride and Prejudice");
        assert_eq!(rows[0].authors, ["Jane Austen"]);
        assert_eq!(rows[0].categories, ["Novels", "Romance"]);
        assert_eq!(rows[0].subjects, ["England -- Fiction", "Love stories"]);
        assert_eq!(rows[1].title, "The United States Bill of Rights", "multi-line title keeps first line");
        assert_eq!(rows[2].language.as_deref(), Some("fr"));
    }

    #[test]
    fn parses_feed_and_detail() {
        let feed = r#"<feed xmlns="http://www.w3.org/2005/Atom">
            <id>http://www.gutenberg.org/ebooks/search.opds/?sort_order=downloads</id>
            <entry><id>https://www.gutenberg.org/ebooks/search.opds/?sort_order=title</id></entry>
            <entry><id>https://www.gutenberg.org/ebooks/2701.opds</id><title>Moby Dick</title></entry>
            <entry><id>https://www.gutenberg.org/ebooks/1342.opds</id></entry></feed>"#;
        assert_eq!(parse_feed_ids(feed), ["2701", "1342"]);

        let detail = r#"<feed xmlns="http://www.w3.org/2005/Atom"><entry><content type="xhtml">
            <div xmlns="http://www.w3.org/1999/xhtml">
            <p>Title: Pride and Prejudice</p>
            <p>Summary:
            "Pride and Prejudice" by Jane Austen is a novel &amp; more. (This is an automatically generated summary.)</p>
            <p>Reading Level: Reading ease score: 69.2 (8th &amp; 9th grade). Neither easy nor difficult to read.</p>
            <p>Downloads: 86053</p></div></content></entry></feed>"#;
        let d = parse_detail(detail);
        assert_eq!(d.summary.as_deref(), Some("\"Pride and Prejudice\" by Jane Austen is a novel & more."));
        assert_eq!(d.downloads, Some(86053));
        assert_eq!(d.reading_level.as_deref(), Some("Neither easy nor difficult to read"));
    }

    #[test]
    fn rejects_bad_ids() {
        assert!(valid_id("1342"));
        for bad in ["", "12a", "../1", "1/2", "12345678901"] {
            assert!(!valid_id(bad), "{bad}");
        }
    }
}
