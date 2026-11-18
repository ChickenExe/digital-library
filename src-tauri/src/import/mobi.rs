//! Kindle MOBI / AZW / AZW3 (KF8) / PRC metadata + cover.
//!
//! Layout: a PalmDB container whose record 0 holds the PalmDOC header, the
//! MOBI header and (usually) an EXTH block of tagged metadata. Images are
//! later records, counted from the MOBI header's "first image" index; EXTH 201
//! names the cover's offset from there. The text itself is read by the
//! frontend (foliate-js), so we only need the headers.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

use super::{Cover, Extracted};
use crate::error::{AppError, AppResult};

/// Generous cap on a single image record.
const MAX_RECORD: u32 = 16 * 1024 * 1024;

pub fn extract(path: &Path) -> AppResult<Extracted> {
    let mut file = File::open(path)?;
    let mut head = vec![0u8; 78];
    file.read_exact(&mut head).map_err(|_| AppError::Parse("file is too short".into()))?;
    check_magic(&head)?;

    let count = be16(&head, 76) as usize;
    let mut table = vec![0u8; count * 8];
    file.read_exact(&mut table)?;
    let offsets: Vec<u32> = (0..count).map(|i| be32(&table, i * 8)).collect();
    let len = file.metadata()?.len() as u32;
    let record = |file: &mut File, i: usize| -> AppResult<Vec<u8>> {
        let start = *offsets.get(i).ok_or_else(|| AppError::Parse("record out of range".into()))?;
        let end = offsets.get(i + 1).copied().unwrap_or(len);
        if end < start || end - start > MAX_RECORD {
            return Err(AppError::Parse("corrupt record table".into()));
        }
        let mut buf = vec![0u8; (end - start) as usize];
        file.seek(SeekFrom::Start(start as u64))?;
        file.read_exact(&mut buf)?;
        Ok(buf)
    };

    let r0 = record(&mut file, 0)?;
    let mut meta = parse_record0(&r0)?;
    if let Some(index) = meta.cover_record {
        if let Ok(bytes) = record(&mut file, index) {
            if looks_like_image(&bytes) {
                meta.extracted.cover = Some(Cover { bytes, media_type: None });
            }
        }
    }
    Ok(meta.extracted)
}

struct Record0 {
    extracted: Extracted,
    cover_record: Option<usize>,
}

fn check_magic(head: &[u8]) -> AppResult<()> {
    if head.starts_with(b"\xeaDRMION\xee") || head.starts_with(b"CONT\x02\x00") {
        return Err(AppError::Unsupported(
            "KFX (Kindle's newest format) can't be opened. Export the book as AZW3 or EPUB instead".into(),
        ));
    }
    match &head[60..68] {
        b"BOOKMOBI" => Ok(()),
        b"TEXtREAd" => Err(AppError::Unsupported("plain PalmDOC (.pdb) books aren't supported yet".into())),
        _ => Err(AppError::Parse("not a MOBI/AZW file".into())),
    }
}

fn parse_record0(r0: &[u8]) -> AppResult<Record0> {
    if r0.len() < 16 {
        return Err(AppError::Parse("missing PalmDOC header".into()));
    }
    if be16(r0, 12) != 0 {
        return Err(AppError::Unsupported(
            "this Kindle book is DRM-protected, so it can't be opened here".into(),
        ));
    }
    let mut out = Extracted::default();
    if r0.get(16..20) != Some(b"MOBI") {
        return Ok(Record0 { extracted: out, cover_record: None });
    }
    let header_len = be32(r0, 20) as usize;
    let utf8 = be32(r0, 28) == 65001;
    let decode = |b: &[u8]| -> String {
        let s = if utf8 {
            String::from_utf8_lossy(b).into_owned()
        } else {
            encoding_rs::WINDOWS_1252.decode(b).0.into_owned()
        };
        s.trim_matches(|c: char| c == '\0' || c.is_whitespace()).to_string()
    };

    // The "full name" is the real title; the PalmDB name is truncated to 31 bytes.
    let name_off = be32(r0, 84) as usize;
    let name_len = be32(r0, 88) as usize;
    if let Some(name) = r0.get(name_off..name_off.saturating_add(name_len)) {
        out.title = Some(decode(name)).filter(|t| !t.is_empty());
    }
    let first_image = be32(r0, 108);

    let mut cover_offset = None;
    let mut thumb_offset = None;
    let has_exth = r0.len() >= 132 && be32(r0, 128) & 0x40 != 0;
    let exth_at = 16 + header_len;
    if has_exth && r0.get(exth_at..exth_at + 4) == Some(b"EXTH") {
        let count = be32(r0, exth_at + 8) as usize;
        let mut pos = exth_at + 12;
        for _ in 0..count {
            let Some(head) = r0.get(pos..pos + 8) else { break };
            let kind = be32(head, 0);
            let size = be32(head, 4) as usize;
            if size < 8 {
                break;
            }
            let Some(data) = r0.get(pos + 8..pos + size) else { break };
            match kind {
                100 => {
                    let a = decode(data);
                    if !a.is_empty() && !out.authors.contains(&a) {
                        out.authors.push(a);
                    }
                }
                101 => out.publisher = Some(decode(data)).filter(|s| !s.is_empty()),
                103 => out.description = Some(super::epub::strip_html(&decode(data))).filter(|s| !s.is_empty()),
                104 => out.isbn = Some(decode(data).replace('-', "")).filter(|s| !s.is_empty()),
                106 => out.published = Some(decode(data)).filter(|s| !s.is_empty()),
                503 => out.title = Some(decode(data)).filter(|s| !s.is_empty()).or(out.title.take()),
                524 => out.language = Some(decode(data)).filter(|s| !s.is_empty()),
                201 if data.len() >= 4 => cover_offset = Some(be32(data, 0)),
                202 if data.len() >= 4 => thumb_offset = Some(be32(data, 0)),
                _ => {}
            }
            pos += size;
        }
    }
    // 0xFFFFFFFF means "none" for both the image index and the offsets.
    let cover_record = (first_image != u32::MAX)
        .then_some(())
        .and(cover_offset.or(thumb_offset).filter(|o| *o != u32::MAX))
        .map(|o| (first_image + o) as usize);
    Ok(Record0 { extracted: out, cover_record })
}

