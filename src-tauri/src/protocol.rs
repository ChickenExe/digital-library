//! Custom URI schemes that stream library files to the webview:
//!
//!   book://localhost/<id>   → the book file (EPUB/PDF bytes)
//!   cover://localhost/<id>  → the cover image
//!
//! On Windows (WebView2) these surface as `http://book.localhost/<id>`; the
//! frontend uses `convertFileSrc(id, "book")` so it never has to care.
//! Files are looked up by id in the DB — a URL can never name an arbitrary path.

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

pub fn handle<R: Runtime>(
    kind: Kind,
    ctx: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let app = ctx.app_handle().clone();
    let id = request.uri().path().trim_start_matches('/').to_string();
    // File reads happen off the webview thread.
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let response = match load(&state, kind, &id) {
            Ok(Some((bytes, mime))) => Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, mime)
                .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                .header(header::CACHE_CONTROL, "max-age=31536000, immutable")
                .body(bytes),
            Ok(None) => status(StatusCode::NOT_FOUND),
            Err(e) => {
                log::error!("protocol error for {id}: {e}");
                status(StatusCode::INTERNAL_SERVER_ERROR)
            }
        };
        responder.respond(response.unwrap_or_else(|_| Response::new(Vec::new())));
    });
}

fn status(code: StatusCode) -> Result<Response<Vec<u8>>, tauri::http::Error> {
    Response::builder()
        .status(code)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(Vec::new())
}

fn load(state: &AppState, kind: Kind, id: &str) -> AppResult<Option<(Vec<u8>, &'static str)>> {
    let name = {
        let conn = state.conn()?;
        match kind {
            Kind::Book => books::file_name(&conn, id)?.map(|(name, _)| name),
            Kind::Cover => books::cover_file(&conn, id)?,
        }
    };
    let Some(name) = name else { return Ok(None) };
    let path = match kind {
        Kind::Book => state.paths.book_file(&name)?,
        Kind::Cover => state.paths.cover_file(&name)?,
    };
    match std::fs::read(&path) {
        Ok(bytes) => Ok(Some((bytes, mime_for(&name)))),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
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
            Ok(Some(bytes)) => Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, "image/jpeg")
                .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                .header(header::CACHE_CONTROL, "max-age=604800")
                .body(bytes),
            Ok(None) => status(StatusCode::NOT_FOUND),
            Err(e) => {
                log::warn!("catalog cover {path}: {e}");
                status(StatusCode::BAD_GATEWAY)
            }
        };
        responder.respond(response.unwrap_or_else(|_| Response::new(Vec::new())));
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
    let response = state.http.get(gutenberg::cover_url(id)).send().await?;
    if response.status() == StatusCode::NOT_FOUND {
        let _ = tokio::fs::write(&missing, b"").await;
        return Ok(None);
    }
    let bytes = response.error_for_status()?.bytes().await?.to_vec();
    let _ = tokio::fs::write(&file, &bytes).await;
    Ok(Some(bytes))
}
