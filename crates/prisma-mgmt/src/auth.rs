use axum::extract::Request;
use axum::http::StatusCode;
use axum::middleware::Next;
use axum::response::Response;
use subtle::ConstantTimeEq;

/// Decode percent-encoded strings (e.g. `%2F` → `/`). Returns `None` if the
/// input contains no percent-encoded sequences (caller can use the original).
fn percent_decode(input: &str) -> Option<String> {
    if !input.contains('%') {
        return None;
    }
    let mut out = Vec::with_capacity(input.len());
    let bytes = input.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(hi), Some(lo)) = (hex_val(bytes[i + 1]), hex_val(bytes[i + 2])) {
                out.push(hi << 4 | lo);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(out).ok()
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

/// Bearer token to validate against, stored in request extensions by the router layer.
#[derive(Clone)]
pub struct AuthToken(pub String);

/// Bearer token authentication middleware.
/// The expected token is injected via request extensions by the outer layer.
/// Accepts the token either via `Authorization: Bearer <token>` header or
/// via a `token=<token>` query parameter (needed for browser WebSocket connections).
pub async fn auth_middleware(request: Request, next: Next) -> Result<Response, StatusCode> {
    let expected = request
        .extensions()
        .get::<AuthToken>()
        .map(|t| t.0.clone())
        .unwrap_or_default();

    if expected.is_empty() {
        // No token configured — allow all (dev mode)
        return Ok(next.run(request).await);
    }

    // Check Authorization header first
    let header_token = request
        .headers()
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .unwrap_or("");

    // Fall back to query parameter (for WebSocket connections from the browser).
    // The client percent-encodes the token, so we must decode it.
    let query_raw = request
        .uri()
        .query()
        .and_then(|q| q.split('&').find_map(|pair| pair.strip_prefix("token=")))
        .unwrap_or("");
    let query_decoded = percent_decode(query_raw);
    let query_token = query_decoded.as_deref().unwrap_or(query_raw);

    let provided = if !header_token.is_empty() {
        header_token
    } else {
        query_token
    };

    // Constant-time comparison to prevent timing side-channels
    if provided.as_bytes().ct_eq(expected.as_bytes()).into() {
        Ok(next.run(request).await)
    } else {
        Err(StatusCode::UNAUTHORIZED)
    }
}
