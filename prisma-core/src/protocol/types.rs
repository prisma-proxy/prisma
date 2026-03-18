use std::sync::atomic::{AtomicU64, Ordering};

use bytes::Bytes;
use uuid::Uuid;

use crate::types::{CipherSuite, ClientId, PaddingRange, ProxyDestination};

// Command byte values
pub const CMD_CONNECT: u8 = 0x01;
pub const CMD_DATA: u8 = 0x02;
pub const CMD_CLOSE: u8 = 0x03;
pub const CMD_PING: u8 = 0x04;
pub const CMD_PONG: u8 = 0x05;
pub const CMD_REGISTER_FORWARD: u8 = 0x06;
pub const CMD_FORWARD_READY: u8 = 0x07;
pub const CMD_FORWARD_CONNECT: u8 = 0x08;
pub const CMD_UDP_ASSOCIATE: u8 = 0x09;
pub const CMD_UDP_DATA: u8 = 0x0A;
pub const CMD_SPEED_TEST: u8 = 0x0B;
pub const CMD_DNS_QUERY: u8 = 0x0C;
pub const CMD_DNS_RESPONSE: u8 = 0x0D;
pub const CMD_CHALLENGE_RESP: u8 = 0x0E;
/// v5: Connection migration request — client sends its migration token to resume
/// a session on a new transport connection without a full handshake.
pub const CMD_MIGRATION: u8 = 0x0F;

// Flag bits (2-byte little-endian)
pub const FLAG_PADDED: u16 = 0x0001;
pub const FLAG_FEC: u16 = 0x0002;
pub const FLAG_PRIORITY: u16 = 0x0004;
pub const FLAG_DATAGRAM: u16 = 0x0008;
pub const FLAG_COMPRESSED: u16 = 0x0010;
pub const FLAG_0RTT: u16 = 0x0020;
pub const FLAG_BUCKETED: u16 = 0x0040;
pub const FLAG_CHAFF: u16 = 0x0080;
/// v5: Header fields (cmd, flags, stream_id) are bound as AAD in encryption.
pub const FLAG_HEADER_AUTHENTICATED: u16 = 0x0100;
/// v5: Frame carries a connection migration token for seamless reconnection.
pub const FLAG_MIGRATION: u16 = 0x0200;

/// Server feature flags bitmask.
pub const FEATURE_UDP_RELAY: u32 = 0x0001;
pub const FEATURE_FEC: u32 = 0x0002;
pub const FEATURE_PORT_HOPPING: u32 = 0x0004;
pub const FEATURE_SPEED_TEST: u32 = 0x0008;
pub const FEATURE_DNS_TUNNEL: u32 = 0x0010;
pub const FEATURE_BANDWIDTH_LIMIT: u32 = 0x0020;
pub const FEATURE_TRANSPORT_ONLY_CIPHER: u32 = 0x0040;
/// v5: Server supports extended anti-replay window (2048-bit).
pub const FEATURE_EXTENDED_ANTI_REPLAY: u32 = 0x0080;
/// v5: Server supports v5 key derivation with improved domain separation.
pub const FEATURE_V5_KDF: u32 = 0x0100;
/// v5: Server supports header-authenticated encryption (AAD binding).
pub const FEATURE_HEADER_AUTH: u32 = 0x0200;
/// v5: Server supports connection migration tokens.
pub const FEATURE_CONNECTION_MIGRATION: u32 = 0x0400;

// --- PrismaVeil handshake types (v4 only) ---

/// PrismaVeil handshake: Client → Server.
/// 2-step handshake: PrismaClientInit → PrismaServerInit.
#[derive(Debug, Clone)]
pub struct PrismaClientInit {
    pub version: u8, // PRISMA_PROTOCOL_VERSION (0x04)
    pub flags: u8,
    pub client_ephemeral_pub: [u8; 32],
    pub client_id: ClientId,
    pub timestamp: u64,
    pub cipher_suite: CipherSuite,
    pub auth_token: [u8; 32],
    pub padding: Vec<u8>,
}

