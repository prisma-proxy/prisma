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
        self.socks5_addr = Some(config.socks5_listen_addr.clone());

        // Serialize config to a temp file for the client loader
        let config_json = serde_json::to_string(&config)?;

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
                        let level = entry.level.to_uppercase();
                        let msg = entry.message.replace('\\', "\\\\").replace('"', "\\\"");
                        let time = entry.timestamp.timestamp_millis();
                        let event = format!(
                            r#"{{"type":"log","level":"{}","msg":"{}","time":{}}}"#,
                            level, msg, time
                        );
                        on_event_log(event);
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                        tracing::warn!("Log forwarder lagged, dropped {} entries", n);
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
        });

        runtime.spawn(async move {
            // Write config to a temp file
            let tmp_dir = std::env::temp_dir();
            let config_path = tmp_dir.join("prisma_ffi_client.json");

            if let Err(e) = tokio::fs::write(&config_path, &config_json).await {
                on_event(format!(
                    r#"{{"type":"error","code":"config_write","msg":{}}}"#,
                    serde_json::to_string(&e.to_string()).unwrap_or_default()
                ));
                return;
            }

            // Optionally set system proxy if requested
            if modes & crate::PRISMA_MODE_SYSTEM_PROXY != 0 {
                if let Ok(addr) = config.socks5_listen_addr.parse::<std::net::SocketAddr>() {
                    let _ = crate::system_proxy::set("127.0.0.1", addr.port());
                }
            }

            let config_path_str = config_path.to_string_lossy().to_string();

            // Use run_embedded for log + metrics forwarding
            let run_result = tokio::select! {
                result = prisma_client::run_embedded(&config_path_str, log_tx, metrics) => result,
                _ = stop_rx => Ok(()),
            };

            // Clear system proxy on disconnect
            if modes & crate::PRISMA_MODE_SYSTEM_PROXY != 0 {
                let _ = crate::system_proxy::clear();
            }

            if let Err(e) = run_result {
                on_event(format!(
                    r#"{{"type":"error","code":"run_error","msg":{}}}"#,
                    serde_json::to_string(&e.to_string()).unwrap_or_default()
                ));
            }

            // Clean up temp file
            let _ = std::fs::remove_file(&config_path);
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

        format!(
            r#"{{"type":"stats","bytes_up":{},"bytes_down":{},"speed_up_bps":{},"speed_down_bps":{},"uptime_secs":{}}}"#,
            bytes_up, bytes_down, speed_up_bps, speed_down_bps, uptime_secs
        )
    }
}

/// Speed test download URLs per server.
fn speed_test_download_url(server: &str, bytes: u64) -> String {
    match server {
        "cloudflare" => format!("https://speed.cloudflare.com/__down?bytes={bytes}"),
        "google" => "https://www.google.com/generate_204".to_string(),
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
        let resp = client
            .post(&url)
            .body(payload.clone())
            .send()
            .await;

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
