//! prisma-ffi — C ABI shared library for Prisma GUI and mobile clients.
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
pub use profiles::ProfileManager;
use runtime::PrismaRuntime;

// ── Error codes ──────────────────────────────────────────────────────────────

pub const PRISMA_OK: c_int = 0;
pub const PRISMA_ERR_INVALID_CONFIG: c_int = 1;
pub const PRISMA_ERR_ALREADY_CONNECTED: c_int = 2;
pub const PRISMA_ERR_NOT_CONNECTED: c_int = 3;
pub const PRISMA_ERR_PERMISSION_DENIED: c_int = 4;
pub const PRISMA_ERR_INTERNAL: c_int = 5;
pub const PRISMA_ERR_NULL_POINTER: c_int = 6;

// ── Network type constants (mobile lifecycle) ────────────────────────────────

pub const PRISMA_NET_DISCONNECTED: i32 = 0;
pub const PRISMA_NET_WIFI: i32 = 1;
pub const PRISMA_NET_CELLULAR: i32 = 2;
pub const PRISMA_NET_ETHERNET: i32 = 3;

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
    /// Current network type for mobile lifecycle management.
    network_type: std::sync::atomic::AtomicI32,
    /// Whether the app is currently in the foreground.
    foreground: std::sync::atomic::AtomicBool,
    /// TUN file descriptor passed from Android VpnService or iOS NetworkExtension.
    /// -1 means not set. Only meaningful on mobile platforms.
    tun_fd: std::sync::atomic::AtomicI32,
}

pub struct CallbackHolder {
    pub func: PrismaCallback,
    pub userdata: *mut c_void,
}

// SAFETY: CallbackHolder is only accessed behind a Mutex. The `userdata` raw
// pointer is treated as an opaque token — it is never dereferenced on the Rust
// side. It is only passed back to the caller-provided callback function which
// is responsible for its own thread safety.
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
                // SAFETY: `func` is a caller-provided extern "C" function pointer set
                // via `prisma_set_callback`. The CString pointer is valid for the
                // duration of this call. `holder.userdata` is passed back as-is.
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
        // SAFETY: Caller guarantees `$ptr` is a valid, non-null, null-terminated
        // C string for the duration of this FFI call. We checked for null above.
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
            // SAFETY: Caller guarantees `$ptr` is a valid, non-null, null-terminated
            // C string. We checked for null above.
            unsafe { CStr::from_ptr($ptr) }.to_str().ok()
        }
    }};
}

// Platform-specific modules are declared after the macros above so that
// `ffi_catch!`, `cstr_to_str!`, and `cstr_to_str_opt!` are in textual scope.
#[cfg(feature = "android")]
mod android;
#[cfg(target_os = "ios")]
mod ios;

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
            network_type: std::sync::atomic::AtomicI32::new(PRISMA_NET_WIFI),
            foreground: std::sync::atomic::AtomicBool::new(true),
            tun_fd: std::sync::atomic::AtomicI32::new(-1),
        });
        Box::into_raw(client)
    })
}