/// PrismaVeil handshake: Server → Client.
#[derive(Debug, Clone)]
pub struct PrismaServerInit {
    pub status: AcceptStatus,
    pub session_id: Uuid,
    pub server_ephemeral_pub: [u8; 32],
    pub challenge: [u8; 32],
    pub padding_min: u16,
    pub padding_max: u16,
    pub server_features: u32,
    pub session_ticket: Vec<u8>,
    /// Bucket sizes for traffic shaping (empty = disabled).
    pub bucket_sizes: Vec<u16>,
    pub padding: Vec<u8>,
}

/// 0-RTT Resumption: Client → Server.
#[derive(Debug, Clone)]
pub struct PrismaClientResume {
    pub version: u8,
    pub flags: u8,
    pub client_ephemeral_pub: [u8; 32],
    pub session_ticket: Vec<u8>,
    pub encrypted_0rtt_data: Vec<u8>,
}

/// Opaque session ticket for 0-RTT resumption.
#[derive(Debug, Clone)]
pub struct SessionTicket {
    pub client_id: ClientId,
    pub session_key: [u8; 32],
    pub cipher_suite: CipherSuite,
    pub issued_at: u64,
    pub padding_range: PaddingRange,
}

/// PrismaClientInit flags.
pub const CLIENT_INIT_FLAG_0RTT: u8 = 0x01;
pub const CLIENT_INIT_FLAG_RESUMPTION: u8 = 0x02;
/// v5: Client requests header-authenticated encryption.
pub const CLIENT_INIT_FLAG_HEADER_AUTH: u8 = 0x04;
/// v5: Client supports connection migration.
pub const CLIENT_INIT_FLAG_MIGRATION: u8 = 0x08;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum AcceptStatus {
    Ok = 0x00,
    AuthFailed = 0x01,
    ServerBusy = 0x02,
    VersionMismatch = 0x03,
    QuotaExceeded = 0x04,
}

impl AcceptStatus {
    pub fn from_u8(v: u8) -> Option<Self> {
        match v {
            0x00 => Some(AcceptStatus::Ok),
            0x01 => Some(AcceptStatus::AuthFailed),
            0x02 => Some(AcceptStatus::ServerBusy),
            0x03 => Some(AcceptStatus::VersionMismatch),
            0x04 => Some(AcceptStatus::QuotaExceeded),
            _ => None,
        }
    }
}

/// Data command variants.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Command {
    Connect(ProxyDestination),
    Data(Bytes),
    Close,
    Ping(u32),
    Pong(u32),
    /// Client → Server: request the server to listen on `remote_port` and forward traffic back.
    RegisterForward {
        remote_port: u16,
        name: String,
    },
    /// Server → Client: acknowledge a port forward registration.
    ForwardReady {
        remote_port: u16,
        success: bool,
    },
    /// Server → Client: a new inbound connection arrived on a forwarded port.
    /// The `stream_id` on the enclosing DataFrame identifies this forwarded connection.
    ForwardConnect {
        remote_port: u16,
    },
    /// Client → Server: set up UDP relay session.
    UdpAssociate {
        bind_addr_type: u8,
        bind_addr: Vec<u8>,
        bind_port: u16,
    },
    /// Both: UDP datagram relay.
    UdpData {
        assoc_id: u32,
        frag: u8,
        addr_type: u8,
        dest_addr: Vec<u8>,
        dest_port: u16,
        payload: Vec<u8>,
    },
    /// Both: bandwidth measurement.
    SpeedTest {
        direction: u8, // 0=download, 1=upload
        duration_secs: u8,
        data: Vec<u8>,
    },
    /// Client → Server: encrypted DNS query.
    DnsQuery {
        query_id: u16,
        data: Vec<u8>,
    },
    /// Server → Client: encrypted DNS response.
    DnsResponse {
        query_id: u16,
        data: Vec<u8>,
    },
    /// Client → Server: challenge response (first frame after handshake).
    ChallengeResponse {
        hash: [u8; 32], // BLAKE3(challenge)
    },
    /// v5: Connection migration — client presents its migration token to resume
    /// a session on a new transport connection.
    Migration {
        token: [u8; 32],
        session_id: [u8; 16],
    },
}

