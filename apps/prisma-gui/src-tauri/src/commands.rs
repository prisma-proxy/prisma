use std::ffi::{CStr, CString};
use std::os::raw::c_char;

use crate::state::AppState;
use prisma_ffi::{PRISMA_ERR_NOT_CONNECTED, PRISMA_OK};
use tauri::Emitter;

// ── helpers ──────────────────────────────────────────────────────────────────

unsafe fn read_owned_cstr(ptr: *mut c_char) -> Option<String> {
    if ptr.is_null() {
        return None;
    }
    let s = CStr::from_ptr(ptr).to_string_lossy().to_string();
    prisma_ffi::prisma_free_string(ptr);
    Some(s)
}

fn client_ptr(state: &tauri::State<AppState>) -> Result<*mut prisma_ffi::PrismaClient, String> {
    let raw = *state.client.lock().map_err(|_| "Failed to acquire client lock".to_string())?;
    if raw == 0 {
        return Err("no client".into());
    }
    Ok(raw as *mut prisma_ffi::PrismaClient)
}

// ── connection ────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn connect(
    state: tauri::State<AppState>,
    config_json: String,
    modes: u32,
) -> Result<(), String> {
    let client = client_ptr(&state)?;
    let cfg = CString::new(config_json).map_err(|e| e.to_string())?;
    let rc = unsafe { prisma_ffi::prisma_connect(client, cfg.as_ptr(), modes) };
    if rc == PRISMA_OK {
        Ok(())
    } else {
        Err(format!("prisma_connect error {rc}"))
    }
}

#[tauri::command]
pub fn disconnect(state: tauri::State<AppState>) -> Result<(), String> {
    let client = client_ptr(&state)?;
    let rc = unsafe { prisma_ffi::prisma_disconnect(client) };
    if rc == PRISMA_OK || rc == PRISMA_ERR_NOT_CONNECTED {
        Ok(())
    } else {
        Err(format!("prisma_disconnect error {rc}"))
    }
}

#[tauri::command]
pub fn get_status(state: tauri::State<AppState>) -> Result<i32, String> {
    let client = client_ptr(&state)?;
    Ok(unsafe { prisma_ffi::prisma_get_status(client) })
}

#[tauri::command]
pub fn get_stats(state: tauri::State<AppState>) -> Result<serde_json::Value, String> {
    let client = client_ptr(&state)?;
    let ptr = unsafe { prisma_ffi::prisma_get_stats_json(client) };
    match unsafe { read_owned_cstr(ptr) } {
        None => Ok(serde_json::Value::Null),
        Some(s) => serde_json::from_str(&s).map_err(|e| e.to_string()),
    }
}

// ── profiles ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn list_profiles() -> Result<serde_json::Value, String> {
    let ptr = prisma_ffi::prisma_profiles_list_json();
    match unsafe { read_owned_cstr(ptr) } {
        None => Ok(serde_json::Value::Array(vec![])),
        Some(s) => serde_json::from_str(&s).map_err(|e| e.to_string()),
    }
}

#[tauri::command]
pub fn save_profile(profile_json: String) -> Result<(), String> {
    let cstr = CString::new(profile_json).map_err(|e| e.to_string())?;
    let rc = unsafe { prisma_ffi::prisma_profile_save(cstr.as_ptr()) };
    if rc == PRISMA_OK {
        Ok(())
    } else {
        Err(format!("prisma_profile_save error {rc}"))
    }
}

#[tauri::command]
pub fn delete_profile(id: String) -> Result<(), String> {
    let cstr = CString::new(id).map_err(|e| e.to_string())?;
    let rc = unsafe { prisma_ffi::prisma_profile_delete(cstr.as_ptr()) };
    if rc == PRISMA_OK {
        Ok(())
    } else {
        Err(format!("prisma_profile_delete error {rc}"))
    }
}

// ── QR ────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn profile_to_qr(profile_json: String) -> Result<String, String> {
    let cstr = CString::new(profile_json).map_err(|e| e.to_string())?;
    let ptr = unsafe { prisma_ffi::prisma_profile_to_qr_svg(cstr.as_ptr()) };
    unsafe { read_owned_cstr(ptr) }.ok_or_else(|| "QR generation failed".into())
}

