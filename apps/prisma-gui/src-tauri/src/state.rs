use std::sync::Mutex;
use std::sync::OnceLock;

pub struct AppState {
    /// PrismaClient* stored as usize for Send-safety across threads.
    pub client: Mutex<usize>,
}

/// Global Tauri app handle — set once in setup, read in FFI callback.
pub static APP_HANDLE: OnceLock<tauri::AppHandle> = OnceLock::new();

/// The tray "Connect/Disconnect" menu item — stored so update_status can toggle its label.
/// Uses Mutex (not OnceLock) because refresh_profiles recreates the menu item.
#[cfg(desktop)]
pub static TRAY_CONNECT_ITEM: Mutex<Option<tauri::menu::MenuItem<tauri::Wry>>> = Mutex::new(None);

/// Active profile ID for tray bullet prefix.
pub static ACTIVE_PROFILE_ID: Mutex<Option<String>> = Mutex::new(None);

/// SOCKS5 port for "Copy Proxy Address" tray menu item.
pub static SOCKS5_PORT: Mutex<u16> = Mutex::new(0);

/// Current proxy mode for tray checkmark display (default: MODE_SYSTEM_PROXY = 0x02).
pub static PROXY_MODE: Mutex<u32> = Mutex::new(0x02);

// ── Speed Stats items (display-only, updated from bandwidth callback) ────────

#[cfg(desktop)]
pub static TRAY_STAT_UPLOAD: Mutex<Option<tauri::menu::MenuItem<tauri::Wry>>> = Mutex::new(None);
#[cfg(desktop)]
pub static TRAY_STAT_DOWNLOAD: Mutex<Option<tauri::menu::MenuItem<tauri::Wry>>> = Mutex::new(None);
#[cfg(desktop)]
pub static TRAY_STAT_TOTAL_UP: Mutex<Option<tauri::menu::MenuItem<tauri::Wry>>> = Mutex::new(None);
#[cfg(desktop)]
pub static TRAY_STAT_TOTAL_DOWN: Mutex<Option<tauri::menu::MenuItem<tauri::Wry>>> =
    Mutex::new(None);
#[cfg(desktop)]
pub static TRAY_STAT_CONNECTIONS: Mutex<Option<tauri::menu::MenuItem<tauri::Wry>>> =
    Mutex::new(None);

// ── Quick Toggle initial states (synced from frontend) ───────────────────────

#[cfg(desktop)]
pub static TOGGLE_AUTO_CONNECT: Mutex<bool> = Mutex::new(false);
#[cfg(desktop)]
pub static TOGGLE_ALLOW_LAN: Mutex<bool> = Mutex::new(false);
#[cfg(desktop)]
pub static TOGGLE_TUN: Mutex<bool> = Mutex::new(false);

// ── Recent Connections (last 5 destinations) ─────────────────────────────────

#[cfg(desktop)]
pub static RECENT_CONNECTIONS: Mutex<Vec<String>> = Mutex::new(Vec::new());
