use tauri::image::Image;
use tauri::menu::{MenuBuilder, MenuItem, SubmenuBuilder};
use tauri::tray::TrayIconBuilder;
use tauri::{App, AppHandle, Emitter, Manager};

const TRAY_SIZE: u32 = 22;

fn icon_off() -> Image<'static> {
    Image::new(
        include_bytes!("../icons/tray-off.rgba"),
        TRAY_SIZE,
        TRAY_SIZE,
    )
}
fn icon_on() -> Image<'static> {
    Image::new(
        include_bytes!("../icons/tray-on.rgba"),
        TRAY_SIZE,
        TRAY_SIZE,
    )
}
fn icon_connecting() -> Image<'static> {
    Image::new(
        include_bytes!("../icons/tray-connecting.rgba"),
        TRAY_SIZE,
        TRAY_SIZE,
    )
}

// ── Formatting helpers ──────────────────────────────────────────────────────

fn fmt_speed(bps: f64) -> String {
    if bps < 1_024.0 {
        format!("{:.0} B/s", bps)
    } else if bps < 1_048_576.0 {
        format!("{:.1} KB/s", bps / 1_024.0)
    } else {
        format!("{:.1} MB/s", bps / 1_048_576.0)
    }
}

fn fmt_bytes(bytes: f64) -> String {
    if bytes < 1_024.0 {
        format!("{:.0} B", bytes)
    } else if bytes < 1_048_576.0 {
        format!("{:.1} KB", bytes / 1_024.0)
    } else if bytes < 1_073_741_824.0 {
        format!("{:.1} MB", bytes / 1_048_576.0)
    } else {
        format!("{:.2} GB", bytes / 1_073_741_824.0)
    }
}

fn fmt_uptime(secs: u64) -> String {
    if secs < 60 {
        format!("{secs}s")
    } else if secs < 3_600 {
        format!("{}m {}s", secs / 60, secs % 60)
    } else {
        format!("{}h {}m", secs / 3_600, (secs % 3_600) / 60)
    }
}

// ── Submenu builders ────────────────────────────────────────────────────────

fn build_proxy_mode_submenu<M: tauri::Manager<tauri::Wry>>(
    mgr: &M,
) -> tauri::Result<tauri::menu::Submenu<tauri::Wry>> {
    let current = crate::state::PROXY_MODE
        .lock()
        .ok()
        .map(|g| *g)
        .unwrap_or(0x02);
    let check = |flag: u32| if current == flag { "\u{2713} " } else { "  " };

    SubmenuBuilder::new(mgr, "Proxy Mode")
        .item(&MenuItem::with_id(
            mgr,
            "mode:system",
            format!("{}System Proxy", check(0x02)),
            true,
            None::<&str>,
        )?)
        .item(&MenuItem::with_id(
            mgr,
            "mode:direct",
            format!("{}Direct (SOCKS5 only)", check(0x01)),
            true,
            None::<&str>,
        )?)
        .item(&MenuItem::with_id(
            mgr,
            "mode:pac",
            format!("{}PAC", check(0x10)),
            true,
            None::<&str>,
        )?)
        .build()
}

fn build_speed_stats_submenu<M: tauri::Manager<tauri::Wry>>(
    mgr: &M,
) -> tauri::Result<tauri::menu::Submenu<tauri::Wry>> {
    let upload = MenuItem::with_id(
        mgr,
        "stat:upload",
        "\u{2191} Upload: 0 B/s",
        false,
        None::<&str>,
    )?;
    let download = MenuItem::with_id(
        mgr,
        "stat:download",
        "\u{2193} Download: 0 B/s",
        false,
        None::<&str>,
    )?;
    let total_up = MenuItem::with_id(mgr, "stat:total-up", "Total Up: 0 B", false, None::<&str>)?;
    let total_down = MenuItem::with_id(
        mgr,
        "stat:total-down",
        "Total Down: 0 B",
        false,
        None::<&str>,
    )?;
    let connections = MenuItem::with_id(
        mgr,
        "stat:connections",
        "Connections: 0",
        false,
        None::<&str>,
    )?;

    // Store references for live updates
    if let Ok(mut g) = crate::state::TRAY_STAT_UPLOAD.lock() {
        *g = Some(upload.clone());
    }
    if let Ok(mut g) = crate::state::TRAY_STAT_DOWNLOAD.lock() {
        *g = Some(download.clone());
    }
    if let Ok(mut g) = crate::state::TRAY_STAT_TOTAL_UP.lock() {
        *g = Some(total_up.clone());
    }
    if let Ok(mut g) = crate::state::TRAY_STAT_TOTAL_DOWN.lock() {
        *g = Some(total_down.clone());
    }
    if let Ok(mut g) = crate::state::TRAY_STAT_CONNECTIONS.lock() {
        *g = Some(connections.clone());
    }

    SubmenuBuilder::new(mgr, "Speed Stats")
        .item(&upload)
        .item(&download)
        .separator()
        .item(&total_up)
        .item(&total_down)
        .item(&connections)
        .build()
}