/// Destroy a PrismaClient handle.
///
/// # Safety
/// `handle` must be a valid pointer returned by `prisma_create`, or NULL.
#[no_mangle]
pub unsafe extern "C" fn prisma_destroy(handle: *mut PrismaClient) {
    if handle.is_null() {
        return;
    }
    // SAFETY: Caller guarantees `handle` is a valid pointer returned by
    // `prisma_create` (which used `Box::into_raw`). We take ownership back.
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
            return PRISMA_ERR_NULL_POINTER;
        }
        // SAFETY: Caller guarantees `handle` is a valid pointer from `prisma_create`.
        let client = unsafe { &*handle };
        let config_str = cstr_to_str!(config_json);

        let config: prisma_core::config::client::ClientConfig =
            match serde_json::from_str(config_str) {
                Ok(c) => c,
                Err(e) => {
                    tracing::error!("Invalid config JSON: {}", e);
                    client.fire_event(
                        &serde_json::json!({
                            "type": "error",
                            "code": "invalid_config",
                            "msg": e.to_string(),
                        })
                        .to_string(),
                    );
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
                    // SAFETY: The callback function pointer was validated when set via
                    // `prisma_set_callback`. The CString is valid for this call duration.
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
                // The "connected" event is fired from inside the spawned task
                // (connection.rs) only after the client is actually ready.
                PRISMA_OK
            }
            Err(e) => {
                client.fire_event(
                    &serde_json::json!({
                        "type": "error",
                        "code": "connect_failed",
                        "msg": e.to_string(),
                    })
                    .to_string(),
                );
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
            return PRISMA_ERR_NULL_POINTER;
        }
        // SAFETY: Caller guarantees `handle` is valid from `prisma_create`.
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
        // Fire immediately for instant GUI feedback. The spawned task also fires
        // this event on completion (for crash/error cases). The GUI handler is
        // idempotent so duplicates are harmless.
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
    // SAFETY: Caller guarantees `handle` is valid. Only a shared reference is taken.
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
/// `handle` must be valid or NULL.
#[no_mangle]
pub unsafe extern "C" fn prisma_get_stats_json(handle: *mut PrismaClient) -> *mut c_char {
    if handle.is_null() {
        return std::ptr::null_mut();
    }
    // SAFETY: Caller guarantees `handle` is valid. Only a shared reference is taken.
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
    // SAFETY: Caller guarantees `s` was returned by a prisma_* function,
    // meaning it was created by `CString::into_raw()`. We reclaim ownership.
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
    // SAFETY: Caller guarantees `handle` is valid. Only a shared reference is taken.
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

/// Import profiles from a subscription URL. Returns JSON ImportResult. Caller must free.
///
/// # Safety
/// `url` must be a valid non-null C string.
#[no_mangle]
pub unsafe extern "C" fn prisma_import_subscription(url: *const c_char) -> *mut c_char {
    let url_str = match cstr_to_str_opt!(url) {
        Some(s) => s,
        None => return std::ptr::null_mut(),
    };
    match profiles::ProfileManager::import_from_url(url_str) {
        Ok(result) => serde_json::to_string(&result)
            .ok()
            .and_then(|s| CString::new(s).ok())
            .map_or(std::ptr::null_mut(), CString::into_raw),
        Err(_) => std::ptr::null_mut(),
    }
}

/// Refresh all subscription profiles. Returns JSON ImportResult. Caller must free.
#[no_mangle]
pub extern "C" fn prisma_refresh_subscriptions() -> *mut c_char {
    match profiles::ProfileManager::refresh_all() {
        Ok(result) => serde_json::to_string(&result)
            .ok()
            .and_then(|s| CString::new(s).ok())
            .map_or(std::ptr::null_mut(), CString::into_raw),
        Err(_) => std::ptr::null_mut(),
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
        return PRISMA_ERR_NULL_POINTER;
    }
    // SAFETY: Both pointers verified non-null above per caller contract.
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
            // SAFETY: `out_json` is valid and non-null per caller contract.
            unsafe { *out_json = s.into_raw() };
            PRISMA_OK
        }
        Err(_) => PRISMA_ERR_INTERNAL,
    }
}

/// Decode a QR code from an image file. Writes the decoded string content to `*out`.
/// Caller must call `prisma_free_string` on the output.
///
/// # Safety
/// `path` must be a valid non-null C string. `out` must be a valid non-null pointer.
#[no_mangle]
pub unsafe extern "C" fn prisma_decode_qr_image(
    path: *const c_char,
    out: *mut *mut c_char,
) -> c_int {
    if path.is_null() || out.is_null() {
        return PRISMA_ERR_NULL_POINTER;
    }
    let path_str = match unsafe { CStr::from_ptr(path) }.to_str() {
        Ok(s) => s,
        Err(_) => return PRISMA_ERR_INVALID_CONFIG,
    };
    let content = match qr::decode_qr_from_image(path_str) {
        Ok(c) => c,
        Err(_) => return PRISMA_ERR_INTERNAL,
    };
    match CString::new(content) {
        Ok(s) => {
            unsafe { *out = s.into_raw() };
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
        // SAFETY: Pointer verified non-null above. Caller guarantees valid C string.
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
        return PRISMA_ERR_NULL_POINTER;
    }
    // SAFETY: Caller guarantees `handle` is valid from `prisma_create`.
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
                    // SAFETY: callback function pointer was set by caller; CString is valid.
                    unsafe { func(cstr.as_ptr(), holder.userdata) };
                }
            }
        }
    });

    PRISMA_OK
}

