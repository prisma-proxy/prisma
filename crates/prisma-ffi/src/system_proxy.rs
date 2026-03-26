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

    fn list_services() -> Result<Vec<String>> {
        let output = Command::new("networksetup")
            .args(["-listallnetworkservices"])
            .output()?;
        Ok(String::from_utf8_lossy(&output.stdout)
            .lines()
            .skip(1)
            .map(|s| s.trim_start_matches('*').trim().to_string())
            .filter(|s| !s.is_empty())
            .collect())
    }

    pub fn set(host: &str, port: u16) -> Result<()> {
        let services = list_services()?;
        let port_str = port.to_string();
        for service in &services {
            // Set HTTP proxy
            let _ = Command::new("networksetup")
                .args(["-setwebproxy", service, host, &port_str])
                .output();
            let _ = Command::new("networksetup")
                .args(["-setwebproxystate", service, "on"])
                .output();
            // Set HTTPS proxy
            let _ = Command::new("networksetup")
                .args(["-setsecurewebproxy", service, host, &port_str])
                .output();
            let _ = Command::new("networksetup")
                .args(["-setsecurewebproxystate", service, "on"])
                .output();
            // Disable SOCKS to avoid conflicts
            let _ = Command::new("networksetup")
                .args(["-setsocksfirewallproxystate", service, "off"])
                .output();
        }
        Ok(())
    }

    pub fn clear() -> Result<()> {
        let services = list_services()?;
        for service in &services {
            let _ = Command::new("networksetup")
                .args(["-setwebproxystate", service, "off"])
                .output();
            let _ = Command::new("networksetup")
                .args(["-setsecurewebproxystate", service, "off"])
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
        match detect_desktop() {
            Desktop::Gnome => set_gnome(host, port)?,
            Desktop::Kde => set_kde(host, port)?,
            Desktop::Unknown => {}
        }
        tracing::info!("Linux system proxy set to {}:{}", host, port);
        Ok(())
    }

    pub fn clear() -> Result<()> {
        match detect_desktop() {
            Desktop::Gnome => clear_gnome()?,
            Desktop::Kde => clear_kde()?,
            Desktop::Unknown => {}
        }
        tracing::info!("Linux system proxy cleared");
        Ok(())
    }

    fn set_gnome(host: &str, port: u16) -> Result<()> {
        let port_str = port.to_string();
        // Set HTTP proxy
        let _ = Command::new("gsettings")
            .args(["set", "org.gnome.system.proxy.http", "host", host])
            .output();
        let _ = Command::new("gsettings")
            .args(["set", "org.gnome.system.proxy.http", "port", &port_str])
            .output();
        // Set HTTPS proxy
        let _ = Command::new("gsettings")
            .args(["set", "org.gnome.system.proxy.https", "host", host])
            .output();
        let _ = Command::new("gsettings")
            .args(["set", "org.gnome.system.proxy.https", "port", &port_str])
            .output();
        // Enable manual proxy mode
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
                "httpProxy",
                &format!("http://{}:{}", host, port),
            ])
            .output();
        let _ = Command::new(kwrite)
            .args([
                "--file",
                "kioslaverc",
                "--group",
                "Proxy Settings",
                "--key",
                "httpsProxy",
                &format!("http://{}:{}", host, port),
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
