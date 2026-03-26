//! WireGuard-compatible transport framing.
//!
//! Wraps Prisma proxy data in UDP packets that mimic the WireGuard protocol
//! on the wire. Only the outer header format matches WireGuard; the actual
//! encryption and handshake semantics are Prisma's own.
//!
//! # Packet Types
//!
//! | Type | Name                | WireGuard Equivalent |
//! |------|---------------------|----------------------|
//! | 1    | Handshake Initiation| Message Type 1       |
//! | 2    | Handshake Response  | Message Type 2       |
//! | 4    | Transport Data      | Message Type 4       |

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use bytes::{BufMut, Bytes, BytesMut};
use rand::Rng;
use tokio::sync::RwLock;

/// WireGuard message type: Handshake Initiation.
pub const MSG_HANDSHAKE_INIT: u8 = 1;
/// WireGuard message type: Handshake Response.
pub const MSG_HANDSHAKE_RESPONSE: u8 = 2;
/// WireGuard message type: Transport Data.
pub const MSG_TRANSPORT_DATA: u8 = 4;

/// WireGuard keepalive interval in seconds (standard is 25s).
pub const KEEPALIVE_INTERVAL_SECS: u64 = 25;

/// Maximum WireGuard-framed packet size. WireGuard typically uses MTU-sized
/// packets; we cap at a generous 65535 to handle jumbo frames.
pub const MAX_WG_PACKET_SIZE: usize = 65535;

/// Minimum handshake initiation message size:
/// 4 (header) + 4 (sender_index) + 32 (ephemeral) + variable payload.
pub const MIN_HANDSHAKE_INIT_SIZE: usize = 148;

/// Minimum handshake response message size:
/// 4 (header) + 4 (sender_index) + 4 (receiver_index) + 32 (ephemeral) + variable.
pub const MIN_HANDSHAKE_RESPONSE_SIZE: usize = 92;

/// Minimum transport data message size:
/// 4 (header) + 4 (receiver_index) + 8 (counter) + payload.
pub const MIN_TRANSPORT_DATA_SIZE: usize = 32;

// ---------------------------------------------------------------------------
// Packet encoding / decoding
// ---------------------------------------------------------------------------

/// Parsed WireGuard-like packet.
#[derive(Debug, Clone)]
pub enum WgPacket {
    /// Handshake initiation (type 1).
    HandshakeInit {
        sender_index: u32,
        /// Prisma handshake payload (ClientInit) padded to look like WG.
        payload: Bytes,
    },
    /// Handshake response (type 2).
    HandshakeResponse {
        sender_index: u32,
        receiver_index: u32,
        /// Prisma handshake payload (ServerInit).
        payload: Bytes,
    },
    /// Transport data (type 4).
    TransportData {
        receiver_index: u32,
        counter: u64,
        /// Encrypted Prisma frame data.
        payload: Bytes,
    },
}

impl WgPacket {
    /// Encode a packet into bytes ready for UDP transmission.
    pub fn encode(&self) -> Bytes {
        match self {
            WgPacket::HandshakeInit {
                sender_index,
                payload,
            } => {
                // Real WG handshake init is 148 bytes.
                // Layout: type(1) + reserved(3) + sender_index(4) + ephemeral(32) +
                //         static(48) + timestamp(28) + mac1(16) + mac2(16) = 148
                // We use: type(1) + reserved(3) + sender_index(4) + payload_len(4) + payload + padding
                let total = MIN_HANDSHAKE_INIT_SIZE.max(12 + payload.len());
                let mut buf = BytesMut::with_capacity(total);
                buf.put_u8(MSG_HANDSHAKE_INIT);
                buf.put_u8(0); // reserved
                buf.put_u8(0);
                buf.put_u8(0);
                buf.put_u32_le(*sender_index);
                buf.put_u32_le(payload.len() as u32);
                buf.extend_from_slice(payload);
                // Pad to minimum WG handshake init size
                while buf.len() < MIN_HANDSHAKE_INIT_SIZE {
                    buf.put_u8(rand::thread_rng().gen());
                }
                buf.freeze()
            }
            WgPacket::HandshakeResponse {
                sender_index,
                receiver_index,
                payload,
            } => {
                // Real WG response is 92 bytes.
                // We use: type(1) + reserved(3) + sender_index(4) + receiver_index(4) +
                //         payload_len(4) + payload + padding
                let total = MIN_HANDSHAKE_RESPONSE_SIZE.max(16 + payload.len());
                let mut buf = BytesMut::with_capacity(total);
                buf.put_u8(MSG_HANDSHAKE_RESPONSE);
                buf.put_u8(0);
                buf.put_u8(0);
                buf.put_u8(0);
                buf.put_u32_le(*sender_index);
                buf.put_u32_le(*receiver_index);
                buf.put_u32_le(payload.len() as u32);
                buf.extend_from_slice(payload);
                while buf.len() < MIN_HANDSHAKE_RESPONSE_SIZE {
                    buf.put_u8(rand::thread_rng().gen());
                }
                buf.freeze()
            }
            WgPacket::TransportData {
                receiver_index,
                counter,
                payload,
            } => {
                // type(1) + reserved(3) + receiver_index(4) + counter(8) + payload
                let mut buf = BytesMut::with_capacity(16 + payload.len());
                buf.put_u8(MSG_TRANSPORT_DATA);
                buf.put_u8(0);
                buf.put_u8(0);
                buf.put_u8(0);
                buf.put_u32_le(*receiver_index);
                buf.put_u64_le(*counter);
                buf.extend_from_slice(payload);
                buf.freeze()
            }
        }
    }

