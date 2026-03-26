//! Fuzz target: prisma:// URI and QR data parsing.
//!
//! Exercises the URI decode path used by `profile_from_qr` in prisma-ffi.
//! Tests base64url decoding and JSON validation of arbitrary input to find
//! panics or unexpected behavior.

#![no_main]

use libfuzzer_sys::fuzz_target;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};

const URI_SCHEME: &str = "prisma://";

/// Simplified version of the QR/URI decode logic from prisma-ffi::qr.
fn try_decode_uri(data: &str) -> Option<String> {
    let encoded = data.strip_prefix(URI_SCHEME).unwrap_or(data);
    let decoded = URL_SAFE_NO_PAD.decode(encoded).ok()?;
    let json = String::from_utf8(decoded).ok()?;
    // Validate JSON
    serde_json::from_str::<serde_json::Value>(&json).ok()?;
    Some(json)
}

fuzz_target!(|data: &[u8]| {
    if let Ok(s) = std::str::from_utf8(data) {
        // Try decoding as-is
        let _ = try_decode_uri(s);

        // Try with prisma:// prefix
        let with_prefix = format!("{}{}", URI_SCHEME, s);
        let _ = try_decode_uri(&with_prefix);

        // Try base64url decoding alone (the inner step)
        let _ = URL_SAFE_NO_PAD.decode(s);
    }
});