impl Command {
    pub fn cmd_byte(&self) -> u8 {
        match self {
            Command::Connect(_) => CMD_CONNECT,
            Command::Data(_) => CMD_DATA,
            Command::Close => CMD_CLOSE,
            Command::Ping(_) => CMD_PING,
            Command::Pong(_) => CMD_PONG,
            Command::RegisterForward { .. } => CMD_REGISTER_FORWARD,
            Command::ForwardReady { .. } => CMD_FORWARD_READY,
            Command::ForwardConnect { .. } => CMD_FORWARD_CONNECT,
            Command::UdpAssociate { .. } => CMD_UDP_ASSOCIATE,
            Command::UdpData { .. } => CMD_UDP_DATA,
            Command::SpeedTest { .. } => CMD_SPEED_TEST,
            Command::DnsQuery { .. } => CMD_DNS_QUERY,
            Command::DnsResponse { .. } => CMD_DNS_RESPONSE,
            Command::ChallengeResponse { .. } => CMD_CHALLENGE_RESP,
            Command::Migration { .. } => CMD_MIGRATION,
        }
    }
}

/// A data frame in the PrismaVeil wire protocol.
///
/// Wire format: `[cmd:1][flags:2][stream_id:4][payload:var][padding:var]`
///
/// When `FLAG_BUCKETED` is set:
/// `[cmd:1][flags:2][stream_id:4][bucket_pad_len:2][payload:var][bucket_padding:var]`
#[derive(Debug, Clone)]
pub struct DataFrame {
    pub command: Command,
    pub flags: u16,
    pub stream_id: u32,
}

/// Session keys produced after successful handshake.
#[derive(Debug, Clone)]
pub struct SessionKeys {
    pub session_key: [u8; 32],
    pub cipher_suite: CipherSuite,
    pub session_id: Uuid,
    pub client_id: ClientId,
    pub client_nonce_counter: u64,
    pub server_nonce_counter: u64,
    /// Protocol version negotiated during handshake.
    pub protocol_version: u8,
    /// Padding range for per-frame padding (v2+ only).
    pub padding_range: PaddingRange,
    /// v3: challenge from ServerInit that client must respond to.
    pub challenge: Option<[u8; 32]>,
    /// v3: session ticket for 0-RTT resumption.
    pub session_ticket: Option<Vec<u8>>,
    /// v5: separate key for header-authenticated encryption AAD binding.
    /// When present, frame headers (cmd+flags+stream_id) are bound as AAD.
    pub header_key: Option<[u8; 32]>,
    /// v5: connection migration token for seamless reconnection.
    pub migration_token: Option<[u8; 32]>,
}

impl SessionKeys {
    /// Generate the next nonce for client→server direction.
    pub fn next_client_nonce(&mut self) -> [u8; 12] {
        let nonce = nonce_from_counter(self.client_nonce_counter, true);
        self.client_nonce_counter += 1;
        nonce
    }

    /// Generate the next nonce for server→client direction.
    pub fn next_server_nonce(&mut self) -> [u8; 12] {
        let nonce = nonce_from_counter(self.server_nonce_counter, false);
        self.server_nonce_counter += 1;
        nonce
    }
}

/// Lock-free atomic nonce counter for high-throughput relay paths.
///
/// Replaces `Arc<Mutex<SessionKeys>>` for nonce generation, eliminating
/// mutex contention from the hot path (~30,000+ lock ops/sec saved).
pub struct AtomicNonceCounter {
    counter: AtomicU64,
    is_client: bool,
}

impl AtomicNonceCounter {
    pub fn new(initial: u64, is_client: bool) -> Self {
        Self {
            counter: AtomicU64::new(initial),
            is_client,
        }
    }

    /// Generate the next nonce atomically. Safe to call from multiple tasks.
    #[inline]
    pub fn next_nonce(&self) -> [u8; 12] {
        let counter = self.counter.fetch_add(1, Ordering::Relaxed);
        nonce_from_counter(counter, self.is_client)
    }
}

/// Build a 12-byte nonce from a counter and direction flag.
/// Format: [direction:1][0:3][counter:8]
#[inline]
fn nonce_from_counter(counter: u64, is_client: bool) -> [u8; 12] {
    let mut nonce = [0u8; 12];
    nonce[0] = if is_client { 0x00 } else { 0x01 };
    nonce[4..12].copy_from_slice(&counter.to_be_bytes());
    nonce
}
