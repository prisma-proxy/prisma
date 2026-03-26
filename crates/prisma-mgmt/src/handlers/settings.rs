use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::auth::UserInfo;
use crate::db;
use crate::handlers::users::require_admin;
use crate::MgmtState;

#[derive(Serialize)]
pub struct SettingsResponse {
    pub settings: HashMap<String, String>,
}

#[derive(Deserialize)]
pub struct UpdateSettingsRequest {
    pub settings: HashMap<String, String>,
}

#[derive(Serialize)]
pub struct SingleSettingResponse {
    pub key: String,
    pub value: String,
}

#[derive(Deserialize)]
pub struct UpdateSingleSettingRequest {
    pub value: String,
}

// ---------------------------------------------------------------------------
// GET /api/settings
// ---------------------------------------------------------------------------

pub async fn get_all(
    user: UserInfo,
    State(state): State<MgmtState>,
) -> Result<Json<SettingsResponse>, StatusCode> {
    require_admin(&user)?;

    let database = state.require_db()?;
    let pairs = db::get_all_settings(database);
    let settings: HashMap<String, String> = pairs.into_iter().collect();

    Ok(Json(SettingsResponse { settings }))
}

// ---------------------------------------------------------------------------
// PUT /api/settings
// ---------------------------------------------------------------------------

pub async fn update_all(
    user: UserInfo,
    State(state): State<MgmtState>,
    Json(req): Json<UpdateSettingsRequest>,
) -> Result<StatusCode, StatusCode> {
    require_admin(&user)?;

    let database = state.require_db()?;
    for (k, v) in &req.settings {
        db::set_setting(database, k, v);
    }

    Ok(StatusCode::OK)
}

// ---------------------------------------------------------------------------
// GET /api/settings/{key}
// ---------------------------------------------------------------------------

pub async fn get_one(
    user: UserInfo,
    State(state): State<MgmtState>,
    Path(key): Path<String>,
) -> Result<Json<SingleSettingResponse>, StatusCode> {
    require_admin(&user)?;

    let database = state.require_db()?;
    let value = db::get_setting(database, &key).ok_or(StatusCode::NOT_FOUND)?;

    Ok(Json(SingleSettingResponse { key, value }))
}

// ---------------------------------------------------------------------------
// PUT /api/settings/{key}
// ---------------------------------------------------------------------------

pub async fn update_one(
    user: UserInfo,
    State(state): State<MgmtState>,
    Path(key): Path<String>,
    Json(req): Json<UpdateSingleSettingRequest>,
) -> Result<StatusCode, StatusCode> {
    require_admin(&user)?;

    let database = state.require_db()?;
    db::set_setting(database, &key, &req.value);

    Ok(StatusCode::OK)
}
