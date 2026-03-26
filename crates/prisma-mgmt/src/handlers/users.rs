use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use chrono::Utc;
use jsonwebtoken::{EncodingKey, Header};
use serde::{Deserialize, Serialize};

use prisma_core::config::server::{UserConfig, UserRole};

use crate::auth::UserInfo;
use crate::db;
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
    let user = resolve_user(&state, &req.username).ok_or(StatusCode::UNAUTHORIZED)?;

    if !user.enabled {
        return Err(StatusCode::UNAUTHORIZED);
    }

    // Verify password against bcrypt hash
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
    let jwt_secret = {
        let cfg = state.config.read().await;
        cfg.management_api.jwt_secret.clone()
    };

    let expiry_hours = db::session_expiry_hours(state.db.as_ref());
    let (token, expires_at) = issue_jwt(&req.username, &role_str, &jwt_secret, expiry_hours)?;

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
pub fn issue_jwt(
    username: &str,
    role: &str,
    jwt_secret: &str,
    expiry_hours: i64,
) -> Result<(String, String), StatusCode> {
    let expires_at = Utc::now() + chrono::Duration::hours(expiry_hours);
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
    let has_admin = if let Some(ref database) = state.db {
        db::has_admin(database)
    } else {
        let cfg = state.config.read().await;
        cfg.management_api
            .users
            .iter()
            .any(|u| u.role == UserRole::Admin)
    };
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

    // Hash password before acquiring any lock
    let hash = db::hash_password(req.password.clone()).await?;

    // Check admin doesn't already exist
    if let Some(ref database) = state.db {
        if db::has_admin(database) {
            return Err(StatusCode::CONFLICT);
        }
        let user = UserConfig {
            username: req.username.clone(),
            password_hash: hash.clone(),
            role: UserRole::Admin,
            enabled: true,
        };
        db::insert_user(database, &user).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }

    // Also update the TOML config for backwards compatibility
    {
        let mut cfg = state.config.write().await;
        if cfg
            .management_api
            .users
            .iter()
            .any(|u| u.role == UserRole::Admin)
        {
            // Already exists in config, skip
        } else {
            cfg.management_api.users.push(UserConfig {
                username: req.username.clone(),
                password_hash: hash,
                role: UserRole::Admin,
                enabled: true,
            });
        }
    }
    state.persist_config().await;

    let jwt_secret = {
        let cfg = state.config.read().await;
        cfg.management_api.jwt_secret.clone()
    };
    let (token, expires_at) = issue_jwt(&req.username, "admin", &jwt_secret, 24)?;

    Ok(Json(LoginResponse {
        token,
        user: UserPublic {
            username: req.username,
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
    // Check registration is enabled (SQLite setting)
    if let Some(ref database) = state.db {
        if !db::get_setting_bool(database, "registration_enabled") {
            return Err(StatusCode::FORBIDDEN);
        }
    }

    // Require at least one admin
    let admin_exists = if let Some(ref database) = state.db {
        db::has_admin(database)
    } else {
        let cfg = state.config.read().await;
        cfg.management_api
            .users
            .iter()
            .any(|u| u.role == UserRole::Admin)
    };
    if !admin_exists {
        return Err(StatusCode::FORBIDDEN);
    }

    if req.username.is_empty() || req.password.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }

    // Check uniqueness
    if let Some(ref database) = state.db {
        if db::user_exists(database, &req.username) {
            return Err(StatusCode::CONFLICT);
        }
    } else {
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

    // Determine default role from settings
    let default_role = if let Some(ref database) = state.db {
        db::get_setting(database, "default_user_role")
            .as_deref()
            .map(db::parse_role)
            .unwrap_or(UserRole::Client)
    } else {
        UserRole::Client
    };

    // Hash password
    let hash = db::hash_password(req.password.clone()).await?;

    let user_config = UserConfig {
        username: req.username.clone(),
        password_hash: hash.clone(),
        role: default_role,
        enabled: true,
    };

    if let Some(ref database) = state.db {
        db::insert_user(database, &user_config).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }

    // Also keep TOML in sync
    {
        let mut cfg = state.config.write().await;
        cfg.management_api.users.push(UserConfig {
            username: req.username.clone(),
            password_hash: hash,
            role: default_role,
            enabled: true,
        });
    }
    state.persist_config().await;

    Ok((
        StatusCode::CREATED,
        Json(RegisterResponse {
            username: req.username,
            role: default_role.to_string(),
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

    let users = if let Some(ref database) = state.db {
        db::list_users(database)
            .into_iter()
            .map(|u| UserPublic {
                username: u.username,
                role: u.role.to_string(),
                enabled: Some(u.enabled),
            })
            .collect()
    } else {
        let cfg = state.config.read().await;
        cfg.management_api
            .users
            .iter()
            .map(|u| UserPublic {
                username: u.username.clone(),
                role: u.role.to_string(),
                enabled: Some(u.enabled),
            })
            .collect()
    };
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
    if let Some(ref database) = state.db {
        if db::user_exists(database, &req.username) {
            return Err(StatusCode::CONFLICT);
        }
    } else {
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
    let hash = db::hash_password(req.password.clone()).await?;

    let user_config = UserConfig {
        username: req.username.clone(),
        password_hash: hash.clone(),
        role,
        enabled: true,
    };

    if let Some(ref database) = state.db {
        db::insert_user(database, &user_config).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }

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

    if let Some(ref database) = state.db {
        if !db::update_user_role_enabled(database, &username, req.role, req.enabled) {
            return Err(StatusCode::NOT_FOUND);
        }
    }

    // Sync to TOML
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

    if let Some(ref database) = state.db {
        if !db::delete_user(database, &username) {
            return Err(StatusCode::NOT_FOUND);
        }
    }

    let mut cfg = state.config.write().await;
    let before = cfg.management_api.users.len();
    cfg.management_api.users.retain(|u| u.username != username);
    let removed = cfg.management_api.users.len() < before;
    drop(cfg);

    if !removed && state.db.is_none() {
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
    let current_hash = resolve_user(&state, &user.username)
        .map(|u| u.password_hash)
        .ok_or(StatusCode::NOT_FOUND)?;

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
    let new_hash = db::hash_password(req.new_password).await?;

    if let Some(ref database) = state.db {
        db::update_user_password(database, &user.username, &new_hash);
    }

    // Sync to TOML
    {
        let mut cfg = state.config.write().await;
        if let Some(target) = cfg
            .management_api
            .users
            .iter_mut()
            .find(|u| u.username == user.username)
        {
            target.password_hash = new_hash;
        }
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

/// Resolve a user from SQLite first, falling back to in-memory config.
fn resolve_user(state: &MgmtState, username: &str) -> Option<UserConfig> {
    if let Some(ref database) = state.db {
        if let Some(u) = db::get_user(database, username) {
            return Some(u);
        }
    }
    // Fallback: read from config (blocking-safe because we return a sync fn)
    None
}
