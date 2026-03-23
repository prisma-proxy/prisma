//! PrismaAuth — Authentication without TLS Session ID dependency.
//!
//! Replaces REALITY's Session ID auth with a padding extension beacon.
//! The auth tag is hidden inside the TLS padding extension at a position
//! derived from the shared secret, making it invisible without the key.

pub mod beacon;
pub mod rotation;

pub use beacon::{build_auth_padding, compute_tag_position, generate_auth_tag, verify_auth_tag};
pub use rotation::{current_epoch, epoch_range, PrismaAuthConfig};

/// Result of server-side auth verification.
#[derive(Debug, Clone)]
pub enum AuthResult {
    /// Authenticated PrismaVeil client with the matching master secret index.
    Authenticated { client_index: usize },
    /// No matching auth found — treat as probe/browser, relay to mask server.
    Unauthenticated,
}
