use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use prisma_core::state::ClientEntry;

use crate::auth::UserInfo;
use crate::db;
use crate::handlers::users::require_admin;
use crate::MgmtState;

// ─────────────────────── Code generation ────────────────────────────────

fn generate_code() -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    let chars: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let seg = |rng: &mut rand::rngs::ThreadRng| -> String {
        (0..4)
            .map(|_| chars[rng.gen_range(0..chars.len())] as char)
            .collect()
    };
    format!(
        "PRISMA-{}-{}-{}",
        seg(&mut rng),
        seg(&mut rng),
        seg(&mut rng)
    )
}

fn generate_invite_token() -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    let chars: &[u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    (0..24)
        .map(|_| chars[rng.gen_range(0..chars.len())] as char)
        .collect()
}

// ─────────────────── Redemption code endpoints ──────────────────────────

#[derive(Deserialize)]
pub struct CreateCodeRequest {
    pub max_uses: Option<i32>,
    pub max_clients: Option<i32>,
    pub bandwidth_up: Option<String>,
    pub bandwidth_down: Option<String>,
    pub quota: Option<String>,
    pub quota_period: Option<String>,
    pub expires_at: Option<String>,
}

#[derive(Serialize)]
pub struct CreateCodeResponse {
    pub id: i64,
    pub code: String,
}

/// POST /api/codes — admin creates a redemption code
pub async fn create_code(
    user: UserInfo,
    State(state): State<MgmtState>,
    Json(req): Json<CreateCodeRequest>,
) -> Result<Json<CreateCodeResponse>, StatusCode> {
    require_admin(&user)?;
    let database = state.require_db()?;

    let code = generate_code();
    let rc = db::RedemptionCode {
        id: 0,
        code: code.clone(),
        max_uses: req.max_uses.unwrap_or(1),
        used_count: 0,
        max_clients: req.max_clients.unwrap_or(1),
        bandwidth_up: req.bandwidth_up,
        bandwidth_down: req.bandwidth_down,
        quota: req.quota,
        quota_period: req.quota_period,
        expires_at: req.expires_at,
        created_by: Some(user.username),
        created_at: String::new(),
    };

    let id =
        db::insert_redemption_code(database, &rc).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(CreateCodeResponse { id, code }))
}

/// GET /api/codes — admin lists all codes
pub async fn list_codes(
    user: UserInfo,
    State(state): State<MgmtState>,
) -> Result<Json<Vec<db::RedemptionCode>>, StatusCode> {
    require_admin(&user)?;
    let database = state.require_db()?;
    Ok(Json(db::list_redemption_codes(database)))
}

/// DELETE /api/codes/{id} — admin deletes a code
pub async fn delete_code(
    user: UserInfo,
    State(state): State<MgmtState>,
    Path(id): Path<i64>,
) -> Result<StatusCode, StatusCode> {
    require_admin(&user)?;
    let database = state.require_db()?;
    if db::delete_redemption_code(database, id) {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(StatusCode::NOT_FOUND)
    }
}

// ─────────────────────── Redeem endpoint ────────────────────────────────

#[derive(Deserialize)]
pub struct RedeemRequest {
    pub code: String,
}

#[derive(Serialize)]
pub struct RedeemResponse {
    pub client_id: String,
    pub auth_secret_hex: String,
    pub name: String,
}