// ── Mobile lifecycle ─────────────────────────────────────────────────────────

/// Get the current network type cached by the library.
///
/// Returns: 0 = disconnected, 1 = WiFi, 2 = cellular, 3 = ethernet.
/// Returns -1 if `handle` is NULL.
///
/// # Safety
/// `handle` must be a valid pointer from `prisma_create`, or NULL.
#[no_mangle]
pub unsafe extern "C" fn prisma_get_network_type(handle: *mut PrismaClient) -> c_int {
    if handle.is_null() {
        return -1;
    }
    let client = unsafe { &*handle };
    client
        .network_type
        .load(std::sync::atomic::Ordering::Relaxed)
}

/// Notify the library of a network connectivity change (mobile).
///
/// `network_type`: 0 = disconnected, 1 = WiFi, 2 = cellular, 3 = ethernet.
///
/// On transition, the library will notify active connections and fire events.
///
/// # Safety
/// `handle` must be a valid pointer from `prisma_create`, or NULL.
#[no_mangle]
pub unsafe extern "C" fn prisma_on_network_change(
    handle: *mut PrismaClient,
    network_type: i32,
) -> c_int {
    ffi_catch!(PRISMA_ERR_INTERNAL, {
        if handle.is_null() {
            return PRISMA_ERR_NULL_POINTER;
        }
        if !(PRISMA_NET_DISCONNECTED..=PRISMA_NET_ETHERNET).contains(&network_type) {
            return PRISMA_ERR_INVALID_CONFIG;
        }

        // SAFETY: Caller guarantees `handle` is valid from `prisma_create`.
        let client = unsafe { &*handle };
        let prev = client
            .network_type
            .swap(network_type, std::sync::atomic::Ordering::Relaxed);

        if prev == network_type {
            return PRISMA_OK;
        }

        let net_name = match network_type {
            PRISMA_NET_DISCONNECTED => "disconnected",
            PRISMA_NET_WIFI => "wifi",
            PRISMA_NET_CELLULAR => "cellular",
            PRISMA_NET_ETHERNET => "ethernet",
            _ => "unknown",
        };

        tracing::info!(
            previous = prev,
            current = network_type,
            "Network type changed to {}",
            net_name
        );

        client.fire_event(
            &serde_json::json!({
                "type": "network_changed",
                "network": net_name,
                "previous": prev,
            })
            .to_string(),
        );

        if let Ok(conn) = client.connection.lock() {
            if conn.is_connected() {
                if network_type == PRISMA_NET_DISCONNECTED {
                    client.fire_event(
                        r#"{"type":"warning","code":"network_lost","msg":"Network connectivity lost, waiting for recovery"}"#,
                    );
                } else {
                    client.fire_event(
                        r#"{"type":"info","code":"network_reconnect","msg":"Network changed, reconnecting transport"}"#,
                    );
                }
            }
        }

        PRISMA_OK
    })
}

/// Notify the library of a low-memory warning from the OS (mobile).
///
/// The library will release non-essential caches and reduce buffer sizes.
///
/// # Safety
/// `handle` must be a valid pointer from `prisma_create`, or NULL.
#[no_mangle]
pub unsafe extern "C" fn prisma_on_memory_warning(handle: *mut PrismaClient) -> c_int {
    ffi_catch!(PRISMA_ERR_INTERNAL, {
        if handle.is_null() {
            return PRISMA_ERR_NULL_POINTER;
        }
        // SAFETY: Caller guarantees `handle` is valid from `prisma_create`.
        let client = unsafe { &*handle };

        tracing::warn!("Memory warning received — releasing caches");
        client.fire_event(
            r#"{"type":"info","code":"memory_warning","msg":"Releasing caches due to memory pressure"}"#,
        );

        if let Ok(mut guard) = client.stats_poller.lock() {
            if let Some(poller) = guard.take() {
                poller.stop();
                tracing::info!("Stats poller stopped due to memory pressure");
            }
        }

        PRISMA_OK
    })
}

