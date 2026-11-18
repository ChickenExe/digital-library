//! `Read + Seek` over a remote file, fetched in byte ranges.
//!
//! The file is split into 64 KB blocks. A read that lands on a missing block
//! fetches it, plus up to three more missing blocks after it (reads inside a
//! zip entry are sequential, so this saves round trips). Blocks are kept, up to
//! a memory budget, so going back to an earlier chapter costs nothing.

use std::collections::{HashMap, VecDeque};
use std::io::{self, Read, Seek, SeekFrom};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

pub const BLOCK: u64 = 64 * 1024;
const READ_AHEAD: u64 = 4;
/// 64 MB of blocks per book; beyond that the oldest are dropped (and refetched if needed).
const MAX_BLOCKS: usize = 1024;

/// Fetches `start..=end` of the remote file. Must return exactly that many bytes.
pub trait Fetch: Send {
    fn fetch(&self, start: u64, end: u64) -> io::Result<Vec<u8>>;
}

pub struct RangeReader {
    fetch: Box<dyn Fetch>,
    len: u64,
    pos: u64,
    blocks: HashMap<u64, Arc<Vec<u8>>>,
    order: VecDeque<u64>,
    /// Total bytes downloaded, shared with whoever reports progress.
    fetched: Arc<AtomicU64>,
}

impl RangeReader {
    pub fn new(fetch: Box<dyn Fetch>, len: u64, fetched: Arc<AtomicU64>) -> Self {
        Self { fetch, len, pos: 0, blocks: HashMap::new(), order: VecDeque::new(), fetched }
    }

    fn block_count(&self) -> u64 {
        self.len.div_ceil(BLOCK)
    }

    fn ensure(&mut self, block: u64) -> io::Result<Arc<Vec<u8>>> {
        if let Some(b) = self.blocks.get(&block) {
            return Ok(b.clone());
        }
        let mut n = 1;
        while n < READ_AHEAD && block + n < self.block_count() && !self.blocks.contains_key(&(block + n)) {
            n += 1;
        }
        let start = block * BLOCK;
        let end = ((block + n) * BLOCK).min(self.len) - 1;
        let data = self.fetch.fetch(start, end)?;
        if data.len() as u64 != end - start + 1 {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                format!("expected {} bytes from the server, got {}", end - start + 1, data.len()),
            ));
        }
        self.fetched.fetch_add(data.len() as u64, Ordering::Relaxed);
        for (i, chunk) in data.chunks(BLOCK as usize).enumerate() {
            let index = block + i as u64;
            self.blocks.insert(index, Arc::new(chunk.to_vec()));
            self.order.push_back(index);
        }
        while self.order.len() > MAX_BLOCKS {
            if let Some(old) = self.order.pop_front() {
                if old != block {
                    self.blocks.remove(&old);
                }
            }
        }
        Ok(self.blocks[&block].clone())
    }
}

impl Read for RangeReader {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if self.pos >= self.len || buf.is_empty() {
            return Ok(0);
        }
        let block = self.pos / BLOCK;
        let data = self.ensure(block)?;
        let offset = (self.pos - block * BLOCK) as usize;
        let n = buf.len().min(data.len() - offset);
        buf[..n].copy_from_slice(&data[offset..offset + n]);
        self.pos += n as u64;
        Ok(n)
    }
}

impl Seek for RangeReader {
    fn seek(&mut self, to: SeekFrom) -> io::Result<u64> {
        let next = match to {
            SeekFrom::Start(p) => Some(p),
            SeekFrom::End(d) => self.len.checked_add_signed(d),
            SeekFrom::Current(d) => self.pos.checked_add_signed(d),
        };
        let Some(next) = next else {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "seek before start of file"));
        };
        self.pos = next;
        Ok(next)
    }
}

