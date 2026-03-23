//! PrismaFP -- Actual ClientHello byte-level construction.
//!
//! The existing utls/fingerprints.rs has metadata-only templates.
//! PrismaFP actually controls the ClientHello bytes to match real browsers,
//! preventing JA3/JA4 fingerprinting.

pub mod builder;
pub mod extensions;
pub mod grease;
pub mod ja3;

pub use builder::ClientHelloBuilder;
