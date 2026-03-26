use anyhow::{Context, Result};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};

const URI_SCHEME: &str = "prisma://";

pub fn profile_to_qr_svg(profile_json: &str) -> Result<String> {
    let uri = profile_to_uri(profile_json)?;
    let code = qrcode::QrCode::new(uri.as_bytes())?;
    let svg = code
        .render::<qrcode::render::svg::Color>()
        .min_dimensions(200, 200)
        .build();
    Ok(svg)
}

pub fn profile_from_qr(data: &str) -> Result<String> {
    let encoded = data.strip_prefix(URI_SCHEME).unwrap_or(data);
    let decoded = URL_SAFE_NO_PAD.decode(encoded)?;
    let json = String::from_utf8(decoded)?;
    // Validate it's parseable JSON
    serde_json::from_str::<serde_json::Value>(&json)?;
    Ok(json)
}

/// Generate a `prisma://` URI from profile JSON (base64url-encoded).
pub fn profile_to_uri(profile_json: &str) -> Result<String> {
    // Validate JSON
    serde_json::from_str::<serde_json::Value>(profile_json)?;
    let encoded = URL_SAFE_NO_PAD.encode(profile_json.as_bytes());
    Ok(format!("{}{}", URI_SCHEME, encoded))
}

/// Convert a profile's config JSON to TOML suitable for prisma-client/CLI.
pub fn profile_config_to_toml(config_json: &str) -> Result<String> {
    let config: prisma_core::config::client::ClientConfig =
        serde_json::from_str(config_json).context("invalid client config JSON")?;
    toml::to_string_pretty(&config).context("TOML serialization failed")
}

/// Decode a QR code from an image file on disk.
/// Returns the raw string content of the QR code.
pub fn decode_qr_from_image(path: &str) -> Result<String> {
    let img = image::open(path)
        .context("failed to open image")?
        .to_luma8();
    let mut prepared = rqrr::PreparedImage::prepare(img);
    let grids = prepared.detect_grids();
    let grid = grids
        .into_iter()
        .next()
        .ok_or_else(|| anyhow::anyhow!("no QR code found in image"))?;
    let (_meta, content) = grid.decode().context("failed to decode QR code")?;
    Ok(content)
}
