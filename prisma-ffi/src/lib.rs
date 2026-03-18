//! prisma-ffi — C ABI shared library for Prisma GUI clients.
//!
//! Safety contract: all pointers passed in must be valid for the duration of
//! the call. Strings are null-terminated UTF-8. The caller owns strings
//! returned by functions that do NOT say "caller must prisma_free_string()".

use std::ffi::{CStr, CString};
use std::os::raw::{c_char, c_int, c_void};
use std::sync::{Arc, Mutex};

mod auto_update;
mod connection;
mod geo;
mod profiles;
mod qr;
mod runtime;
mod stats_poller;
mod system_proxy;

use connection::ConnectionManager;
use profiles::ProfileManager;
use runtime::PrismaRuntime;

// ── Error codes ──────────────────────────────────────────────────────────────

pub const PRISMA_OK: c_int = 0;
pub const PRISMA_ERR_INVALID_CONFIG: c_int = 1;
pub const PRISMA_ERR_ALREADY_CONNECTED: c_int = 2;
pub const PRISMA_ERR_NOT_CONNECTED: c_int = 3;
pub const PRISMA_ERR_PERMISSION_DENIED: c_int = 4;
pub const PRISMA_ERR_INTERNAL: c_int = 5;

// ── Status codes ─────────────────────────────────────────────────────────────

pub const PRISMA_STATUS_DISCONNECTED: c_int = 0;
pub const PRISMA_STATUS_CONNECTING: c_int = 1;
pub const PRISMA_STATUS_CONNECTED: c_int = 2;
pub const PRISMA_STATUS_ERROR: c_int = 3;

// ── Proxy mode flags (bitfield) ───────────────────────────────────────────────

pub const PRISMA_MODE_SOCKS5: u32 = 0x01;
pub const PRISMA_MODE_SYSTEM_PROXY: u32 = 0x02;
pub const PRISMA_MODE_TUN: u32 = 0x04;
pub const PRISMA_MODE_PER_APP: u32 = 0x08;

// ── Callback ──────────────────────────────────────────────────────────────────

pub type PrismaCallback =
    Option<unsafe extern "C" fn(event_json: *const c_char, userdata: *mut c_void)>;

// ── Opaque handle ────────────────────────────────────────────────────────────

pub struct PrismaClient {
    runtime: Arc<PrismaRuntime>,
    connection: Arc<Mutex<ConnectionManager>>,
    callback: Arc<Mutex<CallbackHolder>>,
    stats_poller: Arc<Mutex<Option<stats_poller::StatsPoller>>>,
}

pub struct CallbackHolder {
    pub func: PrismaCallback,
    pub userdata: *mut c_void,
}

unsafe impl Send for CallbackHolder {}
unsafe impl Sync for CallbackHolder {}

impl PrismaClient {
    fn fire_event(&self, event_json: &str) {
        let holder = match self.callback.lock() {
            Ok(h) => h,
            Err(_) => return, // Mutex poisoned — silently skip to avoid panic across FFI
        };
        if let Some(func) = holder.func {
            if let Ok(cstr) = CString::new(event_json) {
                unsafe { func(cstr.as_ptr(), holder.userdata) };
            }
        }
    }
}

// ── Panic safety ─────────────────────────────────────────────────────────────

/// Catch panics at the FFI boundary. Panicking across `extern "C"` functions
/// is undefined behavior. This macro wraps the body and returns `$fallback`
/// if a panic occurs.
macro_rules! ffi_catch {
    ($fallback:expr, $body:expr) => {
        match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| $body)) {
            Ok(val) => val,
            Err(_) => $fallback,
        }
    };
}

// ── Helper macros ────────────────────────────────────────────────────────────

macro_rules! cstr_to_str {
    ($ptr:expr) => {{
        if $ptr.is_null() {
            return PRISMA_ERR_INVALID_CONFIG;
        }
        match unsafe { CStr::from_ptr($ptr) }.to_str() {
            Ok(s) => s,
            Err(_) => return PRISMA_ERR_INVALID_CONFIG,
        }
    }};
}

