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

    pub fn set(_host: &str, _port: u16) -> Result<()> {
        // On Linux: set environment variables (best-effort)
        Ok(())
    }

    pub fn clear() -> Result<()> {
        Ok(())
    }
}

pub fn set(host: &str, port: u16) -> Result<()> {
    platform::set(host, port)
}

pub fn clear() -> Result<()> {
    platform::clear()
}
