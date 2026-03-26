use thiserror::Error;

/// Top-level error type for the Prisma proxy suite.
#[derive(Debug, Error)]
pub enum PrismaError {
    #[error("protocol error: {0}")]
    Protocol(#[from] ProtocolError),

    #[error("crypto error: {0}")]
    Crypto(#[from] CryptoError),

    #[error("config error: {0}")]
    Config(#[from] ConfigError),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("connection error: {0}")]
    Connection(String),

    #[error("auth error: {0}")]
    Auth(String),

    #[error("{0}")]
    Other(#[from] anyhow::Error),
}

#[derive(Debug, Error)]
pub enum ProtocolError {
    #[error("invalid protocol version: {0}")]
    InvalidVersion(u8),

    #[error("invalid command: {0}")]
    InvalidCommand(u8),

    #[error("invalid address type: {0}")]
    InvalidAddressType(u8),

    #[error("frame too large: {size} > {max}")]
    FrameTooLarge { size: usize, max: usize },

    #[error("unexpected message in state {state}: {message}")]
    UnexpectedMessage { state: String, message: String },

    #[error("handshake failed: {0}")]
    HandshakeFailed(String),

    #[error("replay detected: nonce {0}")]
    ReplayDetected(u64),

    #[error("invalid frame: {0}")]
    InvalidFrame(String),
}

#[derive(Debug, Error)]
pub enum CryptoError {
    #[error("encryption failed: {0}")]
    EncryptionFailed(String),

    #[error("decryption failed: {0}")]
    DecryptionFailed(String),
}

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("invalid config: {0}")]
    Invalid(String),

    #[error("validation failed: {0}")]
    ValidationFailed(String),

    #[error("parse error: {0}")]
    ParseError(String),
}

pub type Result<T> = std::result::Result<T, PrismaError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_protocol_error_display() {
        let e = ProtocolError::InvalidVersion(99);
        assert_eq!(e.to_string(), "invalid protocol version: 99");
    }

    #[test]
    fn test_protocol_error_frame_too_large() {
        let e = ProtocolError::FrameTooLarge {
            size: 100_000,
            max: 65535,
        };
        assert!(e.to_string().contains("100000"));
        assert!(e.to_string().contains("65535"));
    }

    #[test]
    fn test_protocol_error_replay_detected() {
        let e = ProtocolError::ReplayDetected(42);
        assert_eq!(e.to_string(), "replay detected: nonce 42");
    }

    #[test]
    fn test_crypto_error_display() {
        let e = CryptoError::EncryptionFailed("bad key".into());
        assert_eq!(e.to_string(), "encryption failed: bad key");

        let e = CryptoError::DecryptionFailed("tag mismatch".into());
        assert_eq!(e.to_string(), "decryption failed: tag mismatch");
    }

    #[test]
    fn test_config_error_display() {
        let e = ConfigError::Invalid("missing field".into());
        assert_eq!(e.to_string(), "invalid config: missing field");

        let e = ConfigError::ValidationFailed("port out of range".into());
        assert_eq!(e.to_string(), "validation failed: port out of range");

        let e = ConfigError::ParseError("bad toml".into());
        assert_eq!(e.to_string(), "parse error: bad toml");
    }

    #[test]
    fn test_prisma_error_from_protocol() {
        let pe = ProtocolError::InvalidCommand(0xFF);
        let e: PrismaError = pe.into();
        assert!(e.to_string().contains("protocol error"));
        assert!(e.to_string().contains("255"));
    }

    #[test]
    fn test_prisma_error_from_crypto() {
        let ce = CryptoError::DecryptionFailed("nonce reuse".into());
        let e: PrismaError = ce.into();
        assert!(e.to_string().contains("crypto error"));
    }

    #[test]
    fn test_prisma_error_from_config() {
        let ce = ConfigError::Invalid("test".into());
        let e: PrismaError = ce.into();
        assert!(e.to_string().contains("config error"));
    }

    #[test]
    fn test_prisma_error_from_io() {
        let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "file not found");
        let e: PrismaError = io_err.into();
        assert!(e.to_string().contains("IO error"));
    }

    #[test]
    fn test_prisma_error_connection() {
        let e = PrismaError::Connection("timeout".into());
        assert_eq!(e.to_string(), "connection error: timeout");
    }

    #[test]
    fn test_prisma_error_auth() {
        let e = PrismaError::Auth("invalid token".into());
        assert_eq!(e.to_string(), "auth error: invalid token");
    }

    #[test]
    fn test_protocol_error_unexpected_message() {
        let e = ProtocolError::UnexpectedMessage {
            state: "handshake".into(),
            message: "data frame".into(),
        };
        assert!(e.to_string().contains("handshake"));
        assert!(e.to_string().contains("data frame"));
    }

    #[test]
    fn test_protocol_error_invalid_frame() {
        let e = ProtocolError::InvalidFrame("truncated".into());
        assert_eq!(e.to_string(), "invalid frame: truncated");
    }

    #[test]
    fn test_protocol_error_handshake_failed() {
        let e = ProtocolError::HandshakeFailed("version mismatch".into());
        assert_eq!(e.to_string(), "handshake failed: version mismatch");
    }

    #[test]
    fn test_protocol_error_invalid_address_type() {
        let e = ProtocolError::InvalidAddressType(0x99);
        assert_eq!(e.to_string(), "invalid address type: 153");
    }
}
