//! Process resolver: maps local TCP/UDP source ports to process names.
//!
//! Used by the per-app proxy feature to decide whether a packet should be
//! proxied or sent direct based on which application owns the socket.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tracing::debug;

/// Cached PID-to-app-name mapping with TTL.
struct CacheEntry {
    app_name: String,
    expires: Instant,
}

/// Resolves (protocol, local_port) to process/app name.
/// Caches results with a short TTL to avoid repeated system calls on every packet.
pub struct ProcessResolver {
    cache: Mutex<HashMap<(u8, u16), CacheEntry>>,
    ttl: Duration,
}

impl Default for ProcessResolver {
    fn default() -> Self {
        Self::new()
    }
}

impl ProcessResolver {
    pub fn new() -> Self {
        Self {
            cache: Mutex::new(HashMap::new()),
            ttl: Duration::from_secs(5),
        }
    }

    /// Look up the process name owning a local port for the given IP protocol.
    /// Returns `None` if the process cannot be determined.
    pub fn resolve(&self, protocol: u8, local_port: u16) -> Option<String> {
        let key = (protocol, local_port);

        // Check cache first
        if let Ok(cache) = self.cache.lock() {
            if let Some(entry) = cache.get(&key) {
                if entry.expires > Instant::now() {
                    return Some(entry.app_name.clone());
                }
            }
        }

        // Platform-specific resolution
        let app_name = self.platform_resolve(protocol, local_port)?;

        // Cache the result
        if let Ok(mut cache) = self.cache.lock() {
            cache.insert(
                key,
                CacheEntry {
                    app_name: app_name.clone(),
                    expires: Instant::now() + self.ttl,
                },
            );
            // Evict stale entries periodically
            if cache.len() > 500 {
                let now = Instant::now();
                cache.retain(|_, v| v.expires > now);
            }
        }

        Some(app_name)
    }

    /// Purge all cached entries.
    pub fn clear_cache(&self) {
        if let Ok(mut cache) = self.cache.lock() {
            cache.clear();
        }
    }

    #[cfg(target_os = "macos")]
    fn platform_resolve(&self, protocol: u8, local_port: u16) -> Option<String> {
        resolve_macos(protocol, local_port)
    }

    #[cfg(target_os = "linux")]
    fn platform_resolve(&self, protocol: u8, local_port: u16) -> Option<String> {
        resolve_linux(protocol, local_port)
    }

    #[cfg(target_os = "windows")]
    fn platform_resolve(&self, _protocol: u8, _local_port: u16) -> Option<String> {
        // Windows process resolution by port is handled via GetExtendedTcpTable
        // which requires iphlpapi. For now, return None — the list_running_apps()
        // function below provides the app browser functionality.
        None
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    fn platform_resolve(&self, _protocol: u8, _local_port: u16) -> Option<String> {
        None // Not supported on this platform
    }
}

// ── macOS implementation ─────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
fn resolve_macos(protocol: u8, local_port: u16) -> Option<String> {
    use std::process::Command;

    let proto_flag = match protocol {
        6 => "tcp",
        17 => "udp",
        _ => return None,
    };

    // Use lsof to find the process owning this port
    let output = Command::new("lsof")
        .args([
            "-i",
            &format!("{proto_flag}:{local_port}"),
            "-n",
            "-P",
            "-F",
            "c",
        ])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    // lsof -F c outputs lines like "cProcessName"
    for line in stdout.lines() {
        if let Some(name) = line.strip_prefix('c') {
            if !name.is_empty() {
                return Some(name.to_string());
            }
        }
    }
    None
}

// ── Linux implementation ─────────────────────────────────────────────────────

#[cfg(target_os = "linux")]
fn resolve_linux(protocol: u8, local_port: u16) -> Option<String> {
    let proc_net_file = match protocol {
        6 => "/proc/net/tcp",
        17 => "/proc/net/udp",
        _ => return None,
    };

    // Parse /proc/net/tcp or /proc/net/udp to find the inode
    let contents = std::fs::read_to_string(proc_net_file).ok()?;
    let port_hex = format!("{:04X}", local_port);

    let mut inode: Option<u64> = None;
    for line in contents.lines().skip(1) {
        let fields: Vec<&str> = line.split_whitespace().collect();
        if fields.len() < 10 {
            continue;
        }
        // local_address is field[1], format "IP:PORT" in hex
        let local_addr = fields[1];
        if let Some(port_part) = local_addr.split(':').nth(1) {
            if port_part.eq_ignore_ascii_case(&port_hex) {
                inode = fields[9].parse().ok();
                break;
            }
        }
    }

    let inode = inode?;
    if inode == 0 {
        return None;
    }

    // Scan /proc/*/fd/ to find which PID owns this inode
    let proc_dir = std::fs::read_dir("/proc").ok()?;
    for entry in proc_dir.flatten() {
        let name = entry.file_name();
        let pid_str = name.to_string_lossy();
        if !pid_str.chars().all(|c| c.is_ascii_digit()) {
            continue;
        }
        let fd_dir = format!("/proc/{}/fd", pid_str);
        if let Ok(fds) = std::fs::read_dir(&fd_dir) {
            for fd in fds.flatten() {
                if let Ok(link) = std::fs::read_link(fd.path()) {
                    let link_str = link.to_string_lossy();
                    if link_str.contains(&format!("socket:[{inode}]")) {
                        // Found the PID, now get the command name
                        let cmdline_path = format!("/proc/{}/cmdline", pid_str);
                        if let Ok(cmdline) = std::fs::read_to_string(&cmdline_path) {
                            let cmd = cmdline
                                .split('\0')
                                .next()
                                .unwrap_or("")
                                .rsplit('/')
                                .next()
                                .unwrap_or("");
                            if !cmd.is_empty() {
                                return Some(cmd.to_string());
                            }
                        }
                        // Fallback to /proc/<pid>/comm
                        let comm_path = format!("/proc/{}/comm", pid_str);
                        if let Ok(comm) = std::fs::read_to_string(&comm_path) {
                            let name = comm.trim();
                            if !name.is_empty() {
                                return Some(name.to_string());
                            }
                        }
                    }
                }
            }
        }
    }

    None
}

// ── App filter ───────────────────────────────────────────────────────────────

/// Per-app filter mode.
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AppFilterMode {
    /// Only proxy traffic from these apps; everything else goes direct.
    Include,
    /// Proxy all traffic except from these apps.
    Exclude,
}

/// Per-app proxy filter configuration.
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct AppFilterConfig {
    pub mode: AppFilterMode,
    pub apps: Vec<String>,
}

/// Runtime filter that decides whether a packet from a given app should be proxied.
pub struct AppFilter {
    config: Mutex<Option<AppFilterConfig>>,
    resolver: ProcessResolver,
}

impl Default for AppFilter {
    fn default() -> Self {
        Self::new()
    }
}

impl AppFilter {
    pub fn new() -> Self {
        Self {
            config: Mutex::new(None),
            resolver: ProcessResolver::new(),
        }
    }

