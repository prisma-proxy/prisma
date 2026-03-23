use aes_gcm::aead::generic_array::GenericArray;
use aes_gcm::aead::{Aead, AeadInPlace, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce as AesNonce};
use chacha20poly1305::{ChaCha20Poly1305, Nonce as ChaChaNonce};

use crate::error::CryptoError;
use crate::types::{CipherSuite, NONCE_SIZE};

/// Authentication tag size for all cipher suites (16 bytes).
pub const TAG_SIZE: usize = 16;

/// Trait for authenticated encryption with associated data.
pub trait AeadCipher: Send + Sync {
    /// Encrypt plaintext with the given nonce and optional associated data.
    fn encrypt(
        &self,
        nonce: &[u8; NONCE_SIZE],
        plaintext: &[u8],
        aad: &[u8],
    ) -> Result<Vec<u8>, CryptoError>;

    /// Decrypt ciphertext with the given nonce and optional associated data.
    fn decrypt(
        &self,
        nonce: &[u8; NONCE_SIZE],
        ciphertext: &[u8],
        aad: &[u8],
    ) -> Result<Vec<u8>, CryptoError>;

    /// Encrypt buffer in-place and return the 16-byte authentication tag.
    fn encrypt_in_place(
        &self,
        nonce: &[u8; NONCE_SIZE],
        aad: &[u8],
        buffer: &mut [u8],
    ) -> Result<[u8; TAG_SIZE], CryptoError>;

    /// Decrypt buffer in-place using the 16-byte authentication tag.
    fn decrypt_in_place(
        &self,
        nonce: &[u8; NONCE_SIZE],
        aad: &[u8],
        buffer: &mut [u8],
        tag: &[u8; TAG_SIZE],
    ) -> Result<(), CryptoError>;
}

pub struct ChaCha20Poly1305Cipher {
    cipher: ChaCha20Poly1305,
}

impl ChaCha20Poly1305Cipher {
    pub fn new(key: &[u8; 32]) -> Self {
        Self {
            cipher: ChaCha20Poly1305::new(key.into()),
        }
    }
}

impl AeadCipher for ChaCha20Poly1305Cipher {
    fn encrypt(
        &self,
        nonce: &[u8; NONCE_SIZE],
        plaintext: &[u8],
        aad: &[u8],
    ) -> Result<Vec<u8>, CryptoError> {
        let nonce = ChaChaNonce::from_slice(nonce);
        self.cipher
            .encrypt(
                nonce,
                Payload {
                    msg: plaintext,
                    aad,
                },
            )
            .map_err(|e| CryptoError::EncryptionFailed(e.to_string()))
    }

    fn decrypt(
        &self,
        nonce: &[u8; NONCE_SIZE],
        ciphertext: &[u8],
        aad: &[u8],
    ) -> Result<Vec<u8>, CryptoError> {
        let nonce = ChaChaNonce::from_slice(nonce);
        self.cipher
            .decrypt(
                nonce,
                Payload {
                    msg: ciphertext,
                    aad,
                },
            )
            .map_err(|e| CryptoError::DecryptionFailed(e.to_string()))
    }

    fn encrypt_in_place(
        &self,
        nonce: &[u8; NONCE_SIZE],
        aad: &[u8],
        buffer: &mut [u8],
    ) -> Result<[u8; TAG_SIZE], CryptoError> {
        let nonce = ChaChaNonce::from_slice(nonce);
        let tag = self
            .cipher
            .encrypt_in_place_detached(nonce, aad, buffer)
            .map_err(|e| CryptoError::EncryptionFailed(e.to_string()))?;
        let mut tag_bytes = [0u8; TAG_SIZE];
        tag_bytes.copy_from_slice(tag.as_slice());
        Ok(tag_bytes)
    }

    fn decrypt_in_place(
        &self,
        nonce: &[u8; NONCE_SIZE],
        aad: &[u8],
        buffer: &mut [u8],
        tag: &[u8; TAG_SIZE],
    ) -> Result<(), CryptoError> {
        let nonce = ChaChaNonce::from_slice(nonce);
        let tag = GenericArray::from_slice(tag);
        self.cipher
            .decrypt_in_place_detached(nonce, aad, buffer, tag)
            .map_err(|e| CryptoError::DecryptionFailed(e.to_string()))
    }
}

