use std::sync::Mutex;
use std::sync::OnceLock;

pub struct AppState {
    /// PrismaClient* stored as usize for Send-safety across threads.
    pub client: Mutex<usize>,
}

/// Global Tauri app handle — set once in setup, read in FFI callback.
pub static APP_HANDLE: OnceLock<tauri::AppHandle> = OnceLock::new();

/// The tray "Connect/Disconnect" menu item — stored so update_status can toggle its label.
pub static TRAY_CONNECT_ITEM: OnceLock<tauri::menu::MenuItem<tauri::Wry>> = OnceLock::new();
