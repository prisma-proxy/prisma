use axum::extract::{FromRequestParts, Request};
use axum::http::StatusCode;
use axum::middleware::Next;
use axum::response::Response;
use jsonwebtoken::{DecodingKey, Validation};
use subtle::ConstantTimeEq;

use prisma_core::config::server::UserRole;

use crate::handlers::users::Claims;

/// Decode percent-encoded strings (e.g. `%2F` -> `/`). Returns `None` if the
/// input contains no percent-encoded sequences (caller can use the original).
fn percent_decode(input: &str) -> Option<String> {
    if !input.contains('%') {
        return None;
    }
    let mut out = Vec::with_capacity(input.len());
    let bytes = input.as_bytes();
    let i_ref = &mut 0usize;
    while *i_ref < bytes.len() {
        if bytes[*i_ref] == b'%' && *i_ref + 2 < bytes.len() {
            if let (Some(hi), Some(lo)) = (hex_val(bytes[*i_ref + 1]), hex_val(bytes[*i_ref + 2])) {
                out.push(hi << 4 | lo);
                *i_ref += 3;
                continue;
            }
        }
        out.push(bytes[*i_ref]);
        *i_ref += 1;
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

/// JWT secret stored in request extensions by the router layer.
#[derive(Clone)]
pub struct JwtSecret(pub String);

/// Authenticated user information, inserted into request extensions after
/// successful JWT or legacy token validation.
#[derive(Clone, Debug)]
pub struct UserInfo {
    pub username: String,
    pub role: UserRole,
}

/// Allow handlers to extract `UserInfo` directly from request extensions.
impl<S: Send + Sync> FromRequestParts<S> for UserInfo {
    type Rejection = StatusCode;

    async fn from_request_parts(
        parts: &mut axum::http::request::Parts,
        _state: &S,
    ) -> Result<Self, Self::Rejection> {
        parts
            .extensions
            .get::<UserInfo>()
            .cloned()
            .ok_or(StatusCode::UNAUTHORIZED)
    }
}

/// Enhanced authentication middleware.
///
/// Authentication strategies (tried in order):
/// 1. JWT Bearer token -> decode claims, extract `UserInfo`
/// 2. Legacy `auth_token` comparison -> assign admin role
/// 3. No token configured and no users -> allow all (dev mode)
///
/// On success, `UserInfo` is inserted into request extensions for downstream handlers.
pub async fn auth_middleware(request: Request, next: Next) -> Result<Response, StatusCode> {
    let jwt_secret = request
        .extensions()
        .get::<JwtSecret>()
        .map(|s| s.0.clone())
        .unwrap_or_default();

    let legacy_token = request
        .extensions()
        .get::<AuthToken>()
        .map(|t| t.0.clone())
        .unwrap_or_default();

    // Extract bearer token from header or query param
    let header_token = request
        .headers()
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .unwrap_or("");

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

    // Strategy 1: Try JWT decode
    if !provided.is_empty() && !jwt_secret.is_empty() {
        let decoding_key = DecodingKey::from_secret(jwt_secret.as_bytes());
        let validation = Validation::default();

        if let Ok(token_data) = jsonwebtoken::decode::<Claims>(provided, &decoding_key, &validation)
        {
            let role = match token_data.claims.role.as_str() {
                "admin" => UserRole::Admin,
                "operator" => UserRole::Operator,
                _ => UserRole::Client,
            };

            let mut request = request;
            request.extensions_mut().insert(UserInfo {
                username: token_data.claims.sub,
                role,
            });

            return Ok(next.run(request).await);
        }
    }

    // Strategy 2: Legacy auth_token constant-time comparison
    if !legacy_token.is_empty()
        && !provided.is_empty()
        && provided.as_bytes().ct_eq(legacy_token.as_bytes()).into()
    {
        let mut request = request;
        request.extensions_mut().insert(UserInfo {
            username: "admin".to_owned(),
            role: UserRole::Admin,
        });
        return Ok(next.run(request).await);
    }

    // Strategy 3: Dev mode — no auth configured at all
    if legacy_token.is_empty() && jwt_secret.is_empty() {
        let mut request = request;
        request.extensions_mut().insert(UserInfo {
            username: "anonymous".to_owned(),
            role: UserRole::Admin,
        });
        return Ok(next.run(request).await);
    }

    Err(StatusCode::UNAUTHORIZED)
}
