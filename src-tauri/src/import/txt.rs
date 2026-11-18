//! Plain text → EPUB 3, so `.txt` books get the full reader (pagination,
//! themes, contents) instead of a raw text dump.
//!
//! Paragraphs are split on blank lines (or, for hard-wrapped files without
//! blank lines, on every line). Lines that look like headings ("Chapter 3",
//! "BOOK II", "Prologue") start new chapters; without any, the text is cut
//! into evenly sized parts so no single page file gets huge.

use std::io::{Cursor, Write};

use crate::error::{AppError, AppResult};

/// Text files bigger than this are almost certainly not books.
pub const MAX_TXT_BYTES: usize = 64 * 1024 * 1024;
const PARAS_PER_PART: usize = 150;

/// Bytes → text: BOM first, then UTF-8, falling back to Windows-1252.
pub fn decode(bytes: &[u8]) -> String {
    if let Some((enc, bom)) = encoding_rs::Encoding::for_bom(bytes) {
        return enc.decode_without_bom_handling(&bytes[bom..]).0.into_owned();
    }
    match std::str::from_utf8(bytes) {
        Ok(s) => s.to_string(),
        Err(_) => encoding_rs::WINDOWS_1252.decode(bytes).0.into_owned(),
    }
}

/// Title/author from a header block ("Title: …", "Author: …"), as Project
/// Gutenberg and many other plain-text sources write them.
pub fn header_meta(text: &str) -> (Option<String>, Option<String>) {
    let mut title = None;
    let mut author = None;
    for line in text.lines().take(80) {
        let line = line.trim();
        if let Some(v) = line.strip_prefix("Title:") {
            title.get_or_insert_with(|| v.trim().to_string());
        } else if let Some(v) = line.strip_prefix("Author:") {
            author.get_or_insert_with(|| v.trim().to_string());
        }
    }
    (title.filter(|t| !t.is_empty()), author.filter(|a| !a.is_empty()))
}

/// The text between Project Gutenberg's "*** START OF …" and "*** END OF …"
/// markers (licence boilerplate stays in the original file, not the reading copy).
pub fn strip_boilerplate(text: &str) -> &str {
    let start = text
        .find("*** START OF")
        .and_then(|at| text[at..].find('\n').map(|nl| at + nl + 1))
        .unwrap_or(0);
    let end = text[start..].find("*** END OF").map(|at| start + at).unwrap_or(text.len());
    let body = &text[start..end];
    if body.trim().len() < 200 { text } else { body }
}

struct Chapter {
    title: String,
    paragraphs: Vec<String>,
}

pub fn to_epub(text: &str, title: &str, id: &str) -> AppResult<Vec<u8>> {
    let text = text.replace("\r\n", "\n").replace('\r', "\n");
    let chapters = split(strip_boilerplate(&text));
    if chapters.iter().all(|c| c.paragraphs.is_empty()) {
        return Err(AppError::Parse("the text file is empty".into()));
    }

    let mut buf = Cursor::new(Vec::new());
    let mut zip = zip::ZipWriter::new(&mut buf);
    let stored = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    let deflated = zip::write::SimpleFileOptions::default();
    let io = |e: zip::result::ZipError| AppError::Parse(e.to_string());

    zip.start_file("mimetype", stored).map_err(io)?;
    zip.write_all(b"application/epub+zip")?;
    zip.start_file("META-INF/container.xml", deflated).map_err(io)?;
    zip.write_all(
        br#"<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>"#,
    )?;

    let mut manifest = String::new();
    let mut spine = String::new();
    let mut nav = String::new();
    for (i, chapter) in chapters.iter().enumerate() {
        let file = format!("part{:04}.xhtml", i + 1);
        manifest.push_str(&format!(
            "    <item id=\"p{i}\" href=\"{file}\" media-type=\"application/xhtml+xml\"/>\n"
        ));
        spine.push_str(&format!("    <itemref idref=\"p{i}\"/>\n"));
        nav.push_str(&format!("      <li><a href=\"{file}\">{}</a></li>\n", esc(&chapter.title)));

        let mut body = String::new();
        if !chapter.title.is_empty() && (i > 0 || chapters.len() > 1 || chapter.title != title) {
            body.push_str(&format!("<h2>{}</h2>\n", esc(&chapter.title)));
        }
        for p in &chapter.paragraphs {
            body.push_str(&format!("<p>{}</p>\n", esc(p)));
        }
        zip.start_file(format!("OEBPS/{file}"), deflated).map_err(io)?;
        zip.write_all(
            format!(
                "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE html>\n<html xmlns=\"http://www.w3.org/1999/xhtml\">\n<head><title>{}</title></head>\n<body>\n{body}</body>\n</html>\n",
                esc(&chapter.title)
            )
            .as_bytes(),
        )?;
    }

    zip.start_file("OEBPS/nav.xhtml", deflated).map_err(io)?;
    zip.write_all(
        format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE html>\n<html xmlns=\"http://www.w3.org/1999/xhtml\" xmlns:epub=\"http://www.idpf.org/2007/ops\">\n<head><title>Contents</title></head>\n<body>\n  <nav epub:type=\"toc\"><ol>\n{nav}  </ol></nav>\n</body>\n</html>\n"
        )
        .as_bytes(),
    )?;

    let modified = "2000-01-01T00:00:00Z";
    zip.start_file("OEBPS/content.opf", deflated).map_err(io)?;
    zip.write_all(
        format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:{id}</dc:identifier>
    <dc:title>{}</dc:title>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">{modified}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
{manifest}  </manifest>
  <spine>
{spine}  </spine>
</package>
"#,
            esc(title)
        )
        .as_bytes(),
    )?;
    zip.finish().map_err(io)?;

    Ok(buf.into_inner())
}

