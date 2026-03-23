//! PrismaFlow -- Traffic normalization layer.
//!
//! Post-handshake fingerprint defense:
//! - HTTP/2 SETTINGS mimicry (match browser H2 fingerprint)
//! - RTT normalization (delay responses to mask proxy hop)

pub mod h2_mimicry;
pub mod timing;

pub use h2_mimicry::{chrome_h2_profile, firefox_h2_profile, safari_h2_profile, H2Profile};
pub use timing::RttNormalizer;
