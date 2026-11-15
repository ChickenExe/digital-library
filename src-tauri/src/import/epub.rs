//! EPUB 2/3 metadata + cover extraction.
//!
//! An EPUB is a zip: `META-INF/container.xml` points at the OPF package file,
//! whose `<metadata>` holds Dublin Core fields and whose `<manifest>` lists the
//! cover image.

use quick_xml::events::{BytesStart, Event};
use quick_xml::{Reader, XmlVersion};
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufReader, Read, Seek};
use std::path::Path;

use super::{Cover, Extracted};
use crate::error::{AppError, AppResult};

/// Cap on any single entry we decompress, to defuse zip bombs.
const MAX_ENTRY_BYTES: u64 = 64 * 1024 * 1024;

pub fn extract(path: &Path) -> AppResult<Extracted> {
    let file = BufReader::new(File::open(path)?);
    extract_from(file)
}

pub fn extract_from<R: Read + Seek>(reader: R) -> AppResult<Extracted> {
    let mut zip = zip::ZipArchive::new(reader).map_err(|e| AppError::Parse(e.to_string()))?;

    let container = read_entry(&mut zip, "META-INF/container.xml")?;
    let opf_path = find_rootfile(&container)
        .ok_or_else(|| AppError::Parse("container.xml has no rootfile".into()))?;
    let opf = read_entry(&mut zip, &opf_path)?;
    let package = parse_opf(&opf)?;

    let cover = package.cover_href().and_then(|(href, media_type)| {
        let full = resolve_href(&opf_path, &href);
        read_entry(&mut zip, &full).ok().map(|bytes| Cover { bytes, media_type })
    });

    let mut authors = package.creators();
    authors.dedup();
    Ok(Extracted {
        title: package.first("title"),
        authors,
        description: package.first("description").map(|d| strip_html(&d)),
        publisher: package.first("publisher"),
        language: package.first("language"),
        published: package.first("date"),
        isbn: package.isbn(),
        page_count: None,
        cover,
    })
}

fn read_entry<R: Read + Seek>(zip: &mut zip::ZipArchive<R>, name: &str) -> AppResult<Vec<u8>> {
    let entry = zip.by_name(name).map_err(|e| AppError::Parse(format!("{name}: {e}")))?;
    let mut buf = Vec::with_capacity(entry.size().min(MAX_ENTRY_BYTES) as usize);
    entry.take(MAX_ENTRY_BYTES).read_to_end(&mut buf)?;
    Ok(buf)
}

/// Joins an href from the OPF with the OPF's own directory and percent-decodes it.
fn resolve_href(opf_path: &str, href: &str) -> String {
    let href = href.split('#').next().unwrap_or(href);
    let href = percent_encoding::percent_decode_str(href).decode_utf8_lossy();
    let mut parts: Vec<&str> = match opf_path.rfind('/') {
        Some(i) => opf_path[..i].split('/').collect(),
        None => Vec::new(),
    };
    for segment in href.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            s => parts.push(s),
        }
    }
    parts.join("/")
}

fn find_rootfile(xml: &[u8]) -> Option<String> {
    let mut reader = Reader::from_reader(xml);
    let mut buf = Vec::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) if local(&e) == "rootfile" => {
                return attr(&e, "full-path");
            }
            Ok(Event::Eof) | Err(_) => return None,
            _ => {}
        }
        buf.clear();
    }
}

#[derive(Debug, Default)]
struct Package {
    /// Dublin Core elements in document order: (local name, text, attributes).
    dc: Vec<(String, String, HashMap<String, String>)>,
    /// `<meta name=.. content=..>` (EPUB 2) and `<meta property=.. refines=..>` (EPUB 3).
    meta_name: HashMap<String, String>,
    refines: HashMap<(String, String), String>,
    manifest: Vec<ManifestItem>,
}

#[derive(Debug)]
struct ManifestItem {
    id: String,
    href: String,
    media_type: Option<String>,
    properties: String,
}

impl Package {
    fn first(&self, name: &str) -> Option<String> {
        self.dc
            .iter()
            .find(|(n, text, _)| n == name && !text.is_empty())
            .map(|(_, t, _)| t.clone())
    }

    /// Creators, skipping non-author roles (editors, illustrators...) when roles are given.
    fn creators(&self) -> Vec<String> {
        let mut out = Vec::new();
        for (name, text, attrs) in &self.dc {
            if name != "creator" || text.is_empty() {
                continue;
            }
            let role = attrs.get("role").cloned().or_else(|| {
                let id = attrs.get("id")?;
                self.refines.get(&(id.clone(), "role".into())).cloned()
            });
            if role.as_deref().is_none_or(|r| r == "aut") {
                out.push(text.clone());
            }
        }
        out
    }