#[tauri::command]
pub fn profile_from_qr(data: String) -> Result<String, String> {
    let cstr = CString::new(data).map_err(|e| e.to_string())?;
    let mut out: *mut c_char = std::ptr::null_mut();
    let rc = unsafe { prisma_ffi::prisma_profile_from_qr(cstr.as_ptr(), &mut out) };
    if rc == PRISMA_OK {
        unsafe { read_owned_cstr(out) }.ok_or_else(|| "QR decode returned null".into())
    } else {
        Err(format!("prisma_profile_from_qr error {rc}"))
    }
}

#[tauri::command]
pub fn decode_qr_image(path: String) -> Result<String, String> {
    let cstr = CString::new(path).map_err(|e| e.to_string())?;
    let mut out: *mut c_char = std::ptr::null_mut();
    let rc = unsafe { prisma_ffi::prisma_decode_qr_image(cstr.as_ptr(), &mut out) };
    if rc == PRISMA_OK {
        unsafe { read_owned_cstr(out) }.ok_or_else(|| "QR image decode returned null".into())
    } else {
        Err(format!("prisma_decode_qr_image error {rc}"))
    }
}

// ── profile sharing ───────────────────────────────────────────────────────

#[tauri::command]
pub fn profile_to_uri(profile_json: String) -> Result<String, String> {
    let cstr = CString::new(profile_json).map_err(|e| e.to_string())?;
    let ptr = unsafe { prisma_ffi::prisma_profile_to_uri(cstr.as_ptr()) };
    unsafe { read_owned_cstr(ptr) }.ok_or_else(|| "URI generation failed".into())
}

#[tauri::command]
pub fn profile_config_to_toml(config_json: String) -> Result<String, String> {
    let cstr = CString::new(config_json).map_err(|e| e.to_string())?;
    let ptr = unsafe { prisma_ffi::prisma_profile_config_to_toml(cstr.as_ptr()) };
    unsafe { read_owned_cstr(ptr) }.ok_or_else(|| "TOML conversion failed".into())
}

// ── system proxy ──────────────────────────────────────────────────────────────

#[tauri::command]
pub fn set_system_proxy(host: String, port: u16) -> Result<(), String> {
    let host_c = CString::new(host).map_err(|e| e.to_string())?;
    let rc = unsafe { prisma_ffi::prisma_set_system_proxy(host_c.as_ptr(), port) };
    if rc == PRISMA_OK {
        Ok(())
    } else {
        Err(format!("prisma_set_system_proxy error {rc}"))
    }
}

#[tauri::command]
pub fn clear_system_proxy() -> Result<(), String> {
    let rc = prisma_ffi::prisma_clear_system_proxy();
    if rc == PRISMA_OK {
        Ok(())
    } else {
        Err(format!("prisma_clear_system_proxy error {rc}"))
    }
}

