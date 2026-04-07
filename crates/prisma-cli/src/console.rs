use anyhow::Result;
use colored::Colorize;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::ui;

/// Start the console web server with auto-download support
pub async fn run_console(
    mgmt_url: String,
    token: Option<String>,
    port: u16,
    bind: String,
    no_open: bool,
    update: bool,
    dir: Option<String>,
) -> Result<()> {
    let console_dir = resolve_console_dir(dir, update).await?;

    // Build the reverse proxy + static file server
    let listen_addr = format!("{}:{}", bind, port);
    let display_host = if bind == "0.0.0.0" {
        "127.0.0.1"
    } else {
        &bind
    };
    let scheme = if mgmt_url.starts_with("https") {
        "https"
    } else {
        "http"
    };
    let url = format!("{}://{}:{}", scheme, display_host, port);
    ui::info(&format!("Console running at {}", url.green().bold()));

    let app = build_server(console_dir, mgmt_url, token)?;

    // Auto-open browser (skip on headless/SSH)
    if !no_open && !is_headless() {
        if let Err(e) = open::that(&url) {
            ui::warn(&format!(
                "Failed to open browser: {}. Open manually: {}",
                e, url
            ));
        }
    } else {
        let remote_url = format!(
            "{}://{}:{}",
            scheme,
            get_server_ip().unwrap_or_else(|| "127.0.0.1".to_string()),
            port
        );
        ui::info(&format!(
            "Open in your local browser: {}",
            remote_url.green()
        ));
    }

    let listener = tokio::net::TcpListener::bind(&listen_addr).await?;
    ui::detail(&format!("Listening on {}", listen_addr));
    axum::serve(listener, app).await?;

    Ok(())
}

/// Download the console to the cache directory and return the path.
/// Used by `prisma init --console` to pre-populate console_dir.
pub async fn download_console_to_cache() -> Result<PathBuf> {
    let cache_dir = get_cache_dir()?;
    let console_dir = cache_dir.join("console");
    let version_file = console_dir.join(".version");

    ui::info("Downloading console dashboard...");
    ui::detail(&format!("Cache: {}", cache_dir.display()));

    let version = download_console(&console_dir, &version_file).await?;
    ui::success(&format!("Console {} downloaded", version.green()));
    Ok(console_dir)
}

/// Resolve which directory to serve the console from.
/// Priority: --dir flag > cached download > dev build > fresh download
async fn resolve_console_dir(dir: Option<String>, update: bool) -> Result<PathBuf> {
    // 1. Explicit --dir flag
    if let Some(dir) = dir {
        let path = PathBuf::from(&dir);
        if path.join("index.html").exists() {
            ui::info(&format!("Using local console from {}", path.display()));
            return Ok(path);
        }
        anyhow::bail!("Console directory '{}' does not contain index.html", dir);
    }

    let cache_dir = get_cache_dir()?;
    let console_dir = cache_dir.join("console");
    let version_file = console_dir.join(".version");

    // 2. If we have a cached version and no --update, use it
    if !update && console_dir.join("index.html").exists() {
        if let Ok(version) = std::fs::read_to_string(&version_file) {
            ui::info(&format!("Using cached console {}", version.trim().green()));
        }
        return Ok(console_dir);
    }

    // 3. Try downloading
    ui::info("Downloading latest console...");
    ui::detail(&format!("Cache: {}", cache_dir.display()));
    match download_console(&console_dir, &version_file).await {
        Ok(version) => {
            ui::success(&format!("Console {} ready", version.green()));
            Ok(console_dir)
        }
        Err(e) => {
            // If we have a stale cache, use it
            if console_dir.join("index.html").exists() {
                ui::warn(&format!("Failed to download latest console: {}", e));
                ui::warn("Using cached version");
                return Ok(console_dir);
            }

            // 4. Fall back to local dev build (apps/prisma-console/out/)
            let dev_dir = PathBuf::from("apps/prisma-console/out");
            if dev_dir.join("index.html").exists() {
                ui::warn(&format!("Failed to download console: {}", e));
                ui::info(&format!("Using local dev build from {}", dev_dir.display()));
                return Ok(dev_dir);
            }

            anyhow::bail!(
                "Failed to download console: {}\n\n\
                 No cached or local build found. Options:\n\
                 - Build locally: cd apps/prisma-console && npm ci && npm run build\n\
                   Then: prisma console --dir apps/prisma-console/out\n\
                 - Ensure the latest GitHub release has a prisma-console.tar.gz asset",
                e
            );
        }
    }
}

