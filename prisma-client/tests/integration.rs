//! Integration tests for prisma-client.
//!
//! These tests verify the client-side protocol logic: handshake initiation,
//! session key derivation, challenge response construction, and encrypted
//! frame exchange. The tests create a mock server on a loopback TCP socket
//! that speaks just enough PrismaVeil to exercise the client code paths.

use std::time::Duration;

use tokio::net::TcpListener;

use prisma_core::crypto::aead::create_cipher;
use prisma_core::protocol::codec::*;
use prisma_core::protocol::handshake::*;
use prisma_core::protocol::types::*;
use prisma_core::types::*;
use prisma_core::util;

// ── Test verifier ─────────────────────────────────────────────────────────────

struct TestVerifier {
    client_id: ClientId,
    auth_secret: [u8; 32],
}

impl AuthVerifier for TestVerifier {
    fn verify(&self, client_id: &ClientId, auth_token: &[u8; 32], timestamp: u64) -> bool {
        if *client_id != self.client_id {
            return false;
        }
        let expected = util::compute_auth_token(&self.auth_secret, client_id, timestamp);
        util::ct_eq(auth_token, &expected)
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

/// Test that the client handshake state machine produces valid init bytes.
#[test]
fn test_client_handshake_produces_valid_init() {
    let client_id = ClientId::new();
    let auth_secret = [0x42u8; 32];

    let hs = PrismaHandshakeClient::new(client_id, auth_secret, CipherSuite::ChaCha20Poly1305);
    let (_state, init_bytes) = hs.start();

    // Should be decodable
    let decoded = decode_client_init(&init_bytes).unwrap();
    assert_eq!(decoded.version, PRISMA_PROTOCOL_VERSION);
    assert_eq!(decoded.client_id, client_id);
    assert_eq!(decoded.cipher_suite, CipherSuite::ChaCha20Poly1305);
}

/// Test client-side handshake completion with a mock server.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn test_client_processes_server_init() {
    let client_id = ClientId::new();
    let auth_secret = [0x42u8; 32];
    let ticket_key = [0xFFu8; 32];

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();

    let verifier = TestVerifier {
        client_id,
        auth_secret,
    };

    // Mock server
    let server = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let ci_buf = util::read_framed(&mut stream).await.unwrap();

        let (si_bytes, server_state) = PrismaHandshakeServer::process_client_init(
            &ci_buf,
            PaddingRange::new(0, 256),
            FEATURE_UDP_RELAY | FEATURE_SPEED_TEST,
            &ticket_key,
            &[128, 256, 512],
            &verifier,
        )
        .unwrap();

        util::write_framed(&mut stream, &si_bytes).await.unwrap();
        server_state.into_session_keys()
    });

    tokio::time::sleep(Duration::from_millis(50)).await;

    let mut client_stream = tokio::net::TcpStream::connect(addr).await.unwrap();

    let hs = PrismaHandshakeClient::new(client_id, auth_secret, CipherSuite::ChaCha20Poly1305);
    let (client_state, init_bytes) = hs.start();
    util::write_framed(&mut client_stream, &init_bytes)
        .await
        .unwrap();

    let si_buf = util::read_framed(&mut client_stream).await.unwrap();
    let (client_keys, buckets) = client_state.process_server_init(&si_buf).unwrap();

    let server_keys = tokio::time::timeout(Duration::from_secs(2), server)
        .await
        .unwrap()
        .unwrap();

    // Verify key agreement
    assert_eq!(client_keys.session_key, server_keys.session_key);
    assert_eq!(client_keys.session_id, server_keys.session_id);

    // Verify bucket sizes propagated
    assert_eq!(buckets, vec![128, 256, 512]);

    // Verify challenge is present
    assert!(client_keys.challenge.is_some());
    assert!(client_keys.session_ticket.is_some());
}

