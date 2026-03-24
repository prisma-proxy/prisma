//! Android JNI wrappers for Prisma FFI.
//!
//! This module provides JNI-compatible entry points for the Android NDK.
//! All functions follow the JNI naming convention:
//!   `Java_com_prisma_core_PrismaCore_<method>`
//!
//! String conversion: Java `String` (UTF-16) -> Rust `&str` (UTF-8) -> C FFI.
//! Error handling: Rust errors are converted to Java exceptions via `JNIEnv::throw_new`.

use jni::objects::{JClass, JString};
use jni::sys::{jint, jlong, jstring};
use jni::JNIEnv;
use std::ffi::CString;

use crate::{PrismaClient, PRISMA_ERR_INTERNAL, PRISMA_ERR_NULL_POINTER, PRISMA_OK};

/// Helper: extract a Rust `String` from a JNI `JString`, or throw and return the fallback.
fn jstring_to_string(env: &mut JNIEnv, js: &JString) -> Result<String, jint> {
    env.get_string(js).map(|s| s.into()).map_err(|_| {
        let _ = env.throw_new(
            "java/lang/IllegalArgumentException",
            "Invalid string argument",
        );
        PRISMA_ERR_INTERNAL
    })
}

/// Helper: convert a Rust string to a JNI jstring. Returns null on failure.
fn string_to_jstring(env: &mut JNIEnv, s: &str) -> jstring {
    env.new_string(s)
        .map(|js| js.into_raw())
        .unwrap_or(std::ptr::null_mut())
}

