//! Session ticket key rotation ring.
//!
//! A `TicketKeyRing` holds the current encryption key and the last N expired keys.
//! Session tickets encrypted with any key in the ring can be decrypted, allowing
//! graceful key rotation without invalidating in-flight tickets.
//!
//! The ring rotates automatically on a configurable interval (default: 6 hours).
//! Old keys are zeroized when evicted from the ring.

use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};

use zeroize::Zeroize;

use crate::crypto::aead::create_cipher;
use crate::types::{CipherSuite, NONCE_SIZE};

/// Default rotation interval: 6 hours.
const DEFAULT_ROTATION_INTERVAL: Duration = Duration::from_secs(6 * 3600);

/// Default number of expired keys to retain.
const DEFAULT_RETAINED_KEYS: usize = 3;

/// A single key entry in the ring with its creation timestamp.
struct KeyEntry {
    key: [u8; 32],
    created_at: Instant,
}

impl Drop for KeyEntry {
    fn drop(&mut self) {
        self.key.zeroize();
    }
}

/// Thread-safe session ticket key ring with automatic rotation.
///
/// Encrypt always uses the current (newest) key.
/// Decrypt tries all keys in the ring (current + retained expired keys).
pub struct TicketKeyRing {
    inner: Arc<RwLock<TicketKeyRingInner>>,
    rotation_interval: Duration,
}

struct TicketKeyRingInner {
    /// The current key is always at index 0. Older keys follow.
    keys: Vec<KeyEntry>,
    /// Maximum number of keys to keep (1 current + N expired).
    max_keys: usize,
}

impl TicketKeyRing {
    /// Create a new key ring with the given initial key.
    ///
    /// - `initial_key`: the first (current) ticket encryption key.
    /// - `rotation_interval`: how often to rotate to a new key. `None` uses the
    ///   default of 6 hours.
    /// - `retained_keys`: how many expired keys to keep for decryption. `None`
    ///   uses the default of 3.
    pub fn new(
        initial_key: [u8; 32],
        rotation_interval: Option<Duration>,
        retained_keys: Option<usize>,
    ) -> Self {
        let rotation_interval = rotation_interval.unwrap_or(DEFAULT_ROTATION_INTERVAL);
        let retained = retained_keys.unwrap_or(DEFAULT_RETAINED_KEYS);
        let entry = KeyEntry {
            key: initial_key,
            created_at: Instant::now(),
        };
        let inner = TicketKeyRingInner {
            keys: vec![entry],
            max_keys: 1 + retained,
        };
        Self {
            inner: Arc::new(RwLock::new(inner)),
            rotation_interval,
        }
    }

    /// Check if the current key has expired and rotate if necessary.
    /// Generates a new key using BLAKE3 KDF from the current key + a counter.
    pub fn maybe_rotate(&self) {
        let needs_rotation = {
            let inner = self
                .inner
                .read()
                .expect("ticket key ring read lock poisoned");
            if let Some(current) = inner.keys.first() {
                current.created_at.elapsed() >= self.rotation_interval
            } else {
                true
            }
        };

        if needs_rotation {
            self.rotate();
        }
    }

    /// Force a key rotation. Derives a new key from the current key using BLAKE3 KDF.
    pub fn rotate(&self) {
        let mut inner = self
            .inner
            .write()
            .expect("ticket key ring write lock poisoned");
        let new_key = if let Some(current) = inner.keys.first() {
            // Derive new key from current key + rotation counter (key count).
            let counter = inner.keys.len() as u64;
            let mut hasher = blake3::Hasher::new_derive_key("prisma-ticket-key-rotation");
            hasher.update(&current.key);
            hasher.update(&counter.to_le_bytes());
            let hash = hasher.finalize();
            *hash.as_bytes()
        } else {
            // Should not happen, but generate a random key as fallback
            let mut key = [0u8; 32];
            rand::Rng::fill(&mut rand::thread_rng(), &mut key);
            key
        };

        let entry = KeyEntry {
            key: new_key,
            created_at: Instant::now(),
        };

        // Insert new key at the front
        inner.keys.insert(0, entry);

        // Evict oldest keys beyond the max (they will be zeroized on Drop)
        while inner.keys.len() > inner.max_keys {
            inner.keys.pop();
        }
    }

    /// Get the current (newest) ticket key for encryption.
    pub fn current_key(&self) -> [u8; 32] {
        self.maybe_rotate();
        let inner = self
            .inner
            .read()
            .expect("ticket key ring read lock poisoned");
        inner.keys.first().map(|e| e.key).unwrap_or([0u8; 32])
    }

    /// Encrypt a session ticket using the current key.
    ///
    /// Format: [key_index: 1][nonce: NONCE_SIZE][ciphertext: variable]
    /// A fresh random nonce is generated per encryption to prevent nonce reuse.
    pub fn encrypt_ticket(&self, plaintext: &[u8]) -> Result<Vec<u8>, crate::error::CryptoError> {
        self.maybe_rotate();
        let inner = self
            .inner
            .read()
            .expect("ticket key ring read lock poisoned");
        let current = inner
            .keys
            .first()
            .ok_or_else(|| crate::error::CryptoError::EncryptionFailed("No keys in ring".into()))?;
        let cipher = create_cipher(CipherSuite::ChaCha20Poly1305, &current.key);
        let mut nonce = [0u8; NONCE_SIZE];
        rand::Rng::fill(&mut rand::thread_rng(), &mut nonce);
        let ciphertext = cipher.encrypt(&nonce, plaintext, &[])?;

        // Format: [key_index: 1][nonce: NONCE_SIZE][ciphertext]
        let mut result = Vec::with_capacity(1 + NONCE_SIZE + ciphertext.len());
        result.push(0u8);
        result.extend_from_slice(&nonce);
        result.extend_from_slice(&ciphertext);
        Ok(result)
    }

