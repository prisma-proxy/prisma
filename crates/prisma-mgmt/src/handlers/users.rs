use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use chrono::Utc;
use jsonwebtoken::{EncodingKey, Header};
use serde::{Deserialize, Serialize};

use prisma_core::config::server::{UserConfig, UserRole};

use crate::auth::UserInfo;
use crate::MgmtState;

// ---------------------------------------------------------------------------
// JWT Claims
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,
    pub role: String,
    pub exp: usize,
}

// ---------------------------------------------------------------------------
// Request / Response types
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

#[derive(Serialize)]
pub struct LoginResponse {
    pub token: String,
    pub user: UserPublic,
    pub expires_at: String,
}

#[derive(Deserialize)]
pub struct RegisterRequest {
    pub username: String,
    pub password: String,
}

#[derive(Serialize)]
pub struct RegisterResponse {
    pub username: String,
    pub role: String,
    pub message: String,
}

#[derive(Serialize, Clone)]
pub struct UserPublic {
    pub username: String,
    pub role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
}

#[derive(Deserialize)]
pub struct CreateUserRequest {
    pub username: String,
    pub password: String,
    pub role: Option<UserRole>,
}

#[derive(Deserialize)]
pub struct UpdateUserRequest {
    pub role: Option<UserRole>,
    pub enabled: Option<bool>,
}

// ---------------------------------------------------------------------------
// POST /api/auth/login
// ---------------------------------------------------------------------------

pub async fn login(
    State(state): State<MgmtState>,
    Json(req): Json<LoginRequest>,
) -> Result<Json<LoginResponse>, StatusCode> {
    let cfg = state.config.read().await;
    let mgmt = &cfg.management_api;

    let user = mgmt
        .users
        .iter()
        .find(|u| u.username == req.username && u.enabled)
        .ok_or(StatusCode::UNAUTHORIZED)?;

    // Verify password against bcrypt hash — runs blocking work on a thread pool
    let hash = user.password_hash.clone();
    let password = req.password.clone();
    let valid = tokio::task::spawn_blocking(move || bcrypt::verify(password, &hash))
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .map_err(|_| StatusCode::UNAUTHORIZED)?;

    if !valid {
        return Err(StatusCode::UNAUTHORIZED);
    }

    let role_str = user.role.to_string();
    let jwt_secret = mgmt.jwt_secret.clone();
    drop(cfg);

    let expires_at = Utc::now() + chrono::Duration::hours(24);
    let claims = Claims {
        sub: req.username.clone(),
        role: role_str.clone(),
        exp: expires_at.timestamp() as usize,
    };

    let token = jsonwebtoken::encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(jwt_secret.as_bytes()),
    )
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(LoginResponse {
        token,
        user: UserPublic {
            username: req.username,
            role: role_str,
            enabled: None,
        },
        expires_at: expires_at.to_rfc3339(),
    }))
}

// ---------------------------------------------------------------------------
// POST /api/auth/register
// ---------------------------------------------------------------------------

pub async fn register(
    State(state): State<MgmtState>,
    Json(req): Json<RegisterRequest>,
) -> Result<(StatusCode, Json<RegisterResponse>), StatusCode> {
    if req.username.is_empty() || req.password.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }

    // Check uniqueness
    {
        let cfg = state.config.read().await;
        if cfg
            .management_api
            .users
            .iter()
            .any(|u| u.username == req.username)
        {
            return Err(StatusCode::CONFLICT);
        }
    }

    // Hash password on a blocking thread
    let password = req.password.clone();
    let hash = tokio::task::spawn_blocking(move || bcrypt::hash(password, 10))
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Add user with Client role
    {
        let mut cfg = state.config.write().await;
        cfg.management_api.users.push(UserConfig {
            username: req.username.clone(),
            password_hash: hash,
            role: UserRole::Client,
            enabled: true,
        });
    }

    state.persist_config().await;

    Ok((
        StatusCode::CREATED,
        Json(RegisterResponse {
            username: req.username,
            role: "client".to_owned(),
            message: "User created. Please login to obtain a token.".to_owned(),
        }),
    ))
}

// ---------------------------------------------------------------------------
// GET /api/auth/me
// ---------------------------------------------------------------------------

