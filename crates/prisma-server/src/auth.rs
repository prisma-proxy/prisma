use std::sync::Arc;

use anyhow::Result;
use tokio::sync::RwLock;

use prisma_core::config::server::AuthorizedClient;
use prisma_core::protocol::handshake::AuthVerifier;
use prisma_core::state::AuthStoreInner;
use prisma_core::types::ClientId;
use prisma_core::util;

/// Thread-safe wrapper around the client store. Supports runtime CRUD via the management API.
#[derive(Clone)]
pub struct AuthStore {
    inner: Arc<RwLock<AuthStoreInner>>,
}

impl AuthStore {
    pub fn from_config(clients: &[AuthorizedClient]) -> Result<Self> {
        let inner = AuthStoreInner::from_config(clients)?;
        Ok(Self {
            inner: Arc::new(RwLock::new(inner)),
        })
    }

    pub fn from_inner(inner: Arc<RwLock<AuthStoreInner>>) -> Self {
        Self { inner }
    }
}

impl AuthStore {
    /// Look up a client's display name by ID.
    pub fn client_name(&self, client_id: &ClientId) -> Option<String> {
        let guard = match self.inner.try_read() {
            Ok(g) => g,
            Err(e) => {
                tracing::error!("AuthStore RwLock poisoned in client_name: {}", e);
                return None;
            }
        };
        guard.clients.get(&client_id.0).and_then(|e| e.name.clone())
    }
}

impl AuthVerifier for AuthStore {
    fn verify(&self, client_id: &ClientId, auth_token: &[u8; 32], timestamp: u64) -> bool {
        let guard = match self.inner.try_read() {
            Ok(g) => g,
            Err(e) => {
                tracing::error!("AuthStore RwLock poisoned in verify: {}", e);
                return false;
            }
        };
        let entry = match guard.clients.get(&client_id.0) {
            Some(e) => e,
            None => return false,
        };
        if !entry.enabled {
            return false;
        }
        let expected = util::compute_auth_token(&entry.auth_secret, client_id, timestamp);
        util::ct_eq(auth_token, &expected)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use prisma_core::config::server::AuthorizedClient;
    use prisma_core::protocol::handshake::AuthVerifier;
    use prisma_core::types::ClientId;
    use prisma_core::util;
    use uuid::Uuid;

    fn test_client() -> AuthorizedClient {
        AuthorizedClient {
            id: "550e8400-e29b-41d4-a716-446655440000".into(),
            auth_secret: "aa".repeat(32), // 64 hex chars -> 32 bytes
            name: Some("test-client".into()),
            bandwidth_up: None,
            bandwidth_down: None,
            quota: None,
            quota_period: None,
            permissions: None,
            tags: Vec::new(),
            owner: None,
        }
    }

    fn test_client_uuid() -> Uuid {
        Uuid::parse_str("550e8400-e29b-41d4-a716-446655440000").unwrap()
    }

    #[test]
    fn test_auth_store_from_config() {
        let clients = vec![test_client()];
        let store = AuthStore::from_config(&clients);
        assert!(store.is_ok());
    }

    #[test]
    fn test_auth_store_verify_correct_token() {
        let client = test_client();
        let clients = vec![client.clone()];
        let store = AuthStore::from_config(&clients).unwrap();

        let uuid = test_client_uuid();
        let client_id = ClientId(uuid);
        let timestamp = 1234567890u64;
        let secret = util::hex_decode_32(&client.auth_secret).unwrap();
        let token = util::compute_auth_token(&secret, &client_id, timestamp);

        assert!(
            store.verify(&client_id, &token, timestamp),
            "Verify should succeed with correct token"
        );
    }

    #[test]
    fn test_auth_store_verify_wrong_token() {
        let clients = vec![test_client()];
        let store = AuthStore::from_config(&clients).unwrap();

        let client_id = ClientId(test_client_uuid());
        let wrong_token = [0xFFu8; 32];

        assert!(
            !store.verify(&client_id, &wrong_token, 1234567890),
            "Verify should fail with wrong token"
        );
    }

    #[test]
    fn test_auth_store_verify_unknown_client() {
        let clients = vec![test_client()];
        let store = AuthStore::from_config(&clients).unwrap();

        let unknown_id = ClientId(Uuid::new_v4());
        let token = [0u8; 32];

        assert!(
            !store.verify(&unknown_id, &token, 0),
            "Verify should fail for unknown client"
        );
    }

    #[test]
    fn test_auth_store_verify_disabled_client() {
        let client = test_client();
        let uuid = test_client_uuid();
        let secret = util::hex_decode_32(&client.auth_secret).unwrap();

        // Build store manually to disable the client
        let mut inner = prisma_core::state::AuthStoreInner::from_config(&[client]).unwrap();
        inner.clients.get_mut(&uuid).unwrap().enabled = false;

        let store = AuthStore::from_inner(Arc::new(RwLock::new(inner)));
        let client_id = ClientId(uuid);
        let timestamp = 999u64;
        let token = util::compute_auth_token(&secret, &client_id, timestamp);

        assert!(
            !store.verify(&client_id, &token, timestamp),
            "Verify should fail for disabled client"
        );
    }

    #[test]
    fn test_auth_store_client_name() {
        let clients = vec![test_client()];
        let store = AuthStore::from_config(&clients).unwrap();

        let client_id = ClientId(test_client_uuid());
        let name = store.client_name(&client_id);
        assert_eq!(name, Some("test-client".into()));
    }

    #[test]
    fn test_auth_store_client_name_unknown() {
        let clients = vec![test_client()];
        let store = AuthStore::from_config(&clients).unwrap();

        let unknown = ClientId(Uuid::new_v4());
        assert_eq!(store.client_name(&unknown), None);
    }

    #[test]
    fn test_auth_store_verify_wrong_timestamp() {
        let client = test_client();
        let clients = vec![client.clone()];
        let store = AuthStore::from_config(&clients).unwrap();

        let uuid = test_client_uuid();
        let client_id = ClientId(uuid);
        let secret = util::hex_decode_32(&client.auth_secret).unwrap();

        // Token for timestamp 1000
        let token = util::compute_auth_token(&secret, &client_id, 1000);
        // Verify with timestamp 2000 — should fail because the token is timestamp-bound
        assert!(
            !store.verify(&client_id, &token, 2000),
            "Verify should fail with wrong timestamp"
        );
    }
}
