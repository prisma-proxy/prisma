//! Epoch-based key rotation for PrismaAuth.
//!
//! Epochs are derived from Unix time divided by a configurable rotation interval.
//! The server accepts tags from a range of epochs to tolerate clock skew between
//! client and server.

use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

/// PrismaAuth configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrismaAuthConfig {
    /// Shared secret between client and server (replaces REALITY's private_key).
    pub master_secret: [u8; 32],
    /// Rotation interval in seconds. Default: 3600 (1 hour).
    #[serde(default = "default_rotation_interval")]
    pub rotation_interval_secs: u64,
    /// Number of epochs to accept on either side of current. Default: 1.
    #[serde(default = "default_clock_skew")]
    pub allowed_clock_skew_epochs: u8,
}

fn default_rotation_interval() -> u64 {
    3600
}

fn default_clock_skew() -> u8 {
    1
}

impl PrismaAuthConfig {
    /// Create a new PrismaAuthConfig with default rotation settings.
    pub fn new(master_secret: [u8; 32]) -> Self {
        Self {
            master_secret,
            rotation_interval_secs: default_rotation_interval(),
            allowed_clock_skew_epochs: default_clock_skew(),
        }
    }

    /// Return the current epoch for this config's rotation interval.
    pub fn current_epoch(&self) -> u64 {
        current_epoch(self.rotation_interval_secs)
    }

    /// Return the allowed epoch range for this config.
    pub fn epoch_range(&self) -> Vec<u64> {
        epoch_range(self.rotation_interval_secs, self.allowed_clock_skew_epochs)
    }
}

/// Compute the current epoch as `floor(unix_time / rotation_interval_secs)`.
///
/// # Panics
///
/// Panics if `rotation_interval_secs` is 0.
pub fn current_epoch(rotation_interval_secs: u64) -> u64 {
    assert!(
        rotation_interval_secs > 0,
        "rotation_interval_secs must be > 0"
    );

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock is before UNIX epoch");

    now.as_secs() / rotation_interval_secs
}

/// Compute the range of valid epochs: `[current_epoch - skew ..= current_epoch + skew]`.
///
/// Uses saturating arithmetic to avoid underflow at epoch 0.
///
/// # Panics
///
/// Panics if `rotation_interval_secs` is 0.
pub fn epoch_range(rotation_interval_secs: u64, skew: u8) -> Vec<u64> {
    let epoch = current_epoch(rotation_interval_secs);
    let skew = skew as u64;

    let start = epoch.saturating_sub(skew);
    let end = epoch.saturating_add(skew);

    (start..=end).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn current_epoch_is_reasonable() {
        // With 3600s intervals, the epoch should be in the ballpark of
        // unix_time / 3600. At the time of writing (2024+), that's > 470000.
        let epoch = current_epoch(3600);
        assert!(
            epoch > 470_000,
            "Epoch {epoch} seems too small for 1-hour intervals"
        );
    }

    #[test]
    fn current_epoch_one_second_interval() {
        let epoch = current_epoch(1);
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        // With 1-second intervals, epoch == unix_time.
        assert!(
            epoch == now || epoch == now - 1 || epoch == now + 1,
            "With 1s interval, epoch ({epoch}) should equal unix_time ({now}) +/- 1"
        );
    }

    #[test]
    #[should_panic(expected = "rotation_interval_secs must be > 0")]
    fn current_epoch_zero_interval_panics() {
        current_epoch(0);
    }

    #[test]
    fn epoch_range_default_skew() {
        let range = epoch_range(3600, 1);
        assert_eq!(range.len(), 3, "Skew of 1 should produce 3 epochs");

        // The middle element should be the current epoch.
        let current = current_epoch(3600);
        assert_eq!(range[1], current);
        assert_eq!(range[0], current - 1);
        assert_eq!(range[2], current + 1);
    }

    #[test]
    fn epoch_range_zero_skew() {
        let range = epoch_range(3600, 0);
        assert_eq!(range.len(), 1);
        assert_eq!(range[0], current_epoch(3600));
    }

    #[test]
    fn epoch_range_large_skew() {
        let range = epoch_range(3600, 5);
        assert_eq!(range.len(), 11, "Skew of 5 should produce 11 epochs");

        let current = current_epoch(3600);
        assert_eq!(range[0], current - 5);
        assert_eq!(range[10], current + 5);
    }

    #[test]
    fn epoch_range_saturating_at_zero() {
        // Use a very large interval so epoch is 0.
        let huge_interval = u64::MAX;
        let epoch = current_epoch(huge_interval);
        assert_eq!(epoch, 0, "With a huge interval, epoch should be 0");

        let range = epoch_range(huge_interval, 2);
        // epoch is 0, so start saturates to 0: range is [0, 1, 2].
        assert_eq!(range[0], 0, "Start should saturate to 0");
        assert_eq!(range.len(), 3);
    }

    #[test]
    fn config_new_defaults() {
        let secret = [0xABu8; 32];
        let config = PrismaAuthConfig::new(secret);

        assert_eq!(config.master_secret, secret);
        assert_eq!(config.rotation_interval_secs, 3600);
        assert_eq!(config.allowed_clock_skew_epochs, 1);
    }

    #[test]
    fn config_current_epoch_delegates() {
        let config = PrismaAuthConfig::new([0u8; 32]);
        let from_config = config.current_epoch();
        let direct = current_epoch(config.rotation_interval_secs);
        // They should be equal (or differ by at most 1 if the clock ticked).
        assert!(
            from_config == direct || from_config + 1 == direct || from_config == direct + 1,
            "config.current_epoch() and current_epoch() should agree"
        );
    }

    #[test]
    fn config_epoch_range_delegates() {
        let config = PrismaAuthConfig::new([0u8; 32]);
        let range = config.epoch_range();
        assert_eq!(range.len(), 3);
    }

    #[test]
    fn config_serialization_roundtrip() {
        let config = PrismaAuthConfig {
            master_secret: [0x42u8; 32],
            rotation_interval_secs: 1800,
            allowed_clock_skew_epochs: 2,
        };

        let json = serde_json::to_string(&config).unwrap();
        let deserialized: PrismaAuthConfig = serde_json::from_str(&json).unwrap();

        assert_eq!(deserialized.master_secret, config.master_secret);
        assert_eq!(
            deserialized.rotation_interval_secs,
            config.rotation_interval_secs
        );
        assert_eq!(
            deserialized.allowed_clock_skew_epochs,
            config.allowed_clock_skew_epochs
        );
    }

    #[test]
    fn config_deserialization_uses_defaults() {
        // JSON without optional fields should use defaults.
        let json = r#"{"master_secret":[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32]}"#;
        let config: PrismaAuthConfig = serde_json::from_str(json).unwrap();

        assert_eq!(config.rotation_interval_secs, 3600);
        assert_eq!(config.allowed_clock_skew_epochs, 1);
    }
}
