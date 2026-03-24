use anyhow::Result;
use std::sync::Arc;

use prisma_client::metrics::ClientMetrics;

use crate::runtime::PrismaRuntime;
use crate::{PRISMA_STATUS_CONNECTED, PRISMA_STATUS_CONNECTING, PRISMA_STATUS_DISCONNECTED};

pub struct ConnectionManager {
    status: i32,
    stop_tx: Option<tokio::sync::oneshot::Sender<()>>,
    metrics: ClientMetrics,
    start_time: Option<std::time::Instant>,
    prev_bytes_up: u64,
    prev_bytes_down: u64,
    socks5_addr: Option<String>,
}

impl ConnectionManager {
    pub fn new() -> Self {
        Self {
            status: PRISMA_STATUS_DISCONNECTED,
            stop_tx: None,
            metrics: ClientMetrics::new(),
            start_time: None,
            prev_bytes_up: 0,
            prev_bytes_down: 0,
            socks5_addr: None,
        }
    }

    pub fn socks5_addr(&self) -> Option<&str> {
        self.socks5_addr.as_deref()
    }

    pub fn is_connected(&self) -> bool {
        self.status == PRISMA_STATUS_CONNECTED
    }

    pub fn status(&self) -> i32 {
        self.status
    }

    pub fn connect(
        &mut self,
        runtime: Arc<PrismaRuntime>,
        config: prisma_core::config::client::ClientConfig,
        modes: u32,
        on_event: Arc<dyn Fn(String) + Send + Sync + 'static>,
    ) -> Result<()> {
        self.status = PRISMA_STATUS_CONNECTING;

        let (stop_tx, stop_rx) = tokio::sync::oneshot::channel::<()>();
        self.stop_tx = Some(stop_tx);
        self.start_time = Some(std::time::Instant::now());
        self.metrics.reset();
        self.prev_bytes_up = 0;
        self.prev_bytes_down = 0;
        self.socks5_addr = config.socks5_listen_addr.clone();

        // Serialize config to a per-profile TOML file for config isolation.
        // Using TOML provides CLI compatibility and human-readable configs.
        // The client_id uniquely identifies each profile, giving each its own file.
        let config_toml = toml::to_string(&config)?;
        let client_id = config.identity.client_id.clone();
        // Sanitize: keep alphanumeric and hyphens only (client_id is hex so always safe)
        let safe_id: String = client_id
            .chars()
            .filter(|c| c.is_alphanumeric() || *c == '-')
            .take(64)
            .collect();
        let file_stem = if safe_id.is_empty() {
            "active_connection".to_string()
        } else {
            safe_id
        };

        // Create broadcast channel for log forwarding
        let (log_tx, mut log_rx) =
            tokio::sync::broadcast::channel::<prisma_core::state::LogEntry>(256);

        // Shared metrics for traffic counting
        let metrics = self.metrics.clone();

        // Spawn log forwarder: converts tracing events → FFI callback events
        let on_event_log = on_event.clone();
        runtime.spawn(async move {
            loop {
                match log_rx.recv().await {
                    Ok(entry) => {
                        let event = serde_json::json!({
                            "type": "log",
                            "level": entry.level.to_uppercase(),
                            "msg": entry.message,
                            "time": entry.timestamp.timestamp_millis(),
                        });
                        on_event_log(event.to_string());
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                        tracing::warn!("Log forwarder lagged, dropped {} entries", n);
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
        });

        runtime.spawn(async move {
            // Write config to per-profile TOML file in the profiles directory.
            // Falls back to temp dir if profiles dir is unavailable.
            let config_path = crate::profiles::ProfileManager::profiles_dir_str()
                .ok()
                .map(|d| std::path::PathBuf::from(d).join(format!("{}.client.toml", file_stem)))
                .unwrap_or_else(|| std::env::temp_dir().join(format!("{}.client.toml", file_stem)));

            // Atomic write: write to .tmp then rename for crash safety
            let tmp_path = config_path.with_extension("toml.tmp");
            if let Err(e) = tokio::fs::write(&tmp_path, &config_toml).await {
                on_event(
                    serde_json::json!({
                        "type": "error",
                        "code": "config_write",
                        "msg": e.to_string(),
                    })
                    .to_string(),
                );
                return;
            }
            if let Err(e) = tokio::fs::rename(&tmp_path, &config_path).await {
                on_event(
                    serde_json::json!({
                        "type": "error",
                        "code": "config_write",
                        "msg": e.to_string(),
                    })
                    .to_string(),
                );
                return;
            }

            // Optionally set system proxy if requested
            if modes & crate::PRISMA_MODE_SYSTEM_PROXY != 0 {
                if let Some(ref socks5_addr) = config.socks5_listen_addr {
                    if let Ok(addr) = socks5_addr.parse::<std::net::SocketAddr>() {
                        if let Err(e) = crate::system_proxy::set("127.0.0.1", addr.port()) {
                            tracing::warn!("Failed to set system proxy: {e}");
                            on_event(format!(
                                r#"{{"type":"error","code":"system_proxy_set","msg":{}}}"#,
                                serde_json::to_string(&e.to_string()).unwrap_or_default()
                            ));
                        }
                    }
                }
            }

            let config_path_str = config_path.to_string_lossy().to_string();

            // Get per-app filter if PER_APP mode is active
            let app_filter = if modes & crate::PRISMA_MODE_PER_APP != 0 {
                Some(crate::global_app_filter())
            } else {
                None
            };

            // Use run_embedded for log + metrics forwarding.
            // Pass stop_rx directly so run_inner can abort all spawned tasks
            // when the shutdown signal fires (prevents leaked service tasks).
            let run_result = prisma_client::run_embedded_with_filter(
                &config_path_str,
                log_tx,
                metrics,
                app_filter,
                Some(stop_rx),
            )
            .await;

            // Clear system proxy on disconnect
            if modes & crate::PRISMA_MODE_SYSTEM_PROXY != 0 {
                if let Err(e) = crate::system_proxy::clear() {
                    tracing::warn!("Failed to clear system proxy: {e}");
                }
            }

            if let Err(e) = run_result {
                on_event(
                    serde_json::json!({
                        "type": "error",
                        "code": "run_error",
                        "msg": e.to_string(),
                    })
                    .to_string(),
                );
            }

            // Clean up config file after disconnect
            let _ = tokio::fs::remove_file(&config_path).await;

            // Fire "disconnected" event only after everything is fully shut down
            // (services stopped, system proxy cleared, config removed).
            on_event(r#"{"type":"status_changed","status":"disconnected"}"#.to_string());
        });

        self.status = PRISMA_STATUS_CONNECTED;
        Ok(())
    }

    pub fn disconnect(&mut self) {
        if let Some(tx) = self.stop_tx.take() {
            let _ = tx.send(());
        }
        self.status = PRISMA_STATUS_DISCONNECTED;
        self.start_time = None;
        self.metrics.reset();
        self.socks5_addr = None;
    }

    pub fn get_stats_json(&mut self) -> String {
        let uptime_secs = self.start_time.map(|t| t.elapsed().as_secs()).unwrap_or(0);

        let bytes_up = self.metrics.get_up();
        let bytes_down = self.metrics.get_down();

        // Compute speed as bytes delta since last poll (called every 1s)
        let speed_up = bytes_up.saturating_sub(self.prev_bytes_up);
        let speed_down = bytes_down.saturating_sub(self.prev_bytes_down);
        self.prev_bytes_up = bytes_up;
        self.prev_bytes_down = bytes_down;

        // Convert bytes/sec → bits/sec for the frontend
        let speed_up_bps = speed_up * 8;
        let speed_down_bps = speed_down * 8;

        serde_json::json!({
            "type": "stats",
            "bytes_up": bytes_up,
            "bytes_down": bytes_down,
            "speed_up_bps": speed_up_bps,
            "speed_down_bps": speed_down_bps,
            "uptime_secs": uptime_secs,
        })
        .to_string()
    }
}

/// Speed test download URLs per server.
///
/// All servers use the Cloudflare speed-test endpoint for bandwidth measurement
/// because Google does not provide a public download speed-test URL.
/// (`generate_204` returns HTTP 204 No Content with an empty body, so it always
/// measured 0 bytes.)
fn speed_test_download_url(server: &str, bytes: u64) -> String {
    match server {
        "cloudflare" | "google" => format!("https://speed.cloudflare.com/__down?bytes={bytes}"),
        _ => format!("https://speed.cloudflare.com/__down?bytes={bytes}"),
    }
}

/// Speed test upload URL per server.
fn speed_test_upload_url(server: &str) -> String {
    match server {
        "cloudflare" => "https://speed.cloudflare.com/__up".to_string(),
        _ => "https://speed.cloudflare.com/__up".to_string(),
    }
}

/// Build a reqwest client that routes through the local SOCKS5 proxy.
fn build_proxy_client(socks5_addr: &str) -> Result<reqwest::Client> {
    let proxy_url = format!("socks5h://{socks5_addr}");
    let proxy = reqwest::Proxy::all(&proxy_url)?;
    let client = reqwest::Client::builder()
        .proxy(proxy)
        .timeout(std::time::Duration::from_secs(30))
        .build()?;
    Ok(client)
}

/// Measure download throughput: repeatedly fetch data for `duration` seconds.
async fn measure_download(
    client: &reqwest::Client,
    server: &str,
    duration: std::time::Duration,
) -> Result<f64> {
    use futures_util::StreamExt;

    let deadline = std::time::Instant::now() + duration;
    let mut total_bytes: u64 = 0;
    let start = std::time::Instant::now();

    // Use progressively larger payloads: 1MB, 10MB, 25MB
    let chunk_sizes: &[u64] = &[1_000_000, 10_000_000, 25_000_000];
    let mut size_idx = 0;

    while std::time::Instant::now() < deadline {
        let chunk_size = chunk_sizes[size_idx.min(chunk_sizes.len() - 1)];
        let url = speed_test_download_url(server, chunk_size);

        let resp = client.get(&url).send().await?;
        let mut stream = resp.bytes_stream();
        while let Some(chunk) = stream.next().await {
            match chunk {
                Ok(bytes) => total_bytes += bytes.len() as u64,
                Err(e) => {
                    tracing::warn!("Speed test download chunk error: {e}");
                    break;
                }
            }
            if std::time::Instant::now() >= deadline {
                break;
            }
        }
        size_idx += 1;
    }

    let elapsed = start.elapsed().as_secs_f64();
    if elapsed > 0.0 {
        Ok((total_bytes as f64 * 8.0) / (elapsed * 1_000_000.0))
    } else {
        Ok(0.0)
    }
}

/// Measure upload throughput: repeatedly POST random data for `duration` seconds.
async fn measure_upload(
    client: &reqwest::Client,
    server: &str,
    duration: std::time::Duration,
) -> Result<f64> {
    let deadline = std::time::Instant::now() + duration;
    let mut total_bytes: u64 = 0;
    let start = std::time::Instant::now();
    let url = speed_test_upload_url(server);

    // Pre-generate a 1MB payload of random bytes
    let payload: Vec<u8> = (0..1_000_000).map(|i| (i % 256) as u8).collect();

    while std::time::Instant::now() < deadline {
        let resp = client.post(&url).body(payload.clone()).send().await;

        match resp {
            Ok(_) => total_bytes += payload.len() as u64,
            Err(e) => {
                tracing::warn!("Speed test upload error: {e}");
                break;
            }
        }
    }

    let elapsed = start.elapsed().as_secs_f64();
    if elapsed > 0.0 {
        Ok((total_bytes as f64 * 8.0) / (elapsed * 1_000_000.0))
    } else {
        Ok(0.0)
    }
}

/// Run a speed test by downloading/uploading data through the local SOCKS5 proxy.
///
/// `socks5_addr`: the SOCKS5 listen address (e.g., "127.0.0.1:1080")
/// `server`: speed test server name (e.g., "cloudflare", "google")
/// `duration_secs`: how long to run each phase (download + upload)
/// `direction`: "download", "upload", or "both"
pub async fn run_speed_test(
    socks5_addr: &str,
    server: &str,
    duration_secs: u32,
    _direction: &str,
) -> Result<(f64, f64)> {
    let client = build_proxy_client(socks5_addr)?;
    let half = std::time::Duration::from_secs((duration_secs as u64).div_ceil(2));

    // Phase 1: Download
    let download_mbps = match measure_download(&client, server, half).await {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!("Speed test download failed: {e}");
            0.0
        }
    };

    // Phase 2: Upload
    let upload_mbps = match measure_upload(&client, server, half).await {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!("Speed test upload failed: {e}");
            0.0
        }
    };

    Ok((download_mbps, upload_mbps))
}