/// Like `cstr_to_str!` but returns `Option<&str>` instead of early-returning an error code.
/// Useful in functions that return pointers rather than error codes.
macro_rules! cstr_to_str_opt {
    ($ptr:expr) => {{
        if $ptr.is_null() {
            None
        } else {
            unsafe { CStr::from_ptr($ptr) }.to_str().ok()
        }
    }};
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

/// Create a new PrismaClient handle. Returns NULL on allocation failure.
#[no_mangle]
pub extern "C" fn prisma_create() -> *mut PrismaClient {
    ffi_catch!(std::ptr::null_mut(), {
        // Install rustls CryptoProvider (idempotent — ignores if already set)
        let _ = rustls::crypto::ring::default_provider().install_default();

        let runtime = match PrismaRuntime::new() {
            Ok(r) => Arc::new(r),
            Err(_) => return std::ptr::null_mut(),
        };
        let client = Box::new(PrismaClient {
            runtime,
            connection: Arc::new(Mutex::new(ConnectionManager::new())),
            callback: Arc::new(Mutex::new(CallbackHolder {
                func: None,
                userdata: std::ptr::null_mut(),
            })),
            stats_poller: Arc::new(Mutex::new(None)),
        });
        Box::into_raw(client)
    })
}

/// Destroy a PrismaClient handle.
///
/// # Safety
/// `handle` must be a valid pointer returned by `prisma_create`.
#[no_mangle]
pub unsafe extern "C" fn prisma_destroy(handle: *mut PrismaClient) {
    if handle.is_null() {
        return;
    }
    let client = unsafe { Box::from_raw(handle) };
    // Stop stats poller
    if let Ok(mut poller_guard) = client.stats_poller.lock() {
        if let Some(poller) = poller_guard.take() {
            poller.stop();
        }
    }
    // Disconnect if connected
    let _ = client.connection.lock().map(|mut conn| conn.disconnect());
    drop(client);
}

// ── Connection ───────────────────────────────────────────────────────────────

/// Connect using the provided config JSON and proxy mode flags.
///
/// # Safety
/// `handle` and `config_json` must be valid non-null pointers.
#[no_mangle]
pub unsafe extern "C" fn prisma_connect(
    handle: *mut PrismaClient,
    config_json: *const c_char,
    modes: u32,
) -> c_int {
    ffi_catch!(PRISMA_ERR_INTERNAL, {
        if handle.is_null() {
            return PRISMA_ERR_INVALID_CONFIG;
        }
        let client = unsafe { &*handle };
        let config_str = cstr_to_str!(config_json);

        let config: prisma_core::config::client::ClientConfig =
            match serde_json::from_str(config_str) {
                Ok(c) => c,
                Err(e) => {
                    tracing::error!("Invalid config JSON: {}", e);
                    client.fire_event(&format!(
                        r#"{{"type":"error","code":"invalid_config","msg":{}}}"#,
                        serde_json::to_string(&e.to_string()).unwrap_or_default()
                    ));
                    return PRISMA_ERR_INVALID_CONFIG;
                }
            };

        let mut conn = match client.connection.lock() {
            Ok(g) => g,
            Err(_) => return PRISMA_ERR_INTERNAL,
        };

        if conn.is_connected() {
            return PRISMA_ERR_ALREADY_CONNECTED;
        }

        client.fire_event(r#"{"type":"status_changed","status":"connecting"}"#);

        let cb_arc = Arc::clone(&client.callback);
        let fire = move |ev: String| {
            let holder = match cb_arc.lock() {
                Ok(h) => h,
                Err(_) => return, // Mutex poisoned — skip to avoid panic across FFI
            };
            if let Some(func) = holder.func {
                if let Ok(cstr) = CString::new(ev) {
                    unsafe { func(cstr.as_ptr(), holder.userdata) };
                }
            }
        };

        match conn.connect(Arc::clone(&client.runtime), config, modes, Arc::new(fire)) {
            Ok(_) => {
                // Start stats poller
                let cb_arc2 = Arc::clone(&client.callback);
                let conn_arc = Arc::clone(&client.connection);
                let poller = stats_poller::StatsPoller::start(
                    Arc::clone(&client.runtime),
                    conn_arc,
                    cb_arc2,
                );
                if let Ok(mut guard) = client.stats_poller.lock() {
                    *guard = Some(poller);
                }
                client.fire_event(r#"{"type":"status_changed","status":"connected"}"#);
                PRISMA_OK
            }
            Err(e) => {
                client.fire_event(&format!(
                    r#"{{"type":"error","code":"connect_failed","msg":{}}}"#,
                    serde_json::to_string(&e.to_string()).unwrap_or_default()
                ));
                PRISMA_ERR_INTERNAL
            }
        }
    }) // ffi_catch
}

/// Disconnect the current session.
///
/// # Safety
/// `handle` must be valid.
#[no_mangle]
pub unsafe extern "C" fn prisma_disconnect(handle: *mut PrismaClient) -> c_int {
    ffi_catch!(PRISMA_ERR_INTERNAL, {
        if handle.is_null() {
            return PRISMA_ERR_INVALID_CONFIG;
        }
        let client = unsafe { &*handle };

        // Stop stats poller first
        if let Ok(mut guard) = client.stats_poller.lock() {
            if let Some(poller) = guard.take() {
                poller.stop();
            }
        }

        let mut conn = match client.connection.lock() {
            Ok(g) => g,
            Err(_) => return PRISMA_ERR_INTERNAL,
        };

        if !conn.is_connected() {
            return PRISMA_ERR_NOT_CONNECTED;
        }

        conn.disconnect();
        client.fire_event(r#"{"type":"status_changed","status":"disconnected"}"#);
        PRISMA_OK
    })
}

/// Get current connection status.
///
/// # Safety
/// `handle` must be valid.
#[no_mangle]
pub unsafe extern "C" fn prisma_get_status(handle: *mut PrismaClient) -> c_int {
    if handle.is_null() {
        return PRISMA_STATUS_DISCONNECTED;
    }
    let client = unsafe { &*handle };
    match client.connection.lock() {
        Ok(conn) => conn.status() as c_int,
        Err(_) => PRISMA_STATUS_ERROR,
    }
}

/// Get current stats as JSON. Caller must call `prisma_free_string` on result.
/// Returns NULL if not connected.
///
/// # Safety
/// `handle` must be valid.
#[no_mangle]
pub unsafe extern "C" fn prisma_get_stats_json(handle: *mut PrismaClient) -> *mut c_char {
    if handle.is_null() {
        return std::ptr::null_mut();
    }
    let client = unsafe { &*handle };
    match client.connection.lock() {
        Ok(mut conn) => {
            let json = conn.get_stats_json();
            match CString::new(json) {
                Ok(s) => s.into_raw(),
                Err(_) => std::ptr::null_mut(),
            }
        }
        Err(_) => std::ptr::null_mut(),
    }
}

/// Free a string returned by a prisma_* function.
///
/// # Safety
/// `s` must be a pointer returned by a prisma_* function (or NULL).
#[no_mangle]
pub unsafe extern "C" fn prisma_free_string(s: *mut c_char) {
    if s.is_null() {
        return;
    }
    unsafe { drop(CString::from_raw(s)) };
}

/// Register an event callback.
///
/// # Safety
/// `handle` must be valid. `userdata` is passed as-is to the callback.
#[no_mangle]
pub unsafe extern "C" fn prisma_set_callback(
    handle: *mut PrismaClient,
    callback: PrismaCallback,
    userdata: *mut c_void,
) {
    if handle.is_null() {
        return;
    }
    let client = unsafe { &*handle };
    if let Ok(mut holder) = client.callback.lock() {
        holder.func = callback;
        holder.userdata = userdata;
    }
}

// ── Profile management ───────────────────────────────────────────────────────

/// List all profiles as a JSON array. Caller must call `prisma_free_string`.
#[no_mangle]
pub extern "C" fn prisma_profiles_list_json() -> *mut c_char {
    ProfileManager::list_json()
        .ok()
        .and_then(|json| CString::new(json).ok())
        .map_or(std::ptr::null_mut(), CString::into_raw)
}

/// Save a profile from JSON.
///
/// # Safety
/// `profile_json` must be a valid non-null C string.
#[no_mangle]
pub unsafe extern "C" fn prisma_profile_save(profile_json: *const c_char) -> c_int {
    let json_str = cstr_to_str!(profile_json);
    match ProfileManager::save(json_str) {
        Ok(_) => PRISMA_OK,
        Err(_) => PRISMA_ERR_INTERNAL,
    }
}

/// Delete a profile by ID.
///
/// # Safety
/// `id` must be a valid non-null C string.
#[no_mangle]
pub unsafe extern "C" fn prisma_profile_delete(id: *const c_char) -> c_int {
    let id_str = cstr_to_str!(id);
    match ProfileManager::delete(id_str) {
        Ok(_) => PRISMA_OK,
        Err(_) => PRISMA_ERR_INTERNAL,
    }
}

// ── QR code ──────────────────────────────────────────────────────────────────

/// Encode a profile JSON to a QR SVG string. Caller must call `prisma_free_string`.
///
/// # Safety
/// `profile_json` must be a valid non-null C string.
#[no_mangle]
pub unsafe extern "C" fn prisma_profile_to_qr_svg(profile_json: *const c_char) -> *mut c_char {
    let json_str = match cstr_to_str_opt!(profile_json) {
        Some(s) => s,
        None => return std::ptr::null_mut(),
    };
    match qr::profile_to_qr_svg(json_str) {
        Ok(svg) => CString::new(svg).map_or(std::ptr::null_mut(), CString::into_raw),
        Err(_) => std::ptr::null_mut(),
    }
}

/// Decode a prisma:// URI or raw QR data to profile JSON.
/// Writes allocated JSON to `*out_json`; caller must call `prisma_free_string` on it.
///
/// # Safety
/// `data` must be a valid non-null C string. `out_json` must be a valid non-null pointer.
#[no_mangle]
pub unsafe extern "C" fn prisma_profile_from_qr(
    data: *const c_char,
    out_json: *mut *mut c_char,
) -> c_int {
    if data.is_null() || out_json.is_null() {
        return PRISMA_ERR_INVALID_CONFIG;
    }
    let data_str = match unsafe { CStr::from_ptr(data) }.to_str() {
        Ok(s) => s,
        Err(_) => return PRISMA_ERR_INVALID_CONFIG,
    };
    let json = match qr::profile_from_qr(data_str) {
        Ok(j) => j,
        Err(_) => return PRISMA_ERR_INVALID_CONFIG,
    };
    match CString::new(json) {
        Ok(s) => {
            unsafe { *out_json = s.into_raw() };
            PRISMA_OK
        }
        Err(_) => PRISMA_ERR_INTERNAL,
    }
}

// ── Profile sharing ──────────────────────────────────────────────────────

/// Generate a `prisma://` URI from profile JSON. Caller must call `prisma_free_string`.
///
/// # Safety
/// `profile_json` must be a valid non-null C string.
#[no_mangle]
pub unsafe extern "C" fn prisma_profile_to_uri(profile_json: *const c_char) -> *mut c_char {
    let json_str = match cstr_to_str_opt!(profile_json) {
        Some(s) => s,
        None => return std::ptr::null_mut(),
    };
    match qr::profile_to_uri(json_str) {
        Ok(uri) => CString::new(uri).map_or(std::ptr::null_mut(), CString::into_raw),
        Err(_) => std::ptr::null_mut(),
    }
}

/// Convert a profile config JSON to TOML string. Caller must call `prisma_free_string`.
///
/// # Safety
/// `config_json` must be a valid non-null C string.
#[no_mangle]
pub unsafe extern "C" fn prisma_profile_config_to_toml(config_json: *const c_char) -> *mut c_char {
    let json_str = match cstr_to_str_opt!(config_json) {
        Some(s) => s,
        None => return std::ptr::null_mut(),
    };
    match qr::profile_config_to_toml(json_str) {
        Ok(toml) => CString::new(toml).map_or(std::ptr::null_mut(), CString::into_raw),
        Err(_) => std::ptr::null_mut(),
    }
}

// ── System proxy ─────────────────────────────────────────────────────────────

/// Set the OS system proxy to `host:port`.
///
/// # Safety
/// `host` must be a valid non-null C string.
#[no_mangle]
pub unsafe extern "C" fn prisma_set_system_proxy(host: *const c_char, port: u16) -> c_int {
    let host_str = cstr_to_str!(host);
    match system_proxy::set(host_str, port) {
        Ok(_) => PRISMA_OK,
        Err(e) if e.to_string().contains("permission") => PRISMA_ERR_PERMISSION_DENIED,
        Err(_) => PRISMA_ERR_INTERNAL,
    }
}

/// Clear the OS system proxy settings.
#[no_mangle]
pub extern "C" fn prisma_clear_system_proxy() -> c_int {
    match system_proxy::clear() {
        Ok(_) => PRISMA_OK,
        Err(_) => PRISMA_ERR_INTERNAL,
    }
}

// ── Auto-update ──────────────────────────────────────────────────────────────

/// Check GitHub for a newer release. Returns JSON `{version,url,changelog}` or NULL.
/// Caller must call `prisma_free_string`.
#[no_mangle]
pub extern "C" fn prisma_check_update_json() -> *mut c_char {
    auto_update::check()
        .ok()
        .flatten()
        .and_then(|info| serde_json::to_string(&info).ok())
        .and_then(|json| CString::new(json).ok())
        .map_or(std::ptr::null_mut(), CString::into_raw)
}

/// Download and apply an update.
///
/// # Safety
/// `download_url` and `sha256` must be valid non-null C strings.
#[no_mangle]
pub unsafe extern "C" fn prisma_apply_update(
    download_url: *const c_char,
    sha256: *const c_char,
) -> c_int {
    let url = cstr_to_str!(download_url);
    let hash = cstr_to_str!(sha256);
    match auto_update::apply(url, hash) {
        Ok(_) => PRISMA_OK,
        Err(_) => PRISMA_ERR_INTERNAL,
    }
}

// ── Ping ──────────────────────────────────────────────────────────────────────

/// Measure TCP connect latency to `server_addr` (host:port).
/// Returns JSON: `{"latency_ms": 42}` or `{"error": "..."}`.
/// Caller must call `prisma_free_string`.
///
/// # Safety
/// `server_addr` must be a valid non-null C string.
#[no_mangle]
pub unsafe extern "C" fn prisma_ping(server_addr: *const c_char) -> *mut c_char {
    let addr_str = match cstr_to_str_opt!(server_addr) {
        Some(s) => s,
        None => {
            let err = r#"{"error":"null server address"}"#;
            return CString::new(err).map_or(std::ptr::null_mut(), CString::into_raw);
        }
    };

    let result = ping_tcp(addr_str);
    let json = match result {
        Ok(ms) => format!(r#"{{"latency_ms":{ms}}}"#),
        Err(e) => format!(
            r#"{{"error":{}}}"#,
            serde_json::to_string(&e.to_string()).unwrap_or_default()
        ),
    };
    CString::new(json).map_or(std::ptr::null_mut(), CString::into_raw)
}

/// Measure TCP connect latency: 3 attempts, return median.
fn ping_tcp(addr: &str) -> Result<u64, Box<dyn std::error::Error>> {
    use std::net::ToSocketAddrs;
    use std::time::{Duration, Instant};

    let sock_addr = addr
        .to_socket_addrs()?
        .next()
        .ok_or("could not resolve address")?;

    let timeout = Duration::from_secs(5);
    let mut samples = Vec::with_capacity(3);

    for _ in 0..3 {
        let start = Instant::now();
        match std::net::TcpStream::connect_timeout(&sock_addr, timeout) {
            Ok(stream) => {
                let elapsed = start.elapsed();
                samples.push(elapsed.as_millis() as u64);
                drop(stream);
            }
            Err(e) => {
                // If any attempt fails, still try others
                if samples.is_empty() {
                    // Record error only if we have no successful samples yet
                    samples.push(0); // placeholder
                    tracing::debug!("ping attempt failed: {e}");
                }
            }
        }
    }

    // Filter out zero placeholders
    let mut valid: Vec<u64> = samples.into_iter().filter(|&v| v > 0).collect();
    if valid.is_empty() {
        return Err("all ping attempts failed".into());
    }
    valid.sort();
    // Return median
    Ok(valid[valid.len() / 2])
}

// ── PAC URL ──────────────────────────────────────────────────────────────────

/// Get the PAC (Proxy Auto-Configuration) URL. Caller must call `prisma_free_string`.
/// Returns the URL string based on the provided PAC port (0 = default 8070).
///
/// # Safety
/// `handle` must be valid.
#[no_mangle]
pub unsafe extern "C" fn prisma_get_pac_url(
    handle: *mut PrismaClient,
    pac_port: u16,
) -> *mut c_char {
    ffi_catch!(std::ptr::null_mut(), {
        let _ = handle;
        let port = if pac_port == 0 { 8070u16 } else { pac_port };
        let url = format!("http://127.0.0.1:{}/proxy.pac", port);
        match CString::new(url) {
            Ok(s) => s.into_raw(),
            Err(_) => std::ptr::null_mut(),
        }
    })
}

// ── Per-app proxy ─────────────────────────────────────────────────────────────

/// Global app filter — shared between FFI and the TUN handler.
static APP_FILTER: once_cell::sync::Lazy<Arc<prisma_client::tun::process::AppFilter>> =
    once_cell::sync::Lazy::new(|| Arc::new(prisma_client::tun::process::AppFilter::new()));

/// Get the global AppFilter instance for use by TUN handler integration.
pub fn global_app_filter() -> Arc<prisma_client::tun::process::AppFilter> {
    Arc::clone(&APP_FILTER)
}

/// Set the per-app proxy filter.
///
/// `app_names_json` must be a valid JSON string:
/// `{"mode": "include"|"exclude", "apps": ["Firefox", "Chrome"]}`
///
/// Pass NULL or empty string to disable.
///
/// # Safety
/// `app_names_json` must be a valid non-null C string (or NULL to disable).
#[no_mangle]
pub unsafe extern "C" fn prisma_set_per_app_filter(app_names_json: *const c_char) -> c_int {
    ffi_catch!(PRISMA_ERR_INTERNAL, {
        if app_names_json.is_null() {
            APP_FILTER.set_config(None);
            return PRISMA_OK;
        }
        let json_str = match unsafe { CStr::from_ptr(app_names_json) }.to_str() {
            Ok(s) => s,
            Err(_) => return PRISMA_ERR_INVALID_CONFIG,
        };

        if json_str.is_empty() {
            APP_FILTER.set_config(None);
            return PRISMA_OK;
        }

        match serde_json::from_str::<prisma_client::tun::process::AppFilterConfig>(json_str) {
            Ok(config) => {
                tracing::info!(
                    mode = ?config.mode,
                    apps = config.apps.len(),
                    "Per-app filter updated"
                );
                APP_FILTER.set_config(Some(config));
                PRISMA_OK
            }
            Err(e) => {
                tracing::error!("Invalid per-app filter JSON: {}", e);
                PRISMA_ERR_INVALID_CONFIG
            }
        }
    })
}

/// Get the current per-app filter config as JSON. Caller must call `prisma_free_string`.
/// Returns NULL if no filter is set.
#[no_mangle]
pub extern "C" fn prisma_get_per_app_filter() -> *mut c_char {
    ffi_catch!(std::ptr::null_mut(), {
        match APP_FILTER.get_config() {
            Some(config) => match serde_json::to_string(&config) {
                Ok(json) => CString::new(json).map_or(std::ptr::null_mut(), CString::into_raw),
                Err(_) => std::ptr::null_mut(),
            },
            None => std::ptr::null_mut(),
        }
    })
}

/// Get a list of currently running application names as JSON array.
/// Caller must call `prisma_free_string`.
#[no_mangle]
pub extern "C" fn prisma_get_running_apps() -> *mut c_char {
    ffi_catch!(std::ptr::null_mut(), {
        let apps = prisma_client::tun::process::list_running_apps();
        match serde_json::to_string(&apps) {
            Ok(json) => CString::new(json).map_or(std::ptr::null_mut(), CString::into_raw),
            Err(_) => std::ptr::null_mut(),
        }
    })
}

// ── Speed test ────────────────────────────────────────────────────────────────

/// Run a speed test (non-blocking). Result delivered via callback.
///
/// # Safety
/// `handle`, `server`, and `direction` must be valid non-null pointers.
#[no_mangle]
pub unsafe extern "C" fn prisma_speed_test(
    handle: *mut PrismaClient,
    server: *const c_char,
    duration_secs: u32,
    direction: *const c_char,
) -> c_int {
    if handle.is_null() {
        return PRISMA_ERR_INVALID_CONFIG;
    }
    let client = unsafe { &*handle };
    let server_str = cstr_to_str!(server);
    let dir_str = cstr_to_str!(direction);

    // Get the SOCKS5 proxy address from the active connection
    let socks5_addr = match client.connection.lock() {
        Ok(conn) => match conn.socks5_addr() {
            Some(addr) => addr.to_owned(),
            None => return PRISMA_ERR_NOT_CONNECTED,
        },
        Err(_) => return PRISMA_ERR_INTERNAL,
    };

    let server_owned = server_str.to_owned();
    let dir_owned = dir_str.to_owned();
    let cb_arc = Arc::clone(&client.callback);
    let runtime = Arc::clone(&client.runtime);

    runtime.spawn(async move {
        let result =
            connection::run_speed_test(&socks5_addr, &server_owned, duration_secs, &dir_owned)
                .await;
        let event = match result {
            Ok((dl, ul)) => format!(
                r#"{{"type":"speed_test_result","download_mbps":{:.2},"upload_mbps":{:.2}}}"#,
                dl, ul
            ),
            Err(e) => format!(
                r#"{{"type":"error","code":"speed_test_failed","msg":{}}}"#,
                serde_json::to_string(&e.to_string()).unwrap_or_default()
            ),
        };
        if let Ok(holder) = cb_arc.lock() {
            if let Some(func) = holder.func {
                if let Ok(cstr) = CString::new(event) {
                    unsafe { func(cstr.as_ptr(), holder.userdata) };
                }
            }
        }
    });

    PRISMA_OK
}
