use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub created_at: String,
    #[serde(default)]
    pub last_used: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub config: serde_json::Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subscription_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_updated: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ImportResult {
    pub count: usize,
    pub profiles: Vec<Profile>,
}

pub struct ProfileManager;

impl ProfileManager {
    fn profiles_dir() -> Result<PathBuf> {
        let base = {
            #[cfg(target_os = "windows")]
            {
                dirs::data_dir().unwrap_or_else(|| PathBuf::from("."))
            }
            #[cfg(target_os = "macos")]
            {
                dirs::home_dir()
                    .map(|h| h.join("Library").join("Application Support"))
                    .unwrap_or_else(|| PathBuf::from("."))
            }
            #[cfg(target_os = "ios")]
            {
                dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
            }
            #[cfg(target_os = "android")]
            {
                PathBuf::from("/data/data/com.prisma.client/files")
            }
            #[cfg(not(any(
                target_os = "windows",
                target_os = "macos",
                target_os = "ios",
                target_os = "android"
            )))]
            {
                dirs::config_dir().unwrap_or_else(|| PathBuf::from("."))
            }
        };
        let dir = base.join("Prisma").join("profiles");
        std::fs::create_dir_all(&dir)?;
        Ok(dir)
    }

    pub fn profiles_dir_str() -> Result<String> {
        let dir = Self::profiles_dir()?;
        Ok(dir.to_string_lossy().into_owned())
    }

    pub fn list_json() -> Result<String> {
        let dir = Self::profiles_dir()?;
        let mut profiles: Vec<Profile> = Vec::new();
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) == Some("json") {
                    if let Ok(content) = std::fs::read_to_string(&path) {
                        if let Ok(p) = serde_json::from_str::<Profile>(&content) {
                            profiles.push(p);
                        }
                    }
                }
            }
        }
        profiles.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(serde_json::to_string(&profiles)?)
    }

    pub fn save(json: &str) -> Result<()> {
        let profile: Profile = serde_json::from_str(json)?;
        let dir = Self::profiles_dir()?;
        let path = dir.join(format!("{}.json", profile.id));
        std::fs::write(path, serde_json::to_string_pretty(&profile)?)?;
        Ok(())
    }

    pub fn import_from_url(url: &str) -> Result<ImportResult> {
        // Accept: JSON array of profiles, or object with "profiles" key
        let raw: serde_json::Value = ureq::get(url)
            .call()
            .map_err(|e| anyhow::anyhow!("fetch failed: {e}"))?
            .body_mut()
            .read_json()
            .map_err(|e| anyhow::anyhow!("invalid JSON: {e}"))?;
        let arr = if let Some(a) = raw.as_array() {
            a.clone()
        } else if let Some(a) = raw.get("profiles").and_then(|v| v.as_array()) {
            a.clone()
        } else {
            anyhow::bail!("expected JSON array or {{\"profiles\":[...]}}");
        };

        let now = chrono::Utc::now().to_rfc3339();
        let mut saved: Vec<Profile> = Vec::new();
        for val in arr {
            let mut p: Profile =
                serde_json::from_value(val).map_err(|e| anyhow::anyhow!("invalid profile: {e}"))?;
            // Assign fresh ID and timestamps for new imports
            p.id = uuid::Uuid::new_v4().to_string();
            p.created_at = now.clone();
            p.subscription_url = Some(url.to_string());
            p.last_updated = Some(now.clone());
            Self::save(&serde_json::to_string(&p)?)?;
            saved.push(p);
        }

        Ok(ImportResult {
            count: saved.len(),
            profiles: saved,
        })
    }

    pub fn refresh_all() -> Result<ImportResult> {
        let dir = Self::profiles_dir()?;
        let mut all: Vec<Profile> = Vec::new();
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) == Some("json") {
                    if let Ok(content) = std::fs::read_to_string(&path) {
                        if let Ok(p) = serde_json::from_str::<Profile>(&content) {
                            all.push(p);
                        }
                    }
                }
            }
        }

        let now = chrono::Utc::now().to_rfc3339();
        let mut refreshed: Vec<Profile> = Vec::new();
        for mut p in all {
            let Some(ref url) = p.subscription_url.clone() else {
                continue;
            };
            let raw: serde_json::Value = match ureq::get(url)
                .call()
                .ok()
                .and_then(|mut r| r.body_mut().read_json().ok())
            {
                Some(v) => v,
                None => continue,
            };
            let arr = if let Some(a) = raw.as_array() {
                a.clone()
            } else if let Some(a) = raw.get("profiles").and_then(|v| v.as_array()) {
                a.clone()
            } else {
                continue;
            };
            // Update from first matching entry (same name) or first entry
            let updated = arr.into_iter().find_map(|v| {
                let candidate: Profile = serde_json::from_value(v).ok()?;
                if candidate.name == p.name {
                    Some(candidate)
                } else {
                    None
                }
            });
            if let Some(fresh) = updated {
                p.config = fresh.config;
                p.last_updated = Some(now.clone());
                if let Ok(json) = serde_json::to_string(&p) {
                    let _ = Self::save(&json);
                    refreshed.push(p);
                }
            }
        }

        Ok(ImportResult {
            count: refreshed.len(),
            profiles: refreshed,
        })
    }

    pub fn delete(id: &str) -> Result<()> {
        // Sanitize id: only allow alphanumeric and hyphens
        if !id.chars().all(|c| c.is_alphanumeric() || c == '-') {
            anyhow::bail!("Invalid profile id");
        }
        let dir = Self::profiles_dir()?;
        let path = dir.join(format!("{}.json", id));
        if path.exists() {
            std::fs::remove_file(path)?;
        }
        Ok(())
    }
}
