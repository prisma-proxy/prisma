use std::sync::atomic::Ordering;

use axum::extract::State;
use axum::http::header;
use axum::response::IntoResponse;
use prometheus::{Encoder, TextEncoder};

use crate::MgmtState;

/// GET /api/prometheus
///
/// Returns all server metrics in Prometheus text exposition format.
pub async fn prometheus_metrics(State(state): State<MgmtState>) -> impl IntoResponse {
    let registry = prometheus::Registry::new();

    // --- Server-level gauges and counters ---

    let active_connections = prometheus::Gauge::new(
        "prisma_active_connections",
        "Current number of active connections",
    )
    .expect("static metric name");
    active_connections.set(state.metrics.active_connections.load(Ordering::Relaxed) as f64);
    registry
        .register(Box::new(active_connections))
        .expect("static metric registration");

    let bytes_uploaded = prometheus::Counter::with_opts(prometheus::Opts::new(
        "prisma_bytes_uploaded_total",
        "Total bytes uploaded through the proxy",
    ))
    .expect("static metric name");
    let up = state.metrics.total_bytes_up.load(Ordering::Relaxed) as f64;
    if up > 0.0 {
        bytes_uploaded.inc_by(up);
    }
    registry
        .register(Box::new(bytes_uploaded))
        .expect("static metric registration");

    let bytes_downloaded = prometheus::Counter::with_opts(prometheus::Opts::new(
        "prisma_bytes_downloaded_total",
        "Total bytes downloaded through the proxy",
    ))
    .expect("static metric name");
    let down = state.metrics.total_bytes_down.load(Ordering::Relaxed) as f64;
    if down > 0.0 {
        bytes_downloaded.inc_by(down);
    }
    registry
        .register(Box::new(bytes_downloaded))
        .expect("static metric registration");

    // Handshakes: success = total_connections, failed = handshake_failures
    let handshakes = prometheus::CounterVec::new(
        prometheus::Opts::new("prisma_handshakes_total", "Total handshakes by status"),
        &["status"],
    )
    .expect("static metric name");
    let success = state.metrics.total_connections.load(Ordering::Relaxed) as f64;
    let failed = state.metrics.handshake_failures.load(Ordering::Relaxed) as f64;
    // Always initialize both label values so they appear in output even at 0
    let success_counter = handshakes.with_label_values(&["success"]);
    let failed_counter = handshakes.with_label_values(&["failed"]);
    if success > 0.0 {
        success_counter.inc_by(success);
    }
    if failed > 0.0 {
        failed_counter.inc_by(failed);
    }
    registry
        .register(Box::new(handshakes))
        .expect("static metric registration");

    let uptime = prometheus::Gauge::new("prisma_uptime_seconds", "Server uptime in seconds")
        .expect("static metric name");
    uptime.set(state.metrics.started_at.elapsed().as_secs_f64());
    registry
        .register(Box::new(uptime))
        .expect("static metric registration");

    // Bandwidth utilization ratio: active / total (0..1, or 0 when no connections yet)
    let utilization = prometheus::Gauge::new(
        "prisma_bandwidth_utilization_ratio",
        "Ratio of active connections to total connections seen",
    )
    .expect("static metric name");
    let total_conns = state.metrics.total_connections.load(Ordering::Relaxed);
    let active = state.metrics.active_connections.load(Ordering::Relaxed) as u64;
    if total_conns > 0 {
        utilization.set(active as f64 / total_conns as f64);
    }
    registry
        .register(Box::new(utilization))
        .expect("static metric registration");

    // --- Per-client byte counters from active connections ---

    let client_bytes = prometheus::CounterVec::new(
        prometheus::Opts::new(
            "prisma_client_bytes_total",
            "Total bytes per client by direction",
        ),
        &["client_id", "direction"],
    )
    .expect("static metric name");
    registry
        .register(Box::new(client_bytes.clone()))
        .expect("static metric registration");

    {
        let conns = state.connections.read().await;
        // Aggregate bytes per client_id across all connections
        let mut client_totals: std::collections::HashMap<String, (u64, u64)> =
            std::collections::HashMap::new();
        for conn in conns.values() {
            let client_id = match &conn.client_id {
                Some(id) => id.to_string(),
                None => continue,
            };
            let entry = client_totals.entry(client_id).or_insert((0, 0));
            entry.0 += conn.bytes_up.load(Ordering::Relaxed);
            entry.1 += conn.bytes_down.load(Ordering::Relaxed);
        }
        for (client_id, (up_val, down_val)) in &client_totals {
            if *up_val > 0 {
                client_bytes
                    .with_label_values(&[client_id, "up"])
                    .inc_by(*up_val as f64);
            }
            if *down_val > 0 {
                client_bytes
                    .with_label_values(&[client_id, "down"])
                    .inc_by(*down_val as f64);
            }
        }
    }

    // Encode to Prometheus text format
    let encoder = TextEncoder::new();
    let metric_families = registry.gather();
    let mut buffer = Vec::new();
    encoder
        .encode(&metric_families, &mut buffer)
        .expect("prometheus text encoding");
    let content_type = encoder.format_type().to_string();

    ([(header::CONTENT_TYPE, content_type)], buffer)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::Request;
    use axum::routing::get;
    use axum::Router;
    use http_body_util::BodyExt;
    use std::sync::Arc;
    use tokio::sync::{broadcast, RwLock};

    use prisma_core::config::server::ServerConfig;
    use prisma_core::state::{AuthStoreInner, ServerState};

    fn test_state() -> MgmtState {
        let config: ServerConfig = toml::from_str(
            r#"
            listen_addr = "0.0.0.0:0"
            quic_listen_addr = "0.0.0.0:0"
            authorized_clients = []
            "#,
        )
        .unwrap();
        let auth_store = AuthStoreInner {
            clients: std::collections::HashMap::new(),
        };
        let (log_tx, _) = broadcast::channel(16);
        let (metrics_tx, _) = broadcast::channel(16);
        let server_state = ServerState::new(&config, auth_store, log_tx, metrics_tx);
        MgmtState {
            state: server_state,
            bandwidth: None,
            quotas: None,
            config_path: None,
            alert_config: Arc::new(RwLock::new(crate::AlertConfig::default())),
        }
    }

    async fn send_request(app: Router, uri: &str) -> (u16, String) {
        let req = Request::builder().uri(uri).body(Body::empty()).unwrap();
        let resp = tower::ServiceExt::oneshot(app, req).await.unwrap();
        let status = resp.status().as_u16();
        let body = resp.into_body().collect().await.unwrap().to_bytes();
        let text = String::from_utf8(body.to_vec()).unwrap();
        (status, text)
    }

    #[tokio::test]
    async fn test_prometheus_endpoint_returns_valid_metrics() {
        let state = test_state();
        let app = Router::new()
            .route("/api/prometheus", get(prometheus_metrics))
            .with_state(state);

        let (status, text) = send_request(app, "/api/prometheus").await;
        assert_eq!(status, 200);

        // All expected metric names must be present
        assert!(
            text.contains("prisma_active_connections"),
            "missing prisma_active_connections"
        );
        assert!(
            text.contains("prisma_bytes_uploaded_total"),
            "missing prisma_bytes_uploaded_total"
        );
        assert!(
            text.contains("prisma_bytes_downloaded_total"),
            "missing prisma_bytes_downloaded_total"
        );
        assert!(
            text.contains("prisma_handshakes_total"),
            "missing prisma_handshakes_total"
        );
        assert!(
            text.contains("prisma_uptime_seconds"),
            "missing prisma_uptime_seconds"
        );
        assert!(
            text.contains("prisma_bandwidth_utilization_ratio"),
            "missing prisma_bandwidth_utilization_ratio"
        );
    }

    #[tokio::test]
    async fn test_prometheus_metrics_with_active_connections() {
        let state = test_state();

        // Simulate some traffic
        state.metrics.total_connections.store(42, Ordering::Relaxed);
        state.metrics.active_connections.store(5, Ordering::Relaxed);
        state
            .metrics
            .total_bytes_up
            .store(1_000_000, Ordering::Relaxed);
        state
            .metrics
            .total_bytes_down
            .store(2_000_000, Ordering::Relaxed);
        state.metrics.handshake_failures.store(3, Ordering::Relaxed);

        let app = Router::new()
            .route("/api/prometheus", get(prometheus_metrics))
            .with_state(state);

        let (_, text) = send_request(app, "/api/prometheus").await;

        // Check specific values
        assert!(
            text.contains("prisma_active_connections 5"),
            "active_connections should be 5, output:\n{text}"
        );
        assert!(
            text.contains("prisma_bytes_uploaded_total 1e6")
                || text.contains("prisma_bytes_uploaded_total 1000000"),
            "bytes uploaded should be 1M, output:\n{text}"
        );
        assert!(
            text.contains("prisma_bytes_downloaded_total 2e6")
                || text.contains("prisma_bytes_downloaded_total 2000000"),
            "bytes downloaded should be 2M, output:\n{text}"
        );
        assert!(
            text.contains("prisma_handshakes_total{status=\"failed\"} 3"),
            "handshake failures should be 3, output:\n{text}"
        );
        assert!(
            text.contains("prisma_handshakes_total{status=\"success\"} 42"),
            "successful handshakes should be 42, output:\n{text}"
        );
    }

    #[tokio::test]
    async fn test_prometheus_per_client_bytes() {
        let state = test_state();

        // Add a connection with a client_id
        let client_uuid = uuid::Uuid::new_v4();
        let conn = prisma_core::state::ConnectionInfo {
            session_id: uuid::Uuid::new_v4(),
            client_id: Some(client_uuid),
            client_name: Some("test-client".into()),
            peer_addr: "127.0.0.1:1234".into(),
            transport: prisma_core::state::Transport::Tcp,
            mode: prisma_core::state::SessionMode::Proxy,
            connected_at: chrono::Utc::now(),
            bytes_up: Arc::new(std::sync::atomic::AtomicU64::new(500)),
            bytes_down: Arc::new(std::sync::atomic::AtomicU64::new(1000)),
            destination: None,
            matched_rule: None,
        };

        {
            let mut conns = state.connections.write().await;
            conns.insert(conn.session_id, conn);
        }

        let app = Router::new()
            .route("/api/prometheus", get(prometheus_metrics))
            .with_state(state);

        let (_, text) = send_request(app, "/api/prometheus").await;

        let client_id_str = client_uuid.to_string();
        assert!(
            text.contains(&format!(
                "prisma_client_bytes_total{{client_id=\"{client_id_str}\",direction=\"up\"}}"
            )),
            "missing per-client upload bytes in:\n{text}"
        );
        assert!(
            text.contains(&format!(
                "prisma_client_bytes_total{{client_id=\"{client_id_str}\",direction=\"down\"}}"
            )),
            "missing per-client download bytes in:\n{text}"
        );
    }
}
