//! On-demand reading: open a catalog book without adding it to the library.
//!
//! The reader asks for files inside the EPUB one at a time through
//!
//!   stream://localhost/<provider>/<id>/<path inside the EPUB>
//!
//! (`http://stream.localhost/…` on Windows). When the server supports HTTP
//! ranges (gutenberg.org and its mirror do), only the zip's directory and the
//! entries you actually open are downloaded: a 25 MB illustrated edition costs
//! a few hundred KB to start reading. Otherwise the whole file is downloaded to
//! a temporary cache.
//!
//! Either way the content is thrown away a few minutes after the book is
//! closed (the reader chooses how long). Reading position and notes are small
//! and live in `library.db`, so they survive, and they move to the library copy
//! if the reader keeps the book (see `catalog_acquire`).

pub mod range;

use std::collections::HashMap;
use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use tauri::http::{header, Request, StatusCode};
use tauri::{AppHandle, Manager, Runtime, State, UriSchemeContext, UriSchemeResponder};
use tokio::io::AsyncWriteExt;

use crate::catalog::{gutenberg, store, CatalogState};
use crate::db::books;
use crate::error::{AppError, AppResult};
use crate::models::{StreamMode, StreamStatus, StreamedBook};
use crate::state::AppState;
use range::{Fetch, RangeReader};

/// Same cap as for downloads: refuse absurdly large files.
const MAX_BOOK_BYTES: u64 = 300 * 1024 * 1024;
/// Cap on any single entry we decompress, to defuse zip bombs.
const MAX_ENTRY_BYTES: u64 = 64 * 1024 * 1024;
/// The longest a closed book may be kept (the UI offers up to an hour).
const MAX_KEEP: Duration = Duration::from_secs(24 * 60 * 60);
const SWEEP_EVERY: Duration = Duration::from_secs(30);

/// Where a streamed book's bytes come from.
enum Source {
    Ranged(RangeReader),
    /// A temporary copy, deleted when the session ends.
    Whole(File),
}

impl Read for Source {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        match self {
            Source::Ranged(r) => r.read(buf),
            Source::Whole(f) => f.read(buf),
        }
    }
}

impl Seek for Source {
    fn seek(&mut self, to: SeekFrom) -> io::Result<u64> {
        match self {
            Source::Ranged(r) => r.seek(to),
            Source::Whole(f) => f.seek(to),
        }
    }
}

pub struct Session {
    pub provider: String,
    pub id: String,
    pub title: String,
    pub authors: Vec<String>,
    /// The URL the book is read from; "Keep" downloads this same file, so
    /// positions and highlights stay valid.
    pub url: String,
    pub mode: StreamMode,
    pub total: u64,
    pub fetched: Arc<AtomicU64>,
    /// The temporary copy (whole-file mode only).
    pub temp_file: Option<PathBuf>,
    archive: Mutex<zip::ZipArchive<Source>>,
    /// Readers that currently have the book open.
    readers: AtomicUsize,
    /// When the last reader closed it, and how long to keep it after that.
    closed: Mutex<Option<(Instant, Duration)>>,
}

impl Session {
    pub fn key(&self) -> String {
        format!("{}/{}", self.provider, self.id)
    }

    pub fn status(&self) -> StreamStatus {
        StreamStatus { mode: self.mode, fetched: self.fetched.load(Ordering::Relaxed), total: self.total }
    }

    /// Reads one file out of the EPUB.
    pub fn read_entry(&self, name: &str) -> AppResult<Option<Vec<u8>>> {
        let mut archive = self.archive.lock().map_err(|_| AppError::Invalid("stream lock poisoned".into()))?;
        let entry = match archive.by_name(name) {
            Ok(e) => e,
            Err(zip::result::ZipError::FileNotFound) => return Ok(None),
            Err(e) => return Err(AppError::Parse(format!("{name}: {e}"))),
        };
        let mut buf = Vec::with_capacity(entry.size().min(MAX_ENTRY_BYTES) as usize);
        entry.take(MAX_ENTRY_BYTES).read_to_end(&mut buf)?;
        Ok(Some(buf))
    }

    fn expired(&self, now: Instant) -> bool {
        if self.readers.load(Ordering::SeqCst) > 0 {
            return false;
        }
        match *self.closed.lock().unwrap_or_else(|e| e.into_inner()) {
            Some((at, keep)) => now.duration_since(at) >= keep,
            None => false,
        }
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        if let Some(file) = &self.temp_file {
            let _ = std::fs::remove_file(file);
        }
    }
}

