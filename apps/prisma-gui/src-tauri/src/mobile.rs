//! Mobile-oriented Tauri commands for iOS and Android.
//!
//! These commands bridge the Tauri frontend to the `prisma_ffi` mobile lifecycle
//! functions (background/foreground transitions, network changes, battery, etc.).
//!
//! While primarily used on mobile, they compile on all targets so the handler
//! table stays uniform. On desktop the lifecycle calls are valid no-ops.

use crate::state::AppState;
use prisma_ffi::PRISMA_OK;

/// Helper: extract the raw `PrismaClient` pointer from managed state.
fn client_ptr(state: &tauri::State<AppState>) -> Result<*mut prisma_ffi::PrismaClient, String> {
    let raw = *state.client.lock().map_err(|_| "Failed to acquire client lock".to_string())?;
    if raw == 0 {
        return Err("no client".into());
    }
    Ok(raw as *mut prisma_ffi::PrismaClient)
}

// ── VPN permission ───────────────────────────────────────────────────────────

/// Check whether VPN permission is granted.
///
/// On Android this checks for `BIND_VPN_SERVICE`.
/// On iOS this checks if a VPN configuration profile exists.
/// On desktop this always returns `true`.
#[tauri::command]
pub fn check_vpn_permission() -> Result<bool, String> {
    // On Android, VPN permission is requested at runtime via VpnService.prepare().
    // On iOS, NetworkExtension entitlement is checked at build time.
    // On desktop, no VPN permission is needed (TUN uses admin privileges).
    Ok(true)
}

/// Request VPN permission from the operating system.
///
/// On Android this triggers `VpnService.prepare()`.
/// On iOS this is a no-op since permission is implicit with the entitlement.
/// On desktop this always returns `true`.
#[tauri::command]
pub fn request_vpn_permission() -> Result<bool, String> {
    // The actual VPN permission request is handled at the platform layer:
    // - Android: VpnService.prepare(context) in the Kotlin/Java wrapper
    // - iOS: NEVPNManager configuration in the Swift wrapper
    // - Desktop: not needed
    Ok(true)
}

// ── Network info ─────────────────────────────────────────────────────────────

/// Get the current network type.
///
/// Returns: 0 = disconnected, 1 = WiFi, 2 = cellular, 3 = ethernet.
///
/// On mobile this reads the value cached by the FFI layer (set via
/// `prisma_on_network_change`). On desktop defaults to ethernet (3).
#[tauri::command]
pub fn get_network_type(state: tauri::State<AppState>) -> Result<i32, String> {
    let client = client_ptr(&state)?;
    let net = unsafe { prisma_ffi::prisma_get_network_type(client) };
    Ok(net)
}

/// Notify the proxy engine of a network connectivity change.
///
/// `network_type`: 0 = disconnected, 1 = WiFi, 2 = cellular, 3 = ethernet.
#[tauri::command]
pub fn on_network_change(state: tauri::State<AppState>, network_type: i32) -> Result<(), String> {
    let client = client_ptr(&state)?;
    let rc = unsafe { prisma_ffi::prisma_on_network_change(client, network_type) };
    if rc == PRISMA_OK {
        Ok(())
    } else {
        Err(format!("prisma_on_network_change error {rc}"))
    }
}

// ── Battery ──────────────────────────────────────────────────────────────────

/// Battery status info returned to the frontend.
#[derive(serde::Serialize)]
pub struct BatteryStatus {
    /// Battery level as a percentage (0-100), or -1 if unknown.
    pub level: i32,
    /// Whether the device is currently charging.
    pub charging: bool,
    /// Whether low-power / battery saver mode is active.
    pub low_power_mode: bool,
}

/// Get the current battery status for adaptive behavior.
///
/// On desktop returns level=-1 (unknown), charging=false, low_power_mode=false.
/// On mobile a future platform plugin can provide real values.
#[tauri::command]
pub fn get_battery_status() -> Result<BatteryStatus, String> {
    Ok(BatteryStatus {
        level: -1,
        charging: false,
        low_power_mode: false,
    })
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

/// Notify the proxy engine that the app entered the background.
#[tauri::command]
pub fn on_app_background(state: tauri::State<AppState>) -> Result<(), String> {
    let client = client_ptr(&state)?;
    let rc = unsafe { prisma_ffi::prisma_on_background(client) };
    if rc == PRISMA_OK {
        Ok(())
    } else {
        Err(format!("prisma_on_background error {rc}"))
    }
}

/// Notify the proxy engine that the app returned to the foreground.
#[tauri::command]
pub fn on_app_foreground(state: tauri::State<AppState>) -> Result<(), String> {
    let client = client_ptr(&state)?;
    let rc = unsafe { prisma_ffi::prisma_on_foreground(client) };
    if rc == PRISMA_OK {
        Ok(())
    } else {
        Err(format!("prisma_on_foreground error {rc}"))
    }
}

/// Notify the proxy engine of a low-memory warning from the OS.
#[tauri::command]
pub fn on_memory_warning(state: tauri::State<AppState>) -> Result<(), String> {
    let client = client_ptr(&state)?;
    let rc = unsafe { prisma_ffi::prisma_on_memory_warning(client) };
    if rc == PRISMA_OK {
        Ok(())
    } else {
        Err(format!("prisma_on_memory_warning error {rc}"))
    }
}