pub fn get_cache_dir() -> Result<PathBuf> {
    let dir = if cfg!(target_os = "windows") {
        dirs_or_fallback("LOCALAPPDATA", "prisma")
    } else if cfg!(target_os = "macos") {
        dirs_or_fallback("HOME", "Library/Caches/prisma")
    } else {
        // XDG_CACHE_HOME or ~/.cache/prisma
        std::env::var("XDG_CACHE_HOME")
            .map(|p| PathBuf::from(p).join("prisma"))
            .unwrap_or_else(|_| dirs_or_fallback("HOME", ".cache/prisma"))
    };
    std::fs::create_dir_all(&dir).map_err(|e| {
        anyhow::anyhow!(
            "Cannot create cache directory '{}': {}\n  \
             Check permissions or set XDG_CACHE_HOME to a writable location",
            dir.display(),
            e
        )
    })?;
    Ok(dir)
}

fn dirs_or_fallback(env_var: &str, suffix: &str) -> PathBuf {
    std::env::var(env_var)
        .map(|p| PathBuf::from(p).join(suffix))
        .unwrap_or_else(|_| PathBuf::from(".").join(suffix))
}

async fn download_console(dest: &Path, version_file: &Path) -> Result<String> {
    // Use GitHub Releases API to find latest release with console asset
    let client = reqwest::Client::new();

    let release_url = "https://api.github.com/repos/prisma-proxy/prisma-console/releases/latest";
    let release: serde_json::Value = client
        .get(release_url)
        .header("User-Agent", "prisma-cli")
        .send()
        .await?
        .json()
        .await?;

    // Check for API errors (rate limit, not found, etc.)
    if let Some(msg) = release["message"].as_str() {
        if msg.contains("rate limit") {
            anyhow::bail!(
                "GitHub API rate limit exceeded.\n  \
                 Set GITHUB_TOKEN env var to authenticate, or wait a few minutes."
            );
        }
        anyhow::bail!("GitHub API error: {}", msg);
    }

    let version = release["tag_name"]
        .as_str()
        .unwrap_or("unknown")
        .to_string();

    // Check if we already have this version
    if let Ok(cached_version) = std::fs::read_to_string(version_file) {
        if cached_version.trim() == version {
            return Ok(version);
        }
    }

    // Find console asset
    let assets = release["assets"].as_array().ok_or_else(|| {
        anyhow::anyhow!(
            "Release {} has no assets (console may not have been built for this release)",
            version
        )
    })?;

    let asset = assets
        .iter()
        .find(|a| {
            a["name"]
                .as_str()
                .map(|n| n.contains("console") && n.ends_with(".tar.gz"))
                .unwrap_or(false)
        })
        .ok_or_else(|| {
            anyhow::anyhow!(
                "Release {} has no prisma-console.tar.gz asset (found {} other assets)",
                version,
                assets.len()
            )
        })?;

    let download_url = asset["browser_download_url"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("No download URL for asset"))?;

    ui::detail(&format!("Source: {}", download_url));

    // Download with retry
    let bytes = download_asset_with_retry(&client, download_url).await?;

    // Clean up old cache
    if dest.exists() {
        if let Ok(size) = dir_size(dest) {
            ui::detail(&format!(
                "Cleaning up old cache ({})...",
                ui::format_bytes(size)
            ));
        }
        std::fs::remove_dir_all(dest)?;
    }
    std::fs::create_dir_all(dest)?;

    // Extract tar.gz
    let decoder = flate2::read::GzDecoder::new(&bytes[..]);
    let mut archive = tar::Archive::new(decoder);
    archive.unpack(dest)?;

    // Write version file
    std::fs::write(version_file, &version)?;

    Ok(version)
}

/// Download an asset with streaming progress and retry logic.
async fn download_asset_with_retry(client: &reqwest::Client, url: &str) -> Result<Vec<u8>> {
    use futures_util::StreamExt;

    const MAX_RETRIES: u32 = 2;
    let mut last_err = None;

    for attempt in 0..=MAX_RETRIES {
        if attempt > 0 {
            ui::warn(&format!(
                "Retrying download (attempt {}/{})",
                attempt + 1,
                MAX_RETRIES + 1
            ));
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        }

        let result: Result<Vec<u8>> = async {
            let response = client
                .get(url)
                .header("User-Agent", "prisma-cli")
                .send()
                .await?;

            if !response.status().is_success() {
                anyhow::bail!("HTTP {}", response.status());
            }

            let total = response.content_length().unwrap_or(0);
            let mut stream = response.bytes_stream();
            let mut downloaded: u64 = 0;
            let mut bytes = Vec::with_capacity(if total > 0 { total as usize } else { 1 << 20 });

            while let Some(chunk) = stream.next().await {
                let chunk = chunk?;
                downloaded += chunk.len() as u64;
                bytes.extend_from_slice(&chunk);
                ui::print_progress(downloaded, total);
            }
            ui::clear_progress();

            Ok(bytes)
        }
        .await;

        match result {
            Ok(bytes) => return Ok(bytes),
            Err(e) => last_err = Some(e),
        }
    }

    Err(last_err.unwrap_or_else(|| anyhow::anyhow!("Download failed")))
}

