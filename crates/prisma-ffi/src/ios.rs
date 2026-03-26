//! iOS/Swift bindings for Prisma FFI.
//!
//! This module provides iOS-specific functionality:
//! - Network Extension integration points
//! - VPN tunnel management helpers
//! - iOS-specific system configuration
//!
//! All functions use the standard C ABI for Swift interop via the bridging header.
//! The C header `crates/prisma-ffi/include/prisma_ffi.h` covers these declarations.

use std::ffi::{CStr, CString};
use std::os::raw::{c_char, c_int};

use crate::{
    PrismaClient, PRISMA_ERR_INTERNAL, PRISMA_ERR_INVALID_CONFIG, PRISMA_ERR_NULL_POINTER,
    PRISMA_OK,
};

// ── Network Extension helpers ────────────────────────────────────────────────

/// Configure the VPN tunnel parameters as JSON.
///
/// `tunnel_config_json` should contain:
/// ```json
/// {
///   "mtu": 1400,
///   "dns_servers": ["1.1.1.1", "8.8.8.8"],
///   "included_routes": ["0.0.0.0/0"],
///   "excluded_routes": ["server.ip.addr/32"]
/// }
/// ```
///
/// Returns the processed config as JSON (with defaults filled in).
/// Caller must call `prisma_free_string`.
///
/// # Safety
/// `tunnel_config_json` must be a valid non-null C string.
#[no_mangle]
pub unsafe extern "C" fn prisma_ios_prepare_tunnel_config(
    tunnel_config_json: *const c_char,
) -> *mut c_char {
    ffi_catch!(std::ptr::null_mut(), {
        if tunnel_config_json.is_null() {
            return std::ptr::null_mut();
        }
        // SAFETY: Caller guarantees pointer is valid.
        let json_str = match unsafe { CStr::from_ptr(tunnel_config_json) }.to_str() {
            Ok(s) => s,
            Err(_) => return std::ptr::null_mut(),
        };

        // Parse and fill defaults
        let mut config: serde_json::Value = match serde_json::from_str(json_str) {
            Ok(v) => v,
            Err(_) => return std::ptr::null_mut(),
        };

        // Apply iOS-specific defaults
        let obj = match config.as_object_mut() {
            Some(o) => o,
            None => return std::ptr::null_mut(),
        };

        if !obj.contains_key("mtu") {
            obj.insert("mtu".to_string(), serde_json::json!(1400));
        }
        if !obj.contains_key("dns_servers") {
            obj.insert(
                "dns_servers".to_string(),
                serde_json::json!(["1.1.1.1", "8.8.8.8"]),
            );
        }
        if !obj.contains_key("included_routes") {
            obj.insert(
                "included_routes".to_string(),
                serde_json::json!(["0.0.0.0/0", "::/0"]),
            );
        }

        match serde_json::to_string(&config) {
            Ok(s) => CString::new(s).map_or(std::ptr::null_mut(), CString::into_raw),
            Err(_) => std::ptr::null_mut(),
        }
    })
}

/// Get the file descriptor for the TUN device (iOS Network Extension).
///
/// On iOS, the TUN fd is provided by the NetworkExtension framework via
/// `NEPacketTunnelProvider`. This function returns a placeholder that
/// the Swift side should replace with the actual fd from
/// `packetTunnelProvider.packetFlow.value(forKey: "socket")`.
///
/// Returns -1 if not available.
#[no_mangle]
pub extern "C" fn prisma_ios_get_tun_fd() -> c_int {
    // The actual fd is managed by the iOS NetworkExtension framework.
    // This is a placeholder; the Swift layer provides the real fd.
    -1
}

/// Set the file descriptor for the TUN device (iOS Network Extension).
///
/// The Swift layer should call this with the fd obtained from
/// `NEPacketTunnelProvider.packetFlow`.
///
/// # Safety
/// `handle` must be valid. `fd` must be a valid file descriptor.
#[no_mangle]
pub unsafe extern "C" fn prisma_ios_set_tun_fd(handle: *mut PrismaClient, fd: c_int) -> c_int {
    ffi_catch!(PRISMA_ERR_INTERNAL, {
        if handle.is_null() {
            return PRISMA_ERR_NULL_POINTER;
        }
        if fd < 0 {
            return PRISMA_ERR_INVALID_CONFIG;
        }
        // SAFETY: Caller guarantees `handle` is valid from `prisma_create`.
        let _client = unsafe { &*handle };

        tracing::info!("iOS TUN fd set to {}", fd);

        // Store the fd for use by the TUN handler
        // In a full implementation, this would be passed to the TUN device layer
        IOS_TUN_FD.store(fd, std::sync::atomic::Ordering::SeqCst);

        PRISMA_OK
    })
}

/// Atomic storage for the iOS TUN file descriptor.
static IOS_TUN_FD: std::sync::atomic::AtomicI32 = std::sync::atomic::AtomicI32::new(-1);

/// Get the stored TUN fd (used internally by the TUN handler).
pub fn get_ios_tun_fd() -> Option<c_int> {
    let fd = IOS_TUN_FD.load(std::sync::atomic::Ordering::SeqCst);
    if fd >= 0 {
        Some(fd)
    } else {
        None
    }
}

// ── iOS system integration ───────────────────────────────────────────────────

/// Get the data directory path suitable for iOS sandboxed storage.
/// Caller must call `prisma_free_string`.
#[no_mangle]
pub extern "C" fn prisma_ios_get_data_dir() -> *mut c_char {
    ffi_catch!(std::ptr::null_mut(), {
        let dir = dirs::home_dir()
            .map(|h| h.join("Documents").join("Prisma"))
            .unwrap_or_else(|| std::path::PathBuf::from("."));

        // Create if doesn't exist
        let _ = std::fs::create_dir_all(&dir);

        match CString::new(dir.to_string_lossy().as_ref()) {
            Ok(s) => s.into_raw(),
            Err(_) => std::ptr::null_mut(),
        }
    })
}

/// Check if VPN permission has been granted on iOS.
/// Returns 1 if granted, 0 if not, -1 on error.
///
/// Note: Actual VPN permission check must be done in Swift via
/// `NETunnelProviderManager.loadAllFromPreferences`. This function
/// provides a cached status that the Swift layer should update.
#[no_mangle]
pub extern "C" fn prisma_ios_vpn_permission_status() -> c_int {
    IOS_VPN_PERMISSION.load(std::sync::atomic::Ordering::SeqCst)
}

/// Set the VPN permission status (called from Swift after checking).
#[no_mangle]
pub extern "C" fn prisma_ios_set_vpn_permission(granted: c_int) {
    IOS_VPN_PERMISSION.store(granted, std::sync::atomic::Ordering::SeqCst);
}

static IOS_VPN_PERMISSION: std::sync::atomic::AtomicI32 = std::sync::atomic::AtomicI32::new(-1);