    /// Update the filter configuration. Pass `None` to disable per-app filtering.
    pub fn set_config(&self, config: Option<AppFilterConfig>) {
        if let Ok(mut guard) = self.config.lock() {
            *guard = config;
        }
        self.resolver.clear_cache();
    }

    /// Returns the current filter configuration.
    pub fn get_config(&self) -> Option<AppFilterConfig> {
        self.config.lock().ok()?.clone()
    }

    /// Check whether a packet with the given protocol and source port should be proxied.
    /// Returns `true` if the packet should go through the proxy tunnel,
    /// `false` if it should go direct (bypass).
    ///
    /// If no filter is configured, always returns `true` (proxy everything).
    pub fn should_proxy(&self, protocol: u8, src_port: u16) -> bool {
        let config = match self.config.lock() {
            Ok(guard) => match guard.as_ref() {
                Some(c) => c.clone(),
                None => return true, // No filter → proxy everything
            },
            Err(_) => return true,
        };

        if config.apps.is_empty() {
            return match config.mode {
                AppFilterMode::Include => false, // Include mode with empty list → proxy nothing
                AppFilterMode::Exclude => true,  // Exclude mode with empty list → proxy everything
            };
        }

        let app_name = match self.resolver.resolve(protocol, src_port) {
            Some(name) => name,
            None => {
                debug!(
                    port = src_port,
                    "Could not resolve process for port, defaulting to proxy"
                );
                return true; // Can't determine app → proxy to be safe
            }
        };

        let app_lower = app_name.to_lowercase();
        let matched = config
            .apps
            .iter()
            .any(|a| app_lower.contains(&a.to_lowercase()));

        match config.mode {
            AppFilterMode::Include => matched, // Only proxy if app is in the include list
            AppFilterMode::Exclude => !matched, // Proxy unless app is in the exclude list
        }
    }
}

// ── Running apps discovery ───────────────────────────────────────────────────

/// List currently running application names. Used by the GUI to populate the app selector.
pub fn list_running_apps() -> Vec<String> {
    let mut apps = platform_list_apps();
    apps.sort();
    apps.dedup();
    apps
}

#[cfg(target_os = "macos")]
fn platform_list_apps() -> Vec<String> {
    use std::process::Command;

    let mut apps = Vec::new();

    // List running GUI apps via ps
    if let Ok(output) = Command::new("ps").args(["-eo", "comm="]).output() {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                let name = line.trim().rsplit('/').next().unwrap_or("").trim();
                if !name.is_empty()
                    && !name.starts_with('(')
                    && !name.starts_with('-')
                    && name.len() > 1
                {
                    apps.push(name.to_string());
                }
            }
        }
    }

    apps
}