pub async fn me(user: UserInfo) -> Json<UserPublic> {
    Json(UserPublic {
        username: user.username,
        role: user.role.to_string(),
        enabled: None,
    })
}

// ---------------------------------------------------------------------------
// GET /api/users  (admin only)
// ---------------------------------------------------------------------------

pub async fn list_users(
    user: UserInfo,
    State(state): State<MgmtState>,
) -> Result<Json<Vec<UserPublic>>, StatusCode> {
    require_admin(&user)?;

    let cfg = state.config.read().await;
    let users: Vec<UserPublic> = cfg
        .management_api
        .users
        .iter()
        .map(|u| UserPublic {
            username: u.username.clone(),
            role: u.role.to_string(),
            enabled: Some(u.enabled),
        })
        .collect();
    Ok(Json(users))
}

// ---------------------------------------------------------------------------
// POST /api/users  (admin only)
// ---------------------------------------------------------------------------

pub async fn create_user(
    user: UserInfo,
    State(state): State<MgmtState>,
    Json(req): Json<CreateUserRequest>,
) -> Result<(StatusCode, Json<UserPublic>), StatusCode> {
    require_admin(&user)?;

    if req.username.is_empty() || req.password.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }

    // Check uniqueness
    {
        let cfg = state.config.read().await;
        if cfg
            .management_api
            .users
            .iter()
            .any(|u| u.username == req.username)
        {
            return Err(StatusCode::CONFLICT);
        }
    }

    let role = req.role.unwrap_or(UserRole::Client);

    // Hash password
    let password = req.password.clone();
    let hash = tokio::task::spawn_blocking(move || bcrypt::hash(password, 10))
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    {
        let mut cfg = state.config.write().await;
        cfg.management_api.users.push(UserConfig {
            username: req.username.clone(),
            password_hash: hash,
            role,
            enabled: true,
        });
    }

    state.persist_config().await;

    Ok((
        StatusCode::CREATED,
        Json(UserPublic {
            username: req.username,
            role: role.to_string(),
            enabled: Some(true),
        }),
    ))
}

// ---------------------------------------------------------------------------
// PUT /api/users/:username  (admin only)
// ---------------------------------------------------------------------------

pub async fn update_user(
    user: UserInfo,
    State(state): State<MgmtState>,
    axum::extract::Path(username): axum::extract::Path<String>,
    Json(req): Json<UpdateUserRequest>,
) -> Result<Json<UserPublic>, StatusCode> {
    require_admin(&user)?;

    let mut cfg = state.config.write().await;
    let target = cfg
        .management_api
        .users
        .iter_mut()
        .find(|u| u.username == username)
        .ok_or(StatusCode::NOT_FOUND)?;

    if let Some(role) = req.role {
        target.role = role;
    }
    if let Some(enabled) = req.enabled {
        target.enabled = enabled;
    }

    let result = UserPublic {
        username: target.username.clone(),
        role: target.role.to_string(),
        enabled: Some(target.enabled),
    };
    drop(cfg);

    state.persist_config().await;

    Ok(Json(result))
}

// ---------------------------------------------------------------------------
// DELETE /api/users/:username  (admin only)
// ---------------------------------------------------------------------------

pub async fn delete_user(
    user: UserInfo,
    State(state): State<MgmtState>,
    axum::extract::Path(username): axum::extract::Path<String>,
) -> Result<StatusCode, StatusCode> {
    require_admin(&user)?;

    // Prevent self-deletion
    if user.username == username {
        return Err(StatusCode::BAD_REQUEST);
    }

    let mut cfg = state.config.write().await;
    let before = cfg.management_api.users.len();
    cfg.management_api.users.retain(|u| u.username != username);
    let removed = cfg.management_api.users.len() < before;
    drop(cfg);

    if !removed {
        return Err(StatusCode::NOT_FOUND);
    }

    state.persist_config().await;

    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Guard: reject non-admin users with 403 Forbidden.
pub fn require_admin(user: &UserInfo) -> Result<(), StatusCode> {
    if user.role != UserRole::Admin {
        return Err(StatusCode::FORBIDDEN);
    }
    Ok(())
}