// ── auto-update ───────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn check_update(proxy_port: Option<u16>) -> Result<Option<serde_json::Value>, String> {
    let port = proxy_port.unwrap_or(0);
    let result = tokio::task::spawn_blocking(move || {
        prisma_core::auto_update::check_with_proxy(port)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;

    match result {
        Some(info) => Ok(serde_json::to_value(info).ok()),
        None => Ok(None),
    }
}

#[tauri::command]
pub async fn apply_update(
    app: tauri::AppHandle,
    url: String,
    sha: String,
    proxy_port: Option<u16>,
) -> Result<(), String> {
    let app_clone = app.clone();
    let port = proxy_port.unwrap_or(0);
    tokio::task::spawn_blocking(move || {
        // Emit downloading phase
        let _ = app_clone.emit(
            "update-progress",
            serde_json::json!({"phase": "downloading"}),
        );

        let bytes = if sha.is_empty() {
            prisma_core::auto_update::download_with_proxy(&url, port)
        } else {
            prisma_core::auto_update::download_and_verify_with_proxy(&url, &sha, port)
        }
        .map_err(|e| e.to_string())?;

        // Emit installing phase
        let _ = app_clone.emit(
            "update-progress",
            serde_json::json!({"phase": "installing"}),
        );

        prisma_core::auto_update::self_replace(&bytes).map_err(|e| e.to_string())?;

        // Emit done
        let _ = app_clone.emit(
            "update-progress",
            serde_json::json!({"phase": "done"}),
        );

        Ok::<(), String>(())
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── tray ──────────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn refresh_tray_profiles(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(desktop)]
    crate::tray::refresh_profiles(&app).map_err(|e| e.to_string())?;
    let _ = &app; // suppress unused warning on mobile
    Ok(())
}

// ── app lifecycle ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn quit_app(app: tauri::AppHandle) {
    let rc = prisma_ffi::prisma_clear_system_proxy();
    if rc != prisma_ffi::PRISMA_OK {
        tracing::error!("Failed to clear system proxy on quit (error code: {})", rc);
    }
    app.exit(0);
}

#[tauri::command]
pub fn set_tray_proxy_mode(app: tauri::AppHandle, mode: u32) {
    if let Ok(mut guard) = crate::state::PROXY_MODE.lock() {
        *guard = mode;
    }
    #[cfg(desktop)]
    let _ = crate::tray::refresh_profiles(&app);
    let _ = &app;
}

// ── tray state ────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn set_active_profile_id(id: String) {
    if let Ok(mut guard) = crate::state::ACTIVE_PROFILE_ID.lock() {
        *guard = if id.is_empty() { None } else { Some(id) };
    }
}

#[tauri::command]
pub fn set_tray_port(port: u16) {
    if let Ok(mut guard) = crate::state::SOCKS5_PORT.lock() {
        *guard = port;
    }
}

#[tauri::command]
pub fn get_active_profile_id() -> Option<String> {
    crate::state::ACTIVE_PROFILE_ID.lock().ok()?.clone()
}

#[tauri::command]
pub fn get_proxy_mode() -> u32 {
    crate::state::PROXY_MODE
        .lock()
        .ok()
        .map(|g| *g)
        .unwrap_or(0x02)
}

/// Update tray speed stats and tooltip with live bandwidth data.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn update_tray_stats(
    app: tauri::AppHandle,
    up_bps: f64,
    down_bps: f64,
    bytes_up: f64,
    bytes_down: f64,
    connections: u32,
    profile_name: String,
    uptime_secs: u64,
) {
    #[cfg(desktop)]
    crate::tray::update_tooltip(
        &app,
        &crate::tray::TrayStatsUpdate {
            up_bps,
            down_bps,
            bytes_up,
            bytes_down,
            connections,
            profile_name: &profile_name,
            uptime_secs,
        },
    );
    let _ = &app;
}

/// Update the Recent Connections submenu with the last N destinations.
#[tauri::command]
pub fn update_tray_recent(app: tauri::AppHandle, destinations: Vec<String>) -> Result<(), String> {
    #[cfg(desktop)]
    crate::tray::refresh_recent_connections(&app, destinations).map_err(|e| e.to_string())?;
    let _ = &app;
    Ok(())
}

/// Sync toggle states from the frontend settings store into tray state.
/// Called once at startup so the tray checkmarks match the persisted settings.
#[tauri::command]
pub fn sync_tray_toggles(
    app: tauri::AppHandle,
    auto_connect: bool,
    allow_lan: bool,
    tun_enabled: bool,
) {
    if let Ok(mut g) = crate::state::TOGGLE_AUTO_CONNECT.lock() {
        *g = auto_connect;
    }
    if let Ok(mut g) = crate::state::TOGGLE_ALLOW_LAN.lock() {
        *g = allow_lan;
    }
    if let Ok(mut g) = crate::state::TOGGLE_TUN.lock() {
        *g = tun_enabled;
    }
    #[cfg(desktop)]
    let _ = crate::tray::refresh_profiles(&app);
    let _ = &app;
}

// ── ping ──────────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn ping_server(addr: String) -> Result<u64, String> {
    let cstr = CString::new(addr).map_err(|e| e.to_string())?;
    let ptr = unsafe { prisma_ffi::prisma_ping(cstr.as_ptr()) };
    match unsafe { read_owned_cstr(ptr) } {
        None => Err("ping returned null".into()),
        Some(json) => {
            let val: serde_json::Value = serde_json::from_str(&json).map_err(|e| e.to_string())?;
            if let Some(ms) = val["latency_ms"].as_u64() {
                Ok(ms)
            } else if let Some(err) = val["error"].as_str() {
                Err(err.to_string())
            } else {
                Err("unexpected ping response".into())
            }
        }
    }
}

