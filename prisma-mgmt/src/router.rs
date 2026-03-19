use std::sync::Arc;

use axum::extract::Request;
use axum::middleware::{self, Next};
use axum::response::Response;
use axum::routing::{delete, get, post, put};
use axum::Router;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};

use prisma_core::config::server::ManagementApiConfig;

use crate::auth::{auth_middleware, AuthToken};
use crate::handlers::{
    acls, alerts, backup, bandwidth, clients, config, connections, forwards, health,
    prometheus_export, reload, routes, system,
};
use crate::ws::{connections as ws_connections, logs, metrics, reload as ws_reload};
use crate::MgmtState;

pub fn build_router(config: ManagementApiConfig, state: MgmtState) -> Router {
    let cors = if config.cors_origins.is_empty() {
        CorsLayer::new()
            .allow_origin(Any)
            .allow_methods(Any)
            .allow_headers(Any)
    } else {
        let origins: Vec<_> = config
            .cors_origins
            .iter()
            .filter_map(|o| o.parse().ok())
            .collect();
        CorsLayer::new()
            .allow_origin(origins)
            .allow_methods(Any)
            .allow_headers(Any)
    };

    let auth_token = Arc::new(AuthToken(config.auth_token.clone()));

    let api = Router::new()
        // Health & metrics
        .route("/api/health", get(health::health))
        .route("/api/metrics", get(health::metrics))
        .route("/api/metrics/history", get(health::metrics_history))
        // System info
        .route("/api/system/info", get(system::get_system_info))
        // Connections
        .route("/api/connections", get(connections::list))
        .route("/api/connections/{id}", delete(connections::disconnect))
        // Clients
        .route("/api/clients", get(clients::list))
        .route("/api/clients", post(clients::create))
        .route("/api/clients/{id}", put(clients::update))
        .route("/api/clients/{id}", delete(clients::remove))
        // Bandwidth & quotas
        .route(
            "/api/clients/{id}/bandwidth",
            get(bandwidth::get_client_bandwidth).put(bandwidth::update_client_bandwidth),
        )
        .route(
            "/api/clients/{id}/quota",
            get(bandwidth::get_client_quota).put(bandwidth::update_client_quota),
        )
        .route(
            "/api/bandwidth/summary",
            get(bandwidth::get_bandwidth_summary),
        )
        // Config
        .route("/api/config", get(config::get_config))
        .route("/api/config", axum::routing::patch(config::patch_config))
        .route("/api/config/tls", get(config::get_tls_info))
        // Config backups
        .route("/api/config/backups", get(backup::list_backups))
        .route("/api/config/backup", post(backup::create_backup))
        .route(
            "/api/config/backups/{name}",
            get(backup::get_backup).delete(backup::delete_backup),
        )
        .route(
            "/api/config/backups/{name}/restore",
            post(backup::restore_backup),
        )
        .route("/api/config/backups/{name}/diff", get(backup::diff_backup))
        // Forwards
        .route("/api/forwards", get(forwards::list))
        // Routes
        .route("/api/routes", get(routes::list))
        .route("/api/routes", post(routes::create))
        .route("/api/routes/{id}", put(routes::update))
        .route("/api/routes/{id}", delete(routes::remove))
        // ACLs
        .route("/api/acls", get(acls::list))
        .route(
            "/api/acls/{client_id}",
            get(acls::get).put(acls::set).delete(acls::remove),
        )
        // Alerts
        .route(
            "/api/alerts/config",
            get(alerts::get_alert_config).put(alerts::update_alert_config),
        )
        // Config reload
        .route("/api/reload", post(reload::reload_config))
        // WebSocket
        .route("/api/ws/metrics", get(metrics::ws_metrics))
        .route("/api/ws/logs", get(logs::ws_logs))
        .route("/api/ws/connections", get(ws_connections::ws_connections))
        .route("/api/ws/reload", get(ws_reload::ws_reload))
        // Auth middleware
        .layer(middleware::from_fn(auth_middleware))
        .layer(middleware::from_fn(move |mut req: Request, next: Next| {
            let token = auth_token.clone();
            async move {
                req.extensions_mut().insert((*token).clone());
                let resp: Response = next.run(req).await;
                Ok::<_, std::convert::Infallible>(resp)
            }
        }));

    // Prometheus metrics endpoint — outside auth middleware for scraper access
    let prometheus_route = Router::new().route(
        "/api/prometheus",
        get(prometheus_export::prometheus_metrics),
    );

    let mut app = api.merge(prometheus_route);

    if let Some(ref dir) = config.console_dir {
        tracing::info!(console_dir = %dir, "Serving console static files");
        let index_path = std::path::PathBuf::from(dir).join("index.html");
        let serve_dir = ServeDir::new(dir)
            .append_index_html_on_directories(true)
            .fallback(ServeFile::new(&index_path));
        app = app.fallback_service(serve_dir);
    }

    app.layer(cors).with_state(state)
}