/// Managed state: every book currently streamed (open, or closed but still kept).
pub struct StreamState {
    sessions: Mutex<HashMap<String, Arc<Session>>>,
    /// Temporary copies for servers without range support.
    dir: PathBuf,
}

impl StreamState {
    /// `dir` is emptied: anything left from a previous run is stale.
    pub fn new(dir: PathBuf) -> AppResult<Self> {
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir)?;
        Ok(Self { sessions: Mutex::new(HashMap::new()), dir })
    }

    fn sessions(&self) -> AppResult<MutexGuard<'_, HashMap<String, Arc<Session>>>> {
        self.sessions.lock().map_err(|_| AppError::Invalid("stream lock poisoned".into()))
    }

    pub fn get(&self, key: &str) -> Option<Arc<Session>> {
        self.sessions().ok()?.get(key).cloned()
    }

    /// Drops sessions that have been closed for longer than they were to be kept.
    pub fn sweep(&self, now: Instant) -> usize {
        let Ok(mut sessions) = self.sessions() else { return 0 };
        let before = sessions.len();
        sessions.retain(|_, s| !s.expired(now));
        before - sessions.len()
    }
}

/// Discards expired sessions in the background for as long as the app runs.
pub fn spawn_sweeper(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(SWEEP_EVERY).await;
            let dropped = app.state::<StreamState>().sweep(Instant::now());
            if dropped > 0 {
                log::info!("discarded {dropped} streamed book(s)");
            }
        }
    });
}

/// Range requests over the shared HTTP client. Called from blocking threads
/// (the protocol handler), so it drives the async request to completion here.
struct HttpFetch {
    http: reqwest::Client,
    url: String,
}

impl Fetch for HttpFetch {
    fn fetch(&self, start: u64, end: u64) -> io::Result<Vec<u8>> {
        let http = self.http.clone();
        let url = self.url.clone();
        tauri::async_runtime::block_on(async move {
            let r = http
                .get(&url)
                .header(header::RANGE, format!("bytes={start}-{end}"))
                .send()
                .await
                .map_err(io::Error::other)?;
            let content_range = r.headers().get(header::CONTENT_RANGE).and_then(|v| v.to_str().ok()).unwrap_or("");
            if r.status() != StatusCode::PARTIAL_CONTENT || !content_range.starts_with(&format!("bytes {start}-")) {
                return Err(io::Error::other(format!("server did not return the requested range (HTTP {})", r.status())));
            }
            Ok(r.bytes().await.map_err(io::Error::other)?.to_vec())
        })
    }
}

/// Finds a working source for the book: the same EPUB variants, in the same
/// order, as "Get" uses. A server that honours ranges is read in place.
async fn resolve(http: &reqwest::Client, id: &str, temp: &Path) -> AppResult<(Source, StreamMode, u64, String, Arc<AtomicU64>)> {
    let mut last_err: Option<AppError> = None;
    let fetched = Arc::new(AtomicU64::new(0));
    for source in gutenberg::epub_sources(id) {
        let url = &source.url;
        let response = match http.get(url).header(header::RANGE, "bytes=0-0").send().await {
            Ok(r) => r,
            Err(e) => {
                if gutenberg::is_primary(url) {
                    gutenberg::mark_primary_down();
                }
                last_err = Some(e.into());
                continue;
            }
        };
        let status = response.status();
        if status.is_server_error() && gutenberg::is_primary(url) {
            gutenberg::mark_primary_down();
        }
        if status == StatusCode::PARTIAL_CONTENT {
            let total = response
                .headers()
                .get(header::CONTENT_RANGE)
                .and_then(|v| v.to_str().ok())
                .and_then(range::total_from_content_range);
            let Some(total) = total.filter(|t| *t > 0 && *t <= MAX_BOOK_BYTES) else { continue };
            // Ask the file (after redirects) directly from now on.
            let final_url = response.url().to_string();
            fetched.fetch_add(1, Ordering::Relaxed);
            let reader = RangeReader::new(Box::new(HttpFetch { http: http.clone(), url: final_url.clone() }), total, fetched.clone());
            return Ok((Source::Ranged(reader), StreamMode::Ranged, total, final_url, fetched));
        }
        if !status.is_success() {
            last_err = Some(AppError::Network(format!("HTTP {status}")));
            continue;
        }
        // The server ignored the range and is sending the whole file.
        let total = response.content_length();
        if let (Some(max), Some(t)) = (source.max_bytes, total) {
            if t > max {
                continue;
            }
        }
        if total.is_some_and(|t| t > MAX_BOOK_BYTES) {
            return Err(AppError::Invalid("this book is too large to read".into()));
        }
        let final_url = response.url().to_string();
        let mut out = tokio::fs::File::create(temp).await?;
        let mut body = response.bytes_stream();
        while let Some(chunk) = body.next().await {
            let chunk = chunk?;
            if fetched.fetch_add(chunk.len() as u64, Ordering::Relaxed) + chunk.len() as u64 > MAX_BOOK_BYTES {
                return Err(AppError::Invalid("this book is too large to read".into()));
            }
            out.write_all(&chunk).await?;
        }
        out.flush().await?;
        drop(out);
        let file = File::open(temp)?;
        let len = file.metadata()?.len();
        return Ok((Source::Whole(file), StreamMode::Whole, len, final_url, fetched));
    }
    Err(last_err.unwrap_or_else(|| AppError::NotFound("no EPUB edition is available for this book".into())))
}

