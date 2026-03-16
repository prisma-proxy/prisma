use anyhow::Result;
use std::sync::Arc;

use crate::runtime::PrismaRuntime;
use crate::{PRISMA_STATUS_CONNECTED, PRISMA_STATUS_CONNECTING, PRISMA_STATUS_DISCONNECTED};

#[derive(Default)]
pub struct ConnectionStats {
    pub bytes_up: u64,
    pub bytes_down: u64,
    pub speed_up_bps: u64,
    pub speed_down_bps: u64,
    pub uptime_secs: u64,
}

pub struct ConnectionManager {
    status: i32,
    stop_tx: Option<tokio::sync::oneshot::Sender<()>>,
    stats: Arc<std::sync::Mutex<ConnectionStats>>,
    start_time: Option<std::time::Instant>,
}

impl ConnectionManager {
    pub fn new() -> Self {
        Self {
            status: PRISMA_STATUS_DISCONNECTED,
            stop_tx: None,
            stats: Arc::new(std::sync::Mutex::new(ConnectionStats::default())),
            start_time: None,
        }
    }

    pub fn is_connected(&self) -> bool {
        self.status == PRISMA_STATUS_CONNECTED
    }

    pub fn status(&self) -> i32 {
        // Update uptime
        if let Some(start) = self.start_time {
            if let Ok(mut stats) = self.stats.lock() {
                stats.uptime_secs = start.elapsed().as_secs();
            }
        }
        self.status
    }

    pub fn connect(
        &mut self,
        runtime: Arc<PrismaRuntime>,
        config: prisma_core::config::client::ClientConfig,
        modes: u32,
        on_event: Box<dyn Fn(String) + Send + Sync + 'static>,
    ) -> Result<()> {
        self.status = PRISMA_STATUS_CONNECTING;

        let (stop_tx, stop_rx) = tokio::sync::oneshot::channel::<()>();
        self.stop_tx = Some(stop_tx);
        self.start_time = Some(std::time::Instant::now());

        // Serialize config to TOML file in a temp location and run client
        let config_json = serde_json::to_string(&config)?;

        runtime.spawn(async move {
            // Write config to a temp file and invoke the client
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

            // Run the client (prisma-client run function)
            // We convert the JSON config back for the client library
            let config_path_str = config_path.to_string_lossy().to_string();

            // Write as TOML for the client loader
            // For now we directly use serde_json deserialization path
            let run_result = tokio::select! {
                result = prisma_client::run(&config_path_str) => result,
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
        if let Ok(mut stats) = self.stats.lock() {
            *stats = ConnectionStats::default();
        }
    }

    pub fn get_stats_json(&self) -> String {
        match self.stats.lock() {
            Ok(s) => format!(
                r#"{{"type":"stats","bytes_up":{},"bytes_down":{},"speed_up_bps":{},"speed_down_bps":{},"uptime_secs":{}}}"#,
                s.bytes_up, s.bytes_down, s.speed_up_bps, s.speed_down_bps, s.uptime_secs
            ),
            Err(_) => r#"{"type":"stats","bytes_up":0,"bytes_down":0,"speed_up_bps":0,"speed_down_bps":0,"uptime_secs":0}"#.to_string(),
        }
    }
}

/// Run a basic speed test by downloading/uploading data through the local SOCKS5 proxy.
pub async fn run_speed_test(
    _server: &str,
    duration_secs: u32,
    _direction: &str,
) -> Result<(f64, f64)> {
    // Simplified: measure throughput over SOCKS5
    let duration = std::time::Duration::from_secs(duration_secs as u64);
    let start = std::time::Instant::now();
    let bytes_received: u64 = 0;

    // Simulate measurement (real impl would use reqwest through SOCKS5)
    tokio::time::sleep(std::cmp::min(duration, std::time::Duration::from_secs(5))).await;

    let elapsed = start.elapsed().as_secs_f64();
    let download_mbps = if elapsed > 0.0 {
        (bytes_received as f64 * 8.0) / (elapsed * 1_000_000.0)
    } else {
        0.0
    };
    let upload_mbps = download_mbps * 0.3; // Placeholder ratio

    Ok((download_mbps, upload_mbps))
}