/// Parses `Content-Range: bytes 0-0/24864480` → total length.
pub fn total_from_content_range(v: &str) -> Option<u64> {
    let (range, total) = v.strip_prefix("bytes ")?.split_once('/')?;
    let (start, _) = range.split_once('-')?;
    if start.trim() != "0" {
        return None;
    }
    total.trim().parse().ok()
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use std::io::{Cursor, Write};
    use std::sync::Mutex;

    /// Serves ranges out of memory and records every request.
    pub struct MemFetch {
        pub data: Arc<Vec<u8>>,
        pub requests: Arc<Mutex<Vec<(u64, u64)>>>,
    }

    impl Fetch for MemFetch {
        fn fetch(&self, start: u64, end: u64) -> io::Result<Vec<u8>> {
            self.requests.lock().unwrap().push((start, end));
            Ok(self.data[start as usize..=end as usize].to_vec())
        }
    }

    /// A zip with a small "chapter" and a large incompressible "image".
    pub fn sample_zip() -> Vec<u8> {
        let mut buf = Cursor::new(Vec::new());
        let mut zip = zip::ZipWriter::new(&mut buf);
        let stored = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
        zip.start_file("mimetype", stored).unwrap();
        zip.write_all(b"application/epub+zip").unwrap();
        // ~2 MB of pseudo-random bytes, so it doesn't compress.
        let mut x: u32 = 1;
        let image: Vec<u8> = (0..2_000_000)
            .map(|_| {
                x ^= x << 13;
                x ^= x >> 17;
                x ^= x << 5;
                x as u8
            })
            .collect();
        zip.start_file("OEBPS/images/plate.jpg", stored).unwrap();
        zip.write_all(&image).unwrap();
        zip.start_file("OEBPS/ch1.xhtml", zip::write::SimpleFileOptions::default()).unwrap();
        zip.write_all("<p>It is a truth universally acknowledged…</p>".repeat(50).as_bytes()).unwrap();
        zip.finish().unwrap();
        buf.into_inner()
    }

    #[test]
    fn reads_a_chapter_without_fetching_the_whole_file() {
        let data = Arc::new(sample_zip());
        let requests = Arc::new(Mutex::new(Vec::new()));
        let fetched = Arc::new(AtomicU64::new(0));
        let reader = RangeReader::new(
            Box::new(MemFetch { data: data.clone(), requests: requests.clone() }),
            data.len() as u64,
            fetched.clone(),
        );
        let mut zip = zip::ZipArchive::new(reader).unwrap();
        let mut text = String::new();
        zip.by_name("OEBPS/ch1.xhtml").unwrap().read_to_string(&mut text).unwrap();
        assert!(text.starts_with("<p>It is a truth"));

        let got = fetched.load(Ordering::Relaxed);
        assert!(got < data.len() as u64 / 4, "fetched {got} of {} bytes", data.len());

        // Reading it again is served from the block cache.
        let before = requests.lock().unwrap().len();
        let mut again = String::new();
        zip.by_name("OEBPS/ch1.xhtml").unwrap().read_to_string(&mut again).unwrap();
        assert_eq!(requests.lock().unwrap().len(), before);

        // The large entry streams through intact.
        let mut image = Vec::new();
        zip.by_name("OEBPS/images/plate.jpg").unwrap().read_to_end(&mut image).unwrap();
        assert_eq!(image.len(), 2_000_000);
    }

    #[test]
    fn seeks_and_reads_across_blocks() {
        let data: Arc<Vec<u8>> = Arc::new((0..(BLOCK * 3 + 10)).map(|i| (i % 251) as u8).collect());
        let mut r = RangeReader::new(
            Box::new(MemFetch { data: data.clone(), requests: Default::default() }),
            data.len() as u64,
            Default::default(),
        );
        r.seek(SeekFrom::Start(BLOCK - 3)).unwrap();
        let mut buf = [0u8; 10];
        r.read_exact(&mut buf).unwrap();
        assert_eq!(&buf[..], &data[(BLOCK - 3) as usize..(BLOCK + 7) as usize]);
        r.seek(SeekFrom::End(-4)).unwrap();
        let mut tail = Vec::new();
        r.read_to_end(&mut tail).unwrap();
        assert_eq!(tail, &data[data.len() - 4..]);
        assert!(r.seek(SeekFrom::Current(-1_000_000)).is_err());
    }

    #[test]
    fn short_responses_are_errors() {
        struct Short;
        impl Fetch for Short {
            fn fetch(&self, _: u64, _: u64) -> io::Result<Vec<u8>> {
                Ok(vec![0; 3])
            }
        }
        let mut r = RangeReader::new(Box::new(Short), 1000, Default::default());
        assert!(r.read(&mut [0u8; 8]).is_err());
    }

    #[test]
    fn parses_content_range() {
        assert_eq!(total_from_content_range("bytes 0-0/24864480"), Some(24864480));
        assert_eq!(total_from_content_range("bytes 0-99/*"), None);
        assert_eq!(total_from_content_range("bytes 5-9/100"), None);
    }
}