fn check(provider: &str, id: &str) -> AppResult<()> {
    if provider != gutenberg::PROVIDER || !gutenberg::valid_id(id) {
        return Err(AppError::Invalid(format!("unknown listing {provider}/{id}")));
    }
    Ok(())
}

fn info(session: &Session, library: &AppState) -> AppResult<StreamedBook> {
    Ok(StreamedBook {
        key: session.key(),
        provider: session.provider.clone(),
        id: session.id.clone(),
        title: session.title.clone(),
        authors: session.authors.clone(),
        progress: books::stream_progress(&*library.conn()?, &session.provider, &session.id)?,
        status: session.status(),
    })
}

/// Opens a catalog book for reading on demand. Reopening one that is still
/// cached (closed recently) is instant and fetches nothing.
#[tauri::command]
pub async fn stream_open(app: AppHandle, provider: String, id: String) -> AppResult<StreamedBook> {
    check(&provider, &id)?;
    let streams = app.state::<StreamState>();
    let library = app.state::<AppState>();
    let key = format!("{provider}/{id}");
    if let Some(session) = streams.get(&key) {
        session.readers.fetch_add(1, Ordering::SeqCst);
        *session.closed.lock().unwrap_or_else(|e| e.into_inner()) = None;
        return info(&session, &library);
    }

    let catalog = app.state::<CatalogState>();
    let entry = store::get(&*catalog.conn()?, &provider, &id)?
        .ok_or_else(|| AppError::NotFound(format!("listing {key}")))?
        .entry;
    let temp = streams.dir.join(format!("{provider}-{id}-{}.epub", uuid::Uuid::now_v7()));
    let resolved = resolve(&catalog.http, &id, &temp).await;
    let (source, mode, total, url, fetched) = match resolved {
        Ok(r) => r,
        Err(e) => {
            let _ = std::fs::remove_file(&temp);
            return Err(e);
        }
    };
    let temp_file = (mode == StreamMode::Whole).then_some(temp.clone());

    // Reading the zip directory blocks on the network: do it off the async runtime.
    let archive = tauri::async_runtime::spawn_blocking(move || -> AppResult<zip::ZipArchive<Source>> {
        let mut zip = zip::ZipArchive::new(source).map_err(|e| AppError::Parse(e.to_string()))?;
        zip.by_name("META-INF/container.xml").map_err(|_| AppError::Parse("not an EPUB".into()))?;
        Ok(zip)
    })
    .await
    .map_err(|e| AppError::Invalid(e.to_string()))?;
    let archive = match archive {
        Ok(a) => a,
        Err(e) => {
            let _ = std::fs::remove_file(&temp);
            return Err(e);
        }
    };

    let session = Arc::new(Session {
        provider,
        id,
        title: entry.title,
        authors: entry.authors,
        url,
        mode,
        total,
        fetched,
        temp_file,
        archive: Mutex::new(archive),
        readers: AtomicUsize::new(1),
        closed: Mutex::new(None),
    });
    // Two opens racing: keep whichever arrived first.
    let session = {
        let mut sessions = streams.sessions()?;
        match sessions.get(&key) {
            Some(existing) => {
                existing.readers.fetch_add(1, Ordering::SeqCst);
                existing.clone()
            }
            None => {
                sessions.insert(key.clone(), session.clone());
                session
            }
        }
    };
    log::info!("streaming {key} ({:?}, {} bytes)", session.mode, session.total);
    info(&session, &library)
}

