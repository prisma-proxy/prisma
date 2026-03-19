mod commands;
mod state;

#[cfg(desktop)]
mod tray;

use std::ffi::CStr;
use tauri::Emitter;

unsafe extern "C" fn on_ffi_event(
    json: *const std::ffi::c_char,
    _userdata: *mut std::ffi::c_void,
) {
    if json.is_null() { return; }
    let s = CStr::from_ptr(json).to_string_lossy().to_string();
    if let Some(handle) = state::APP_HANDLE.get() {
        // Update tray (desktop only) — parse before emit to avoid clone
        #[cfg(desktop)]
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&s) {
            match parsed["type"].as_str() {
                Some("status_changed") => {
                    let code = parsed["code"].as_i64().unwrap_or(0) as i32;
                    tray::update_status(handle, code);
                }
                Some("stats") => {
                    let up   = parsed["speed_up_bps"].as_f64().unwrap_or(0.0);
                    let down = parsed["speed_down_bps"].as_f64().unwrap_or(0.0);
                    tray::update_tooltip(handle, up, down);
                }
                _ => {}
            }
        }

        // Forward to frontend
        let _ = handle.emit("prisma://event", s);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let client = prisma_ffi::prisma_create();
    if !client.is_null() {
        unsafe {
            prisma_ffi::prisma_set_callback(
                client,
                Some(on_ffi_event),
                std::ptr::null_mut(),
            );
        }
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(state::AppState {
            client: std::sync::Mutex::new(client as usize),
        })
        .setup(|app| {
            state::APP_HANDLE.set(app.handle().clone()).ok();

            #[cfg(desktop)]
            tray::setup(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::connect,
            commands::disconnect,
            commands::get_status,
            commands::get_stats,
            commands::list_profiles,
            commands::save_profile,
            commands::delete_profile,
            commands::profile_to_qr,
            commands::profile_from_qr,
            commands::profile_to_uri,
            commands::profile_config_to_toml,
            commands::check_update,
            commands::apply_update,
            commands::ping_server,
            commands::speed_test,
            commands::get_pac_url,
            commands::set_system_proxy,
            commands::clear_system_proxy,
            commands::refresh_tray_profiles,
            commands::set_active_profile_id,
            commands::set_tray_port,
            commands::quit_app,
            commands::set_tray_proxy_mode,
            commands::set_per_app_filter,
            commands::clear_per_app_filter,
            commands::get_running_apps,
            commands::get_per_app_filter,
            commands::import_subscription,
            commands::refresh_subscriptions,
            commands::get_profiles_dir,
            commands::open_folder,
            commands::download_file,
        ])
        .run(tauri::generate_context!())
        .expect("tauri run failed");
}