    /// Decode a packet from raw UDP bytes.
    pub fn decode(data: &[u8]) -> Result<Self, WgError> {
        if data.len() < 4 {
            return Err(WgError::PacketTooShort);
        }

        let msg_type = data[0];
        // data[1..4] are reserved

        match msg_type {
            MSG_HANDSHAKE_INIT => {
                if data.len() < 12 {
                    return Err(WgError::PacketTooShort);
                }
                let sender_index = u32::from_le_bytes([data[4], data[5], data[6], data[7]]);
                let payload_len =
                    u32::from_le_bytes([data[8], data[9], data[10], data[11]]) as usize;
                if data.len() < 12 + payload_len {
                    return Err(WgError::PacketTooShort);
                }
                let payload = Bytes::copy_from_slice(&data[12..12 + payload_len]);
                Ok(WgPacket::HandshakeInit {
                    sender_index,
                    payload,
                })
            }
            MSG_HANDSHAKE_RESPONSE => {
                if data.len() < 16 {
                    return Err(WgError::PacketTooShort);
                }
                let sender_index = u32::from_le_bytes([data[4], data[5], data[6], data[7]]);
                let receiver_index = u32::from_le_bytes([data[8], data[9], data[10], data[11]]);
                let payload_len =
                    u32::from_le_bytes([data[12], data[13], data[14], data[15]]) as usize;
                if data.len() < 16 + payload_len {
                    return Err(WgError::PacketTooShort);
                }
                let payload = Bytes::copy_from_slice(&data[16..16 + payload_len]);
                Ok(WgPacket::HandshakeResponse {
                    sender_index,
                    receiver_index,
                    payload,
                })
            }
            MSG_TRANSPORT_DATA => {
                if data.len() < 16 {
                    return Err(WgError::PacketTooShort);
                }
                let receiver_index = u32::from_le_bytes([data[4], data[5], data[6], data[7]]);
                let counter = u64::from_le_bytes([
                    data[8], data[9], data[10], data[11], data[12], data[13], data[14], data[15],
                ]);
                let payload = Bytes::copy_from_slice(&data[16..]);
                Ok(WgPacket::TransportData {
                    receiver_index,
                    counter,
                    payload,
                })
            }
            _ => Err(WgError::UnknownMessageType(msg_type)),
        }
    }
}

// ---------------------------------------------------------------------------
// Session tracking
// ---------------------------------------------------------------------------

/// Per-peer session state tracked by the server.
#[derive(Debug)]
pub struct WgSession {
    /// Our local index (used as receiver_index by the peer).
    pub local_index: u32,
    /// The peer's index (used as receiver_index when we send to them).
    pub peer_index: u32,
    /// Peer's UDP address.
    pub peer_addr: SocketAddr,
    /// Monotonic counter for outbound transport data packets.
    pub tx_counter: AtomicU64,
    /// Last received counter (for replay protection).
    pub rx_counter: AtomicU64,
    /// Timestamp of last activity (for keepalive / timeout).
    pub last_activity: AtomicU64,
}

impl WgSession {
    pub fn new(local_index: u32, peer_index: u32, peer_addr: SocketAddr) -> Self {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        Self {
            local_index,
            peer_index,
            peer_addr,
            tx_counter: AtomicU64::new(0),
            rx_counter: AtomicU64::new(0),
            last_activity: AtomicU64::new(now),
        }
    }

    pub fn next_tx_counter(&self) -> u64 {
        self.tx_counter.fetch_add(1, Ordering::Relaxed)
    }

    pub fn update_activity(&self) {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        self.last_activity.store(now, Ordering::Relaxed);
    }

    pub fn seconds_since_activity(&self) -> u64 {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        now.saturating_sub(self.last_activity.load(Ordering::Relaxed))
    }
}

