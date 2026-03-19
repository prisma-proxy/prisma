use anyhow::Result;

#[cfg(target_os = "windows")]
mod platform {
    use anyhow::Result;

    const INTERNET_OPTION_SETTINGS_CHANGED: u32 = 39;
    const INTERNET_OPTION_REFRESH: u32 = 37;

    extern "system" {
        fn InternetSetOptionW(
            h_internet: *mut std::ffi::c_void,
            dw_option: u32,
            lp_buffer: *mut std::ffi::c_void,
            dw_buffer_length: u32,
        ) -> i32;
    }

    pub fn set(host: &str, port: u16) -> Result<()> {
        use winreg::enums::*;
        use winreg::RegKey;

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let (key, _) =
            hkcu.create_subkey(r"Software\Microsoft\Windows\CurrentVersion\Internet Settings")?;
        key.set_value("ProxyEnable", &1u32)?;
        key.set_value("ProxyServer", &format!("{}:{}", host, port))?;

        unsafe {
            InternetSetOptionW(
                std::ptr::null_mut(),
                INTERNET_OPTION_SETTINGS_CHANGED,
                std::ptr::null_mut(),
                0,
            );
            InternetSetOptionW(
                std::ptr::null_mut(),
                INTERNET_OPTION_REFRESH,
                std::ptr::null_mut(),
                0,
            );
        }
        Ok(())
    }