fn build_quick_toggles_submenu<M: tauri::Manager<tauri::Wry>>(
    mgr: &M,
) -> tauri::Result<tauri::menu::Submenu<tauri::Wry>> {
    let auto_connect = crate::state::TOGGLE_AUTO_CONNECT
        .lock()
        .ok()
        .map(|g| *g)
        .unwrap_or(false);
    let allow_lan = crate::state::TOGGLE_ALLOW_LAN
        .lock()
        .ok()
        .map(|g| *g)
        .unwrap_or(false);
    let tun = crate::state::TOGGLE_TUN
        .lock()
        .ok()
        .map(|g| *g)
        .unwrap_or(false);

    let check = |v: bool| if v { "\u{2713} " } else { "  " };

    SubmenuBuilder::new(mgr, "Quick Toggles")
        .item(&MenuItem::with_id(
            mgr,
            "toggle:autoConnect",
            format!("{}Auto-connect on startup", check(auto_connect)),
            true,
            None::<&str>,
        )?)
        .item(&MenuItem::with_id(
            mgr,
            "toggle:allowLan",
            format!("{}Allow LAN connections", check(allow_lan)),
            true,
            None::<&str>,
        )?)
        .item(&MenuItem::with_id(
            mgr,
            "toggle:tunEnabled",
            format!("{}TUN mode", check(tun)),
            true,
            None::<&str>,
        )?)
        .build()
}

fn build_recent_connections_submenu<M: tauri::Manager<tauri::Wry>>(
    mgr: &M,
) -> tauri::Result<tauri::menu::Submenu<tauri::Wry>> {
    let recent = crate::state::RECENT_CONNECTIONS
        .lock()
        .ok()
        .map(|g| g.clone())
        .unwrap_or_default();

    let mut sub = SubmenuBuilder::new(mgr, "Recent Connections");
    if recent.is_empty() {
        sub = sub.item(&MenuItem::with_id(
            mgr,
            "recent:empty",
            "(empty)",
            false,
            None::<&str>,
        )?);
    } else {
        for (i, dest) in recent.iter().enumerate() {
            sub = sub.item(&MenuItem::with_id(
                mgr,
                format!("recent:{i}"),
                dest.as_str(),
                false,
                None::<&str>,
            )?);
        }
    }
    sub.build()
}

// ── Build the full menu ─────────────────────────────────────────────────────

