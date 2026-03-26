use anyhow::Result;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");
const RELEASES_API: &str = "https://api.github.com/repos/Yamimega/prisma/releases/latest";

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateInfo {
    pub version: String,
    pub url: String,
    pub changelog: String,
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

/// Check GitHub releases for a newer version. Returns `None` if already up to date.
pub fn check() -> Result<Option<UpdateInfo>> {
    let resp: GithubRelease = ureq::get(RELEASES_API)
        .header("User-Agent", &format!("prisma/{}", CURRENT_VERSION))
        .call()?
        .body_mut()
        .read_json()?;

    let remote_tag = resp.tag_name.trim_start_matches('v');
    let current = semver::Version::parse(CURRENT_VERSION)?;
    let remote = semver::Version::parse(remote_tag)?;

    if remote > current {
        let target_suffix = platform_asset_suffix();
        let url = resp
            .assets
            .iter()
            .find(|a| a.name.contains(target_suffix))
            .map(|a| a.browser_download_url.clone())
            .unwrap_or_default();

        Ok(Some(UpdateInfo {
            version: resp.tag_name,
            url,
            changelog: resp.body.unwrap_or_default(),
        }))
    } else {
        Ok(None)
    }
}

/// Maximum download size: 200 MB (release binaries can be 30-50 MB).
const MAX_DOWNLOAD_SIZE: u64 = 200 * 1024 * 1024;

/// Download a binary from `download_url` and verify its SHA256 hash.
pub fn download_and_verify(download_url: &str, expected_sha256: &str) -> Result<Vec<u8>> {
    let agent = ureq::Agent::new_with_defaults();
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
    let agent = ureq::Agent::new_with_defaults();
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
        std::fs::rename(&backup, &current_exe).ok();
        return Err(e.into());
    }

    // Clean up backup
    std::fs::remove_file(&backup).ok();

    Ok(())
}

pub fn platform_asset_suffix() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        "windows"
    }
    #[cfg(target_os = "macos")]
    {
        "macos"
    }
    #[cfg(target_os = "android")]
    {
        "android"
    }
    #[cfg(target_os = "ios")]
    {
        "ios"
    }
    #[cfg(not(any(
        target_os = "windows",
        target_os = "macos",
        target_os = "android",
        target_os = "ios"
    )))]
    {
        "linux"
    }
}