#[cfg(target_os = "linux")]
fn platform_list_apps() -> Vec<String> {
    let mut apps = Vec::new();

    if let Ok(proc_dir) = std::fs::read_dir("/proc") {
        for entry in proc_dir.flatten() {
            let name = entry.file_name();
            let pid_str = name.to_string_lossy();
            if !pid_str.chars().all(|c| c.is_ascii_digit()) {
                continue;
            }
            let comm_path = format!("/proc/{}/comm", pid_str);
            if let Ok(comm) = std::fs::read_to_string(&comm_path) {
                let name = comm.trim().to_string();
                if !name.is_empty() {
                    apps.push(name);
                }
            }
        }
    }

    apps
}

#[cfg(target_os = "windows")]
fn platform_list_apps() -> Vec<String> {
    use std::collections::HashSet;

    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };

    let mut apps = Vec::new();
    let mut seen = HashSet::new();

    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot == windows_sys::Win32::Foundation::INVALID_HANDLE_VALUE {
            return apps;
        }

        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;

        if Process32FirstW(snapshot, &mut entry) != 0 {
            loop {
                // Convert the wide-char exe name to a String.
                let name_len = entry
                    .szExeFile
                    .iter()
                    .position(|&c| c == 0)
                    .unwrap_or(entry.szExeFile.len());
                let name = String::from_utf16_lossy(&entry.szExeFile[..name_len]);

                // Filter out system-level / uninteresting processes.
                let lower = name.to_lowercase();
                if !lower.is_empty()
                    && lower != "[system process]"
                    && lower != "system"
                    && lower != "idle"
                    && seen.insert(lower)
                {
                    apps.push(name);
                }

                if Process32NextW(snapshot, &mut entry) == 0 {
                    break;
                }
            }
        }

        CloseHandle(snapshot);
    }

    apps
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
fn platform_list_apps() -> Vec<String> {
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_app_filter_no_config_proxies_all() {
        let filter = AppFilter::new();
        // No config set → should proxy everything
        assert!(filter.should_proxy(6, 12345));
        assert!(filter.should_proxy(17, 54321));
    }

    #[test]
    fn test_app_filter_include_empty_proxies_nothing() {
        let filter = AppFilter::new();
        filter.set_config(Some(AppFilterConfig {
            mode: AppFilterMode::Include,
            apps: vec![],
        }));
        // Include mode with empty list → proxy nothing
        assert!(!filter.should_proxy(6, 12345));
    }

    #[test]
    fn test_app_filter_exclude_empty_proxies_all() {
        let filter = AppFilter::new();
        filter.set_config(Some(AppFilterConfig {
            mode: AppFilterMode::Exclude,
            apps: vec![],
        }));
        // Exclude mode with empty list → proxy everything
        assert!(filter.should_proxy(6, 12345));
    }

    #[test]
    fn test_app_filter_config_roundtrip() {
        let filter = AppFilter::new();
        assert!(filter.get_config().is_none());

        let config = AppFilterConfig {
            mode: AppFilterMode::Include,
            apps: vec!["Firefox".to_string(), "Chrome".to_string()],
        };
        filter.set_config(Some(config.clone()));

        let got = filter.get_config().unwrap();
        assert_eq!(got.mode, AppFilterMode::Include);
        assert_eq!(got.apps.len(), 2);
        assert_eq!(got.apps[0], "Firefox");

        filter.set_config(None);
        assert!(filter.get_config().is_none());
    }

    #[test]
    fn test_app_filter_config_serde() {
        let json = r#"{"mode":"include","apps":["Firefox","Chrome"]}"#;
        let config: AppFilterConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.mode, AppFilterMode::Include);
        assert_eq!(config.apps, vec!["Firefox", "Chrome"]);

        let json2 = r#"{"mode":"exclude","apps":["Safari"]}"#;
        let config2: AppFilterConfig = serde_json::from_str(json2).unwrap();
        assert_eq!(config2.mode, AppFilterMode::Exclude);
    }

    #[test]
    fn test_process_resolver_cache() {
        let resolver = ProcessResolver::new();
        // Resolving an unlikely port should return None (no process)
        // This just tests the cache path doesn't panic
        let _ = resolver.resolve(6, 1);
        resolver.clear_cache();
    }

    #[test]
    fn test_list_running_apps() {
        let apps = list_running_apps();
        // Should return a list (may be empty on CI)
        // Just verify it doesn't panic and returns sorted unique values
        for i in 1..apps.len() {
            assert!(apps[i] >= apps[i - 1], "apps should be sorted");
        }
    }
}