/// Test client correctly constructs a challenge response.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn test_client_challenge_response() {
    let client_id = ClientId::new();
    let auth_secret = [0x42u8; 32];
    let ticket_key = [0xFFu8; 32];

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();

    let verifier = TestVerifier {
        client_id,
        auth_secret,
    };

    let server = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let ci_buf = util::read_framed(&mut stream).await.unwrap();

        let (si_bytes, server_completed) = PrismaHandshakeServer::process_client_init(
            &ci_buf,
            PaddingRange::new(0, 256),
            0,
            &ticket_key,
            &[],
            &verifier,
        )
        .unwrap();

        util::write_framed(&mut stream, &si_bytes).await.unwrap();

        let session_keys = server_completed.into_session_keys();
        let cipher = create_cipher(session_keys.cipher_suite, &session_keys.session_key);

        // Read client's challenge response
        let frame_buf = util::read_framed(&mut stream).await.unwrap();
        let (plaintext, _) = decrypt_frame(cipher.as_ref(), &frame_buf).unwrap();
        let frame = decode_data_frame(&plaintext).unwrap();

        let Command::ChallengeResponse { hash } = frame.command else {
            panic!("Expected ChallengeResponse");
        };

        // Verify it matches
        let challenge = session_keys.challenge.as_ref().unwrap();
        let expected: [u8; 32] = blake3::hash(challenge).into();
        assert!(
            util::ct_eq(&hash, &expected),
            "Challenge response hash mismatch"
        );
    });

    tokio::time::sleep(Duration::from_millis(50)).await;

    let mut client_stream = tokio::net::TcpStream::connect(addr).await.unwrap();

    let hs = PrismaHandshakeClient::new(client_id, auth_secret, CipherSuite::ChaCha20Poly1305);
    let (client_state, init_bytes) = hs.start();
    util::write_framed(&mut client_stream, &init_bytes)
        .await
        .unwrap();

    let si_buf = util::read_framed(&mut client_stream).await.unwrap();
    let (mut session_keys, _) = client_state.process_server_init(&si_buf).unwrap();

    let cipher = create_cipher(session_keys.cipher_suite, &session_keys.session_key);

    // Construct and send challenge response
    let challenge = session_keys.challenge.take().unwrap();
    let hash: [u8; 32] = blake3::hash(&challenge).into();
    let frame = DataFrame {
        command: Command::ChallengeResponse { hash },
        flags: 0,
        stream_id: 0,
    };
    let frame_bytes = encode_data_frame(&frame);
    let nonce = session_keys.next_client_nonce();
    let encrypted = encrypt_frame(cipher.as_ref(), &nonce, &frame_bytes).unwrap();
    util::write_framed(&mut client_stream, &encrypted)
        .await
        .unwrap();

    let _ = tokio::time::timeout(Duration::from_secs(2), server).await;
}

/// Test Connect command construction with IPv4 destination.
#[test]
fn test_connect_command_ipv4() {
    let frame = DataFrame {
        command: Command::Connect(ProxyDestination {
            address: ProxyAddress::Ipv4(std::net::Ipv4Addr::new(127, 0, 0, 1)),
            port: 8080,
        }),
        flags: 0,
        stream_id: 1,
    };
    let encoded = encode_data_frame(&frame);
    let decoded = decode_data_frame(&encoded).unwrap();
    assert_eq!(decoded.command, frame.command);
    assert_eq!(decoded.stream_id, 1);
}

/// Test Connect command construction with IPv6 destination.
#[test]
fn test_connect_command_ipv6() {
    let frame = DataFrame {
        command: Command::Connect(ProxyDestination {
            address: ProxyAddress::Ipv6(std::net::Ipv6Addr::LOCALHOST),
            port: 443,
        }),
        flags: 0,
        stream_id: 2,
    };
    let encoded = encode_data_frame(&frame);
    let decoded = decode_data_frame(&encoded).unwrap();
    assert_eq!(decoded.command, frame.command);
}

/// Test Connect command construction with domain destination.
#[test]
fn test_connect_command_domain() {
    let frame = DataFrame {
        command: Command::Connect(ProxyDestination {
            address: ProxyAddress::Domain("example.com".into()),
            port: 443,
        }),
        flags: 0,
        stream_id: 3,
    };
    let encoded = encode_data_frame(&frame);
    let decoded = decode_data_frame(&encoded).unwrap();
    assert_eq!(decoded.command, frame.command);
}

