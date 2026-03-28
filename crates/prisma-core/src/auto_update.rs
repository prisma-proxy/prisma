use anyhow::Result;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");
const RELEASES_API: &str = "https://api.github.com/repos/prisma-proxy/prisma/releases/latest";
/// GUI releases live in a separate repo.
pub const GUI_RELEASES_API: &str =
    "https://api.github.com/repos/prisma-proxy/prisma-gui/releases/latest";

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateInfo {
    pub version: String,
    pub url: String,
    pub changelog: String,
    #[serde(default)]
    pub sha256: Option<String>,
}

#[derive(Deserialize)]
struct GithubRelease {
    tag_name: String,
    body: Option<String>,
    assets: Vec<GithubAsset>,
}

#[derive(Deserialize)]
struct GithubAsset {
    name: String,
    browser_download_url: String,
}

/// Build a ureq agent, optionally routing through an HTTP proxy.
fn build_agent(proxy_port: u16) -> Result<ureq::Agent> {
    if proxy_port > 0 {
        let url = format!("http://127.0.0.1:{proxy_port}");
        let proxy = ureq::Proxy::new(&url)?;
        Ok(ureq::Agent::config_builder()
            .proxy(Some(proxy))
            .build()
            .into())
    } else {
        Ok(ureq::Agent::new_with_defaults())
    }
}

/// Check GitHub releases for a newer version. Returns `None` if already up to date.
pub fn check() -> Result<Option<UpdateInfo>> {
    check_with_proxy(0)
}

/// Check GitHub releases for a newer version, optionally via proxy.
pub fn check_with_proxy(proxy_port: u16) -> Result<Option<UpdateInfo>> {
    check_repo_with_proxy(RELEASES_API, None, proxy_port)
}

/// Check a specific GitHub repo's releases for a newer version.
///
/// `releases_url`: full GitHub API URL (e.g., `GUI_RELEASES_API`)
/// `asset_hint`: optional substring to match in asset names. If `None`, uses
///   the default `platform_asset_suffix()`.
pub fn check_repo_with_proxy(
    releases_url: &str,
    asset_hint: Option<&str>,
    proxy_port: u16,
) -> Result<Option<UpdateInfo>> {
    check_repo_with_version(releases_url, asset_hint, proxy_port, CURRENT_VERSION)
}

/// Check a specific GitHub repo's releases for a newer version,
/// using a custom current version string instead of the crate version.
///
/// Useful when the caller has its own version (e.g., the GUI app)
/// that differs from prisma-core's compiled version.
pub fn check_repo_with_version(
    releases_url: &str,
    asset_hint: Option<&str>,
    proxy_port: u16,
    current_version: &str,
) -> Result<Option<UpdateInfo>> {
    let agent = build_agent(proxy_port)?;
    let resp: GithubRelease = agent
        .get(releases_url)
        .header("User-Agent", &format!("prisma/{}", current_version))
        .call()?
        .body_mut()
        .read_json()?;

    let remote_tag = resp.tag_name.trim_start_matches('v');
    let current = semver::Version::parse(current_version)?;
    let remote = semver::Version::parse(remote_tag)?;

    if remote > current {
        let suffix = asset_hint.unwrap_or_else(|| platform_asset_suffix());
        let url = resp
            .assets
            .iter()
            .find(|a| a.name.contains(suffix))
            .map(|a| a.browser_download_url.clone())
            .unwrap_or_default();

        // Try to find the SHA256 checksums file and extract hash for our binary
        let sha256 = extract_sha256_for_asset(&resp.assets, suffix, &agent);

        Ok(Some(UpdateInfo {
            version: resp.tag_name,
            url,
            changelog: resp.body.unwrap_or_default(),
            sha256,
        }))
    } else {
        Ok(None)
    }
}

/// Download and parse the checksums file, extract the hash for the target asset.
fn extract_sha256_for_asset(
    assets: &[GithubAsset],
    target_suffix: &str,
    agent: &ureq::Agent,
) -> Option<String> {
    let checksums_asset = assets
        .iter()
        .find(|a| a.name.contains("checksums-sha256") || a.name.contains("sha256"))?;

    let body = agent
        .get(&checksums_asset.browser_download_url)
        .header("User-Agent", &format!("prisma/{}", CURRENT_VERSION))
        .call()
        .ok()?
        .body_mut()
        .read_to_string()
        .ok()?;

    // Format: "<hash>  <filename>" per line
    for line in body.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 2 && parts[1].contains(target_suffix) {
            return Some(parts[0].to_string());
        }
    }
    None
}

/// Maximum download size: 200 MB (release binaries can be 30-50 MB).
const MAX_DOWNLOAD_SIZE: u64 = 200 * 1024 * 1024;

/// Download a binary from `download_url` and verify its SHA256 hash.
pub fn download_and_verify(download_url: &str, expected_sha256: &str) -> Result<Vec<u8>> {
    download_and_verify_with_proxy(download_url, expected_sha256, 0)
}

/// Download a binary from `download_url`, verify its SHA256 hash, optionally via proxy.
pub fn download_and_verify_with_proxy(
    download_url: &str,
    expected_sha256: &str,
    proxy_port: u16,
) -> Result<Vec<u8>> {
    let agent = build_agent(proxy_port)?;
    let mut resp = agent
        .get(download_url)
        .header("User-Agent", &format!("prisma/{}", CURRENT_VERSION))
        .call()?;

    let buf = resp
        .body_mut()
        .with_config()
        .limit(MAX_DOWNLOAD_SIZE)
        .read_to_vec()?;

    // Verify SHA256
    let mut hasher = Sha256::new();
    hasher.update(&buf);
    let result = format!("{:x}", hasher.finalize());
    if result != expected_sha256.to_lowercase() {
        anyhow::bail!(
            "SHA256 mismatch: expected {}, got {}",
            expected_sha256,
            result
        );
    }

    Ok(buf)
}

