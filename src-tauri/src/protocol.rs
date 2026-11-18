//! Custom URI schemes that stream library files to the webview:
//!
//!   book://localhost/<id>   → the book file (EPUB/PDF bytes)
//!   cover://localhost/<id>  → a 360 px cover thumbnail (`?full=1` for the original)
//!
//! On Windows (WebView2) these surface as `http://book.localhost/<id>`; the
//! frontend uses `convertFileSrc(id, "book")` so it never has to care.
//! Files are looked up by id in the DB — a URL can never name an arbitrary path.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use tauri::http::{header, Request, Response, StatusCode};
use tauri::{Manager, Runtime, UriSchemeContext, UriSchemeResponder};

use crate::catalog::{gutenberg, CatalogState};
use crate::db::books;
use crate::error::AppResult;
use crate::library::mime_for;
use crate::state::AppState;

#[derive(Clone, Copy)]
pub enum Kind {
    Book,
    Cover,
}

/// What a request asked for, parsed from its URL and headers.
struct Ask {
    id: String,
    /// `cover://…?full=1` returns the original cover; otherwise a thumbnail.
    full: bool,
    /// `cover://…?w=240` asks for a smaller thumbnail (standard-density screens).
    width: Option<u32>,
    /// `Range: bytes=a-b` (books only), so large PDFs load only what's viewed.
    range: Option<(u64, Option<u64>)>,
}

pub fn handle<R: Runtime>(
    kind: Kind,
    ctx: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    if request.method() == tauri::http::Method::OPTIONS {
        responder.respond(
            base(StatusCode::NO_CONTENT)
                .header(header::ACCESS_CONTROL_ALLOW_METHODS, "GET, OPTIONS")
                .header(header::ACCESS_CONTROL_ALLOW_HEADERS, "Range")
                .body(Vec::new())
                .unwrap_or_default(),
        );
        return;
    }
    let app = ctx.app_handle().clone();
    let ask = Ask {
        id: request.uri().path().trim_start_matches('/').to_string(),
        full: request.uri().query().is_some_and(|q| q.split('&').any(|p| p == "full=1")),
        width: request
            .uri()
            .query()
            .and_then(|q| q.split('&').find_map(|p| p.strip_prefix("w=")))
            .and_then(|w| w.parse().ok()),
        range: request
            .headers()
            .get(header::RANGE)
            .and_then(|v| v.to_str().ok())
            .and_then(parse_range),
    };
    // File reads (and thumbnail generation) happen off the webview thread.
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let response = match kind {
            Kind::Book => serve_book(&state, &ask),
            Kind::Cover => serve_cover(&state, &ask),
        }
        .unwrap_or_else(|e| {
            log::error!("protocol error for {}: {e}", ask.id);
            status(StatusCode::INTERNAL_SERVER_ERROR)
        });
        responder.respond(response);
    });
}

type Resp = Response<Vec<u8>>;

fn base(code: StatusCode) -> tauri::http::response::Builder {
    Response::builder()
        .status(code)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        // Cross-origin readers (pdf.js) need to see these to do range loading.
        .header(header::ACCESS_CONTROL_EXPOSE_HEADERS, "Content-Range, Content-Length, Accept-Ranges")
}

fn status(code: StatusCode) -> Resp {
    base(code).body(Vec::new()).unwrap_or_default()
}

/// `bytes=start-end` / `bytes=start-` → (start, end inclusive). Multi-range isn't supported.
fn parse_range(v: &str) -> Option<(u64, Option<u64>)> {
    let spec = v.strip_prefix("bytes=")?;
    if spec.contains(',') {
        return None;
    }
    let (a, b) = spec.split_once('-')?;
    let start = a.trim().parse().ok()?;
    let end = if b.trim().is_empty() { None } else { Some(b.trim().parse().ok()?) };
    Some((start, end))
}

fn serve_book(state: &AppState, ask: &Ask) -> AppResult<Resp> {
    let name = books::file_name(&*state.conn()?, &ask.id)?.map(|(name, _)| name);
    let Some(name) = name else { return Ok(status(StatusCode::NOT_FOUND)) };
    let path = state.paths.book_file(&name)?;
    let mut file = match File::open(&path) {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(status(StatusCode::NOT_FOUND)),
        Err(e) => return Err(e.into()),
    };
    let len = file.metadata()?.len();
    let mime = mime_for(&name);

    let Some((start, end)) = ask.range else {
        let mut bytes = Vec::with_capacity(len as usize);
        file.read_to_end(&mut bytes)?;
        return Ok(base(StatusCode::OK)
            .header(header::CONTENT_TYPE, mime)
            .header(header::ACCEPT_RANGES, "bytes")
            .body(bytes)
            .unwrap_or_default());
    };

    if start >= len {
        return Ok(base(StatusCode::RANGE_NOT_SATISFIABLE)
            .header(header::CONTENT_RANGE, format!("bytes */{len}"))
            .body(Vec::new())
            .unwrap_or_default());
    }
    let end = end.unwrap_or(len - 1).min(len - 1);
    let mut bytes = vec![0; (end - start + 1) as usize];
    file.seek(SeekFrom::Start(start))?;
    file.read_exact(&mut bytes)?;
    Ok(base(StatusCode::PARTIAL_CONTENT)
        .header(header::CONTENT_TYPE, mime)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{len}"))
        .body(bytes)
        .unwrap_or_default())
}

