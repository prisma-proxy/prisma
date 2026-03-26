pub mod client;
pub mod server;
pub mod validation;

use serde::{Deserialize, Serialize};

use crate::error::ConfigError;

pub(crate) fn default_alpn() -> Vec<String> {
    vec!["h2".into(), "http/1.1".into()]
}

// ── Shared configuration types ──────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoggingConfig {
    #[serde(default = "default_level")]
    pub level: String,
    #[serde(default = "default_format")]
    pub format: String,
}

impl Default for LoggingConfig {
    fn default() -> Self {
        Self {
            level: default_level(),
            format: default_format(),
        }
    }
}

fn default_level() -> String {
    "info".into()
}

fn default_format() -> String {
    "pretty".into()
}

/// Load server config from file path with layered overrides:
/// defaults → TOML file → env vars (PRISMA_*)
///
/// Returns the parsed config. Use [`load_server_config_with_raw`] when the
/// original TOML text is also needed (e.g., for merge-based persistence).
pub fn load_server_config(path: &str) -> Result<server::ServerConfig, ConfigError> {
    let (config, _raw) = load_server_config_with_raw(path)?;
    Ok(config)
}

/// Load server config from file path with layered overrides.
/// Returns both the parsed config AND the raw TOML string from disk,
/// which can be used for merge-based persistence that preserves unknown fields.
pub fn load_server_config_with_raw(
    path: &str,
) -> Result<(server::ServerConfig, String), ConfigError> {
    // Read the raw TOML text for merge-based persistence.
    // Try the exact path first, then with ".toml" extension (matching `config::File::with_name` behavior).
    let raw_toml = std::fs::read_to_string(path)
        .or_else(|_| {
            let with_ext = format!("{path}.toml");
            std::fs::read_to_string(with_ext)
        })
        .map_err(|e| ConfigError::ParseError(format!("Cannot read config file: {e}")))?;

    let builder = config::Config::builder()
        .set_default("listen_addr", "0.0.0.0:8443")
        .map_err(|e| ConfigError::Invalid(e.to_string()))?
        .set_default("quic_listen_addr", "0.0.0.0:8443")
        .map_err(|e| ConfigError::Invalid(e.to_string()))?
        .set_default("logging.level", "info")
        .map_err(|e| ConfigError::Invalid(e.to_string()))?
        .set_default("logging.format", "pretty")
        .map_err(|e| ConfigError::Invalid(e.to_string()))?
        .set_default("performance.max_connections", 1024i64)
        .map_err(|e| ConfigError::Invalid(e.to_string()))?
        .set_default("performance.connection_timeout_secs", 300i64)
        .map_err(|e| ConfigError::Invalid(e.to_string()))?
        .add_source(config::File::with_name(path).required(true))
        .add_source(
            config::Environment::with_prefix("PRISMA")
                .separator("_")
                .try_parsing(true),
        );

    let config = builder
        .build()
        .map_err(|e| ConfigError::ParseError(e.to_string()))?;

    let server_config: server::ServerConfig = config
        .try_deserialize()
        .map_err(|e| ConfigError::ParseError(e.to_string()))?;

    validation::validate_server_config(&server_config)?;

    Ok((server_config, raw_toml))
}

/// Load client config from file path with layered overrides.
pub fn load_client_config(path: &str) -> Result<client::ClientConfig, ConfigError> {
    let builder = config::Config::builder()
        .set_default("cipher_suite", "chacha20-poly1305")
        .map_err(|e| ConfigError::Invalid(e.to_string()))?
        .set_default("logging.level", "info")
        .map_err(|e| ConfigError::Invalid(e.to_string()))?
        .set_default("logging.format", "pretty")
        .map_err(|e| ConfigError::Invalid(e.to_string()))?
        .set_default("transport", "quic")
        .map_err(|e| ConfigError::Invalid(e.to_string()))?
        .set_default("skip_cert_verify", false)
        .map_err(|e| ConfigError::Invalid(e.to_string()))?
        .add_source(config::File::with_name(path).required(true))
        .add_source(
            config::Environment::with_prefix("PRISMA")
                .separator("_")
                .try_parsing(true),
        );

    let config = builder
        .build()
        .map_err(|e| ConfigError::ParseError(e.to_string()))?;

    let client_config: client::ClientConfig = config
        .try_deserialize()
        .map_err(|e| ConfigError::ParseError(e.to_string()))?;

    validation::validate_client_config(&client_config)?;

    Ok(client_config)
}