fn build_full_menu(app: &AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    let connect_label = crate::state::TRAY_CONNECT_ITEM
        .lock()
        .ok()
        .and_then(|guard| guard.as_ref().and_then(|item| item.text().ok()))
        .unwrap_or_else(|| "Connect".to_string());

    let connect = MenuItem::with_id(app, "tray-connect", connect_label, true, None::<&str>)?;
    if let Ok(mut guard) = crate::state::TRAY_CONNECT_ITEM.lock() {
        *guard = Some(connect.clone());
    }

    let show = MenuItem::with_id(app, "tray-show", "Show Window", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "tray-quit", "Quit Prisma", true, None::<&str>)?;
    let copy_addr = MenuItem::with_id(
        app,
        "tray-copy-addr",
        "Copy Proxy Address",
        true,
        None::<&str>,
    )?;
    let copy_terminal = MenuItem::with_id(
        app,
        "copy-terminal-proxy",
        "Copy Terminal Proxy",
        true,
        None::<&str>,
    )?;
    let check_updates = MenuItem::with_id(
        app,
        "tray-check-update",
        "Check for Updates",
        true,
        None::<&str>,
    )?;
    let update_providers = MenuItem::with_id(
        app,
        "tray-update-providers",
        "Update Rule Providers",
        true,
        None::<&str>,
    )?;

    let mode_sub = build_proxy_mode_submenu(app)?;
    let profiles_sub = build_profiles_submenu(app)?;
    let stats_sub = build_speed_stats_submenu(app)?;
    let recent_sub = build_recent_connections_submenu(app)?;
    let toggles_sub = build_quick_toggles_submenu(app)?;

    MenuBuilder::new(app)
        .item(&connect)
        .separator()
        .item(&mode_sub)
        .item(&profiles_sub)
        .separator()
        .item(&stats_sub)
        .item(&recent_sub)
        .separator()
        .item(&toggles_sub)
        .separator()
        .item(&update_providers)
        .item(&check_updates)
        .separator()
        .item(&copy_addr)
        .item(&copy_terminal)
        .separator()
        .item(&show)
        .item(&quit)
        .build()
}

fn build_profiles_submenu(app: &AppHandle) -> tauri::Result<tauri::menu::Submenu<tauri::Wry>> {
    let ptr = prisma_ffi::prisma_profiles_list_json();
    let profiles: Vec<serde_json::Value> = if ptr.is_null() {
        Vec::new()
    } else {
        let s = unsafe {
            let s = std::ffi::CStr::from_ptr(ptr).to_string_lossy().to_string();
            prisma_ffi::prisma_free_string(ptr as *mut _);
            s
        };
        serde_json::from_str(&s).unwrap_or_default()
    };

    let active_id = crate::state::ACTIVE_PROFILE_ID
        .lock()
        .ok()
        .and_then(|guard| guard.clone());

    let mut sub = SubmenuBuilder::new(app, "Profiles");
    if profiles.is_empty() {
        sub = sub.item(&MenuItem::with_id(
            app,
            "profile:none",
            "(no profiles)",
            false,
            None::<&str>,
        )?);
    } else {
        for p in &profiles {
            if let (Some(id), Some(name)) = (p["id"].as_str(), p["name"].as_str()) {
                let is_active = active_id.as_deref() == Some(id);
                let label = if is_active {
                    format!("\u{25CF} {name}")
                } else {
                    format!("  {name}")
                };
                sub = sub.item(&MenuItem::with_id(
                    app,
                    format!("profile:{id}"),
                    label,
                    true,
                    None::<&str>,
                )?);
            }
        }
    }
    sub.build()
}

// ── Handle menu events ──────────────────────────────────────────────────────