    /// Decrypt a session ticket, trying all keys in the ring.
    ///
    /// Expected format: [key_index: 1][nonce: NONCE_SIZE][ciphertext]
    /// The key index is a hint; all keys are tried for robustness.
    pub fn decrypt_ticket(&self, data: &[u8]) -> Result<Vec<u8>, crate::error::CryptoError> {
        if data.len() < 1 + NONCE_SIZE + 1 {
            return Err(crate::error::CryptoError::DecryptionFailed(
                "Ticket data too short".into(),
            ));
        }

        self.maybe_rotate();
        let inner = self
            .inner
            .read()
            .expect("ticket key ring read lock poisoned");
        let hint = data[0] as usize;
        let nonce: [u8; NONCE_SIZE] = data[1..1 + NONCE_SIZE]
            .try_into()
            .map_err(|_| crate::error::CryptoError::DecryptionFailed("Invalid nonce".into()))?;
        let ciphertext = &data[1 + NONCE_SIZE..];

        // Try the hinted key first, then all others
        if hint < inner.keys.len() {
            let cipher = create_cipher(CipherSuite::ChaCha20Poly1305, &inner.keys[hint].key);
            if let Ok(plaintext) = cipher.decrypt(&nonce, ciphertext, &[]) {
                return Ok(plaintext);
            }
        }

        for (i, entry) in inner.keys.iter().enumerate() {
            if i == hint {
                continue;
            }
            let cipher = create_cipher(CipherSuite::ChaCha20Poly1305, &entry.key);
            if let Ok(plaintext) = cipher.decrypt(&nonce, ciphertext, &[]) {
                return Ok(plaintext);
            }
        }

        Err(crate::error::CryptoError::DecryptionFailed(
            "No key in the ring could decrypt this ticket".into(),
        ))
    }

    /// Get the number of keys currently in the ring.
    pub fn key_count(&self) -> usize {
        let inner = self
            .inner
            .read()
            .expect("ticket key ring read lock poisoned");
        inner.keys.len()
    }

    /// Get the rotation interval.
    pub fn rotation_interval(&self) -> Duration {
        self.rotation_interval
    }
}

impl Clone for TicketKeyRing {
    fn clone(&self) -> Self {
        Self {
            inner: Arc::clone(&self.inner),
            rotation_interval: self.rotation_interval,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encrypt_decrypt_round_trip() {
        let key = [0x42u8; 32];
        let ring = TicketKeyRing::new(key, Some(Duration::from_secs(3600)), None);

        let plaintext = b"session-ticket-data-12345";
        let encrypted = ring.encrypt_ticket(plaintext).unwrap();
        let decrypted = ring.decrypt_ticket(&encrypted).unwrap();

        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_decrypt_after_rotation() {
        let key = [0x42u8; 32];
        let ring = TicketKeyRing::new(key, Some(Duration::from_secs(3600)), Some(3));

        let plaintext = b"session-ticket-before-rotation";
        let encrypted = ring.encrypt_ticket(plaintext).unwrap();

        // Rotate the key
        ring.rotate();
        assert_eq!(ring.key_count(), 2);

        // Old ticket should still decrypt
        let decrypted = ring.decrypt_ticket(&encrypted).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_decrypt_after_multiple_rotations() {
        let key = [0x42u8; 32];
        let ring = TicketKeyRing::new(key, Some(Duration::from_secs(3600)), Some(3));

        let plaintext = b"old-ticket";
        let encrypted = ring.encrypt_ticket(plaintext).unwrap();

        // Rotate three times (within retained limit)
        ring.rotate();
        ring.rotate();
        ring.rotate();
        assert_eq!(ring.key_count(), 4); // 1 current + 3 retained

        // Old ticket should still decrypt
        let decrypted = ring.decrypt_ticket(&encrypted).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_decrypt_fails_after_eviction() {
        let key = [0x42u8; 32];
        let ring = TicketKeyRing::new(key, Some(Duration::from_secs(3600)), Some(2));

        let plaintext = b"will-be-evicted";
        let encrypted = ring.encrypt_ticket(plaintext).unwrap();

        // Rotate 3 times (only 2 retained, so the original key gets evicted)
        ring.rotate();
        ring.rotate();
        ring.rotate();
        assert_eq!(ring.key_count(), 3); // 1 current + 2 retained

        // Old ticket should fail to decrypt (original key evicted)
        let result = ring.decrypt_ticket(&encrypted);
        assert!(result.is_err());
    }

    #[test]
    fn test_new_ticket_decrypts_after_rotation() {
        let key = [0x42u8; 32];
        let ring = TicketKeyRing::new(key, Some(Duration::from_secs(3600)), None);

        ring.rotate();
        ring.rotate();

        let plaintext = b"new-ticket-after-rotation";
        let encrypted = ring.encrypt_ticket(plaintext).unwrap();
        let decrypted = ring.decrypt_ticket(&encrypted).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_rotation_produces_different_keys() {
        let key = [0x42u8; 32];
        let ring = TicketKeyRing::new(key, Some(Duration::from_secs(3600)), None);

        let key1 = ring.current_key();
        ring.rotate();
        let key2 = ring.current_key();

        assert_ne!(key1, key2);
    }

    #[test]
    fn test_default_rotation_interval() {
        let key = [0x42u8; 32];
        let ring = TicketKeyRing::new(key, None, None);
        assert_eq!(ring.rotation_interval(), Duration::from_secs(6 * 3600));
    }

    #[test]
    fn test_empty_ticket_fails() {
        let key = [0x42u8; 32];
        let ring = TicketKeyRing::new(key, None, None);
        assert!(ring.decrypt_ticket(&[]).is_err());
    }
}
