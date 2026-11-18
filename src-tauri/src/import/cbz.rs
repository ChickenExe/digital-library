//! Comic book archives (`.cbz`): a zip of page images, optionally with a
//! `ComicInfo.xml` (the de-facto metadata standard from ComicRack).

use quick_xml::events::Event;
use quick_xml::Reader;
use std::fs::File;
use std::io::{BufReader, Read};
use std::path::Path;

use super::epub::{collapse_ws, local, MAX_ENTRY_BYTES};
use super::{Cover, Extracted};
use crate::error::{AppError, AppResult};

pub fn extract(path: &Path) -> AppResult<Extracted> {
    let mut zip = zip::ZipArchive::new(BufReader::new(File::open(path)?))
        .map_err(|e| AppError::Parse(e.to_string()))?;
    let mut pages: Vec<String> = zip.file_names().flatten().filter(|n| is_image(n)).map(|n| n.into_owned()).collect();
    if pages.is_empty() {
        return Err(AppError::Parse("no page images in this archive".into()));
    }
    pages.sort_by(|a, b| natural_cmp(a, b));

    let mut out = Extracted { page_count: Some(pages.len() as u32), ..Default::default() };
    let info = zip
        .file_names()
        .flatten()
        .find(|n| n.rsplit('/').next().is_some_and(|f| f.eq_ignore_ascii_case("ComicInfo.xml")))
        .map(|n| n.into_owned());
    if let Some(name) = info {
        if let Ok(xml) = read(&mut zip, &name) {
            comic_info(&String::from_utf8_lossy(&xml), &mut out);
        }
    }
    if let Ok(bytes) = read(&mut zip, &pages[0]) {
        out.cover = Some(Cover { bytes, media_type: None });
    }
    Ok(out)
}

fn read(zip: &mut zip::ZipArchive<BufReader<File>>, name: &str) -> AppResult<Vec<u8>> {
    let entry = zip.by_name(name).map_err(|e| AppError::Parse(e.to_string()))?;
    let mut buf = Vec::new();
    entry.take(MAX_ENTRY_BYTES).read_to_end(&mut buf)?;
    Ok(buf)
}

fn is_image(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    !lower.starts_with("__macosx/")
        && !lower.rsplit('/').next().unwrap_or("").starts_with('.')
        && [".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif"].iter().any(|e| lower.ends_with(e))
}

/// "page2.jpg" < "page10.jpg".
fn natural_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    fn chunks(s: &str) -> Vec<(bool, String)> {
        let mut out: Vec<(bool, String)> = Vec::new();
        for c in s.to_lowercase().chars() {
            let digit = c.is_ascii_digit();
            match out.last_mut() {
                Some((d, chunk)) if *d == digit => chunk.push(c),
                _ => out.push((digit, c.to_string())),
            }
        }
        out
    }
    let (ca, cb) = (chunks(a), chunks(b));
    for (x, y) in ca.iter().zip(&cb) {
        let ord = match (x.0, y.0) {
            (true, true) => {
                let (nx, ny) = (x.1.trim_start_matches('0'), y.1.trim_start_matches('0'));
                nx.len().cmp(&ny.len()).then_with(|| nx.cmp(ny))
            }
            _ => x.1.cmp(&y.1),
        };
        if ord.is_ne() {
            return ord;
        }
    }
    ca.len().cmp(&cb.len())
}

fn comic_info(xml: &str, out: &mut Extracted) {
    let mut reader = Reader::from_str(xml);
    let mut current = String::new();
    let mut text = String::new();
    let (mut title, mut series, mut number) = (None, None, None);
    while let Ok(event) = reader.read_event() {
        match event {
            Event::Start(e) => {
                current = local(&e);
                text.clear();
            }
            Event::Text(t) => text.push_str(&t.xml10_content()),
            Event::End(_) => {
                let value = Some(collapse_ws(&text)).filter(|v| !v.is_empty());
                match current.as_str() {
                    "Title" => title = value,
                    "Series" => series = value,
                    "Number" => number = value,
                    "Summary" => out.description = value,
                    "Publisher" => out.publisher = value,
                    "LanguageISO" => out.language = value,
                    "Year" => out.published = value,
                    "Writer" => {
                        out.authors = value
                            .map(|v| v.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect())
                            .unwrap_or_default()
                    }
                    _ => {}
                }
                current.clear();
                text.clear();
            }
            Event::Eof => break,
            _ => {}
        }
    }
    out.title = match (series, number, title) {
        (Some(s), Some(n), Some(t)) => Some(format!("{s} #{n}: {t}")),
        (Some(s), Some(n), None) => Some(format!("{s} #{n}")),
        (_, _, Some(t)) => Some(t),
        (Some(s), None, None) => Some(s),
        _ => None,
    };
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn natural_order() {
        let mut v = vec!["p10.jpg", "p2.jpg", "p1.jpg"];
        v.sort_by(|a, b| natural_cmp(a, b));
        assert_eq!(v, ["p1.jpg", "p2.jpg", "p10.jpg"]);
    }

    #[test]
    fn reads_pages_and_comic_info() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("c.cbz");
        {
            let mut zip = zip::ZipWriter::new(File::create(&path).unwrap());
            let o = zip::write::SimpleFileOptions::default();
            for name in ["10.png", "2.png", "1.png"] {
                zip.start_file(name, o).unwrap();
                zip.write_all(format!("\u{89}PNG {name}").as_bytes()).unwrap();
            }
            zip.start_file("ComicInfo.xml", o).unwrap();
            zip.write_all(b"<ComicInfo><Series>Bone</Series><Number>1</Number><Writer>Jeff Smith</Writer></ComicInfo>").unwrap();
            zip.finish().unwrap();
        }
        let x = extract(&path).unwrap();
        assert_eq!(x.page_count, Some(3));
        assert_eq!(x.title.as_deref(), Some("Bone #1"));
        assert_eq!(x.authors, vec!["Jeff Smith"]);
        assert!(String::from_utf8_lossy(&x.cover.unwrap().bytes).ends_with("1.png"));
    }
}
