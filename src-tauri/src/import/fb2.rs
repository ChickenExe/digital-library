//! FictionBook 2 (`.fb2`, and `.fbz` / `.fb2.zip` which zip a single .fb2).
//!
//! Metadata lives in `<description><title-info>`; the cover is a
//! `<coverpage><image href="#id"/>` pointing at a base64 `<binary id="id">`.
//! Many FB2 files (especially Russian ones) are windows-1251, declared in the
//! XML prolog, so we decode by that before parsing.

use base64::Engine;
use quick_xml::events::Event;
use quick_xml::Reader;
use std::fs::File;
use std::io::{BufReader, Read};
use std::path::Path;

use super::epub::{attrs, collapse_ws, local, MAX_ENTRY_BYTES};
use super::{Cover, Extracted};
use crate::error::{AppError, AppResult};

/// Largest FB2 we'll parse for metadata (they embed images as base64).
const MAX_FB2_BYTES: u64 = 128 * 1024 * 1024;

pub fn extract(path: &Path) -> AppResult<Extracted> {
    let bytes = read_fb2(path)?;
    parse(&decode(&bytes))
}

/// The FB2 document bytes, unzipping `.fbz` / `.fb2.zip` if needed.
pub fn read_fb2(path: &Path) -> AppResult<Vec<u8>> {
    let mut file = File::open(path)?;
    let mut magic = [0u8; 4];
    let n = file.read(&mut magic)?;
    drop(file);
    if n == 4 && magic == *b"PK\x03\x04" {
        let mut zip = zip::ZipArchive::new(BufReader::new(File::open(path)?))
            .map_err(|e| AppError::Parse(e.to_string()))?;
        let name = zip
            .file_names()
            .flatten()
            .find(|n| n.to_ascii_lowercase().ends_with(".fb2"))
            .map(|n| n.into_owned())
            .ok_or_else(|| AppError::Parse("archive has no .fb2 inside".into()))?;
        let entry = zip.by_name(&name).map_err(|e| AppError::Parse(e.to_string()))?;
        let mut out = Vec::new();
        entry.take(MAX_ENTRY_BYTES.max(MAX_FB2_BYTES)).read_to_end(&mut out)?;
        return Ok(out);
    }
    let mut out = Vec::new();
    File::open(path)?.take(MAX_FB2_BYTES).read_to_end(&mut out)?;
    Ok(out)
}

/// Decodes by BOM, then the prolog's `encoding="…"`, defaulting to UTF-8.
fn decode(bytes: &[u8]) -> String {
    if let Some((enc, bom)) = encoding_rs::Encoding::for_bom(bytes) {
        return enc.decode_without_bom_handling(&bytes[bom..]).0.into_owned();
    }
    let prolog = &bytes[..bytes.len().min(200)];
    let prolog = String::from_utf8_lossy(prolog);
    let label = prolog.find("encoding=").and_then(|at| {
        let rest = &prolog[at + 9..];
        let quote = rest.chars().next()?;
        let rest = &rest[1..];
        Some(rest[..rest.find(quote)?].to_string())
    });
    let enc = label
        .and_then(|l| encoding_rs::Encoding::for_label(l.as_bytes()))
        .unwrap_or(encoding_rs::UTF_8);
    enc.decode_without_bom_handling(bytes).0.into_owned()
}

#[derive(Default)]
struct Author {
    first: String,
    middle: String,
    last: String,
    nick: String,
}