pub struct Aes256GcmCipher {
    cipher: Aes256Gcm,
}

impl Aes256GcmCipher {
    pub fn new(key: &[u8; 32]) -> Self {
        Self {
            cipher: Aes256Gcm::new(key.into()),
        }
    }
}

impl AeadCipher for Aes256GcmCipher {
    fn encrypt(
        &self,
        nonce: &[u8; NONCE_SIZE],
        plaintext: &[u8],
        aad: &[u8],
    ) -> Result<Vec<u8>, CryptoError> {
        let nonce = AesNonce::from_slice(nonce);
        self.cipher
            .encrypt(
                nonce,
                Payload {
                    msg: plaintext,
                    aad,
                },
            )
            .map_err(|e| CryptoError::EncryptionFailed(e.to_string()))
    }

    fn decrypt(
        &self,
        nonce: &[u8; NONCE_SIZE],
        ciphertext: &[u8],
        aad: &[u8],
    ) -> Result<Vec<u8>, CryptoError> {
        let nonce = AesNonce::from_slice(nonce);
        self.cipher
            .decrypt(
                nonce,
                Payload {
                    msg: ciphertext,
                    aad,
                },
            )
            .map_err(|e| CryptoError::DecryptionFailed(e.to_string()))
    }

    fn encrypt_in_place(
        &self,
        nonce: &[u8; NONCE_SIZE],
        aad: &[u8],
        buffer: &mut [u8],
    ) -> Result<[u8; TAG_SIZE], CryptoError> {
        let nonce = AesNonce::from_slice(nonce);
        let tag = self
            .cipher
            .encrypt_in_place_detached(nonce, aad, buffer)
            .map_err(|e| CryptoError::EncryptionFailed(e.to_string()))?;
        let mut tag_bytes = [0u8; TAG_SIZE];
        tag_bytes.copy_from_slice(tag.as_slice());
        Ok(tag_bytes)
    }

    fn decrypt_in_place(
        &self,
        nonce: &[u8; NONCE_SIZE],
        aad: &[u8],
        buffer: &mut [u8],
        tag: &[u8; TAG_SIZE],
    ) -> Result<(), CryptoError> {
        let nonce = AesNonce::from_slice(nonce);
        let tag = GenericArray::from_slice(tag);
        self.cipher
            .decrypt_in_place_detached(nonce, aad, buffer, tag)
            .map_err(|e| CryptoError::DecryptionFailed(e.to_string()))
    }
}

/// Transport-only cipher: BLAKE3 keyed MAC for integrity, no encryption.
///
/// When transport is already TLS/QUIC, application-layer encryption is redundant.
/// This mode replaces AEAD with a BLAKE3 keyed MAC, providing integrity and
/// anti-replay protection without the CPU cost of encryption.
///
/// Wire format is identical to AEAD: `[nonce][len][plaintext][mac:16]`
pub struct TransportOnlyCipher {
    mac_key: [u8; 32],
}

impl TransportOnlyCipher {
    pub fn new(key: &[u8; 32]) -> Self {
        let mac_key: [u8; 32] = blake3::keyed_hash(key, b"prisma-transport-only-mac-v1").into();
        Self { mac_key }
    }

    /// Compute the 16-byte keyed MAC over nonce + data.
    fn compute_mac(&self, nonce: &[u8; NONCE_SIZE], data: &[u8]) -> [u8; TAG_SIZE] {
        let mut hasher = blake3::Hasher::new_keyed(&self.mac_key);
        hasher.update(nonce);
        hasher.update(data);
        let hash_bytes: [u8; 32] = hasher.finalize().into();
        let mut tag = [0u8; TAG_SIZE];
        tag.copy_from_slice(&hash_bytes[..TAG_SIZE]);
        tag
    }
}

impl AeadCipher for TransportOnlyCipher {
    fn encrypt(
        &self,
        nonce: &[u8; NONCE_SIZE],
        plaintext: &[u8],
        _aad: &[u8],
    ) -> Result<Vec<u8>, CryptoError> {
        let tag = self.compute_mac(nonce, plaintext);
        let mut output = Vec::with_capacity(plaintext.len() + TAG_SIZE);
        output.extend_from_slice(plaintext);
        output.extend_from_slice(&tag);
        Ok(output)
    }

