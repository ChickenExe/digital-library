//! Cover thumbnails.
//!
//! Real-world covers are often 1500×2300 or larger. Decoded, that's ~14 MB of
//! RAM per cover, for an image the UI shows at ~130 px. Every grid and card uses
//! a 360 px-wide JPEG thumbnail instead (≈0.5 MB decoded); full covers are only
//! served on request.

use std::path::Path;

use crate::error::{AppError, AppResult};

/// Wide enough for the largest on-screen cover at 2× DPI.
pub const THUMB_WIDTH: u32 = 360;
/// Enough for standard-density screens (≤ 1.33×); ~55% less memory than 360 px.
pub const THUMB_WIDTH_SMALL: u32 = 240;

/// The supported thumbnail widths; anything else snaps to the large size.
pub fn snap_width(requested: Option<u32>) -> u32 {
    match requested {
        Some(w) if w <= THUMB_WIDTH_SMALL => THUMB_WIDTH_SMALL,
        _ => THUMB_WIDTH,
    }
}

pub fn make(bytes: &[u8]) -> AppResult<Vec<u8>> {
    make_sized(bytes, THUMB_WIDTH)
}

/// Thumbnails are generated one at a time. Each decode briefly needs ~10–30 MB
/// for a large cover; doing dozens in parallel (a fast scroll through a new
/// library) spikes memory that the allocator then keeps. Serially, each still
/// takes only milliseconds.
static GENERATE: std::sync::Mutex<()> = std::sync::Mutex::new(());

pub fn make_sized(bytes: &[u8], width: u32) -> AppResult<Vec<u8>> {
    let _one_at_a_time = GENERATE.lock().unwrap_or_else(|e| e.into_inner());
    let img = image::load_from_memory(bytes).map_err(|e| AppError::Parse(format!("cover: {e}")))?;
    let img = if img.width() > width { img.thumbnail(width, u32::MAX) } else { img };
    let rgb = img.to_rgb8();
    let mut out = Vec::with_capacity(48 * 1024);
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 84)
        .encode_image(&rgb)
        .map_err(|e| AppError::Parse(format!("thumbnail: {e}")))?;
    Ok(out)
}

/// Writes a thumbnail for `cover` to `target` (best effort; failures are logged).
pub fn write_for(cover: &[u8], target: &Path) {
    match make(cover).and_then(|t| std::fs::write(target, t).map_err(Into::into)) {
        Ok(()) => {}
        Err(e) => log::warn!("thumbnail for {} failed: {e}", target.display()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shrinks_large_covers_and_keeps_aspect() {
        let big = image::RgbImage::from_fn(1200, 1800, |x, y| image::Rgb([(x % 255) as u8, (y % 255) as u8, 90]));
        let mut png = Vec::new();
        image::DynamicImage::ImageRgb8(big)
            .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .unwrap();
        let thumb = image::load_from_memory(&make(&png).unwrap()).unwrap();
        assert_eq!(thumb.width(), THUMB_WIDTH);
        assert_eq!(thumb.height(), 540);
    }

    #[test]
    fn snaps_widths() {
        assert_eq!(snap_width(Some(200)), THUMB_WIDTH_SMALL);
        assert_eq!(snap_width(Some(240)), THUMB_WIDTH_SMALL);
        assert_eq!(snap_width(Some(300)), THUMB_WIDTH);
        assert_eq!(snap_width(None), THUMB_WIDTH);
    }

    #[test]
    fn rejects_non_images() {
        assert!(make(b"not an image").is_err());
    }
}
