use axum::extract::State;
use axum::Json;
use serde::Serialize;

use prisma_core::state::{MetricsSnapshot, ServerState};

#[derive(Serialize)]
pub struct HealthResponse {
    pub status: &'static str,
    pub uptime_secs: u64,
    pub version: &'static str,
}

pub async fn health(State(state): State<ServerState>) -> Json<HealthResponse> {
    let snapshot = state.snapshot_metrics();
    Json(HealthResponse {
        status: "ok",
        uptime_secs: snapshot.uptime_secs,
        version: env!("CARGO_PKG_VERSION"),
    })
}

pub async fn metrics(State(state): State<ServerState>) -> Json<MetricsSnapshot> {
    Json(state.snapshot_metrics())
}

/// Returns recent metrics history. For now, returns current snapshot only.
/// A ring buffer can be added later for time-series data.
pub async fn metrics_history(State(state): State<ServerState>) -> Json<Vec<MetricsSnapshot>> {
    Json(vec![state.snapshot_metrics()])
}