    fn decrypt(
        &self,
        nonce: &[u8; NONCE_SIZE],
        ciphertext: &[u8],
        _aad: &[u8],
    ) -> Result<Vec<u8>, CryptoError> {
        if ciphertext.len() < TAG_SIZE {
            return Err(CryptoError::DecryptionFailed(
                "TransportOnly frame too short for MAC".into(),
            ));
        }
        let data_len = ciphertext.len() - TAG_SIZE;
        let data = &ciphertext[..data_len];
        let received_tag = &ciphertext[data_len..];

        let expected_tag = self.compute_mac(nonce, data);
        if !constant_time_eq(received_tag, &expected_tag) {
            return Err(CryptoError::DecryptionFailed(
                "TransportOnly MAC verification failed".into(),
            ));
        }
        Ok(data.to_vec())
    }

    fn encrypt_in_place(
        &self,
        nonce: &[u8; NONCE_SIZE],
        _aad: &[u8],
        buffer: &mut [u8],
    ) -> Result<[u8; TAG_SIZE], CryptoError> {
        // No encryption — data stays as plaintext. Just compute the MAC.
        Ok(self.compute_mac(nonce, buffer))
    }

    fn decrypt_in_place(
        &self,
        nonce: &[u8; NONCE_SIZE],
        _aad: &[u8],
        buffer: &mut [u8],
        tag: &[u8; TAG_SIZE],
    ) -> Result<(), CryptoError> {
        // No decryption needed — verify the MAC only.
        let expected_tag = self.compute_mac(nonce, buffer);
        if !constant_time_eq(tag, &expected_tag) {
            return Err(CryptoError::DecryptionFailed(
                "TransportOnly MAC verification failed".into(),
            ));
        }
        Ok(())
    }
}

/// Constant-time byte comparison using the `subtle` crate for guaranteed
/// constant-time behavior (not subject to compiler optimizations).
#[inline]
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    use subtle::ConstantTimeEq;
    a.ct_eq(b).into()
}

