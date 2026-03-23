//! Per-client metrics API endpoints.
//!
//! Provides breakdowns of bytes up/down, connection counts, active connections,
//! last-seen timestamps, and latency percentiles per client.

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;
use uuid::Uuid;

use prisma_core::state::{ClientMetrics, ClientMetricsHistoryPoint};

use crate::MgmtState;

/// GET /api/metrics/clients -- All client metrics.
pub async fn list_client_metrics(State(state): State<MgmtState>) -> Json<Vec<ClientMetrics>> {
    let mut result = Vec::new();

    // Get client names from the auth store
    let auth = state.auth_store.read().await;

    for entry in state.state.per_client_metrics.iter() {
        let client_id = *entry.key();
        let acc = entry.value();
        let name = auth.clients.get(&client_id).and_then(|e| e.name.clone());
        result.push(acc.snapshot(client_id, name).await);
    }

    // Sort by bytes_down descending for most-active-first
    result.sort_by(|a, b| b.bytes_down.cmp(&a.bytes_down));

    Json(result)
}

/// GET /api/metrics/clients/:id -- Single client metrics.
pub async fn get_client_metrics(
    State(state): State<MgmtState>,
    Path(id): Path<Uuid>,
) -> Result<Json<ClientMetrics>, StatusCode> {
    let acc = state
        .state
        .per_client_metrics
        .get(&id)
        .ok_or(StatusCode::NOT_FOUND)?;

    let name = {
        let auth = state.auth_store.read().await;
        auth.clients.get(&id).and_then(|e| e.name.clone())
    };

    Ok(Json(acc.value().snapshot(id, name).await))
}

#[derive(Deserialize)]
pub struct HistoryParams {
    /// Period: "1h", "6h", "24h". Default "1h".
    pub period: Option<String>,
}

/// GET /api/metrics/clients/:id/history -- Historical data points for a client.
pub async fn get_client_metrics_history(
    State(state): State<MgmtState>,
    Path(id): Path<Uuid>,
    Query(params): Query<HistoryParams>,
) -> Result<Json<Vec<ClientMetricsHistoryPoint>>, StatusCode> {
    let period_secs: i64 = match params.period.as_deref() {
        Some("6h") => 6 * 3600,
        Some("24h") => 24 * 3600,
        _ => 3600, // default 1h
    };

    let history = state.state.per_client_history.read().await;
    let points = history.get(&id).ok_or(StatusCode::NOT_FOUND)?;

    let cutoff = chrono::Utc::now() - chrono::Duration::seconds(period_secs);
    let filtered: Vec<ClientMetricsHistoryPoint> = points
        .iter()
        .filter(|p| p.timestamp >= cutoff)
        .cloned()
        .collect();

    Ok(Json(filtered))
}
