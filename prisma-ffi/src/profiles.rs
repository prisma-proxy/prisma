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
            #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "ios", target_os = "android")))]
            {
                dirs::config_dir().unwrap_or_else(|| PathBuf::from("."))
            }
        };
        let dir = base.join("Prisma").join("profiles");
        std::fs::create_dir_all(&dir)?;
        Ok(dir)
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
