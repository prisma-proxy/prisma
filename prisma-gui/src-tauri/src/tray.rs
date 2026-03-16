use tauri::{App, AppHandle, Emitter, Manager, Wry};
use tauri::menu::{MenuBuilder, MenuItem, SubmenuBuilder};
use tauri::tray::TrayIconBuilder;
use tauri::image::Image;

const TRAY_SIZE: u32 = 32;

fn icon_off()         -> Image<'static> { Image::new(include_bytes!("../icons/tray-off.rgba"),        TRAY_SIZE, TRAY_SIZE) }
fn icon_on()          -> Image<'static> { Image::new(include_bytes!("../icons/tray-on.rgba"),         TRAY_SIZE, TRAY_SIZE) }
fn icon_connecting()  -> Image<'static> { Image::new(include_bytes!("../icons/tray-connecting.rgba"), TRAY_SIZE, TRAY_SIZE) }

pub fn setup(app: &App) -> tauri::Result<()> {
    let connect = MenuItem::with_id(app, "tray-connect", "Connect", true, None::<&str>)?;
    // Store for label updates in update_status
    crate::state::TRAY_CONNECT_ITEM.set(connect.clone()).ok();

    let show = MenuItem::with_id(app, "tray-show", "Show Window", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "tray-quit", "Quit Prisma",  true, None::<&str>)?;

    let profiles_sub = SubmenuBuilder::new(app, "Profiles")
        .item(&MenuItem::with_id(app, "profile:none", "(no profiles)", false, None::<&str>)?)
        .build()?;

    let menu = MenuBuilder::new(app)
        .item(&connect)
        .item(&profiles_sub)
        .separator()
        .item(&show)
        .item(&quit)
        .build()?;

    TrayIconBuilder::with_id("prisma-tray")
        .tooltip("Prisma")
        .icon(icon_off())
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "tray-quit" => app.exit(0),
            "tray-show" => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            "tray-connect" => {
                let _ = app.emit("tray://connect-toggle", ());
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

    if let Some(item) = crate::state::TRAY_CONNECT_ITEM.get() {
        let label = if status == 2 { "Disconnect" } else { "Connect" };
        let _ = item.set_text(label);
    }
}

pub fn update_tooltip(handle: &AppHandle, up_bps: f64, down_bps: f64) {
    fn fmt(bps: f64) -> String {
        if bps < 1_024.0          { format!("{:.0} B/s",  bps) }
        else if bps < 1_048_576.0 { format!("{:.1} KB/s", bps / 1_024.0) }
        else                      { format!("{:.1} MB/s", bps / 1_048_576.0) }
    }
    let tooltip = format!("Prisma  \u{2191} {}  \u{2193} {}", fmt(up_bps), fmt(down_bps));
    if let Some(tray) = handle.tray_by_id("prisma-tray") {
        let _ = tray.set_tooltip(Some(&tooltip));
    }
}

pub fn refresh_profiles(app: &AppHandle) -> tauri::Result<()> {
    use std::ffi::CStr;

    let ptr = prisma_ffi::prisma_profiles_list_json();
    let profiles_json = if ptr.is_null() {
        "[]".to_string()
    } else {
        unsafe {
            let s = CStr::from_ptr(ptr).to_string_lossy().to_string();
            prisma_ffi::prisma_free_string(ptr as *mut _);
            s
        }
    };

    let profiles: Vec<serde_json::Value> =
        serde_json::from_str(&profiles_json).unwrap_or_default();

    let connect_label = crate::state::TRAY_CONNECT_ITEM
        .get()
        .and_then(|item| item.text().ok())
        .unwrap_or_else(|| "Connect".to_string());

    let connect = MenuItem::with_id(app, "tray-connect", connect_label, true, None::<&str>)?;
    let show    = MenuItem::with_id(app, "tray-show",    "Show Window", true, None::<&str>)?;
    let quit    = MenuItem::with_id(app, "tray-quit",    "Quit Prisma", true, None::<&str>)?;

    let mut sub = SubmenuBuilder::new(app, "Profiles");
    if profiles.is_empty() {
        sub = sub.item(&MenuItem::with_id(app, "profile:none", "(no profiles)", false, None::<&str>)?);
    } else {
        for p in &profiles {
            if let (Some(id), Some(name)) = (p["id"].as_str(), p["name"].as_str()) {
                sub = sub.item(&MenuItem::with_id(
                    app,
                    format!("profile:{id}"),
                    name,
                    true,
                    None::<&str>,
                )?);
            }
        }
    }
    let profiles_sub = sub.build()?;

    let menu = MenuBuilder::new(app)
        .item(&connect)
        .item(&profiles_sub)
        .separator()
        .item(&show)
        .item(&quit)
        .build()?;

    if let Some(tray) = app.tray_by_id("prisma-tray") {
        tray.set_menu(Some(menu))?;
    }

    Ok(())
}

// Keep the Wry type referenced so the module compiles even if unused on mobile
#[allow(dead_code)]
fn _wry_phantom(_: Wry) {}
