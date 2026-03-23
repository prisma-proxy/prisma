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
pub static TRAY_CONNECT_ITEM: Mutex<Option<tauri::menu::MenuItem<tauri::Wry>>> = Mutex::new(None);

/// Active profile ID for tray bullet prefix.
pub static ACTIVE_PROFILE_ID: Mutex<Option<String>> = Mutex::new(None);

/// SOCKS5 port for "Copy Proxy Address" tray menu item.
pub static SOCKS5_PORT: Mutex<u16> = Mutex::new(0);

/// Current proxy mode for tray checkmark display (default: MODE_SYSTEM_PROXY = 0x02).
pub static PROXY_MODE: Mutex<u32> = Mutex::new(0x02);