fn split(text: &str) -> Vec<Chapter> {
    let has_blank_lines = text.contains("\n\n") || text.contains("\n \n");
    // Paragraphs: blank-line separated blocks, with hard line wraps joined.
    let blocks: Vec<String> = if has_blank_lines {
        text.split("\n\n")
            .flat_map(|b| {
                // A heading glued to its first paragraph by a single newline.
                let mut lines = b.lines();
                let first = lines.next().unwrap_or("");
                if is_heading(first) && lines.clone().next().is_some() {
                    vec![first.to_string(), lines.collect::<Vec<_>>().join("\n")]
                } else {
                    vec![b.to_string()]
                }
            })
            .map(|b| b.split_whitespace().collect::<Vec<_>>().join(" "))
            .filter(|b| !b.is_empty())
            .collect()
    } else {
        text.lines().map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect()
    };

    let headings = blocks.iter().filter(|b| is_heading(b)).count();
    let mut chapters: Vec<Chapter> = Vec::new();
    if headings >= 2 {
        for b in blocks {
            if is_heading(&b) {
                chapters.push(Chapter { title: b, paragraphs: Vec::new() });
            } else {
                match chapters.last_mut() {
                    Some(c) => c.paragraphs.push(b),
                    None => chapters.push(Chapter { title: "Beginning".into(), paragraphs: vec![b] }),
                }
            }
        }
    } else {
        for (i, chunk) in blocks.chunks(PARAS_PER_PART).enumerate() {
            chapters.push(Chapter { title: format!("Part {}", i + 1), paragraphs: chunk.to_vec() });
        }
    }
    if chapters.is_empty() {
        chapters.push(Chapter { title: "Text".into(), paragraphs: Vec::new() });
    }
    chapters
}

fn is_heading(line: &str) -> bool {
    let line = line.trim();
    if line.is_empty() || line.len() > 60 {
        return false;
    }
    let lower = line.to_lowercase();
    let words: Vec<&str> = lower.split_whitespace().collect();
    let first = words.first().copied().unwrap_or("").trim_end_matches(['.', ':']);
    let keyword = ["chapter", "book", "part", "prologue", "epilogue", "preface", "introduction", "act", "canto", "volume"]
        .contains(&first);
    (keyword && words.len() <= 6) || is_numbered(line)
}

/// "IV.", "XII", "12." on a line of their own.
fn is_numbered(line: &str) -> bool {
    let core = line.trim().trim_end_matches('.');
    !core.is_empty()
        && core.len() <= 8
        && (core.chars().all(|c| c.is_ascii_digit())
            || core.chars().all(|c| matches!(c, 'I' | 'V' | 'X' | 'L' | 'C')))
}

fn esc(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_legacy_text() {
        assert_eq!(decode(b"caf\xe9"), "café");
        assert_eq!(decode("naïve".as_bytes()), "naïve");
    }

    #[test]
    fn finds_chapters_and_builds_a_readable_epub() {
        let text = "My Book\n\nCHAPTER I\nIt was a dark night.\nThe rain fell.\n\nAnd so on.\n\nCHAPTER II\n\nMorning came.";
        let chapters = split(text);
        assert_eq!(chapters.len(), 3, "{:?}", chapters.iter().map(|c| &c.title).collect::<Vec<_>>());
        assert_eq!(chapters[1].title, "CHAPTER I");
        assert_eq!(chapters[1].paragraphs[0], "It was a dark night. The rain fell.");

        let epub = to_epub(text, "My Book & Co", "x").unwrap();
        let meta = super::super::epub::extract_from(Cursor::new(epub)).unwrap();
        assert_eq!(meta.title.as_deref(), Some("My Book & Co"));
    }

    #[test]
    fn gutenberg_headers_and_boilerplate() {
        let body = "CHAPTER I.\n\nIt is a truth universally acknowledged.\n\n".repeat(10);
        let text = format!("The Project Gutenberg eBook\n\nTitle: Pride and Prejudice\n\nAuthor: Jane Austen\n\n*** START OF THE PROJECT GUTENBERG EBOOK 1342 ***\n{body}*** END OF THE PROJECT GUTENBERG EBOOK 1342 ***\nLicence text.");
        assert_eq!(header_meta(&text), (Some("Pride and Prejudice".into()), Some("Jane Austen".into())));
        let stripped = strip_boilerplate(&text);
        assert!(stripped.starts_with("CHAPTER I.") && !stripped.contains("Licence"));
        assert_eq!(split(stripped)[0].title, "CHAPTER I.");
    }

    #[test]
    fn unstructured_text_is_cut_into_parts() {
        let text: String = (0..400).map(|i| format!("Line {i} of prose.\n")).collect();
        let chapters = split(&text);
        assert_eq!(chapters.len(), 3);
        assert_eq!(chapters[0].title, "Part 1");
    }
}