/// The reader closed the book: keep its content for `keep_minutes`, then discard it.
#[tauri::command]
pub fn stream_close(streams: State<'_, StreamState>, key: String, keep_minutes: u32) {
    let Some(session) = streams.get(&key) else { return };
    let left = session.readers.fetch_sub(1, Ordering::SeqCst).saturating_sub(1);
    if left == 0 {
        let keep = Duration::from_secs(u64::from(keep_minutes) * 60).min(MAX_KEEP);
        *session.closed.lock().unwrap_or_else(|e| e.into_inner()) = Some((Instant::now(), keep));
        if keep.is_zero() {
            streams.sweep(Instant::now());
        }
    }
}

#[tauri::command]
pub fn stream_status(streams: State<'_, StreamState>, key: String) -> AppResult<StreamStatus> {
    streams.get(&key).map(|s| s.status()).ok_or_else(|| AppError::NotFound(format!("stream {key}")))
}

#[tauri::command(async)]
pub fn stream_save_progress(
    library: State<'_, AppState>,
    provider: String,
    id: String,
    locator: String,
    percent: f64,
) -> AppResult<()> {
    check(&provider, &id)?;
    if !percent.is_finite() {
        return Err(AppError::Invalid("percent must be a finite number".into()));
    }
    books::save_stream_progress(&*library.conn()?, &provider, &id, &locator, percent)
}

/// Splits `/<provider>/<id>/<entry path>` into the session key and the entry name.
fn parse_path(path: &str) -> Option<(String, String)> {
    let path = path.trim_start_matches('/');
    let mut parts = path.splitn(3, '/');
    let (provider, id, rest) = (parts.next()?, parts.next()?, parts.next()?);
    let entry = percent_encoding::percent_decode_str(rest).decode_utf8().ok()?.into_owned();
    // Zip entry names are plain relative paths.
    if entry.is_empty() || entry.starts_with('/') || entry.split('/').any(|s| s == "..") {
        return None;
    }
    Some((format!("{provider}/{id}"), entry))
}

fn mime(entry: &str) -> &'static str {
    match entry.rsplit('.').next().map(str::to_ascii_lowercase).as_deref() {
        Some("xhtml") | Some("xht") => "application/xhtml+xml",
        Some("html") | Some("htm") => "text/html",
        Some("css") => "text/css",
        Some("opf") => "application/oebps-package+xml",
        Some("ncx") => "application/x-dtbncx+xml",
        Some("xml") => "application/xml",
        Some("ttf") => "font/ttf",
        Some("otf") => "font/otf",
        Some("woff") => "font/woff",
        Some("woff2") => "font/woff2",
        // Book scripts never run (the reader disables them); don't serve them as script.
        Some("js") => "text/plain",
        _ => crate::library::mime_for(entry),
    }
}

/// `stream://localhost/<provider>/<id>/<entry>`: one file from a streamed EPUB.
/// Only open sessions are served, so this can't be used to fetch arbitrary URLs.
pub fn handle<R: Runtime>(ctx: UriSchemeContext<'_, R>, request: Request<Vec<u8>>, responder: UriSchemeResponder) {
    let app = ctx.app_handle().clone();
    let path = request.uri().path().to_string();
    tauri::async_runtime::spawn_blocking(move || {
        let respond = |code: StatusCode| crate::protocol::base(code).body(Vec::new()).unwrap_or_default();
        let Some((key, entry)) = parse_path(&path) else {
            return responder.respond(respond(StatusCode::BAD_REQUEST));
        };
        let Some(session) = app.state::<StreamState>().get(&key) else {
            return responder.respond(respond(StatusCode::NOT_FOUND));
        };
        let response = match session.read_entry(&entry) {
            Ok(Some(bytes)) => crate::protocol::base(StatusCode::OK)
                .header(header::CONTENT_TYPE, mime(&entry))
                .body(bytes)
                .unwrap_or_default(),
            Ok(None) => respond(StatusCode::NOT_FOUND),
            Err(e) => {
                log::warn!("stream {key}/{entry}: {e}");
                respond(StatusCode::BAD_GATEWAY)
            }
        };
        responder.respond(response);
    });
}

#[cfg(test)]
mod tests {
    use super::range::tests::{sample_zip, MemFetch};
    use super::*;

