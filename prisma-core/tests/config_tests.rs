use prisma_core::config::{load_client_config, load_server_config};

fn fixture(name: &str) -> String {
    format!("{}/tests/fixtures/{}", env!("CARGO_MANIFEST_DIR"), name)
}

#[test]
fn test_load_valid_server_config() {
    let config = load_server_config(&fixture("valid_server")).unwrap();
    assert_eq!(config.listen_addr, "0.0.0.0:8443");
    assert_eq!(config.authorized_clients.len(), 1);
    assert_eq!(
        config.authorized_clients[0].name,
        Some("test-client".into())
    );
    assert_eq!(config.logging.level, "debug");
    assert_eq!(config.performance.max_connections, 512);
}

#[test]
fn test_load_valid_client_config() {
    let config = load_client_config(&fixture("valid_client")).unwrap();
    assert_eq!(config.socks5_listen_addr, "127.0.0.1:1080");
    assert_eq!(config.server_addr, "127.0.0.1:8443");
    assert_eq!(config.cipher_suite, "chacha20-poly1305");
    assert_eq!(config.transport, "tcp");
    assert_eq!(config.logging.format, "json");
}

#[test]
fn test_reject_server_no_clients() {
    let result = load_server_config(&fixture("bad_server_no_clients"));
    assert!(result.is_err());
    let err = format!("{}", result.unwrap_err());
    assert!(
        err.contains("at least one authorized client"),
        "Expected 'at least one authorized client', got: {}",
        err
    );
}

#[test]
fn test_reject_server_invalid_hex() {
    let result = load_server_config(&fixture("bad_server_invalid_hex"));
    assert!(result.is_err());
    let err = format!("{}", result.unwrap_err());
    assert!(
        err.contains("valid hex"),
        "Expected 'valid hex' error, got: {}",
        err
    );
}

#[test]
fn test_reject_client_invalid_cipher() {
    let result = load_client_config(&fixture("bad_client_invalid_cipher"));
    assert!(result.is_err());
    let err = format!("{}", result.unwrap_err());
    assert!(
        err.contains("cipher_suite"),
        "Expected cipher_suite error, got: {}",
        err
    );
}

#[test]
fn test_reject_nonexistent_config() {
    let result = load_server_config("/nonexistent/path/to/config");
    assert!(result.is_err());
}

#[test]
fn test_server_config_defaults() {
    // The valid config overrides some defaults; check the defaults flow through
    let config = load_server_config(&fixture("valid_server")).unwrap();
    // connection_timeout is explicitly set to 60 in the fixture
    assert_eq!(config.performance.connection_timeout_secs, 60);
}

#[test]
fn test_mgmt_listen_addr_from_toml() {
    let config = load_server_config(&fixture("valid_server_mgmt")).unwrap();
    assert_eq!(config.management_api.enabled, true);
    assert_eq!(
        config.management_api.listen_addr, "0.0.0.0:9090",
        "listen_addr should preserve 0.0.0.0:9090 from TOML, got: {}",
        config.management_api.listen_addr
    );
    assert_eq!(config.management_api.auth_token, "test-mgmt-token");
}

#[test]
fn test_mgmt_listen_addr_default_when_omitted() {
    // When [management_api] is not in the TOML, default should be 127.0.0.1:9090
    let config = load_server_config(&fixture("valid_server")).unwrap();
    assert_eq!(config.management_api.listen_addr, "127.0.0.1:9090");
    assert_eq!(config.management_api.enabled, false);
}

#[test]
fn test_mgmt_tls_defaults_to_disabled() {
    // When [management_api] exists but tls_enabled is not set, it should default to false.
    // This is critical: if tls_enabled defaults to true, the mgmt API silently serves
    // HTTPS (inheriting the server cert), making HTTP access from the public network fail.
    let config = load_server_config(&fixture("valid_server_mgmt")).unwrap();
    assert_eq!(
        config.management_api.tls_enabled, false,
        "tls_enabled must default to false so the API serves HTTP out of the box"
    );
    assert!(
        config.management_api.tls.is_none(),
        "tls must be None when tls_enabled is false and no [management_api.tls] is set"
    );
}

#[test]
fn test_mgmt_addr_survives_clone() {
    // Verify that cloning ManagementApiConfig preserves listen_addr.
    // The server clones the config before passing to prisma_mgmt::serve.
    let config = load_server_config(&fixture("valid_server_mgmt")).unwrap();
    let cloned = config.management_api.clone();
    assert_eq!(
        cloned.listen_addr, "0.0.0.0:9090",
        "listen_addr must survive clone"
    );
    assert_eq!(cloned.enabled, true);
    assert_eq!(cloned.tls_enabled, false);
}