fn handle_menu_event(app: &AppHandle, event: tauri::menu::MenuEvent) {
    match event.id.as_ref() {
        "tray-quit" => {
            let _ = prisma_ffi::prisma_clear_system_proxy();
            app.exit(0);
        }
        "tray-show" => {
            if let Some(w) = app.get_webview_window("main") {
                if let Err(e) = w.show() {
                    tracing::warn!("Failed to show window: {}", e);
                }
                if let Err(e) = w.set_focus() {
                    tracing::warn!("Failed to set window focus: {}", e);
                }
            }
        }
        "tray-connect" => {
            if let Err(e) = app.emit("tray://connect-toggle", ()) {
                tracing::warn!("Failed to emit tray event: {}", e);
            }
        }
        "tray-copy-addr" => {
            if let Err(e) = app.emit("tray://copy-proxy-address", ()) {
                tracing::warn!("Failed to emit tray event: {}", e);
            }
        }
        "copy-terminal-proxy" => {
            if let Err(e) = app.emit("tray://copy-terminal-proxy", ()) {
                tracing::warn!("Failed to emit tray event: {}", e);
            }
        }
        "tray-check-update" => {
            if let Err(e) = app.emit("tray://check-update", ()) {
                tracing::warn!("Failed to emit tray event: {}", e);
            }
        }
        "tray-update-providers" => {
            if let Err(e) = app.emit("tray://update-providers", ()) {
                tracing::warn!("Failed to emit tray event: {}", e);
            }
        }
        "mode:system" => {
            if let Err(e) = app.emit("tray://proxy-mode-change", 0x02u32) {
                tracing::warn!("Failed to emit tray event: {}", e);
            }
        }
        "mode:direct" => {
            if let Err(e) = app.emit("tray://proxy-mode-change", 0x01u32) {
                tracing::warn!("Failed to emit tray event: {}", e);
            }
        }
        "mode:pac" => {
            if let Err(e) = app.emit("tray://proxy-mode-change", 0x10u32) {
                tracing::warn!("Failed to emit tray event: {}", e);
            }
        }
        id if id.starts_with("profile:") => {
            let profile_id = id["profile:".len()..].to_owned();
            if let Err(e) = app.emit("tray://profile-select", profile_id) {
                tracing::warn!("Failed to emit tray event: {}", e);
            }
        }
        id if id.starts_with("toggle:") => {
            let key = id["toggle:".len()..].to_owned();
            // Flip the current value
            let new_value = match key.as_str() {
                "autoConnect" => {
                    let mut g = match crate::state::TOGGLE_AUTO_CONNECT.lock() {
                        Ok(g) => g,
                        Err(_) => return,
                    };
                    *g = !*g;
                    *g
                }
                "allowLan" => {
                    let mut g = match crate::state::TOGGLE_ALLOW_LAN.lock() {
                        Ok(g) => g,
                        Err(_) => return,
                    };
                    *g = !*g;
                    *g
                }
                "tunEnabled" => {
                    let mut g = match crate::state::TOGGLE_TUN.lock() {
                        Ok(g) => g,
                        Err(_) => return,
                    };
                    *g = !*g;
                    *g
                }
                _ => return,
            };
            if let Err(e) = app.emit(
                "tray://toggle-setting",
                serde_json::json!({ "key": key, "value": new_value }),
            ) {
                tracing::warn!("Failed to emit tray event: {}", e);
            }
            // Rebuild menu to update checkmarks
            if let Ok(menu) = build_full_menu(app) {
                if let Some(tray) = app.tray_by_id("prisma-tray") {
                    if let Err(e) = tray.set_menu(Some(menu)) {
                        tracing::warn!("Failed to set tray menu: {}", e);
                    }
                }
            }
        }
        _ => {}
    }
}

// ── Public API ──────────────────────────────────────────────────────────────

pub fn setup(app: &App) -> tauri::Result<()> {
    let handle = app.handle();
    let menu = build_full_menu(handle)?;

    TrayIconBuilder::with_id("prisma-tray")
        .tooltip("Prisma")
        .icon(icon_off())
        .menu(&menu)
        .on_menu_event(handle_menu_event)
        .build(app)?;

    Ok(())
}

pub fn update_status(handle: &AppHandle, status: i32) {
    tracing::info!(status, "Tray status update");
    let icon = match status {
        2 => icon_on(),
        1 => icon_connecting(),
        _ => icon_off(),
    };

    if let Some(tray) = handle.tray_by_id("prisma-tray") {
        if let Err(e) = tray.set_icon(Some(icon)) {
            tracing::warn!("Failed to set tray icon: {}", e);
        }
    }

    if let Ok(guard) = crate::state::TRAY_CONNECT_ITEM.lock() {
        if let Some(item) = guard.as_ref() {
            let label = if status == 2 { "Disconnect" } else { "Connect" };
            if let Err(e) = item.set_text(label) {
                tracing::warn!("Failed to set tray item text: {}", e);
            }
        }
    }

    // When disconnecting, reset tooltip to simple form
    if status == 0 {
        if let Some(tray) = handle.tray_by_id("prisma-tray") {
            if let Err(e) = tray.set_tooltip(Some("Prisma \u{2014} Disconnected")) {
                tracing::warn!("Failed to set tray tooltip: {}", e);
            }
        }
    }
}