fn parse(xml: &str) -> AppResult<Extracted> {
    let mut reader = Reader::from_str(xml);
    let mut out = Extracted::default();
    let mut path: Vec<String> = Vec::new();
    let mut text = String::new();
    let mut author: Option<Author> = None;
    let mut annotation = String::new();
    let mut cover_id: Option<String> = None;
    // (id, content-type, base64) of the binary being read.
    let mut binary: Option<(String, Option<String>)> = None;

    loop {
        let event = reader.read_event().map_err(|e| AppError::Parse(e.to_string()))?;
        match event {
            Event::Start(e) => {
                let name = local(&e);
                let a = attrs(&e);
                if name == "author" && in_title_info(&path) {
                    author = Some(Author::default());
                }
                if name == "binary" {
                    binary = a.get("id").cloned().map(|id| (id, a.get("content-type").cloned()));
                }
                if name == "body" {
                    // Metadata is done; the cover binary (if any) is found by search below.
                    break;
                }
                path.push(name);
                text.clear();
            }
            Event::Empty(e) => {
                let name = local(&e);
                if name == "image" && path.iter().any(|p| p == "coverpage") && cover_id.is_none() {
                    cover_id = attrs(&e).get("href").map(|h| h.trim_start_matches('#').to_string());
                }
            }
            Event::Text(t) => {
                let s = t.xml10_content();
                text.push_str(&s);
                if path.iter().any(|p| p == "annotation") && in_title_info(&path) {
                    annotation.push_str(&s);
                }
            }
            Event::GeneralRef(r) => {
                let resolved = match r.resolve_char_ref() {
                    Ok(Some(c)) => c.to_string(),
                    _ => match &*r {
                        "amp" => "&",
                        "lt" => "<",
                        "gt" => ">",
                        "quot" => "\"",
                        "apos" => "'",
                        _ => "",
                    }
                    .to_string(),
                };
                text.push_str(&resolved);
                if path.iter().any(|p| p == "annotation") && in_title_info(&path) {
                    annotation.push_str(&resolved);
                }
            }
            Event::End(_) => {
                let Some(name) = path.pop() else { continue };
                if name == "p" && path.iter().any(|p| p == "annotation") {
                    annotation.push(' ');
                }
                let value = collapse_ws(&text);
                let title_info = in_title_info(&path) || (name == "title-info");
                match name.as_str() {
                    "book-title" if title_info => out.title = Some(value).filter(|v| !v.is_empty()),
                    "first-name" => if let Some(a) = &mut author { a.first = value },
                    "middle-name" => if let Some(a) = &mut author { a.middle = value },
                    "last-name" => if let Some(a) = &mut author { a.last = value },
                    "nickname" => if let Some(a) = &mut author { a.nick = value },
                    "author" => {
                        if let Some(a) = author.take() {
                            let full = collapse_ws(&format!("{} {} {}", a.first, a.middle, a.last));
                            let full = if full.is_empty() { a.nick } else { full };
                            if !full.is_empty() && !out.authors.contains(&full) {
                                out.authors.push(full);
                            }
                        }
                    }
                    "lang" if title_info => out.language = Some(value).filter(|v| !v.is_empty()),
                    "date" if title_info && out.published.is_none() => {
                        out.published = Some(value).filter(|v| !v.is_empty())
                    }
                    "publisher" if path.iter().any(|p| p == "publish-info") => {
                        out.publisher = Some(value).filter(|v| !v.is_empty())
                    }
                    "isbn" => out.isbn = Some(value.replace('-', "")).filter(|v| !v.is_empty()),
                    "year" if out.published.is_none() => out.published = Some(value).filter(|v| !v.is_empty()),
                    "binary" => {
                        if let Some((id, media_type)) = binary.take() {
                            if Some(&id) == cover_id.as_ref() {
                                let clean: String = text.chars().filter(|c| !c.is_whitespace()).collect();
                                if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(clean) {
                                    out.cover = Some(Cover { bytes, media_type });
                                }
                                break;
                            }
                        }
                    }
                    _ => {}
                }
                text.clear();
            }
            Event::Eof => break,
            _ => {}
        }
    }
    // Binaries come after the (possibly huge) body, which we didn't parse.
    if out.cover.is_none() {
        if let Some(id) = &cover_id {
            out.cover = find_binary(xml, id);
        }
    }
    let annotation = collapse_ws(&annotation);
    if !annotation.is_empty() {
        out.description = Some(annotation);
    }
    Ok(out)
}

fn in_title_info(path: &[String]) -> bool {
    path.iter().any(|p| p == "title-info")
}

/// Binaries follow the (possibly huge) body; find the cover's without parsing the body.
fn find_binary(xml: &str, id: &str) -> Option<Cover> {
    let mut from = 0;
    while let Some(at) = xml[from..].find("<binary") {
        let start = from + at;
        let tag_end = start + xml[start..].find('>')?;
        let tag = &xml[start..tag_end];
        let close = tag_end + xml[tag_end..].find("</binary>")?;
        if tag.contains(&format!("id=\"{id}\"")) || tag.contains(&format!("id='{id}'")) {
            let media_type = tag
                .split("content-type=")
                .nth(1)
                .and_then(|r| r.trim_start_matches(['"', '\'']).split(['"', '\'']).next())
                .map(String::from);
            let clean: String = xml[tag_end + 1..close].chars().filter(|c| !c.is_whitespace()).collect();
            let bytes = base64::engine::general_purpose::STANDARD.decode(clean).ok()?;
            return Some(Cover { bytes, media_type });
        }
        from = close;
    }
    None
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub fn build_fb2() -> String {
        r##"<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
 <description>
  <title-info>
   <genre>sf</genre>
   <author><first-name>Arkady</first-name><last-name>Strugatsky</last-name></author>
   <author><first-name>Boris</first-name><last-name>Strugatsky</last-name></author>
   <book-title>Roadside Picnic</book-title>
   <annotation><p>A Zone, &amp; its stalkers.</p></annotation>
   <date>1972</date>
   <coverpage><image l:href="#cover.jpg"/></coverpage>
   <lang>en</lang>
  </title-info>
  <publish-info><publisher>Macmillan</publisher><isbn>978-0-02-615170-0</isbn></publish-info>
 </description>
 <body><section><title><p>One</p></title><p>Text.</p></section></body>
 <binary id="cover.jpg" content-type="image/jpeg">/9j/4AAQ</binary>
</FictionBook>"##
            .to_string()
    }

    #[test]
    fn reads_title_info_and_cover() {
        let x = parse(&build_fb2()).unwrap();
        assert_eq!(x.title.as_deref(), Some("Roadside Picnic"));
        assert_eq!(x.authors, vec!["Arkady Strugatsky", "Boris Strugatsky"]);
        assert_eq!(x.description.as_deref(), Some("A Zone, & its stalkers."));
        assert_eq!(x.publisher.as_deref(), Some("Macmillan"));
        assert_eq!(x.isbn.as_deref(), Some("9780026151700"));
        assert_eq!(x.language.as_deref(), Some("en"));
        let cover = x.cover.unwrap();
        assert_eq!(cover.bytes[..2], [0xff, 0xd8]);
        assert_eq!(cover.media_type.as_deref(), Some("image/jpeg"));
    }

    #[test]
    fn decodes_windows_1251() {
        let xml = "<?xml version=\"1.0\" encoding=\"windows-1251\"?><FictionBook><description><title-info><book-title>Пикник</book-title></title-info></description></FictionBook>";
        let (bytes, _, _) = encoding_rs::WINDOWS_1251.encode(xml);
        let x = parse(&decode(&bytes)).unwrap();
        assert_eq!(x.title.as_deref(), Some("Пикник"));
    }
}