/// POST /api/redeem — user redeems a code to get a client credential
pub async fn redeem_code(
    user: UserInfo,
    State(state): State<MgmtState>,
    Json(req): Json<RedeemRequest>,
) -> Result<Json<RedeemResponse>, StatusCode> {
    let database = state.require_db()?;

    let code_upper = req.code.trim().to_uppercase();
    let rc = db::get_redemption_code_by_code(database, &code_upper).ok_or(StatusCode::NOT_FOUND)?;

    // Validate: not exhausted
    if rc.used_count >= rc.max_uses {
        return Err(StatusCode::GONE);
    }

    // Validate: not expired
    if db::is_expired(rc.expires_at.as_deref()) {
        return Err(StatusCode::GONE);
    }

    // Check user hasn't exceeded max_clients for this code
    let existing = db::count_redemptions_for_user_code(database, rc.id, &user.username);
    if existing >= rc.max_clients {
        return Err(StatusCode::CONFLICT);
    }

    // Create new client
    let client_id = Uuid::new_v4();
    let (secret, hex) = db::generate_client_secret();
    let client_name = format!("{}-{}", user.username, existing + 1);

    let db_client = db::DbClient {
        id: client_id.to_string(),
        auth_secret: hex.clone(),
        name: Some(client_name.clone()),
        enabled: true,
        owner: Some(user.username.clone()),
        bandwidth_up: rc.bandwidth_up.clone(),
        bandwidth_down: rc.bandwidth_down.clone(),
        quota: rc.quota.clone(),
        quota_period: rc.quota_period.clone(),
        tags: vec!["redeemed".into()],
    };
    db::insert_client(database, &db_client).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Insert into auth store
    let entry = ClientEntry {
        auth_secret: secret,
        name: Some(client_name.clone()),
        enabled: true,
        tags: vec!["redeemed".into()],
    };
    state
        .auth_store
        .write()
        .await
        .clients
        .insert(client_id, entry);

    // Record redemption
    db::insert_redemption(database, rc.id, &user.username, &client_id.to_string());
    db::increment_code_usage(database, rc.id);

    // Sync to config
    state.sync_clients_to_config().await;
    state.persist_config().await;

    Ok(Json(RedeemResponse {
        client_id: client_id.to_string(),
        auth_secret_hex: hex,
        name: client_name,
    }))
}

// ─────────────────────── Subscription status ────────────────────────────

/// GET /api/subscription — user's subscription status
pub async fn subscription_status(
    user: UserInfo,
    State(state): State<MgmtState>,
) -> Result<Json<Vec<db::SubscriptionInfo>>, StatusCode> {
    let database = state.require_db()?;
    Ok(Json(db::user_subscriptions(database, &user.username)))
}

// ─────────────────────── Invite endpoints ───────────────────────────────

#[derive(Deserialize)]
pub struct CreateInviteRequest {
    pub max_uses: Option<i32>,
    pub max_clients: Option<i32>,
    pub bandwidth_up: Option<String>,
    pub bandwidth_down: Option<String>,
    pub quota: Option<String>,
    pub quota_period: Option<String>,
    pub default_role: Option<String>,
    pub expires_at: Option<String>,
}

#[derive(Serialize)]
pub struct CreateInviteResponse {
    pub id: i64,
    pub token: String,
}

/// POST /api/invites — admin creates invite
pub async fn create_invite(
    user: UserInfo,
    State(state): State<MgmtState>,
    Json(req): Json<CreateInviteRequest>,
) -> Result<Json<CreateInviteResponse>, StatusCode> {
    require_admin(&user)?;
    let database = state.require_db()?;

    let token = generate_invite_token();
    let inv = db::Invite {
        id: 0,
        token: token.clone(),
        max_uses: req.max_uses.unwrap_or(1),
        used_count: 0,
        max_clients: req.max_clients.unwrap_or(1),
        bandwidth_up: req.bandwidth_up,
        bandwidth_down: req.bandwidth_down,
        quota: req.quota,
        quota_period: req.quota_period,
        default_role: req.default_role.unwrap_or_else(|| "client".into()),
        expires_at: req.expires_at,
        created_by: Some(user.username),
        created_at: String::new(),
    };

    let id = db::insert_invite(database, &inv).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(CreateInviteResponse { id, token }))
}

/// GET /api/invites — admin lists invites
pub async fn list_invites(
    user: UserInfo,
    State(state): State<MgmtState>,
) -> Result<Json<Vec<db::Invite>>, StatusCode> {
    require_admin(&user)?;
    let database = state.require_db()?;
    Ok(Json(db::list_invites(database)))
}

/// DELETE /api/invites/{id} — admin deletes invite
pub async fn delete_invite(
    user: UserInfo,
    State(state): State<MgmtState>,
    Path(id): Path<i64>,
) -> Result<StatusCode, StatusCode> {
    require_admin(&user)?;
    let database = state.require_db()?;
    if db::delete_invite(database, id) {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(StatusCode::NOT_FOUND)
    }
}

// ─────────────────── Invite info / redeem ───────────────────────────────