/// Session store: maps local_index -> session.
pub type SessionStore = Arc<RwLock<HashMap<u32, Arc<WgSession>>>>;

/// Create a new session store.
pub fn new_session_store() -> SessionStore {
    Arc::new(RwLock::new(HashMap::new()))
}

/// Generate a random 32-bit session index.
pub fn random_index() -> u32 {
    rand::thread_rng().gen()
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[derive(Debug, thiserror::Error)]
pub enum WgError {
    #[error("packet too short")]
    PacketTooShort,
    #[error("unknown message type: {0}")]
    UnknownMessageType(u8),
    #[error("session not found for index {0}")]
    SessionNotFound(u32),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/// WireGuard transport configuration for the server.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct WireGuardServerConfig {
    /// Whether WireGuard transport is enabled.
    #[serde(default)]
    pub enabled: bool,
    /// UDP listen address (e.g., "0.0.0.0:51820").
    #[serde(default = "default_wg_listen_addr")]
    pub listen_addr: String,
    /// Session timeout in seconds. Peers with no activity for this long are removed.
    #[serde(default = "default_wg_session_timeout")]
    pub session_timeout_secs: u64,
}

impl Default for WireGuardServerConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            listen_addr: default_wg_listen_addr(),
            session_timeout_secs: default_wg_session_timeout(),
        }
    }
}

fn default_wg_listen_addr() -> String {
    "0.0.0.0:51820".into()
}

fn default_wg_session_timeout() -> u64 {
    180
}

/// WireGuard transport configuration for the client.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct WireGuardClientConfig {
    /// Server WireGuard endpoint (e.g., "1.2.3.4:51820").
    pub endpoint: String,
    /// Keepalive interval in seconds. Defaults to 25 (WireGuard standard).
    #[serde(default = "default_wg_keepalive")]
    pub keepalive_secs: u64,
}

fn default_wg_keepalive() -> u64 {
    KEEPALIVE_INTERVAL_SECS
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_handshake_init_roundtrip() {
        let pkt = WgPacket::HandshakeInit {
            sender_index: 42,
            payload: Bytes::from_static(b"hello prisma"),
        };
        let encoded = pkt.encode();
        assert_eq!(encoded[0], MSG_HANDSHAKE_INIT);
        assert!(encoded.len() >= MIN_HANDSHAKE_INIT_SIZE);

        let decoded = WgPacket::decode(&encoded).unwrap();
        match decoded {
            WgPacket::HandshakeInit {
                sender_index,
                payload,
            } => {
                assert_eq!(sender_index, 42);
                assert_eq!(payload.as_ref(), b"hello prisma");
            }
            _ => panic!("unexpected packet type"),
        }
    }

    #[test]
    fn test_handshake_response_roundtrip() {
        let pkt = WgPacket::HandshakeResponse {
            sender_index: 100,
            receiver_index: 42,
            payload: Bytes::from_static(b"server reply"),
        };
        let encoded = pkt.encode();
        assert_eq!(encoded[0], MSG_HANDSHAKE_RESPONSE);
        assert!(encoded.len() >= MIN_HANDSHAKE_RESPONSE_SIZE);

        let decoded = WgPacket::decode(&encoded).unwrap();
        match decoded {
            WgPacket::HandshakeResponse {
                sender_index,
                receiver_index,
                payload,
            } => {
                assert_eq!(sender_index, 100);
                assert_eq!(receiver_index, 42);
                assert_eq!(payload.as_ref(), b"server reply");
            }
            _ => panic!("unexpected packet type"),
        }
    }

    #[test]
    fn test_transport_data_roundtrip() {
        let pkt = WgPacket::TransportData {
            receiver_index: 42,
            counter: 12345,
            payload: Bytes::from_static(b"encrypted data here"),
        };
        let encoded = pkt.encode();
        assert_eq!(encoded[0], MSG_TRANSPORT_DATA);
        assert_eq!(encoded.len(), 16 + 19); // header(16) + payload(19)

        let decoded = WgPacket::decode(&encoded).unwrap();
        match decoded {
            WgPacket::TransportData {
                receiver_index,
                counter,
                payload,
            } => {
                assert_eq!(receiver_index, 42);
                assert_eq!(counter, 12345);
                assert_eq!(payload.as_ref(), b"encrypted data here");
            }
            _ => panic!("unexpected packet type"),
        }
    }

    #[test]
    fn test_unknown_message_type() {
        let data = [3, 0, 0, 0]; // type 3 is not used
        let result = WgPacket::decode(&data);
        assert!(result.is_err());
    }

    #[test]
    fn test_packet_too_short() {
        let data = [1, 0]; // too short for any message
        let result = WgPacket::decode(&data);
        assert!(result.is_err());
    }
}
