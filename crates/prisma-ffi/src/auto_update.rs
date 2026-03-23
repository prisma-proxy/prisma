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

pub fn check() -> Result<Option<UpdateInfo>> {
    let resp: GithubRelease = ureq::get(RELEASES_API)
        .header("User-Agent", "prisma-ffi/1.0")
        .call()?
        .body_mut()
        .read_json()?;

    let remote_tag = resp.tag_name.trim_start_matches('v');
    let current = semver::Version::parse(CURRENT_VERSION)?;
    let remote = semver::Version::parse(remote_tag)?;

    if remote > current {
        // Find platform-specific asset
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

pub fn apply(download_url: &str, expected_sha256: &str) -> Result<()> {
    // Download to temp file
    let mut resp = ureq::get(download_url)
        .header("User-Agent", "prisma-ffi/1.0")
        .call()?;

    let buf = resp.body_mut().read_to_vec()?;

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

    // Write to temp location and schedule replacement on next launch
    let tmp = std::env::temp_dir().join("prisma_update");
    std::fs::write(&tmp, &buf)?;
    tracing::info!("Update downloaded to {:?}, restart to apply", tmp);

    Ok(())
}

fn platform_asset_suffix() -> &'static str {
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
