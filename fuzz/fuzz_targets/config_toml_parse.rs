//! Fuzz target: Client and server config TOML parsing.
//!
//! Exercises the TOML deserialization paths for both `ClientConfig` and
//! `ServerConfig` to catch panics, stack overflows, or unbounded allocations
//! from malformed TOML input.

#![no_main]

use libfuzzer_sys::fuzz_target;

use prisma_core::config::client::ClientConfig;
use prisma_core::config::server::ServerConfig;

fuzz_target!(|data: &[u8]| {
    // Only try if valid UTF-8
    if let Ok(s) = std::str::from_utf8(data) {
        // Try parsing as ClientConfig TOML
        let _ = toml::from_str::<ClientConfig>(s);

        // Try parsing as ServerConfig TOML
        let _ = toml::from_str::<ServerConfig>(s);

        // Try parsing as generic TOML value (to catch toml crate panics)
        let _ = toml::from_str::<toml::Value>(s);
    }
});
