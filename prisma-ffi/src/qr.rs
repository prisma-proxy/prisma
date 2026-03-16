use anyhow::Result;
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};

const URI_SCHEME: &str = "prisma://";

pub fn profile_to_qr_svg(profile_json: &str) -> Result<String> {
    let encoded = URL_SAFE_NO_PAD.encode(profile_json.as_bytes());
    let uri = format!("{}{}", URI_SCHEME, encoded);
    let code = qrcode::QrCode::new(uri.as_bytes())?;
    let svg = code.render::<qrcode::render::svg::Color>()
        .min_dimensions(200, 200)
        .build();
    Ok(svg)
}

pub fn profile_from_qr(data: &str) -> Result<String> {
    let encoded = if data.starts_with(URI_SCHEME) {
        &data[URI_SCHEME.len()..]
    } else {
        data
    };
    let decoded = URL_SAFE_NO_PAD.decode(encoded)?;
    let json = String::from_utf8(decoded)?;
    // Validate it's parseable JSON
    serde_json::from_str::<serde_json::Value>(&json)?;
    Ok(json)
}