/// Parameters for updating the tray tooltip and speed stats.
pub struct TrayStatsUpdate<'a> {
    pub up_bps: f64,
    pub down_bps: f64,
    pub bytes_up: f64,
    pub bytes_down: f64,
    pub connections: u32,
    pub profile_name: &'a str,
    pub uptime_secs: u64,
}

/// Update the tray tooltip with rich connection info (Item 5) and update
/// the Speed Stats submenu items (Item 1).
pub fn update_tooltip(handle: &AppHandle, stats: &TrayStatsUpdate<'_>) {
    // Enhanced tooltip (Item 5)
    let tooltip = if stats.profile_name.is_empty() {
        format!(
            "Prisma \u{2014} Connected\n\u{2191} {} \u{2193} {}",
            fmt_speed(stats.up_bps),
            fmt_speed(stats.down_bps),
        )
    } else {
        format!(
            "Prisma \u{2014} Connected\nProfile: {}\nUptime: {}\n\u{2191} {} \u{2193} {}",
            stats.profile_name,
            fmt_uptime(stats.uptime_secs),
            fmt_speed(stats.up_bps),
            fmt_speed(stats.down_bps),
        )
    };
    if let Some(tray) = handle.tray_by_id("prisma-tray") {
        if let Err(e) = tray.set_tooltip(Some(&tooltip)) {
            tracing::warn!("Failed to set tray tooltip: {}", e);
        }
    }

    // Update Speed Stats submenu items (Item 1)
    if let Ok(g) = crate::state::TRAY_STAT_UPLOAD.lock() {
        if let Some(item) = g.as_ref() {
            if let Err(e) = item.set_text(format!("\u{2191} Upload: {}", fmt_speed(stats.up_bps))) {
                tracing::warn!("Failed to set tray stat text: {}", e);
            }
        }
    }
    if let Ok(g) = crate::state::TRAY_STAT_DOWNLOAD.lock() {
        if let Some(item) = g.as_ref() {
            if let Err(e) = item.set_text(format!("\u{2193} Download: {}", fmt_speed(stats.down_bps))) {
                tracing::warn!("Failed to set tray stat text: {}", e);
            }
        }
    }
    if let Ok(g) = crate::state::TRAY_STAT_TOTAL_UP.lock() {
        if let Some(item) = g.as_ref() {
            if let Err(e) = item.set_text(format!("Total Up: {}", fmt_bytes(stats.bytes_up))) {
                tracing::warn!("Failed to set tray stat text: {}", e);
            }
        }
    }
    if let Ok(g) = crate::state::TRAY_STAT_TOTAL_DOWN.lock() {
        if let Some(item) = g.as_ref() {
            if let Err(e) = item.set_text(format!("Total Down: {}", fmt_bytes(stats.bytes_down))) {
                tracing::warn!("Failed to set tray stat text: {}", e);
            }
        }
    }
    if let Ok(g) = crate::state::TRAY_STAT_CONNECTIONS.lock() {
        if let Some(item) = g.as_ref() {
            if let Err(e) = item.set_text(format!("Connections: {}", stats.connections)) {
                tracing::warn!("Failed to set tray stat text: {}", e);
            }
        }
    }
}

/// Rebuild the full tray menu (used when profiles, toggles, or recent connections change).
pub fn refresh_profiles(app: &AppHandle) -> tauri::Result<()> {
    let menu = build_full_menu(app)?;
    if let Some(tray) = app.tray_by_id("prisma-tray") {
        tray.set_menu(Some(menu))?;
    }
    Ok(())
}

/// Rebuild the Recent Connections submenu with the given destinations.
pub fn refresh_recent_connections(app: &AppHandle, destinations: Vec<String>) -> tauri::Result<()> {
    // Update global state
    if let Ok(mut g) = crate::state::RECENT_CONNECTIONS.lock() {
        *g = destinations;
    }
    // Rebuild full menu to pick up the new recent connections
    let menu = build_full_menu(app)?;
    if let Some(tray) = app.tray_by_id("prisma-tray") {
        tray.set_menu(Some(menu))?;
    }
    Ok(())
}
