use std::ffi::{CStr, CString};
use std::os::raw::c_char;

use crate::state::AppState;
use prisma_ffi::{PRISMA_OK, PRISMA_ERR_NOT_CONNECTED};

// ── helpers ──────────────────────────────────────────────────────────────────

unsafe fn read_owned_cstr(ptr: *mut c_char) -> Option<String> {
    if ptr.is_null() { return None; }
    let s = CStr::from_ptr(ptr).to_string_lossy().to_string();
    prisma_ffi::prisma_free_string(ptr);
    Some(s)
}

fn client_ptr(state: &tauri::State<AppState>) -> Result<*mut prisma_ffi::PrismaClient, String> {
    let raw = *state.client.lock().unwrap();
    if raw == 0 { return Err("no client".into()); }
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
    if rc == PRISMA_OK { Ok(()) } else { Err(format!("prisma_connect error {rc}")) }
}

#[tauri::command]
pub fn disconnect(state: tauri::State<AppState>) -> Result<(), String> {
    let client = client_ptr(&state)?;
    let rc = unsafe { prisma_ffi::prisma_disconnect(client) };
    if rc == PRISMA_OK || rc == PRISMA_ERR_NOT_CONNECTED { Ok(()) }
    else { Err(format!("prisma_disconnect error {rc}")) }
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
    if rc == PRISMA_OK { Ok(()) } else { Err(format!("prisma_profile_save error {rc}")) }
}

#[tauri::command]
pub fn delete_profile(id: String) -> Result<(), String> {
    let cstr = CString::new(id).map_err(|e| e.to_string())?;
    let rc = unsafe { prisma_ffi::prisma_profile_delete(cstr.as_ptr()) };
    if rc == PRISMA_OK { Ok(()) } else { Err(format!("prisma_profile_delete error {rc}")) }
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
    if rc == PRISMA_OK { Ok(()) } else { Err(format!("prisma_set_system_proxy error {rc}")) }
}

#[tauri::command]
pub fn clear_system_proxy() -> Result<(), String> {
    let rc = prisma_ffi::prisma_clear_system_proxy();
    if rc == PRISMA_OK { Ok(()) } else { Err(format!("prisma_clear_system_proxy error {rc}")) }
}

// ── auto-update ───────────────────────────────────────────────────────────────

#[tauri::command]
pub fn check_update() -> Result<Option<serde_json::Value>, String> {
    let ptr = prisma_ffi::prisma_check_update_json();
    match unsafe { read_owned_cstr(ptr) } {
        None => Ok(None),
        Some(s) => serde_json::from_str(&s).map(Some).map_err(|e| e.to_string()),
    }
}

#[tauri::command]
pub fn apply_update(url: String, sha: String) -> Result<(), String> {
    let url_c = CString::new(url).map_err(|e| e.to_string())?;
    let sha_c = CString::new(sha).map_err(|e| e.to_string())?;
    let rc = unsafe { prisma_ffi::prisma_apply_update(url_c.as_ptr(), sha_c.as_ptr()) };
    if rc == PRISMA_OK { Ok(()) } else { Err(format!("prisma_apply_update error {rc}")) }
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
    app.exit(0);
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

// ── ping ──────────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn ping_server(addr: String) -> Result<u64, String> {
    let cstr = CString::new(addr).map_err(|e| e.to_string())?;
    let ptr = unsafe { prisma_ffi::prisma_ping(cstr.as_ptr()) };
    match unsafe { read_owned_cstr(ptr) } {
        None => Err("ping returned null".into()),
        Some(json) => {
            let val: serde_json::Value =
                serde_json::from_str(&json).map_err(|e| e.to_string())?;
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

// ── per-app proxy ─────────────────────────────────────────────────────────────

#[tauri::command]
pub fn set_per_app_filter(filter_json: String) -> Result<(), String> {
    let cstr = CString::new(filter_json).map_err(|e| e.to_string())?;
    let rc = unsafe { prisma_ffi::prisma_set_per_app_filter(cstr.as_ptr()) };
    if rc == PRISMA_OK { Ok(()) } else { Err(format!("prisma_set_per_app_filter error {rc}")) }
}

#[tauri::command]
pub fn clear_per_app_filter() -> Result<(), String> {
    let rc = unsafe { prisma_ffi::prisma_set_per_app_filter(std::ptr::null()) };
    if rc == PRISMA_OK { Ok(()) } else { Err(format!("prisma_clear_per_app_filter error {rc}")) }
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
        Some(s) => serde_json::from_str(&s).map(Some).map_err(|e| e.to_string()),
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
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ── file download ──────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn download_file(
    url: String,
    dest_path: String,
    proxy_port: u16,
) -> Result<(), String> {
    let mut builder = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120));
    if proxy_port > 0 {
        let proxy = reqwest::Proxy::all(format!("socks5://127.0.0.1:{}", proxy_port))
            .map_err(|e| e.to_string())?;
        builder = builder.proxy(proxy);
    }
    let client = builder.build().map_err(|e| e.to_string())?;
    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    tokio::fs::write(&dest_path, &bytes).await.map_err(|e| e.to_string())?;
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
    let rc = unsafe { prisma_ffi::prisma_speed_test(client, srv.as_ptr(), duration_secs, dir.as_ptr()) };
    if rc == PRISMA_OK { Ok(()) } else { Err(format!("prisma_speed_test error {rc}")) }
}