fn serve_cover(state: &AppState, ask: &Ask) -> AppResult<Resp> {
    let Some(name) = books::cover_file(&*state.conn()?, &ask.id)? else {
        return Ok(status(StatusCode::NOT_FOUND));
    };
    let original = state.paths.cover_file(&name)?;
    let ok = |bytes: Vec<u8>, mime: &str| {
        base(StatusCode::OK)
            .header(header::CONTENT_TYPE, mime)
            .header(header::CACHE_CONTROL, "max-age=31536000, immutable")
            .body(bytes)
            .unwrap_or_default()
    };
    let read = |p: &std::path::Path| match std::fs::read(p) {
        Ok(b) => Ok(Some(b)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e),
    };

    if !ask.full {
        let width = crate::thumbs::snap_width(ask.width);
        let thumb = state.paths.thumb_file(&ask.id, width)?;
        if let Some(bytes) = read(&thumb)? {
            return Ok(ok(bytes, "image/jpeg"));
        }
        // Other sizes (and libraries imported before thumbnails existed): generate on first view.
        if let Some(cover) = read(&original)? {
            if let Ok(t) = crate::thumbs::make_sized(&cover, width) {
                let _ = std::fs::write(&thumb, &t);
                return Ok(ok(t, "image/jpeg"));
            }
            return Ok(ok(cover, mime_for(&name))); // e.g. SVG covers: serve as-is
        }
        return Ok(status(StatusCode::NOT_FOUND));
    }
    Ok(match read(&original)? {
        Some(bytes) => ok(bytes, mime_for(&name)),
        None => status(StatusCode::NOT_FOUND),
    })
}

#[cfg(test)]
mod tests {
    use super::parse_range;

    #[test]
    fn parses_ranges() {
        assert_eq!(parse_range("bytes=0-1023"), Some((0, Some(1023))));
        assert_eq!(parse_range("bytes=500-"), Some((500, None)));
        assert_eq!(parse_range("bytes=0-1,5-9"), None);
        assert_eq!(parse_range("items=0-1"), None);
    }
}

/// `catalog-cover://localhost/<provider>%2F<id>`: remote catalog covers,
/// fetched through Rust and cached on disk. Only known providers and valid ids
/// are accepted, so the webview can't use this to reach arbitrary URLs.
pub fn handle_catalog_cover<R: Runtime>(
    ctx: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let app = ctx.app_handle().clone();
    let path = percent_encoding::percent_decode_str(request.uri().path().trim_start_matches('/'))
        .decode_utf8_lossy()
        .into_owned();
    tauri::async_runtime::spawn(async move {
        let state = app.state::<CatalogState>();
        let response = match catalog_cover(&state, &path).await {
            Ok(Some(bytes)) => base(StatusCode::OK)
                .header(header::CONTENT_TYPE, "image/jpeg")
                .header(header::CACHE_CONTROL, "max-age=604800")
                .body(bytes)
                .unwrap_or_default(),
            Ok(None) => status(StatusCode::NOT_FOUND),
            Err(e) => {
                log::warn!("catalog cover {path}: {e}");
                status(StatusCode::BAD_GATEWAY)
            }
        };
        responder.respond(response);
    });
}

async fn catalog_cover(state: &CatalogState, path: &str) -> AppResult<Option<Vec<u8>>> {
    let Some((provider, id)) = path.split_once('/') else { return Ok(None) };
    if provider != gutenberg::PROVIDER || !gutenberg::valid_id(id) {
        return Ok(None);
    }
    let file = state.covers_dir.join(format!("{provider}-{id}.jpg"));
    let missing = state.covers_dir.join(format!("{provider}-{id}.none"));
    if let Ok(bytes) = tokio::fs::read(&file).await {
        return Ok(Some(bytes));
    }
    if tokio::fs::try_exists(&missing).await.unwrap_or(false) {
        return Ok(None);
    }

    let _permit = state.cover_permits.acquire().await.map_err(|e| crate::error::AppError::Invalid(e.to_string()))?;
    // gutenberg.org, then the mirror. Only a definitive 404 everywhere marks
    // the cover as missing; server errors leave it to be retried later.
    let mut not_found = 0;
    let urls = gutenberg::cover_urls(id);
    let mut last_err = None;
    for url in &urls {
        match state.http.get(url).send().await {
            Ok(r) if r.status().is_success() => {
                let bytes = r.bytes().await?.to_vec();
                let _ = tokio::fs::write(&file, &bytes).await;
                return Ok(Some(bytes));
            }
            Ok(r) if r.status() == StatusCode::NOT_FOUND => not_found += 1,
            Ok(r) => {
                if gutenberg::is_primary(url) && r.status().is_server_error() {
                    gutenberg::mark_primary_down();
                }
                last_err = Some(crate::error::AppError::Network(format!("HTTP {}", r.status())));
            }
            Err(e) => {
                if gutenberg::is_primary(url) {
                    gutenberg::mark_primary_down();
                }
                last_err = Some(e.into());
            }
        }
    }
    if not_found == urls.len() {
        let _ = tokio::fs::write(&missing, b"").await;
        return Ok(None);
    }
    Err(last_err.unwrap_or_else(|| crate::error::AppError::Network("cover unavailable".into())))
}