/// Download a binary, verify SHA256, and save to temp dir. Legacy FFI compat.
pub fn apply(download_url: &str, expected_sha256: &str) -> Result<()> {
    let buf = download_and_verify(download_url, expected_sha256)?;
    let tmp = std::env::temp_dir().join("prisma_update");
    std::fs::write(&tmp, &buf)?;
    tracing::info!("Update downloaded to {:?}, restart to apply", tmp);
    Ok(())
}

/// Download a binary from `download_url` without hash verification.
pub fn download(download_url: &str) -> Result<Vec<u8>> {
    download_with_proxy(download_url, 0)
}

/// Download a binary from `download_url` without hash verification, optionally via proxy.
pub fn download_with_proxy(download_url: &str, proxy_port: u16) -> Result<Vec<u8>> {
    let agent = build_agent(proxy_port)?;
    let mut resp = agent
        .get(download_url)
        .header("User-Agent", &format!("prisma/{}", CURRENT_VERSION))
        .call()?;
    let buf = resp
        .body_mut()
        .with_config()
        .limit(MAX_DOWNLOAD_SIZE)
        .read_to_vec()?;
    Ok(buf)
}

/// Replace the currently running binary with new content.
///
/// On Windows the running exe is file-locked by the OS, so a simple rename
/// may fail.  The strategy is:
///   1. Write the new binary to `<exe>.new` (does not touch the running exe).
///   2. Try to rename `<exe>` -> `<exe>.old`.
///   3. If rename succeeds: rename `<exe>.new` -> `<exe>`, clean up `.old`.
///   4. If rename fails (Windows lock): use `MoveFileExW` with
///      `MOVEFILE_DELAY_UNTIL_REBOOT` to stage the replacement for next restart.
pub fn self_replace(new_binary: &[u8]) -> Result<()> {
    let current_exe = std::env::current_exe()?;
    let backup = current_exe.with_extension("old");
    let tmp_new = current_exe.with_extension("new");

    // Remove stale artefacts from previous attempts
    if backup.exists() {
        std::fs::remove_file(&backup).ok();
    }
    if tmp_new.exists() {
        std::fs::remove_file(&tmp_new).ok();
    }

    // Step 1: write new binary to .new (does not touch running exe)
    std::fs::write(&tmp_new, new_binary)?;

    // Set executable permission on Unix
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&tmp_new, std::fs::Permissions::from_mode(0o755))?;
    }

    // Step 2: try rename current → .old
    if std::fs::rename(&current_exe, &backup).is_err() {
        #[cfg(target_os = "windows")]
        {
            // On Windows: schedule replacement on next reboot via MoveFileExW
            use std::os::windows::ffi::OsStrExt;
            let src: Vec<u16> = tmp_new
                .as_os_str()
                .encode_wide()
                .chain(std::iter::once(0))
                .collect();
            let dst: Vec<u16> = current_exe
                .as_os_str()
                .encode_wide()
                .chain(std::iter::once(0))
                .collect();
            // MOVEFILE_REPLACE_EXISTING (0x01) | MOVEFILE_DELAY_UNTIL_REBOOT (0x04)
            let ok = unsafe {
                windows_sys::Win32::Storage::FileSystem::MoveFileExW(
                    src.as_ptr(),
                    dst.as_ptr(),
                    0x01 | 0x04,
                )
            };
            if ok == 0 {
                anyhow::bail!("MoveFileExW failed: {}", std::io::Error::last_os_error());
            }
            tracing::info!("Update staged for next restart (Windows file lock)");
            return Ok(());
        }
        #[cfg(not(target_os = "windows"))]
        {
            // On Unix: if rename fails, try harder
            std::fs::remove_file(&backup).ok();
            std::fs::rename(&current_exe, &backup)?;
        }
    }

    // Step 3: rename .new → current exe
    if let Err(e) = std::fs::rename(&tmp_new, &current_exe) {
        // Restore backup on failure
        if let Err(restore_err) = std::fs::rename(&backup, &current_exe) {
            tracing::error!(
                "CRITICAL: Failed to restore backup after update failure: {}",
                restore_err
            );
        }
        return Err(e.into());
    }

    // Clean up backup
    std::fs::remove_file(&backup).ok();

    Ok(())
}

pub fn platform_asset_suffix() -> &'static str {
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        "windows-amd64"
    }
    #[cfg(all(target_os = "windows", target_arch = "aarch64"))]
    {
        "windows-arm64"
    }
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        "darwin-arm64"
    }
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    {
        "darwin-amd64"
    }
    #[cfg(target_os = "android")]
    {
        "android"
    }
    #[cfg(target_os = "ios")]
    {
        "ios"
    }
    #[cfg(all(
        not(target_os = "windows"),
        not(target_os = "macos"),
        not(target_os = "android"),
        not(target_os = "ios"),
        target_arch = "x86_64"
    ))]
    {
        "linux-amd64"
    }
    #[cfg(all(
        not(target_os = "windows"),
        not(target_os = "macos"),
        not(target_os = "android"),
        not(target_os = "ios"),
        target_arch = "aarch64"
    ))]
    {
        "linux-arm64"
    }
    #[cfg(all(
        not(target_os = "windows"),
        not(target_os = "macos"),
        not(target_os = "android"),
        not(target_os = "ios"),
        not(target_arch = "x86_64"),
        not(target_arch = "aarch64")
    ))]
    {
        "linux-amd64"
    }
}