/// Test bidirectional encrypted data exchange between client and mock server.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn test_bidirectional_data_exchange() {
    let client_id = ClientId::new();
    let auth_secret = [0x42u8; 32];
    let ticket_key = [0xFFu8; 32];

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();

    let verifier = TestVerifier {
        client_id,
        auth_secret,
    };

    let server = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let ci_buf = util::read_framed(&mut stream).await.unwrap();

        let (si_bytes, server_state) = PrismaHandshakeServer::process_client_init(
            &ci_buf,
            PaddingRange::new(0, 256),
            0,
            &ticket_key,
            &[],
            &verifier,
        )
        .unwrap();

        util::write_framed(&mut stream, &si_bytes).await.unwrap();
        let mut session_keys = server_state.into_session_keys();
        let cipher = create_cipher(session_keys.cipher_suite, &session_keys.session_key);

        // Verify challenge response
        let frame_buf = util::read_framed(&mut stream).await.unwrap();
        let (plaintext, _) = decrypt_frame(cipher.as_ref(), &frame_buf).unwrap();
        let frame = decode_data_frame(&plaintext).unwrap();
        assert!(matches!(frame.command, Command::ChallengeResponse { .. }));

        // Read client data
        let frame_buf = util::read_framed(&mut stream).await.unwrap();
        let (plaintext, _) = decrypt_frame(cipher.as_ref(), &frame_buf).unwrap();
        let frame = decode_data_frame(&plaintext).unwrap();

        if let Command::Data(data) = frame.command {
            assert_eq!(&data[..], b"client->server");

            // Send response data
            let resp = DataFrame {
                command: Command::Data(bytes::Bytes::from_static(b"server->client")),
                flags: 0,
                stream_id: 0,
            };
            let frame_bytes = encode_data_frame(&resp);
            let nonce = session_keys.next_server_nonce();
            let encrypted = encrypt_frame(cipher.as_ref(), &nonce, &frame_bytes).unwrap();
            util::write_framed(&mut stream, &encrypted).await.unwrap();
        } else {
            panic!("Expected Data command");
        }
    });

    tokio::time::sleep(Duration::from_millis(50)).await;

    let mut client_stream = tokio::net::TcpStream::connect(addr).await.unwrap();

    let hs = PrismaHandshakeClient::new(client_id, auth_secret, CipherSuite::ChaCha20Poly1305);
    let (client_state, init_bytes) = hs.start();
    util::write_framed(&mut client_stream, &init_bytes)
        .await
        .unwrap();

    let si_buf = util::read_framed(&mut client_stream).await.unwrap();
    let (mut session_keys, _) = client_state.process_server_init(&si_buf).unwrap();

    let cipher = create_cipher(session_keys.cipher_suite, &session_keys.session_key);

    // Send challenge response
    let challenge = session_keys.challenge.take().unwrap();
    let hash: [u8; 32] = blake3::hash(&challenge).into();
    let cr_frame = DataFrame {
        command: Command::ChallengeResponse { hash },
        flags: 0,
        stream_id: 0,
    };
    let frame_bytes = encode_data_frame(&cr_frame);
    let nonce = session_keys.next_client_nonce();
    let encrypted = encrypt_frame(cipher.as_ref(), &nonce, &frame_bytes).unwrap();
    util::write_framed(&mut client_stream, &encrypted)
        .await
        .unwrap();

    // Send data
    let data_frame = DataFrame {
        command: Command::Data(bytes::Bytes::from_static(b"client->server")),
        flags: 0,
        stream_id: 0,
    };
    let frame_bytes = encode_data_frame(&data_frame);
    let nonce = session_keys.next_client_nonce();
    let encrypted = encrypt_frame(cipher.as_ref(), &nonce, &frame_bytes).unwrap();
    util::write_framed(&mut client_stream, &encrypted)
        .await
        .unwrap();

    // Receive response
    let resp_buf = util::read_framed(&mut client_stream).await.unwrap();
    let (plaintext, _) = decrypt_frame(cipher.as_ref(), &resp_buf).unwrap();
    let response = decode_data_frame(&plaintext).unwrap();

    if let Command::Data(data) = response.command {
        assert_eq!(&data[..], b"server->client");
    } else {
        panic!("Expected Data response");
    }

    let _ = tokio::time::timeout(Duration::from_secs(2), server).await;
}

/// Test nonce counter monotonicity: client and server nonces never overlap.
#[test]
fn test_nonce_counter_monotonicity() {
    let mut keys = SessionKeys {
        session_key: [0xAA; 32],
        cipher_suite: CipherSuite::ChaCha20Poly1305,
        session_id: uuid::Uuid::nil(),
        client_id: ClientId::new(),
        client_nonce_counter: 0,
        server_nonce_counter: 0,
        padding_range: PaddingRange::new(0, 256),
        challenge: None,
        session_ticket: None,
        header_key: None,
        migration_token: None,
    };

    let cn1 = keys.next_client_nonce();
    let cn2 = keys.next_client_nonce();
    let sn1 = keys.next_server_nonce();
    let sn2 = keys.next_server_nonce();

    // Each successive nonce must differ
    assert_ne!(cn1, cn2);
    assert_ne!(sn1, sn2);

    // Client and server nonces must differ (direction byte differs)
    assert_ne!(cn1, sn1);
}

/// Test that PQ KEM handshake produces valid keys when both sides support it.
#[test]
fn test_pq_kem_handshake_keys_agree() {
    let client_id = ClientId::new();
    let auth_secret = [0x42u8; 32];
    let ticket_key = [0xFFu8; 32];

    let verifier = TestVerifier {
        client_id,
        auth_secret,
    };

    let hs = PrismaHandshakeClient::new(client_id, auth_secret, CipherSuite::ChaCha20Poly1305)
        .with_pq_kem();
    let (client_state, init_bytes) = hs.start();

    let (si_bytes, server_state) = PrismaHandshakeServer::process_client_init(
        &init_bytes,
        PaddingRange::new(0, 256),
        FEATURE_PQ_KEM,
        &ticket_key,
        &[],
        &verifier,
    )
    .unwrap();

    let (client_keys, _) = client_state.process_server_init(&si_bytes).unwrap();
    let server_keys = server_state.into_session_keys();

    assert_eq!(client_keys.session_key, server_keys.session_key);
    assert_ne!(client_keys.session_key, [0u8; 32]);
}
