//! PDF metadata via lopdf's metadata-only loader (doesn't parse every object).
//! Cover thumbnails are rendered by the frontend with pdf.js, which already
//! ships a full renderer — no need to bundle pdfium on the Rust side.

use std::path::Path;

use super::Extracted;
use crate::error::{AppError, AppResult};

pub fn extract(path: &Path) -> AppResult<Extracted> {
    let meta = lopdf::Document::load_metadata(path).map_err(|e| AppError::Parse(e.to_string()))?;
    let clean = |s: Option<String>| {
        s.map(|v| v.trim().trim_matches('\0').to_string()).filter(|v| !v.is_empty())
    };
    let title = clean(meta.title)
        // Producers love writing junk like "Microsoft Word - draft3.docx" here.
        .filter(|t| !t.to_ascii_lowercase().starts_with("microsoft word"))
        .filter(|t| !t.to_ascii_lowercase().ends_with(".pdf"));
    let authors = clean(meta.author)
        .map(|a| {
            a.split([';', '&'])
                .flat_map(|p| p.split(" and "))
                .map(str::trim)
                .filter(|p| !p.is_empty())
                .map(String::from)
                .collect()
        })
        .unwrap_or_default();
    Ok(Extracted {
        title,
        authors,
        description: clean(meta.subject),
        page_count: Some(meta.page_count).filter(|c| *c > 0),
        published: clean(meta.creation_date).and_then(|d| pdf_year(&d)),
        ..Default::default()
    })
}

/// "D:20230115..." -> "2023"
fn pdf_year(date: &str) -> Option<String> {
    let digits = date.trim_start_matches("D:");
    let year = digits.get(..4)?;
    year.chars().all(|c| c.is_ascii_digit()).then(|| year.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_pdf_dates() {
        assert_eq!(pdf_year("D:20230115120000Z").as_deref(), Some("2023"));
        assert_eq!(pdf_year("garbage"), None);
    }
}