    fn isbn(&self) -> Option<String> {
        self.dc.iter().filter(|(n, _, _)| n == "identifier").find_map(|(_, text, attrs)| {
            let digits: String = text.chars().filter(|c| c.is_ascii_digit() || *c == 'X').collect();
            let tagged = attrs.get("scheme").is_some_and(|s| s.eq_ignore_ascii_case("isbn"))
                || text.to_ascii_lowercase().contains("isbn");
            ((digits.len() == 10 || digits.len() == 13) && (tagged || digits.starts_with("97")))
                .then_some(digits)
        })
    }

    fn cover_href(&self) -> Option<(String, Option<String>)> {
        let is_image = |i: &&ManifestItem| {
            i.media_type.as_deref().is_some_and(|m| m.starts_with("image/"))
        };
        // 1. EPUB 3: manifest item with properties="cover-image".
        let item = self
            .manifest
            .iter()
            .find(|i| i.properties.split_whitespace().any(|p| p == "cover-image"))
            // 2. EPUB 2: <meta name="cover" content="<manifest id>">.
            .or_else(|| {
                let id = self.meta_name.get("cover")?;
                self.manifest.iter().find(|i| &i.id == id).filter(is_image)
            })
            // 3. Heuristic: an image whose id or href mentions "cover".
            .or_else(|| {
                self.manifest.iter().filter(is_image).find(|i| {
                    i.id.to_ascii_lowercase().contains("cover")
                        || i.href.to_ascii_lowercase().contains("cover")
                })
            })?;
        Some((item.href.clone(), item.media_type.clone()))
    }
}

fn parse_opf(xml: &[u8]) -> AppResult<Package> {
    let mut reader = Reader::from_reader(xml);
    let mut pkg = Package::default();
    let mut buf = Vec::new();
    let mut in_metadata = false;
    // The element whose text we are currently collecting.
    let mut current: Option<(String, HashMap<String, String>, bool)> = None;
    let mut text = String::new();

    loop {
        let event = reader.read_event_into(&mut buf).map_err(|e| AppError::Parse(e.to_string()))?;
        match event {
            Event::Start(e) => {
                let name = local(&e);
                if name == "metadata" {
                    in_metadata = true;
                } else if in_metadata {
                    let is_meta = name == "meta";
                    let attrs = attrs(&e);
                    if is_meta {
                        if let Some(content) = attrs.get("content") {
                            if let Some(n) = attrs.get("name") {
                                pkg.meta_name.insert(n.clone(), content.clone());
                            }
                        }
                    }
                    current = Some((name, attrs, is_meta));
                    text.clear();
                }
            }
            Event::Empty(e) => {
                let name = local(&e);
                let a = attrs(&e);
                if in_metadata && name == "meta" {
                    if let (Some(n), Some(c)) = (a.get("name"), a.get("content")) {
                        pkg.meta_name.insert(n.clone(), c.clone());
                    }
                } else if name == "item" {
                    pkg.manifest.push(ManifestItem {
                        id: a.get("id").cloned().unwrap_or_default(),
                        href: a.get("href").cloned().unwrap_or_default(),
                        media_type: a.get("media-type").cloned(),
                        properties: a.get("properties").cloned().unwrap_or_default(),
                    });
                }
            }
            Event::Text(t) => {
                if current.is_some() {
                    text.push_str(&t.xml10_content());
                }
            }
            Event::CData(t) => {
                if current.is_some() {
                    text.push_str(&t.xml10_content());
                }
            }
            Event::GeneralRef(r) => {
                if current.is_some() {
                    if let Ok(Some(c)) = r.resolve_char_ref() {
                        text.push(c);
                    } else {
                        text.push_str(match &*r {
                            "amp" => "&",
                            "lt" => "<",
                            "gt" => ">",
                            "quot" => "\"",
                            "apos" => "'",
                            "nbsp" => " ",
                            _ => "",
                        });
                    }
                }
            }
            Event::End(e) => {
                let name = e.local_name().as_ref().to_string();
                if name == "metadata" {
                    in_metadata = false;
                } else if let Some((cur, attrs, is_meta)) = current.take() {
                    if cur == name {
                        let value = collapse_ws(&text);
                        if is_meta {
                            if let (Some(target), Some(prop)) =
                                (attrs.get("refines"), attrs.get("property"))
                            {
                                let prop = prop.rsplit(':').next().unwrap_or(prop).to_string();
                                pkg.refines
                                    .insert((target.trim_start_matches('#').to_string(), prop), value);
                            }
                        } else {
                            pkg.dc.push((cur, value, attrs));
                        }
                    } else {
                        // Nested markup inside a field (rare): keep collecting.
                        current = Some((cur, attrs, is_meta));
                    }
                }
            }
            Event::Eof => break,
            _ => {}
        }
        buf.clear();
    }
    Ok(pkg)
}