// ── PAC URL ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_pac_url(state: tauri::State<AppState>, pac_port: u16) -> Result<String, String> {
    let client = client_ptr(&state)?;
    let ptr = unsafe { prisma_ffi::prisma_get_pac_url(client, pac_port) };
    unsafe { read_owned_cstr(ptr) }.ok_or_else(|| "Failed to get PAC URL".into())
}

// ── elevation check ───────────────────────────────────────────────────────────

/// Check whether the process is running with elevated privileges.
/// On Windows this always returns false (per-app proxy injection doesn't need elevation).
/// On macOS/Linux, it checks if the process is running as root.
#[tauri::command]
pub fn check_elevation() -> bool {
    check_elevation_impl()
}

#[cfg(unix)]
fn check_elevation_impl() -> bool {
    unsafe { libc::getuid() == 0 }
}

#[cfg(not(unix))]
fn check_elevation_impl() -> bool {
    false
}

// ── per-app proxy ─────────────────────────────────────────────────────────────

#[tauri::command]
pub fn set_per_app_filter(filter_json: String) -> Result<(), String> {
    let cstr = CString::new(filter_json).map_err(|e| e.to_string())?;
    let rc = unsafe { prisma_ffi::prisma_set_per_app_filter(cstr.as_ptr()) };
    if rc == PRISMA_OK {
        Ok(())
    } else {
        Err(format!("prisma_set_per_app_filter error {rc}"))
    }
}

#[tauri::command]
pub fn clear_per_app_filter() -> Result<(), String> {
    let rc = unsafe { prisma_ffi::prisma_set_per_app_filter(std::ptr::null()) };
    if rc == PRISMA_OK {
        Ok(())
    } else {
        Err(format!("prisma_clear_per_app_filter error {rc}"))
    }
}

#[tauri::command]
pub fn get_running_apps() -> Result<Vec<String>, String> {
    let ptr = prisma_ffi::prisma_get_running_apps();
    match unsafe { read_owned_cstr(ptr) } {
        None => Ok(vec![]),
        Some(s) => serde_json::from_str(&s).map_err(|e| e.to_string()),
    }
}

#[tauri::command]
pub fn get_per_app_filter() -> Result<Option<serde_json::Value>, String> {
    let ptr = prisma_ffi::prisma_get_per_app_filter();
    match unsafe { read_owned_cstr(ptr) } {
        None => Ok(None),
        Some(s) => serde_json::from_str(&s)
            .map(Some)
            .map_err(|e| e.to_string()),
    }
}

// ── subscriptions ─────────────────────────────────────────────────────────────

#[tauri::command]
pub fn import_subscription(url: String) -> Result<serde_json::Value, String> {
    let cstr = CString::new(url).map_err(|e| e.to_string())?;
    let ptr = unsafe { prisma_ffi::prisma_import_subscription(cstr.as_ptr()) };
    match unsafe { read_owned_cstr(ptr) } {
        None => Err("import failed".into()),
        Some(s) => serde_json::from_str(&s).map_err(|e| e.to_string()),
    }
}

#[tauri::command]
pub fn refresh_subscriptions() -> Result<serde_json::Value, String> {
    let ptr = prisma_ffi::prisma_refresh_subscriptions();
    match unsafe { read_owned_cstr(ptr) } {
        None => Err("refresh failed".into()),
        Some(s) => serde_json::from_str(&s).map_err(|e| e.to_string()),
    }
}

