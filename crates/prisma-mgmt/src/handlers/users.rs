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
pub struct ChangePasswordRequest {
    pub current_password: String,
    pub new_password: String,
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

    let (token, expires_at) = issue_jwt(&req.username, &role_str, &jwt_secret)?;

    Ok(Json(LoginResponse {
        token,
        user: UserPublic {
            username: req.username,
            role: role_str,
            enabled: None,
        },
        expires_at,
    }))
}

/// Issue a JWT token for the given user. Returns (token, expires_at_rfc3339).
fn issue_jwt(username: &str, role: &str, jwt_secret: &str) -> Result<(String, String), StatusCode> {
    let expires_at = Utc::now() + chrono::Duration::hours(24);
    let claims = Claims {
        sub: username.to_owned(),
        role: role.to_owned(),
        exp: expires_at.timestamp() as usize,
    };
    let token = jsonwebtoken::encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(jwt_secret.as_bytes()),
    )
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok((token, expires_at.to_rfc3339()))
}

// ---------------------------------------------------------------------------
// GET /api/setup/status
// ---------------------------------------------------------------------------

pub async fn setup_status(State(state): State<MgmtState>) -> Json<serde_json::Value> {
    let cfg = state.config.read().await;
    let has_admin = cfg
        .management_api
        .users
        .iter()
        .any(|u| u.role == UserRole::Admin);
    Json(serde_json::json!({
        "needs_setup": !has_admin
    }))
}

// ---------------------------------------------------------------------------
// POST /api/setup/init
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct SetupInitRequest {
    pub username: String,
    pub password: String,
}

pub async fn setup_init(
    State(state): State<MgmtState>,
    Json(req): Json<SetupInitRequest>,
) -> Result<Json<LoginResponse>, StatusCode> {
    if req.username.is_empty() || req.password.len() < 8 {
        return Err(StatusCode::BAD_REQUEST);
    }

    // Hash password before acquiring write lock
    let password = req.password.clone();
    let hash = tokio::task::spawn_blocking(move || bcrypt::hash(password, 10))
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Atomically check + create inside a single write lock to prevent TOCTOU
    let (username, jwt_secret) = {
        let mut cfg = state.config.write().await;
        if cfg
            .management_api
            .users
            .iter()
            .any(|u| u.role == UserRole::Admin)
        {
            return Err(StatusCode::CONFLICT);
        }
        let username = req.username.clone();
        cfg.management_api.users.push(UserConfig {
            username: username.clone(),
            password_hash: hash,
            role: UserRole::Admin,
            enabled: true,
        });
        let secret = cfg.management_api.jwt_secret.clone();
        (username, secret)
    };

    state.persist_config().await;

    let (token, expires_at) = issue_jwt(&username, "admin", &jwt_secret)?;

    Ok(Json(LoginResponse {
        token,
        user: UserPublic {
            username,
            role: "admin".to_owned(),
            enabled: None,
        },
        expires_at,
    }))
}

// ---------------------------------------------------------------------------
// POST /api/auth/register
// ---------------------------------------------------------------------------

pub async fn register(
    State(state): State<MgmtState>,
    Json(req): Json<RegisterRequest>,
) -> Result<(StatusCode, Json<RegisterResponse>), StatusCode> {
    // Require at least one admin to exist before allowing registration
    {
        let cfg = state.config.read().await;
        if !cfg
            .management_api
            .users
            .iter()
            .any(|u| u.role == UserRole::Admin)
        {
            return Err(StatusCode::FORBIDDEN); // Setup required first
        }
    }

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
// PUT /api/auth/password  (authenticated — any role)
// ---------------------------------------------------------------------------

pub async fn change_password(
    user: UserInfo,
    State(state): State<MgmtState>,
    Json(req): Json<ChangePasswordRequest>,
) -> Result<StatusCode, StatusCode> {
    if req.new_password.len() < 8 {
        return Err(StatusCode::BAD_REQUEST);
    }

    // Verify current password
    let current_hash = {
        let cfg = state.config.read().await;
        cfg.management_api
            .users
            .iter()
            .find(|u| u.username == user.username && u.enabled)
            .map(|u| u.password_hash.clone())
            .ok_or(StatusCode::NOT_FOUND)?
    };

    let current_password = req.current_password.clone();
    let valid =
        tokio::task::spawn_blocking(move || bcrypt::verify(current_password, &current_hash))
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
            .map_err(|_| StatusCode::UNAUTHORIZED)?;

    if !valid {
        return Err(StatusCode::UNAUTHORIZED);
    }

    // Hash new password
    let new_hash = tokio::task::spawn_blocking(move || bcrypt::hash(req.new_password, 10))
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Update password
    {
        let mut cfg = state.config.write().await;
        let target = cfg
            .management_api
            .users
            .iter_mut()
            .find(|u| u.username == user.username)
            .ok_or(StatusCode::NOT_FOUND)?;
        target.password_hash = new_hash;
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