    fn session(state: &StreamState, key_id: &str) -> Arc<Session> {
        let data = Arc::new(sample_zip());
        let fetched = Arc::new(AtomicU64::new(0));
        let reader = RangeReader::new(Box::new(MemFetch { data: data.clone(), requests: Default::default() }), data.len() as u64, fetched.clone());
        let s = Arc::new(Session {
            provider: "gutenberg".into(),
            id: key_id.into(),
            title: "T".into(),
            authors: vec![],
            url: "mem://".into(),
            mode: StreamMode::Ranged,
            total: data.len() as u64,
            fetched,
            temp_file: None,
            archive: Mutex::new(zip::ZipArchive::new(Source::Ranged(reader)).unwrap()),
            readers: AtomicUsize::new(1),
            closed: Mutex::new(None),
        });
        state.sessions().unwrap().insert(s.key(), s.clone());
        s
    }

    #[test]
    fn serves_entries_and_expires_after_close() {
        let dir = tempfile::tempdir().unwrap();
        let state = StreamState::new(dir.path().join("streams")).unwrap();
        let s = session(&state, "1342");
        assert!(s.read_entry("OEBPS/ch1.xhtml").unwrap().is_some());
        assert!(s.read_entry("OEBPS/missing.xhtml").unwrap().is_none());
        assert!(s.status().fetched < s.total / 4);

        let now = Instant::now();
        assert_eq!(state.sweep(now), 0, "open books are never discarded");
        s.readers.store(0, Ordering::SeqCst);
        *s.closed.lock().unwrap() = Some((now, Duration::from_secs(600)));
        assert_eq!(state.sweep(now + Duration::from_secs(599)), 0, "kept for the chosen time");
        assert_eq!(state.sweep(now + Duration::from_secs(600)), 1);
        assert!(state.get("gutenberg/1342").is_none());
    }

    #[test]
    fn whole_file_copies_are_deleted_with_the_session() {
        let dir = tempfile::tempdir().unwrap();
        let state = StreamState::new(dir.path().join("streams")).unwrap();
        let temp = state.dir.join("copy.epub");
        std::fs::write(&temp, sample_zip()).unwrap();
        let s = Arc::new(Session {
            provider: "gutenberg".into(),
            id: "1".into(),
            title: "T".into(),
            authors: vec![],
            url: "file".into(),
            mode: StreamMode::Whole,
            total: 0,
            fetched: Default::default(),
            temp_file: Some(temp.clone()),
            archive: Mutex::new(zip::ZipArchive::new(Source::Whole(File::open(&temp).unwrap())).unwrap()),
            readers: AtomicUsize::new(0),
            closed: Mutex::new(Some((Instant::now(), Duration::ZERO))),
        });
        state.sessions().unwrap().insert(s.key(), s);
        assert_eq!(state.sweep(Instant::now()), 1);
        assert!(!temp.exists());
    }

    /// Streams a real illustrated book from the Gutenberg mirror. Network-dependent,
    /// so opt-in: `cargo test -- --ignored streams_from_the_mirror`.
    #[test]
    #[ignore]
    fn streams_from_the_mirror() {
        let http = crate::http::client();
        let temp = tempfile::tempdir().unwrap();
        let (source, mode, total, url, fetched) =
            tauri::async_runtime::block_on(resolve(&http, "1342", &temp.path().join("t.epub"))).unwrap();
        assert_eq!(mode, StreamMode::Ranged, "{url}");
        let mut zip = zip::ZipArchive::new(source).unwrap();
        let mut container = String::new();
        zip.by_name("META-INF/container.xml").unwrap().read_to_string(&mut container).unwrap();
        assert!(container.contains("rootfile"));
        let got = fetched.load(Ordering::Relaxed);
        println!("{url}: fetched {got} of {total} bytes to open");
        assert!(got < total / 10);
    }

    #[test]
    fn parses_entry_paths() {
        assert_eq!(
            parse_path("/gutenberg/1342/OEBPS/My%20Chapter.xhtml"),
            Some(("gutenberg/1342".into(), "OEBPS/My Chapter.xhtml".into()))
        );
        assert_eq!(parse_path("/gutenberg/1342/META-INF/container.xml").unwrap().1, "META-INF/container.xml");
        for bad in ["/gutenberg/1342/", "/gutenberg/1342/../x", "/gutenberg", "/gutenberg/1342/a/../../b"] {
            assert_eq!(parse_path(bad), None, "{bad}");
        }
    }
}
