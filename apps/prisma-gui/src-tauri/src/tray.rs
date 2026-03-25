use tauri::{App, AppHandle, Emitter, Manager};
use tauri::menu::{MenuBuilder, MenuItem, SubmenuBuilder};
use tauri::tray::TrayIconBuilder;
use tauri::image::Image;

const TRAY_SIZE: u32 = 22;

fn icon_off()         -> Image<'static> { Image::new(include_bytes!("../icons/tray-off.rgba"),        TRAY_SIZE, TRAY_SIZE) }
fn icon_on()          -> Image<'static> { Image::new(include_bytes!("../icons/tray-on.rgba"),         TRAY_SIZE, TRAY_SIZE) }
fn icon_connecting()  -> Image<'static> { Image::new(include_bytes!("../icons/tray-connecting.rgba"), TRAY_SIZE, TRAY_SIZE) }

fn build_proxy_mode_submenu<M: tauri::Manager<tauri::Wry>>(mgr: &M) -> tauri::Result<tauri::menu::Submenu<tauri::Wry>> {
    let current = crate::state::PROXY_MODE.lock().map(|g| *g).unwrap_or(0x02);
    let check = |flag: u32| if current == flag { "\u{2713} " } else { "  " };

    SubmenuBuilder::new(mgr, "Proxy Mode")
        .item(&MenuItem::with_id(mgr, "mode:system", format!("{}System Proxy", check(0x02)), true, None::<&str>)?)
        .item(&MenuItem::with_id(mgr, "mode:direct", format!("{}Direct (SOCKS5 only)", check(0x01)), true, None::<&str>)?)
        .item(&MenuItem::with_id(mgr, "mode:pac",    format!("{}PAC", check(0x10)), true, None::<&str>)?)
        .build()
}

pub fn setup(app: &App) -> tauri::Result<()> {
    let connect = MenuItem::with_id(app, "tray-connect", "Connect", true, None::<&str>)?;
    // Store for label updates in update_status
    if let Ok(mut guard) = crate::state::TRAY_CONNECT_ITEM.lock() {
        *guard = Some(connect.clone());
    }

    let show = MenuItem::with_id(app, "tray-show", "Show Window", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "tray-quit", "Quit Prisma",  true, None::<&str>)?;
    let copy_addr = MenuItem::with_id(app, "tray-copy-addr", "Copy Proxy Address", true, None::<&str>)?;
    let copy_terminal = MenuItem::with_id(app, "copy-terminal-proxy", "Copy Terminal Proxy", true, None::<&str>)?;
    let mode_sub = build_proxy_mode_submenu(app)?;

    let profiles_sub = SubmenuBuilder::new(app, "Profiles")
        .item(&MenuItem::with_id(app, "profile:none", "(no profiles)", false, None::<&str>)?)
        .build()?;

    let menu = MenuBuilder::new(app)
        .item(&connect)
        .separator()
        .item(&mode_sub)
        .item(&profiles_sub)
        .separator()
        .item(&copy_addr)
        .item(&copy_terminal)
        .separator()
        .item(&show)
        .item(&quit)
        .build()?;

    TrayIconBuilder::with_id("prisma-tray")
        .tooltip("Prisma")
        .icon(icon_off())
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "tray-quit" => {
                let _ = prisma_ffi::prisma_clear_system_proxy();
                app.exit(0);
            }
            "tray-show" => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            "tray-connect" => {
                let _ = app.emit("tray://connect-toggle", ());
            }
            "tray-copy-addr" => {
                let _ = app.emit("tray://copy-proxy-address", ());
            }
            "copy-terminal-proxy" => {
                let _ = app.emit("tray://copy-terminal-proxy", ());
            }
            "mode:system" => {
                let _ = app.emit("tray://proxy-mode-change", 0x02u32);
            }
            "mode:direct" => {
                let _ = app.emit("tray://proxy-mode-change", 0x01u32);
            }
            "mode:pac" => {
                let _ = app.emit("tray://proxy-mode-change", 0x10u32);
            }
            id if id.starts_with("profile:") => {
                let profile_id = id["profile:".len()..].to_owned();
                let _ = app.emit("tray://profile-select", profile_id);
            }
            _ => {}
        })
        .build(app)?;

    Ok(())
}

pub fn update_status(handle: &AppHandle, status: i32) {
    let icon = match status {
        2 => icon_on(),
        1 => icon_connecting(),
        _ => icon_off(),
    };

    if let Some(tray) = handle.tray_by_id("prisma-tray") {
        let _ = tray.set_icon(Some(icon));
    }

    if let Ok(guard) = crate::state::TRAY_CONNECT_ITEM.lock() {
        if let Some(item) = guard.as_ref() {
            let label = if status == 2 { "Disconnect" } else { "Connect" };
            let _ = item.set_text(label);
        }
    }
}

pub fn update_tooltip(handle: &AppHandle, up_bps: f64, down_bps: f64) {
    fn fmt(bps: f64) -> String {
        if bps < 1_024.0          { format!("{:.0} B/s",  bps) }
        else if bps < 1_048_576.0 { format!("{:.1} KB/s", bps / 1_024.0) }
        else                      { format!("{:.1} MB/s", bps / 1_048_576.0) }
    }
    let tooltip = format!("Prisma  Up: {}  Down: {}", fmt(up_bps), fmt(down_bps));
    if let Some(tray) = handle.tray_by_id("prisma-tray") {
        let _ = tray.set_tooltip(Some(&tooltip));
    }
}

pub fn refresh_profiles(app: &AppHandle) -> tauri::Result<()> {
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

    let connect_label = crate::state::TRAY_CONNECT_ITEM
        .lock()
        .ok()
        .and_then(|guard| guard.as_ref().and_then(|item| item.text().ok()))
        .unwrap_or_else(|| "Connect".to_string());

    let connect = MenuItem::with_id(app, "tray-connect", connect_label, true, None::<&str>)?;
    // Update the stored reference so update_status writes to the new item
    if let Ok(mut guard) = crate::state::TRAY_CONNECT_ITEM.lock() {
        *guard = Some(connect.clone());
    }
    let show      = MenuItem::with_id(app, "tray-show",      "Show Window",        true, None::<&str>)?;
    let quit      = MenuItem::with_id(app, "tray-quit",      "Quit Prisma",        true, None::<&str>)?;
    let copy_addr = MenuItem::with_id(app, "tray-copy-addr", "Copy Proxy Address", true, None::<&str>)?;
    let copy_terminal = MenuItem::with_id(app, "copy-terminal-proxy", "Copy Terminal Proxy", true, None::<&str>)?;

    let mut sub = SubmenuBuilder::new(app, "Profiles");
    if profiles.is_empty() {
        sub = sub.item(&MenuItem::with_id(app, "profile:none", "(no profiles)", false, None::<&str>)?);
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
    let profiles_sub = sub.build()?;
    let mode_sub = build_proxy_mode_submenu(app)?;

    let menu = MenuBuilder::new(app)
        .item(&connect)
        .separator()
        .item(&mode_sub)
        .item(&profiles_sub)
        .separator()
        .item(&copy_addr)
        .item(&copy_terminal)
        .separator()
        .item(&show)
        .item(&quit)
        .build()?;

    if let Some(tray) = app.tray_by_id("prisma-tray") {
        tray.set_menu(Some(menu))?;
    }

    Ok(())
}