/// Create a cipher instance for the given suite and key.
pub fn create_cipher(suite: CipherSuite, key: &[u8; 32]) -> Box<dyn AeadCipher> {
    match suite {
        CipherSuite::ChaCha20Poly1305 => Box::new(ChaCha20Poly1305Cipher::new(key)),
        CipherSuite::Aes256Gcm => Box::new(Aes256GcmCipher::new(key)),
        CipherSuite::TransportOnly => Box::new(TransportOnlyCipher::new(key)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_round_trip(suite: CipherSuite) {
        let key = [0x42u8; 32];
        let cipher = create_cipher(suite, &key);
        let nonce = [0u8; NONCE_SIZE];
        let plaintext = b"hello, prisma!";
        let aad = b"session-1";

        let ciphertext = cipher.encrypt(&nonce, plaintext, aad).unwrap();
        let decrypted = cipher.decrypt(&nonce, &ciphertext, aad).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    fn test_in_place_round_trip(suite: CipherSuite) {
        let key = [0x42u8; 32];
        let cipher = create_cipher(suite, &key);
        let nonce = [0u8; NONCE_SIZE];
        let plaintext = b"hello, prisma!";

        let mut buffer = plaintext.to_vec();
        let tag = cipher.encrypt_in_place(&nonce, &[], &mut buffer).unwrap();
        // After in-place encrypt, buffer contains ciphertext (same length)
        cipher
            .decrypt_in_place(&nonce, &[], &mut buffer, &tag)
            .unwrap();
        assert_eq!(&buffer, plaintext);
    }

    #[test]
    fn test_chacha20_round_trip() {
        test_round_trip(CipherSuite::ChaCha20Poly1305);
    }

    #[test]
    fn test_aes256gcm_round_trip() {
        test_round_trip(CipherSuite::Aes256Gcm);
    }

    #[test]
    fn test_transport_only_round_trip() {
        test_round_trip(CipherSuite::TransportOnly);
    }

    #[test]
    fn test_chacha20_in_place() {
        test_in_place_round_trip(CipherSuite::ChaCha20Poly1305);
    }

    #[test]
    fn test_aes256gcm_in_place() {
        test_in_place_round_trip(CipherSuite::Aes256Gcm);
    }

    #[test]
    fn test_transport_only_in_place() {
        test_in_place_round_trip(CipherSuite::TransportOnly);
    }

    #[test]
    fn test_transport_only_plaintext_preserved() {
        let key = [0x42u8; 32];
        let cipher = create_cipher(CipherSuite::TransportOnly, &key);
        let nonce = [0u8; NONCE_SIZE];
        let plaintext = b"hello, prisma!";

        let ciphertext = cipher.encrypt(&nonce, plaintext, &[]).unwrap();
        // TransportOnly: first bytes should be the plaintext (no encryption)
        assert_eq!(&ciphertext[..plaintext.len()], &plaintext[..]);
        // Followed by 16-byte MAC
        assert_eq!(ciphertext.len(), plaintext.len() + TAG_SIZE);
    }

    #[test]
    fn test_transport_only_mac_tamper_detection() {
        let key = [0x42u8; 32];
        let cipher = create_cipher(CipherSuite::TransportOnly, &key);
        let nonce = [0u8; NONCE_SIZE];

        let mut ciphertext = cipher.encrypt(&nonce, b"secret", &[]).unwrap();
        // Tamper with the data
        ciphertext[0] ^= 0xFF;
        assert!(cipher.decrypt(&nonce, &ciphertext, &[]).is_err());
    }

    #[test]
    fn test_wrong_key_rejection() {
        let key1 = [0x42u8; 32];
        let key2 = [0x43u8; 32];
        let cipher1 = create_cipher(CipherSuite::ChaCha20Poly1305, &key1);
        let cipher2 = create_cipher(CipherSuite::ChaCha20Poly1305, &key2);

        let nonce = [0u8; NONCE_SIZE];
        let ciphertext = cipher1.encrypt(&nonce, b"secret", b"").unwrap();
        assert!(cipher2.decrypt(&nonce, &ciphertext, b"").is_err());
    }

    #[test]
    fn test_wrong_aad_rejection() {
        let key = [0x42u8; 32];
        let cipher = create_cipher(CipherSuite::Aes256Gcm, &key);
        let nonce = [0u8; NONCE_SIZE];

        let ciphertext = cipher.encrypt(&nonce, b"secret", b"correct-aad").unwrap();
        assert!(cipher.decrypt(&nonce, &ciphertext, b"wrong-aad").is_err());
    }

    #[test]
    fn test_ciphertext_differs_from_plaintext() {
        let key = [0x42u8; 32];
        let cipher = create_cipher(CipherSuite::ChaCha20Poly1305, &key);
        let nonce = [0u8; NONCE_SIZE];
        let plaintext = b"hello, prisma!";

        let ciphertext = cipher.encrypt(&nonce, plaintext, b"").unwrap();
        assert_ne!(&ciphertext[..plaintext.len()], &plaintext[..]);
    }

    #[test]
    fn test_in_place_compat_with_allocating() {
        // Verify that in-place and allocating APIs produce compatible output
        for suite in [
            CipherSuite::ChaCha20Poly1305,
            CipherSuite::Aes256Gcm,
            CipherSuite::TransportOnly,
        ] {
            let key = [0x42u8; 32];
            let cipher = create_cipher(suite, &key);
            let nonce = [1u8; NONCE_SIZE];
            let plaintext = b"cross-check data";

            // Encrypt with allocating API
            let ciphertext = cipher.encrypt(&nonce, plaintext, &[]).unwrap();

            // Encrypt with in-place API
            let mut buffer = plaintext.to_vec();
            let tag = cipher.encrypt_in_place(&nonce, &[], &mut buffer).unwrap();

            // The in-place ciphertext + tag should equal the allocating ciphertext
            let mut combined = buffer.clone();
            combined.extend_from_slice(&tag);
            assert_eq!(combined, ciphertext, "Mismatch for {:?}", suite);

            // Decrypt with allocating API should work on in-place output
            let decrypted = cipher.decrypt(&nonce, &combined, &[]).unwrap();
            assert_eq!(decrypted, plaintext);
        }
    }
}