/// GET /api/invite/{token}/info — public: check invite validity
pub async fn invite_info(
    State(state): State<MgmtState>,
    Path(token): Path<String>,
) -> Result<Json<InviteInfoResponse>, StatusCode> {
    let database = state.require_db()?;
    let inv = db::get_invite_by_token(database, &token).ok_or(StatusCode::NOT_FOUND)?;

    let valid = inv.used_count < inv.max_uses && !db::is_expired(inv.expires_at.as_deref());

    Ok(Json(InviteInfoResponse {
        valid,
        default_role: inv.default_role,
        max_clients: inv.max_clients,
    }))
}

#[derive(Serialize)]
pub struct InviteInfoResponse {
    pub valid: bool,
    pub default_role: String,
    pub max_clients: i32,
}

/// POST /api/invite/{token} — register user + provision client via invite
#[derive(Deserialize)]
pub struct InviteRedeemRequest {
    pub username: String,
    pub password: String,
}

#[derive(Serialize)]
pub struct InviteRedeemResponse {
    pub token: String,
    pub user: super::users::UserPublic,
    pub expires_at: String,
    pub client_id: String,
    pub auth_secret_hex: String,
}

pub async fn redeem_invite(
    State(state): State<MgmtState>,
    Path(invite_token): Path<String>,
    Json(req): Json<InviteRedeemRequest>,
) -> Result<Json<InviteRedeemResponse>, StatusCode> {
    let database = state.require_db()?;

    if req.username.is_empty() || req.password.len() < 8 {
        return Err(StatusCode::BAD_REQUEST);
    }

    let inv = db::get_invite_by_token(database, &invite_token).ok_or(StatusCode::NOT_FOUND)?;

    // Validate not exhausted
    if inv.used_count >= inv.max_uses {
        return Err(StatusCode::GONE);
    }

    // Validate not expired
    if db::is_expired(inv.expires_at.as_deref()) {
        return Err(StatusCode::GONE);
    }

    // Check username not taken
    if db::user_exists(database, &req.username) {
        return Err(StatusCode::CONFLICT);
    }

    // Hash password
    let hash = db::hash_password(req.password.clone()).await?;

    let role = db::parse_role(&inv.default_role);

    // Create user
    let user_config = prisma_core::config::server::UserConfig {
        username: req.username.clone(),
        password_hash: hash.clone(),
        role,
        enabled: true,
    };
    db::insert_user(database, &user_config).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Also sync user to TOML
    {
        let mut cfg = state.config.write().await;
        cfg.management_api
            .users
            .push(prisma_core::config::server::UserConfig {
                username: req.username.clone(),
                password_hash: hash,
                role,
                enabled: true,
            });
    }

    // Create client
    let client_id = Uuid::new_v4();
    let (secret, hex) = db::generate_client_secret();
    let client_name = format!("{}-1", req.username);

    let db_client = db::DbClient {
        id: client_id.to_string(),
        auth_secret: hex.clone(),
        name: Some(client_name.clone()),
        enabled: true,
        owner: Some(req.username.clone()),
        bandwidth_up: inv.bandwidth_up,
        bandwidth_down: inv.bandwidth_down,
        quota: inv.quota,
        quota_period: inv.quota_period,
        tags: vec!["invite".into()],
    };
    db::insert_client(database, &db_client).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Insert into auth store
    let entry = ClientEntry {
        auth_secret: secret,
        name: Some(client_name),
        enabled: true,
        tags: vec!["invite".into()],
    };
    state
        .auth_store
        .write()
        .await
        .clients
        .insert(client_id, entry);

    // Track invite usage
    db::increment_invite_usage(database, inv.id);

    // Sync config
    state.sync_clients_to_config().await;
    state.persist_config().await;

    // Issue JWT using shared helper
    let jwt_secret = {
        let cfg = state.config.read().await;
        cfg.management_api.jwt_secret.clone()
    };
    let expiry_hours = db::session_expiry_hours(Some(database));

    let role_str = role.to_string();
    let (jwt, expires_at) =
        super::users::issue_jwt(&req.username, &role_str, &jwt_secret, expiry_hours)?;

    Ok(Json(InviteRedeemResponse {
        token: jwt,
        user: super::users::UserPublic {
            username: req.username,
            role: role_str,
            enabled: None,
        },
        expires_at,
        client_id: client_id.to_string(),
        auth_secret_hex: hex,
    }))
}