/// Calculate total size of a directory recursively.
fn dir_size(path: &Path) -> Result<u64> {
    let mut total = 0u64;
    dir_size_recursive(path, &mut total)?;
    Ok(total)
}

fn dir_size_recursive(path: &Path, total: &mut u64) -> Result<()> {
    for entry in std::fs::read_dir(path)? {
        let entry = entry?;
        let meta = entry.metadata()?;
        if meta.is_dir() {
            dir_size_recursive(&entry.path(), total)?;
        } else {
            *total += meta.len();
        }
    }
    Ok(())
}

fn build_server(
    console_dir: PathBuf,
    mgmt_url: String,
    token: Option<String>,
) -> Result<axum::Router> {
    use axum::{routing::any, Router};
    use tower_http::services::ServeDir;

    let mgmt_url = Arc::new(mgmt_url);
    let token = Arc::new(token);

    let app = Router::new()
        .route(
            "/api/{*path}",
            any({
                let mgmt_url = mgmt_url.clone();
                let token = token.clone();
                move |req: axum::extract::Request| {
                    let mgmt_url = mgmt_url.clone();
                    let token = token.clone();
                    async move { proxy_request(req, &mgmt_url, token.as_deref()).await }
                }
            }),
        )
        .fallback_service(ServeDir::new(console_dir).append_index_html_on_directories(true));

    Ok(app)
}

async fn proxy_request(
    req: axum::extract::Request,
    mgmt_url: &str,
    token: Option<&str>,
) -> axum::response::Response {
    use axum::http::StatusCode;
    use axum::response::IntoResponse;

    // Only accept self-signed certs when proxying to localhost (typical dev setup).
    // Remote mgmt endpoints must use valid certificates.
    let is_localhost = {
        let host = mgmt_url
            .trim_start_matches("https://")
            .trim_start_matches("http://")
            .split(':')
            .next()
            .unwrap_or("");
        host == "localhost" || host == "127.0.0.1" || host == "::1"
    };
    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(is_localhost)
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());
    let path = req.uri().path();
    let query = req
        .uri()
        .query()
        .map(|q| format!("?{}", q))
        .unwrap_or_default();
    let url = format!("{}{}{}", mgmt_url.trim_end_matches('/'), path, query);
    let method = req.method().clone();

    let mut builder = client.request(
        reqwest::Method::from_bytes(method.as_str().as_bytes()).unwrap_or(reqwest::Method::GET),
        &url,
    );

    // Forward auth token
    if let Some(t) = token {
        builder = builder.header("Authorization", format!("Bearer {}", t));
    }

    // Forward request headers (except host and authorization when proxy injects its own)
    for (key, value) in req.headers() {
        if key == "host" {
            continue;
        }
        if key == "authorization" && token.is_some() {
            continue;
        }
        if let Ok(v) = value.to_str() {
            builder = builder.header(key.as_str(), v);
        }
    }

    // Forward body
    let body_bytes = axum::body::to_bytes(req.into_body(), 10 * 1024 * 1024)
        .await
        .unwrap_or_default();
    if !body_bytes.is_empty() {
        builder = builder.body(body_bytes);
    }

    match builder.send().await {
        Ok(resp) => {
            let status = StatusCode::from_u16(resp.status().as_u16())
                .unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
            let mut response = axum::response::Response::builder().status(status);

            for (key, value) in resp.headers() {
                response = response.header(key.as_str(), value.as_bytes());
            }

            let body = resp.bytes().await.unwrap_or_default();
            response
                .body(axum::body::Body::from(body))
                .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
        }
        Err(e) => {
            eprintln!("Proxy error: {}", e);
            StatusCode::BAD_GATEWAY.into_response()
        }
    }
}

fn is_headless() -> bool {
    // Check for SSH session
    if std::env::var("SSH_TTY").is_ok() || std::env::var("SSH_CONNECTION").is_ok() {
        return true;
    }
    // On Linux, check for DISPLAY
    if cfg!(target_os = "linux")
        && std::env::var("DISPLAY").is_err()
        && std::env::var("WAYLAND_DISPLAY").is_err()
    {
        return true;
    }
    false
}

fn get_server_ip() -> Option<String> {
    // Simple heuristic: try to get a non-loopback IP
    // This is best-effort for display purposes
    std::env::var("HOSTNAME").ok()
}