fn looks_like_image(b: &[u8]) -> bool {
    b.starts_with(&[0xff, 0xd8]) || b.starts_with(b"\x89PNG") || b.starts_with(b"GIF8")
}

fn be16(b: &[u8], at: usize) -> u16 {
    b.get(at..at + 2).map(|s| u16::from_be_bytes([s[0], s[1]])).unwrap_or(0)
}
fn be32(b: &[u8], at: usize) -> u32 {
    b.get(at..at + 4).map(|s| u32::from_be_bytes([s[0], s[1], s[2], s[3]])).unwrap_or(0)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// A minimal BOOKMOBI with an EXTH block (author, title) and a cover image record.
    pub fn build_mobi(encrypted: bool) -> Vec<u8> {
        let mut exth = Vec::new();
        let mut recs = 0u32;
        let mut push = |kind: u32, data: &[u8]| {
            exth.extend_from_slice(&kind.to_be_bytes());
            exth.extend_from_slice(&(data.len() as u32 + 8).to_be_bytes());
            exth.extend_from_slice(data);
            recs += 1;
        };
        push(100, "Ursula K. Le Guin".as_bytes());
        push(503, "A Wizard of Earthsea".as_bytes());
        push(201, &0u32.to_be_bytes());
        let mut exth_block = b"EXTH".to_vec();
        exth_block.extend_from_slice(&(exth.len() as u32 + 12).to_be_bytes());
        exth_block.extend_from_slice(&recs.to_be_bytes());
        exth_block.extend_from_slice(&exth);

        let header_len = 232u32;
        let mut r0 = vec![0u8; 16 + header_len as usize];
        r0[12..14].copy_from_slice(&(if encrypted { 2u16 } else { 0 }).to_be_bytes());
        r0[16..20].copy_from_slice(b"MOBI");
        r0[20..24].copy_from_slice(&header_len.to_be_bytes());
        r0[28..32].copy_from_slice(&65001u32.to_be_bytes());
        r0[108..112].copy_from_slice(&2u32.to_be_bytes()); // first image = record 2
        r0[128..132].copy_from_slice(&0x40u32.to_be_bytes());
        r0.extend_from_slice(&exth_block);
        let name = b"Earthsea";
        let name_off = r0.len() as u32;
        r0.extend_from_slice(name);
        r0[84..88].copy_from_slice(&name_off.to_be_bytes());
        r0[88..92].copy_from_slice(&(name.len() as u32).to_be_bytes());

        let text = b"<html><body><p>Only a word.</p></body></html>".to_vec();
        let image = [0xffu8, 0xd8, 0xff, 0xe0, 1, 2, 3, 4].to_vec();
        let records = [r0, text, image];

        let mut out = vec![0u8; 78];
        out[..8].copy_from_slice(b"Earthsea");
        out[60..68].copy_from_slice(b"BOOKMOBI");
        out[76..78].copy_from_slice(&(records.len() as u16).to_be_bytes());
        let mut offset = 78 + records.len() as u32 * 8 + 2;
        for r in &records {
            out.extend_from_slice(&offset.to_be_bytes());
            out.extend_from_slice(&[0; 4]);
            offset += r.len() as u32;
        }
        out.extend_from_slice(&[0, 0]);
        for r in &records {
            out.extend_from_slice(r);
        }
        out
    }

    #[test]
    fn reads_exth_metadata_and_cover() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("b.azw3");
        std::fs::write(&path, build_mobi(false)).unwrap();
        let x = extract(&path).unwrap();
        assert_eq!(x.title.as_deref(), Some("A Wizard of Earthsea"));
        assert_eq!(x.authors, vec!["Ursula K. Le Guin"]);
        assert!(x.cover.unwrap().bytes.starts_with(&[0xff, 0xd8]));
    }

    #[test]
    fn rejects_drm_and_junk() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("b.azw");
        std::fs::write(&path, build_mobi(true)).unwrap();
        assert!(matches!(extract(&path), Err(AppError::Unsupported(_))));
        std::fs::write(&path, vec![7u8; 200]).unwrap();
        assert!(extract(&path).is_err());
    }
}