    pub fn clear() -> Result<()> {
        use winreg::enums::*;
        use winreg::RegKey;

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let (key, _) =
            hkcu.create_subkey(r"Software\Microsoft\Windows\CurrentVersion\Internet Settings")?;
        key.set_value("ProxyEnable", &0u32)?;

        unsafe {
            InternetSetOptionW(
                std::ptr::null_mut(),
                INTERNET_OPTION_SETTINGS_CHANGED,
                std::ptr::null_mut(),
                0,
            );
            InternetSetOptionW(
                std::ptr::null_mut(),
                INTERNET_OPTION_REFRESH,
                std::ptr::null_mut(),
                0,
            );
        }
        Ok(())
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use anyhow::Result;
    use std::process::Command;

    pub fn set(host: &str, port: u16) -> Result<()> {
        // Use networksetup to set SOCKS proxy on all network services
        let output = Command::new("networksetup")
            .args(["-listallnetworkservices"])
            .output()?;
        let services = String::from_utf8_lossy(&output.stdout);
        for service in services.lines().skip(1) {
            let service = service.trim_start_matches('*').trim();
            if service.is_empty() {
                continue;
            }
            let _ = Command::new("networksetup")
                .args(["-setsocksfirewallproxy", service, host, &port.to_string()])
                .output();
            let _ = Command::new("networksetup")
                .args(["-setsocksfirewallproxystate", service, "on"])
                .output();
        }
        Ok(())
    }

    pub fn clear() -> Result<()> {
        let output = Command::new("networksetup")
            .args(["-listallnetworkservices"])
            .output()?;
        let services = String::from_utf8_lossy(&output.stdout);
        for service in services.lines().skip(1) {
            let service = service.trim_start_matches('*').trim();
            if service.is_empty() {
                continue;
            }
            let _ = Command::new("networksetup")
                .args(["-setsocksfirewallproxystate", service, "off"])
                .output();
        }
        Ok(())
    }
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
mod platform {
    use anyhow::Result;
    use std::process::Command;

    /// Detect which desktop environment is active.
    fn detect_desktop() -> Desktop {
        if let Ok(desktop) = std::env::var("XDG_CURRENT_DESKTOP") {
            let d = desktop.to_uppercase();
            if d.contains("GNOME")
                || d.contains("UNITY")
                || d.contains("CINNAMON")
                || d.contains("BUDGIE")
            {
                return Desktop::Gnome;
            }
            if d.contains("KDE") {
                return Desktop::Kde;
            }
        }
        if std::env::var("GNOME_DESKTOP_SESSION_ID").is_ok() {
            return Desktop::Gnome;
        }
        if std::env::var("KDE_FULL_SESSION").is_ok() {
            return Desktop::Kde;
        }
        Desktop::Unknown
    }

    enum Desktop {
        Gnome,
        Kde,
        Unknown,
    }

    pub fn set(host: &str, port: u16) -> Result<()> {
        let proxy = format!("socks5://{}:{}", host, port);

        match detect_desktop() {
            Desktop::Gnome => set_gnome(host, port)?,
            Desktop::Kde => set_kde(host, port)?,
            Desktop::Unknown => {}
        }

        // Always set environment variables as fallback (best-effort)
        std::env::set_var("all_proxy", &proxy);
        std::env::set_var("ALL_PROXY", &proxy);
        std::env::set_var("socks_proxy", &proxy);
        std::env::set_var("SOCKS_PROXY", &proxy);

        tracing::info!("Linux system proxy set to {}:{}", host, port);
        Ok(())
    }

    pub fn clear() -> Result<()> {
        match detect_desktop() {
            Desktop::Gnome => clear_gnome()?,
            Desktop::Kde => clear_kde()?,
            Desktop::Unknown => {}
        }

        std::env::remove_var("all_proxy");
        std::env::remove_var("ALL_PROXY");
        std::env::remove_var("socks_proxy");
        std::env::remove_var("SOCKS_PROXY");

        tracing::info!("Linux system proxy cleared");
        Ok(())
    }

    fn set_gnome(host: &str, port: u16) -> Result<()> {
        let port_str = port.to_string();
        let _ = Command::new("gsettings")
            .args(["set", "org.gnome.system.proxy.socks", "host", host])
            .output();
        let _ = Command::new("gsettings")
            .args(["set", "org.gnome.system.proxy.socks", "port", &port_str])
            .output();
        let _ = Command::new("gsettings")
            .args(["set", "org.gnome.system.proxy", "mode", "manual"])
            .output();
        Ok(())
    }

    fn clear_gnome() -> Result<()> {
        let _ = Command::new("gsettings")
            .args(["set", "org.gnome.system.proxy", "mode", "none"])
            .output();
        Ok(())
    }

    fn set_kde(host: &str, port: u16) -> Result<()> {
        let port_str = port.to_string();
        let kwrite = if Command::new("kwriteconfig6").arg("--help").output().is_ok() {
            "kwriteconfig6"
        } else {
            "kwriteconfig5"
        };

        let _ = Command::new(kwrite)
            .args([
                "--file",
                "kioslaverc",
                "--group",
                "Proxy Settings",
                "--key",
                "ProxyType",
                "1",
            ])
            .output();
        let _ = Command::new(kwrite)
            .args([
                "--file",
                "kioslaverc",
                "--group",
                "Proxy Settings",
                "--key",
                "socksProxy",
                &format!("socks://{}:{}", host, port_str),
            ])
            .output();
        let _ = Command::new("dbus-send")
            .args([
                "--type=signal",
                "/KIO/Scheduler",
                "org.kde.KIO.Scheduler.reparseSlaveConfiguration",
                "string:''",
            ])
            .output();
        Ok(())
    }

    fn clear_kde() -> Result<()> {
        let kwrite = if Command::new("kwriteconfig6").arg("--help").output().is_ok() {
            "kwriteconfig6"
        } else {
            "kwriteconfig5"
        };

        let _ = Command::new(kwrite)
            .args([
                "--file",
                "kioslaverc",
                "--group",
                "Proxy Settings",
                "--key",
                "ProxyType",
                "0",
            ])
            .output();
        let _ = Command::new("dbus-send")
            .args([
                "--type=signal",
                "/KIO/Scheduler",
                "org.kde.KIO.Scheduler.reparseSlaveConfiguration",
                "string:''",
            ])
            .output();
        Ok(())
    }
}

pub fn set(host: &str, port: u16) -> Result<()> {
    platform::set(host, port)
}

pub fn clear() -> Result<()> {
    platform::clear()
}