/// Notify the library that the app has entered the background (mobile).
///
/// The library will reduce stats polling and defer non-essential operations.
///
/// # Safety
/// `handle` must be a valid pointer from `prisma_create`, or NULL.
#[no_mangle]
pub unsafe extern "C" fn prisma_on_background(handle: *mut PrismaClient) -> c_int {
    ffi_catch!(PRISMA_ERR_INTERNAL, {
        if handle.is_null() {
            return PRISMA_ERR_NULL_POINTER;
        }
        // SAFETY: Caller guarantees `handle` is valid from `prisma_create`.
        let client = unsafe { &*handle };

        client
            .foreground
            .store(false, std::sync::atomic::Ordering::Relaxed);
        tracing::info!("App entering background — reducing activity");

        if let Ok(mut guard) = client.stats_poller.lock() {
            if let Some(poller) = guard.take() {
                poller.stop();
            }
        }

        client.fire_event(r#"{"type":"lifecycle","state":"background"}"#);
        PRISMA_OK
    })
}

/// Notify the library that the app has returned to the foreground (mobile).
///
/// The library will restore full stats polling and check connection health.
///
/// # Safety
/// `handle` must be a valid pointer from `prisma_create`, or NULL.
#[no_mangle]
pub unsafe extern "C" fn prisma_on_foreground(handle: *mut PrismaClient) -> c_int {
    ffi_catch!(PRISMA_ERR_INTERNAL, {
        if handle.is_null() {
            return PRISMA_ERR_NULL_POINTER;
        }
        // SAFETY: Caller guarantees `handle` is valid from `prisma_create`.
        let client = unsafe { &*handle };

        client
            .foreground
            .store(true, std::sync::atomic::Ordering::Relaxed);
        tracing::info!("App returning to foreground — restoring full operation");

        if let Ok(conn_guard) = client.connection.lock() {
            if conn_guard.is_connected() {
                drop(conn_guard);
                let cb_arc = Arc::clone(&client.callback);
                let conn_arc = Arc::clone(&client.connection);
                let poller =
                    stats_poller::StatsPoller::start(Arc::clone(&client.runtime), conn_arc, cb_arc);
                if let Ok(mut guard) = client.stats_poller.lock() {
                    if let Some(old) = guard.take() {
                        old.stop();
                    }
                    *guard = Some(poller);
                }
            }
        }

        client.fire_event(r#"{"type":"lifecycle","state":"foreground"}"#);
        PRISMA_OK
    })
}

/// Get traffic statistics as a JSON string for mobile status bar widgets.
///
/// Returns JSON: `{"bytes_up": N, "bytes_down": N, "connected": bool}`
/// Caller must call `prisma_free_string` on the result.
/// Returns NULL if `handle` is NULL or not connected.
///
/// # Safety
/// `handle` must be a valid pointer from `prisma_create`, or NULL.
#[no_mangle]
pub unsafe extern "C" fn prisma_get_traffic_stats(handle: *mut PrismaClient) -> *mut c_char {
    ffi_catch!(std::ptr::null_mut(), {
        if handle.is_null() {
            return std::ptr::null_mut();
        }
        // SAFETY: Caller guarantees `handle` is valid from `prisma_create`.
        let client = unsafe { &*handle };
        match client.connection.lock() {
            Ok(mut conn) => {
                let json = conn.get_stats_json();
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&json) {
                    let bytes_up = val.get("bytes_up").and_then(|v| v.as_u64()).unwrap_or(0);
                    let bytes_down = val.get("bytes_down").and_then(|v| v.as_u64()).unwrap_or(0);
                    let connected = conn.is_connected();
                    let compact = format!(
                        r#"{{"bytes_up":{},"bytes_down":{},"connected":{}}}"#,
                        bytes_up, bytes_down, connected
                    );
                    CString::new(compact).map_or(std::ptr::null_mut(), CString::into_raw)
                } else {
                    std::ptr::null_mut()
                }
            }
            Err(_) => std::ptr::null_mut(),
        }
    })
}

/// Set the TUN file descriptor received from Android VpnService or iOS NetworkExtension.
///
/// On Android, `PrismaVpnService` creates the TUN device and passes the fd
/// here via JNI. On iOS, the NetworkExtension packet tunnel provides the fd.
/// The stored fd is later consumed by the TUN handler when in VPN mode.
///
/// # Safety
/// `handle` must be a valid pointer from `prisma_create`. `fd` must be a valid
/// open file descriptor, or -1 to clear.
#[no_mangle]
pub unsafe extern "C" fn prisma_set_tun_fd(handle: *mut PrismaClient, fd: c_int) -> c_int {
    ffi_catch!(PRISMA_ERR_INTERNAL, {
        if handle.is_null() {
            return PRISMA_ERR_NULL_POINTER;
        }
        // SAFETY: Caller guarantees `handle` is valid from `prisma_create`.
        let client = unsafe { &*handle };

        let prev = client.tun_fd.swap(fd, std::sync::atomic::Ordering::Relaxed);

        // Bridge to the static atomic in prisma-client so
        // wait_for_mobile_tun_fd() receives the fd.
        #[cfg(any(target_os = "android", target_os = "ios"))]
        prisma_client::set_mobile_tun_fd(fd);

        tracing::info!(previous = prev, current = fd, "TUN fd updated");

        client.fire_event(
            &serde_json::json!({
                "type": "tun_fd_set",
                "fd": fd,
                "previous": prev,
            })
            .to_string(),
        );

        PRISMA_OK
    })
}

/// Get the currently stored TUN file descriptor.
///
/// Returns the fd, or -1 if not set / handle is NULL.
///
/// # Safety
/// `handle` must be a valid pointer from `prisma_create`, or NULL.
#[no_mangle]
pub unsafe extern "C" fn prisma_get_tun_fd(handle: *mut PrismaClient) -> c_int {
    if handle.is_null() {
        return -1;
    }
    // SAFETY: Caller guarantees `handle` is valid from `prisma_create`.
    let client = unsafe { &*handle };
    client.tun_fd.load(std::sync::atomic::Ordering::Relaxed)
}

/// Get the Prisma library version string.
/// Returns a statically allocated string — do NOT call `prisma_free_string` on it.
#[no_mangle]
pub extern "C" fn prisma_version() -> *const c_char {
    // SAFETY: This is a static null-terminated byte string literal. The pointer
    // is valid for the entire program lifetime.
    static VERSION: &[u8] = concat!(env!("CARGO_PKG_VERSION"), "\0").as_bytes();
    VERSION.as_ptr() as *const c_char
}

// ── Proxy groups ─────────────────────────────────────────────────────────────

/// Global proxy group manager — lazily initialized.
static PROXY_GROUP_MANAGER: once_cell::sync::Lazy<
    Arc<Mutex<Option<prisma_core::proxy_group::ProxyGroupManager>>>,
> = once_cell::sync::Lazy::new(|| Arc::new(Mutex::new(None)));

/// Initialize proxy groups from a JSON array of ProxyGroupConfig.
///
/// # Safety
/// `config_json` must be a valid non-null C string.
#[no_mangle]
pub unsafe extern "C" fn prisma_proxy_groups_init(config_json: *const c_char) -> c_int {
    ffi_catch!(PRISMA_ERR_INTERNAL, {
        let json_str = match cstr_to_str_opt!(config_json) {
            Some(s) => s,
            None => return PRISMA_ERR_INVALID_CONFIG,
        };
        let configs: Vec<prisma_core::proxy_group::ProxyGroupConfig> =
            match serde_json::from_str(json_str) {
                Ok(c) => c,
                Err(_) => return PRISMA_ERR_INVALID_CONFIG,
            };
        let manager = prisma_core::proxy_group::ProxyGroupManager::new(configs);
        if let Ok(mut guard) = PROXY_GROUP_MANAGER.lock() {
            *guard = Some(manager);
        }
        PRISMA_OK
    })
}

/// List all proxy groups as JSON. Caller must call `prisma_free_string`.
#[no_mangle]
pub extern "C" fn prisma_proxy_groups_list() -> *mut c_char {
    ffi_catch!(std::ptr::null_mut(), {
        let guard = match PROXY_GROUP_MANAGER.lock() {
            Ok(g) => g,
            Err(_) => return std::ptr::null_mut(),
        };
        let manager = match guard.as_ref() {
            Some(m) => m,
            None => {
                // Return empty array if no groups initialized
                return CString::new("[]").map_or(std::ptr::null_mut(), CString::into_raw);
            }
        };
        // Use the current tokio runtime to block on async list
        let groups = match tokio::runtime::Handle::try_current() {
            Ok(h) => std::thread::scope(|_| h.block_on(manager.list())),
            Err(_) => {
                // No runtime available, return empty
                return CString::new("[]").map_or(std::ptr::null_mut(), CString::into_raw);
            }
        };
        serde_json::to_string(&groups)
            .ok()
            .and_then(|s| CString::new(s).ok())
            .map_or(std::ptr::null_mut(), CString::into_raw)
    })
}

/// Select a server in a proxy group.
///
/// # Safety
/// `group_name` and `server` must be valid non-null C strings.
#[no_mangle]
pub unsafe extern "C" fn prisma_proxy_group_select(
    group_name: *const c_char,
    server: *const c_char,
) -> c_int {
    ffi_catch!(PRISMA_ERR_INTERNAL, {
        let gn = match cstr_to_str_opt!(group_name) {
            Some(s) => s,
            None => return PRISMA_ERR_INVALID_CONFIG,
        };
        let srv = match cstr_to_str_opt!(server) {
            Some(s) => s,
            None => return PRISMA_ERR_INVALID_CONFIG,
        };
        let guard = match PROXY_GROUP_MANAGER.lock() {
            Ok(g) => g,
            Err(_) => return PRISMA_ERR_INTERNAL,
        };
        let manager = match guard.as_ref() {
            Some(m) => m,
            None => return PRISMA_ERR_NOT_CONNECTED,
        };
        let ok = match tokio::runtime::Handle::try_current() {
            Ok(h) => std::thread::scope(|_| h.block_on(manager.select(gn, srv))),
            Err(_) => false,
        };
        if ok {
            PRISMA_OK
        } else {
            PRISMA_ERR_INVALID_CONFIG
        }
    })
}

/// Test all servers in a proxy group. Returns JSON array of LatencyResult.
/// Caller must call `prisma_free_string`.
///
/// # Safety
/// `group_name` must be a valid non-null C string.
#[no_mangle]
pub unsafe extern "C" fn prisma_proxy_group_test(group_name: *const c_char) -> *mut c_char {
    ffi_catch!(std::ptr::null_mut(), {
        let gn = match cstr_to_str_opt!(group_name) {
            Some(s) => s,
            None => return std::ptr::null_mut(),
        };
        let guard = match PROXY_GROUP_MANAGER.lock() {
            Ok(g) => g,
            Err(_) => return std::ptr::null_mut(),
        };
        let manager = match guard.as_ref() {
            Some(m) => m,
            None => return std::ptr::null_mut(),
        };
        let results = match tokio::runtime::Handle::try_current() {
            Ok(h) => std::thread::scope(|_| h.block_on(manager.test_group(gn))),
            Err(_) => None,
        };
        match results {
            Some(r) => serde_json::to_string(&r)
                .ok()
                .and_then(|s| CString::new(s).ok())
                .map_or(std::ptr::null_mut(), CString::into_raw),
            None => std::ptr::null_mut(),
        }
    })
}

// ── Port forwarding ──────────────────────────────────────────────────────────

/// List all active port forwards with their status and metrics as a JSON array.
///
/// Returns a JSON array of objects with fields:
/// `name`, `remote_port`, `local_addr`, `active_connections`, `total_connections`,
/// `bytes_up`, `bytes_down`, `last_connection_at`, `registered`.
///
/// Caller must call `prisma_free_string` on the result.
/// Returns `"[]"` if no forwards are active.
///
/// # Safety
/// `handle` must be a valid pointer from `prisma_create`, or NULL.
#[no_mangle]
pub unsafe extern "C" fn prisma_port_forwards_list(handle: *mut PrismaClient) -> *mut c_char {
    ffi_catch!(std::ptr::null_mut(), {
        let _ = handle; // handle reserved for future per-client forward managers
        let json = match tokio::runtime::Handle::try_current() {
            Ok(h) => std::thread::scope(|_| {
                h.block_on(prisma_client::forward::get_forward_metrics_json())
            }),
            Err(_) => "[]".to_owned(),
        };
        CString::new(json).map_or(std::ptr::null_mut(), CString::into_raw)
    })
}

/// Dynamically add a port forward at runtime.
///
/// `json` must be a valid JSON object matching PortForwardConfig, e.g.:
/// ```json
/// {"name":"ssh","local_addr":"127.0.0.1:22","remote_port":2222,"enabled":true}
/// ```
///
/// Returns PRISMA_OK on success, or an error code.
///
/// # Safety
/// `handle` must be valid. `json` must be a valid non-null C string.
#[no_mangle]
pub unsafe extern "C" fn prisma_port_forward_add(
    handle: *mut PrismaClient,
    json: *const c_char,
) -> c_int {
    ffi_catch!(PRISMA_ERR_INTERNAL, {
        if handle.is_null() {
            return PRISMA_ERR_NULL_POINTER;
        }
        let json_str = cstr_to_str!(json);

        let config: prisma_core::config::client::PortForwardConfig =
            match serde_json::from_str(json_str) {
                Ok(c) => c,
                Err(e) => {
                    tracing::error!("Invalid port forward JSON: {}", e);
                    return PRISMA_ERR_INVALID_CONFIG;
                }
            };

        let mgr = match prisma_client::forward::global_forward_manager() {
            Some(m) => m,
            None => {
                tracing::error!("Port forwarding is not active");
                return PRISMA_ERR_NOT_CONNECTED;
            }
        };

        // Send Add control message (non-blocking try_send to avoid deadlock at FFI boundary)
        match mgr
            .control_tx
            .try_send(prisma_client::forward::ForwardControl::Add(Box::new(
                config,
            ))) {
            Ok(_) => PRISMA_OK,
            Err(e) => {
                tracing::error!("Failed to send add-forward control: {}", e);
                PRISMA_ERR_INTERNAL
            }
        }
    })
}

/// Dynamically remove a port forward by remote port at runtime.
///
/// Returns PRISMA_OK on success, or an error code.
///
/// # Safety
/// `handle` must be valid.
#[no_mangle]
pub unsafe extern "C" fn prisma_port_forward_remove(
    handle: *mut PrismaClient,
    remote_port: u16,
) -> c_int {
    ffi_catch!(PRISMA_ERR_INTERNAL, {
        if handle.is_null() {
            return PRISMA_ERR_NULL_POINTER;
        }

        let mgr = match prisma_client::forward::global_forward_manager() {
            Some(m) => m,
            None => {
                tracing::error!("Port forwarding is not active");
                return PRISMA_ERR_NOT_CONNECTED;
            }
        };

        match mgr
            .control_tx
            .try_send(prisma_client::forward::ForwardControl::Remove(remote_port))
        {
            Ok(_) => PRISMA_OK,
            Err(e) => {
                tracing::error!("Failed to send remove-forward control: {}", e);
                PRISMA_ERR_INTERNAL
            }
        }
    })
}