// ── open folder ────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn open_folder(path: String) -> Result<(), String> {
    let cmd = if cfg!(target_os = "macos") {
        "open"
    } else if cfg!(target_os = "windows") {
        "explorer"
    } else if cfg!(target_os = "linux") {
        "xdg-open"
    } else {
        return Ok(()); // no-op on unsupported platforms (e.g. Android)
    };
    std::process::Command::new(cmd)
        .arg(&path)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ── file download ──────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn download_file(url: String, dest_path: String, proxy_port: u16) -> Result<(), String> {
    if dest_path.contains("..") {
        return Err("Invalid path: directory traversal not allowed".into());
    }
    #[cfg(target_os = "windows")]
    {
        let normalized = dest_path.replace('/', "\\");
        if normalized.starts_with("\\\\") || normalized.starts_with("C:\\Windows") || normalized.starts_with("C:\\Program Files") {
            return Err("Invalid path: writing to sensitive directory not allowed".into());
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        if dest_path.starts_with("/etc") || dest_path.starts_with("/usr") || dest_path.starts_with("/bin") || dest_path.starts_with("/sbin") {
            return Err("Invalid path: writing to sensitive directory not allowed".into());
        }
    }
    let mut builder = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .redirect(reqwest::redirect::Policy::limited(10));
    if proxy_port > 0 {
        // Use HTTP CONNECT proxy (not SOCKS5) for reliable HTTPS tunneling
        let proxy = reqwest::Proxy::http(format!("http://127.0.0.1:{}", proxy_port))
            .map_err(|e| e.to_string())?;
        let proxy_https = reqwest::Proxy::https(format!("http://127.0.0.1:{}", proxy_port))
            .map_err(|e| e.to_string())?;
        builder = builder.proxy(proxy).proxy(proxy_https);
    }
    let client = builder.build().map_err(|e| e.to_string())?;
    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    tokio::fs::write(&dest_path, &bytes)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ── profiles dir ──────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_profiles_dir() -> Result<String, String> {
    prisma_ffi::ProfileManager::profiles_dir_str().map_err(|e| e.to_string())
}

// ── speed test ────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn speed_test(
    state: tauri::State<AppState>,
    server: String,
    duration_secs: u32,
) -> Result<(), String> {
    let client = client_ptr(&state)?;
    let srv = CString::new(server).map_err(|e| e.to_string())?;
    let dir = CString::new("both").map_err(|e| e.to_string())?;
    let rc =
        unsafe { prisma_ffi::prisma_speed_test(client, srv.as_ptr(), duration_secs, dir.as_ptr()) };
    if rc == PRISMA_OK {
        Ok(())
    } else {
        Err(format!("prisma_speed_test error {rc}"))
    }
}

// ── rule providers ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn update_rule_provider(
    id: String,
    name: String,
    url: String,
    behavior: String,
    action: String,
    proxy_port: u16,
) -> Result<serde_json::Value, String> {
    let mut builder = reqwest::Client::builder().timeout(std::time::Duration::from_secs(30));
    if proxy_port > 0 {
        let proxy = reqwest::Proxy::all(format!("http://127.0.0.1:{}", proxy_port))
            .map_err(|e| e.to_string())?;
        builder = builder.proxy(proxy);
    }
    let client = builder.build().map_err(|e| e.to_string())?;
    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let content = resp.text().await.map_err(|e| e.to_string())?;

    // Sanitize name to prevent path traversal (allow spaces for display names)
    if name.contains("..") || name.contains('/') || name.contains('\\') || name.starts_with('.') {
        return Err("Invalid rule provider name".into());
    }
    if !name
        .chars()
        .all(|c| c.is_alphanumeric() || c == '-' || c == '_' || c == '.' || c == ' ')
    {
        return Err("Invalid rule provider name".into());
    }

    // Write to the cache directory that prisma-client expects
    // Replace spaces with underscores for safe filenames
    let safe_name = name.replace(' ', "_");
    let cache_dir = std::path::PathBuf::from("./data/rule-providers");
    let _ = std::fs::create_dir_all(&cache_dir);
    let cache_path = cache_dir.join(format!("{}.txt", safe_name));
    let _ = std::fs::write(&cache_path, &content);

    // Count lines that are actual rules (not comments/blanks)
    let rule_count = content
        .lines()
        .filter(|l| {
            let t = l.trim();
            !t.is_empty() && !t.starts_with('#') && !t.starts_with("//")
        })
        .count();

    let now_epoch = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    Ok(serde_json::json!({
        "id": id,
        "behavior": behavior,
        "action": action,
        "rule_count": rule_count,
        "updated_at_epoch": now_epoch,
    }))
}

#[tauri::command]
pub fn list_rule_providers() -> Result<serde_json::Value, String> {
    // Provider state is managed on the frontend via Zustand persist.
    // This command exists for future backend integration.
    Ok(serde_json::Value::Array(vec![]))
}