/// Helper: throw a Java exception with the given message, returning the error code.
fn throw_error(env: &mut JNIEnv, msg: &str) -> jint {
    let _ = env.throw_new("java/lang/RuntimeException", msg);
    PRISMA_ERR_INTERNAL
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

/// Create a new PrismaClient handle. Returns a raw pointer as a jlong (opaque handle).
#[no_mangle]
pub extern "system" fn Java_com_prisma_core_PrismaCore_nativeCreate(
    _env: JNIEnv,
    _class: JClass,
) -> jlong {
    let ptr = crate::prisma_create();
    ptr as jlong
}

/// Destroy a PrismaClient handle.
#[no_mangle]
pub extern "system" fn Java_com_prisma_core_PrismaCore_nativeDestroy(
    _env: JNIEnv,
    _class: JClass,
    handle: jlong,
) {
    if handle == 0 {
        return;
    }
    // SAFETY: `handle` was returned by `nativeCreate` which gives a valid pointer.
    // The caller guarantees this is only called once per handle.
    unsafe { crate::prisma_destroy(handle as *mut PrismaClient) };
}

// ── Connection ───────────────────────────────────────────────────────────────

/// Connect using config JSON and proxy mode flags.
#[no_mangle]
pub extern "system" fn Java_com_prisma_core_PrismaCore_nativeConnect(
    mut env: JNIEnv,
    _class: JClass,
    handle: jlong,
    config_json: JString,
    modes: jint,
) -> jint {
    if handle == 0 {
        return throw_error(&mut env, "Null handle");
    }
    let config_str = match jstring_to_string(&mut env, &config_json) {
        Ok(s) => s,
        Err(code) => return code,
    };
    let c_str = match CString::new(config_str) {
        Ok(s) => s,
        Err(_) => return throw_error(&mut env, "Config contains null byte"),
    };
    // SAFETY: `handle` is a valid pointer from `nativeCreate`. `c_str` is a valid
    // null-terminated string that lives for the duration of this call.
    unsafe { crate::prisma_connect(handle as *mut PrismaClient, c_str.as_ptr(), modes as u32) }
}

/// Disconnect the current session.
#[no_mangle]
pub extern "system" fn Java_com_prisma_core_PrismaCore_nativeDisconnect(
    mut env: JNIEnv,
    _class: JClass,
    handle: jlong,
) -> jint {
    if handle == 0 {
        return throw_error(&mut env, "Null handle");
    }
    // SAFETY: `handle` is a valid pointer from `nativeCreate`.
    unsafe { crate::prisma_disconnect(handle as *mut PrismaClient) }
}

/// Get current connection status.
#[no_mangle]
pub extern "system" fn Java_com_prisma_core_PrismaCore_nativeGetStatus(
    _env: JNIEnv,
    _class: JClass,
    handle: jlong,
) -> jint {
    if handle == 0 {
        return crate::PRISMA_STATUS_DISCONNECTED;
    }
    // SAFETY: `handle` is a valid pointer from `nativeCreate`.
    unsafe { crate::prisma_get_status(handle as *mut PrismaClient) }
}

/// Get current stats as JSON string.
#[no_mangle]
pub extern "system" fn Java_com_prisma_core_PrismaCore_nativeGetStatsJson(
    mut env: JNIEnv,
    _class: JClass,
    handle: jlong,
) -> jstring {
    if handle == 0 {
        return std::ptr::null_mut();
    }
    // SAFETY: `handle` is a valid pointer from `nativeCreate`.
    let raw = unsafe { crate::prisma_get_stats_json(handle as *mut PrismaClient) };
    if raw.is_null() {
        return std::ptr::null_mut();
    }
    // SAFETY: `raw` was returned by `prisma_get_stats_json` which returns a valid CString.
    let c_str = unsafe { std::ffi::CStr::from_ptr(raw) };
    let result = match c_str.to_str() {
        Ok(s) => string_to_jstring(&mut env, s),
        Err(_) => std::ptr::null_mut(),
    };
    // SAFETY: `raw` was allocated by prisma_get_stats_json and must be freed.
    unsafe { crate::prisma_free_string(raw) };
    result
}

// ── Config ───────────────────────────────────────────────────────────────────

/// Set config from JSON. This is a convenience wrapper that parses and validates
/// the config without connecting.
#[no_mangle]
pub extern "system" fn Java_com_prisma_core_PrismaCore_nativeSetConfig(
    mut env: JNIEnv,
    _class: JClass,
    config_json: JString,
) -> jint {
    let config_str = match jstring_to_string(&mut env, &config_json) {
        Ok(s) => s,
        Err(code) => return code,
    };
    // Validate by parsing
    match serde_json::from_str::<prisma_core::config::client::ClientConfig>(&config_str) {
        Ok(_) => PRISMA_OK,
        Err(e) => {
            let _ = env.throw_new(
                "java/lang/IllegalArgumentException",
                format!("Invalid config: {}", e),
            );
            crate::PRISMA_ERR_INVALID_CONFIG
        }
    }
}

// ── Profile management ───────────────────────────────────────────────────────

/// List all profiles as JSON.
#[no_mangle]
pub extern "system" fn Java_com_prisma_core_PrismaCore_nativeProfilesList(
    mut env: JNIEnv,
    _class: JClass,
) -> jstring {
    let raw = crate::prisma_profiles_list_json();
    if raw.is_null() {
        return std::ptr::null_mut();
    }
    // SAFETY: `raw` was returned by `prisma_profiles_list_json` which returns a valid CString.
    let c_str = unsafe { std::ffi::CStr::from_ptr(raw) };
    let result = match c_str.to_str() {
        Ok(s) => string_to_jstring(&mut env, s),
        Err(_) => std::ptr::null_mut(),
    };
    // SAFETY: `raw` was allocated by prisma_profiles_list_json and must be freed.
    unsafe { crate::prisma_free_string(raw) };
    result
}

/// Save a profile from JSON.
#[no_mangle]
pub extern "system" fn Java_com_prisma_core_PrismaCore_nativeProfileSave(
    mut env: JNIEnv,
    _class: JClass,
    profile_json: JString,
) -> jint {
    let json_str = match jstring_to_string(&mut env, &profile_json) {
        Ok(s) => s,
        Err(code) => return code,
    };
    let c_str = match CString::new(json_str) {
        Ok(s) => s,
        Err(_) => return throw_error(&mut env, "Profile JSON contains null byte"),
    };
    // SAFETY: `c_str` is a valid null-terminated string.
    unsafe { crate::prisma_profile_save(c_str.as_ptr()) }
}

/// Delete a profile by ID.
#[no_mangle]
pub extern "system" fn Java_com_prisma_core_PrismaCore_nativeProfileDelete(
    mut env: JNIEnv,
    _class: JClass,
    id: JString,
) -> jint {
    let id_str = match jstring_to_string(&mut env, &id) {
        Ok(s) => s,
        Err(code) => return code,
    };
    let c_str = match CString::new(id_str) {
        Ok(s) => s,
        Err(_) => return throw_error(&mut env, "ID contains null byte"),
    };
    // SAFETY: `c_str` is a valid null-terminated string.
    unsafe { crate::prisma_profile_delete(c_str.as_ptr()) }
}

// ── VpnService JNI bridge ────────────────────────────────────────────────────
//
// These entry points are called from `PrismaVpnService.java` (the Android
// VPN service). They follow the JNI naming convention for that class:
//   `Java_com_prisma_client_PrismaVpnService_<method>`

/// Store the TUN file descriptor received from `VpnService.Builder.establish()`.
///
/// The Android VpnService creates the TUN interface, then passes the fd here
/// so the Rust TUN handler can read/write packets through it.
#[no_mangle]
pub extern "system" fn Java_com_prisma_client_PrismaVpnService_nativeSetTunFd(
    _env: JNIEnv,
    _class: JClass,
    handle: jlong,
    fd: jint,
) -> jint {
    if handle == 0 {
        return PRISMA_ERR_NULL_POINTER;
    }
    // SAFETY: `handle` is a valid pointer from `nativeCreate`.
    unsafe { crate::prisma_set_tun_fd(handle as *mut PrismaClient, fd) }
}

/// Notify the Rust engine of a network connectivity change detected by VpnService.
///
/// `network_type`: 0 = disconnected, 1 = WiFi, 2 = cellular, 3 = ethernet.
/// VpnService monitors ConnectivityManager callbacks and forwards them here.
#[no_mangle]
pub extern "system" fn Java_com_prisma_client_PrismaVpnService_nativeOnNetworkChange(
    _env: JNIEnv,
    _class: JClass,
    handle: jlong,
    network_type: jint,
) -> jint {
    if handle == 0 {
        return PRISMA_ERR_NULL_POINTER;
    }
    // SAFETY: `handle` is a valid pointer from `nativeCreate`.
    unsafe { crate::prisma_on_network_change(handle as *mut PrismaClient, network_type) }
}

/// Disconnect the client session from VpnService (e.g., when VPN is revoked).
///
/// Called from `PrismaVpnService.onRevoke()` or when the user stops the VPN
/// service via a stop intent.
#[no_mangle]
pub extern "system" fn Java_com_prisma_client_PrismaVpnService_nativeDisconnect(
    mut env: JNIEnv,
    _class: JClass,
    handle: jlong,
) -> jint {
    if handle == 0 {
        return throw_error(&mut env, "Null handle");
    }
    // Clear the TUN fd first so the engine knows the device is gone
    unsafe { crate::prisma_set_tun_fd(handle as *mut PrismaClient, -1) };
    // SAFETY: `handle` is a valid pointer from `nativeCreate`.
    unsafe { crate::prisma_disconnect(handle as *mut PrismaClient) }
}

// ── Mobile lifecycle (PrismaCore) ───────────────────────────────────────────

/// Notify network connectivity change.
#[no_mangle]
pub extern "system" fn Java_com_prisma_core_PrismaCore_nativeOnNetworkChange(
    _env: JNIEnv,
    _class: JClass,
    handle: jlong,
    network_type: jint,
) -> jint {
    if handle == 0 {
        return PRISMA_ERR_NULL_POINTER;
    }
    // SAFETY: `handle` is a valid pointer from `nativeCreate`.
    unsafe { crate::prisma_on_network_change(handle as *mut PrismaClient, network_type) }
}

/// Notify low-memory warning.
#[no_mangle]
pub extern "system" fn Java_com_prisma_core_PrismaCore_nativeOnMemoryWarning(
    _env: JNIEnv,
    _class: JClass,
    handle: jlong,
) -> jint {
    if handle == 0 {
        return PRISMA_ERR_NULL_POINTER;
    }
    // SAFETY: `handle` is a valid pointer from `nativeCreate`.
    unsafe { crate::prisma_on_memory_warning(handle as *mut PrismaClient) }
}

/// Notify app entering background.
#[no_mangle]
pub extern "system" fn Java_com_prisma_core_PrismaCore_nativeOnBackground(
    _env: JNIEnv,
    _class: JClass,
    handle: jlong,
) -> jint {
    if handle == 0 {
        return PRISMA_ERR_NULL_POINTER;
    }
    // SAFETY: `handle` is a valid pointer from `nativeCreate`.
    unsafe { crate::prisma_on_background(handle as *mut PrismaClient) }
}

/// Notify app returning to foreground.
#[no_mangle]
pub extern "system" fn Java_com_prisma_core_PrismaCore_nativeOnForeground(
    _env: JNIEnv,
    _class: JClass,
    handle: jlong,
) -> jint {
    if handle == 0 {
        return PRISMA_ERR_NULL_POINTER;
    }
    // SAFETY: `handle` is a valid pointer from `nativeCreate`.
    unsafe { crate::prisma_on_foreground(handle as *mut PrismaClient) }
}

/// Get traffic stats as JSON for status bar widgets.
#[no_mangle]
pub extern "system" fn Java_com_prisma_core_PrismaCore_nativeGetTrafficStats(
    mut env: JNIEnv,
    _class: JClass,
    handle: jlong,
) -> jstring {
    if handle == 0 {
        return std::ptr::null_mut();
    }
    // SAFETY: `handle` is a valid pointer from `nativeCreate`.
    let raw = unsafe { crate::prisma_get_traffic_stats(handle as *mut PrismaClient) };
    if raw.is_null() {
        return std::ptr::null_mut();
    }
    // SAFETY: `raw` was returned by `prisma_get_traffic_stats` which returns a valid CString.
    let c_str = unsafe { std::ffi::CStr::from_ptr(raw) };
    let result = match c_str.to_str() {
        Ok(s) => string_to_jstring(&mut env, s),
        Err(_) => std::ptr::null_mut(),
    };
    // SAFETY: `raw` was allocated by prisma_get_traffic_stats and must be freed.
    unsafe { crate::prisma_free_string(raw) };
    result
}

/// Get Prisma library version.
#[no_mangle]
pub extern "system" fn Java_com_prisma_core_PrismaCore_nativeVersion(
    mut env: JNIEnv,
    _class: JClass,
) -> jstring {
    let version = env!("CARGO_PKG_VERSION");
    string_to_jstring(&mut env, version)
}

// ── System proxy ─────────────────────────────────────────────────────────────

/// Set system proxy (Android uses VpnService, but this is available for completeness).
#[no_mangle]
pub extern "system" fn Java_com_prisma_core_PrismaCore_nativeSetSystemProxy(
    mut env: JNIEnv,
    _class: JClass,
    host: JString,
    port: jint,
) -> jint {
    let host_str = match jstring_to_string(&mut env, &host) {
        Ok(s) => s,
        Err(code) => return code,
    };
    let c_str = match CString::new(host_str) {
        Ok(s) => s,
        Err(_) => return throw_error(&mut env, "Host contains null byte"),
    };
    // SAFETY: `c_str` is a valid null-terminated string.
    unsafe { crate::prisma_set_system_proxy(c_str.as_ptr(), port as u16) }
}

/// Clear system proxy.
#[no_mangle]
pub extern "system" fn Java_com_prisma_core_PrismaCore_nativeClearSystemProxy(
    _env: JNIEnv,
    _class: JClass,
) -> jint {
    crate::prisma_clear_system_proxy()
}

/// Ping a server and return latency JSON.
#[no_mangle]
pub extern "system" fn Java_com_prisma_core_PrismaCore_nativePing(
    mut env: JNIEnv,
    _class: JClass,
    server_addr: JString,
) -> jstring {
    let addr_str = match jstring_to_string(&mut env, &server_addr) {
        Ok(s) => s,
        Err(_) => return std::ptr::null_mut(),
    };
    let c_str = match CString::new(addr_str) {
        Ok(s) => s,
        Err(_) => return std::ptr::null_mut(),
    };
    // SAFETY: `c_str` is a valid null-terminated string.
    let raw = unsafe { crate::prisma_ping(c_str.as_ptr()) };
    if raw.is_null() {
        return std::ptr::null_mut();
    }
    // SAFETY: `raw` was returned by `prisma_ping` which returns a valid CString.
    let result_cstr = unsafe { std::ffi::CStr::from_ptr(raw) };
    let result = match result_cstr.to_str() {
        Ok(s) => string_to_jstring(&mut env, s),
        Err(_) => std::ptr::null_mut(),
    };
    // SAFETY: `raw` was allocated by prisma_ping and must be freed.
    unsafe { crate::prisma_free_string(raw) };
    result
}