fn local(e: &BytesStart<'_>) -> String {
    e.local_name().as_ref().to_string()
}

/// Attributes keyed by local name (`opf:role` -> `role`).
fn attrs(e: &BytesStart<'_>) -> HashMap<String, String> {
    e.attributes()
        .flatten()
        .filter_map(|a| {
            let key = a.key.local_name().as_ref().to_string();
            let value = a.normalized_value(XmlVersion::Implicit1_0).ok()?.into_owned();
            Some((key, value))
        })
        .collect()
}

fn attr(e: &BytesStart<'_>, name: &str) -> Option<String> {
    attrs(e).remove(name)
}

fn collapse_ws(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Descriptions are often HTML; we store plain text and let the UI style it.
fn strip_html(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_tag = false;
    for c in s.chars() {
        match c {
            '<' => {
                in_tag = true;
                out.push(' ');
            }
            '>' => in_tag = false,
            c if !in_tag => out.push(c),
            _ => {}
        }
    }
    collapse_ws(&out)
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&nbsp;", " ")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::io::{Cursor, Write};

    /// Builds a tiny but valid EPUB in memory.
    pub fn build_epub(with_cover: bool) -> Vec<u8> {
        let mut buf = Cursor::new(Vec::new());
        {
            let mut zip = zip::ZipWriter::new(&mut buf);
            let stored = zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Stored);
            zip.start_file("mimetype", stored).unwrap();
            zip.write_all(b"application/epub+zip").unwrap();
            zip.start_file("META-INF/container.xml", stored).unwrap();
            zip.write_all(br#"<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>"#).unwrap();
            zip.start_file("OEBPS/content.opf", stored).unwrap();
            zip.write_all(br##"<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:identifier id="uid">urn:isbn:978-0-553-38368-9</dc:identifier>
    <dc:title>A Wizard &amp; a Sea</dc:title>
    <dc:creator id="c1">Ursula K. Le Guin</dc:creator>
    <meta refines="#c1" property="role" scheme="marc:relators">aut</meta>
    <dc:creator id="c2">Ruth Robbins</dc:creator>
    <meta refines="#c2" property="role" scheme="marc:relators">ill</meta>
    <dc:description><![CDATA[<p>An <b>apprentice</b> mage.</p>]]></dc:description>
    <dc:language>en</dc:language>
    <dc:date>1968</dc:date>
    <meta name="cover" content="cover-img"/>
  </metadata>
  <manifest>
    <item id="cover-img" href="images/My%20Cover.png" media-type="image/png"/>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="ch1"/></spine>
</package>"##).unwrap();
            zip.start_file("OEBPS/ch1.xhtml", stored).unwrap();
            zip.write_all(br#"<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>1</title></head><body><p>Hello.</p></body></html>"#).unwrap();
            if with_cover {
                zip.start_file("OEBPS/images/My Cover.png", stored).unwrap();
                zip.write_all(&[0x89, b'P', b'N', b'G', 0, 0, 0, 0]).unwrap();
            }
            zip.finish().unwrap();
        }
        buf.into_inner()
    }

    #[test]
    fn extracts_metadata_and_cover() {
        let meta = extract_from(Cursor::new(build_epub(true))).unwrap();
        assert_eq!(meta.title.as_deref(), Some("A Wizard & a Sea"));
        assert_eq!(meta.authors, ["Ursula K. Le Guin"], "illustrator is filtered out");
        assert_eq!(meta.description.as_deref(), Some("An apprentice mage."));
        assert_eq!(meta.language.as_deref(), Some("en"));
        assert_eq!(meta.isbn.as_deref(), Some("9780553383689"));
        let cover = meta.cover.expect("cover");
        assert_eq!(&cover.bytes[..4], &[0x89, b'P', b'N', b'G']);
    }

    #[test]
    fn missing_cover_is_not_an_error() {
        let meta = extract_from(Cursor::new(build_epub(false))).unwrap();
        assert!(meta.cover.is_none());
        assert_eq!(meta.title.as_deref(), Some("A Wizard & a Sea"));
    }

    #[test]
    fn resolves_relative_hrefs() {
        assert_eq!(resolve_href("OEBPS/content.opf", "../Images/a%20b.jpg"), "Images/a b.jpg");
        assert_eq!(resolve_href("content.opf", "cover.jpg#x"), "cover.jpg");
    }

    #[test]
    fn rejects_garbage() {
        assert!(extract_from(Cursor::new(b"not a zip".to_vec())).is_err());
    }
}
