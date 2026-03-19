//! Integration tests for prisma-server.
//!
//! These tests exercise the PrismaVeil handshake, challenge-response,
//! and encrypted relay pipeline in-process without requiring network listeners.
//! They use raw TCP streams over loopback to simulate each transport's
//! handshake -> relay -> disconnect lifecycle.

use std::sync::Arc;
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

use prisma_core::crypto::aead::create_cipher;
use prisma_core::protocol::codec::*;
use prisma_core::protocol::handshake::*;
use prisma_core::protocol::types::*;
use prisma_core::types::*;
use prisma_core::util;

// ── Test verifier ─────────────────────────────────────────────────────────────

/// Simple auth verifier for tests: accepts a single client_id + auth_secret pair.
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

// ── Helper: run a full handshake on raw TCP ──────────────────────────────────

/// Perform the PrismaVeil handshake from the server side of a stream.
/// Returns the negotiated SessionKeys.
async fn server_handshake(
    stream: &mut TcpStream,
    verifier: &dyn AuthVerifier,
    ticket_key: &[u8; 32],
) -> SessionKeys {
    let client_init_buf = util::read_framed(stream).await.unwrap();
    let padding_range = PaddingRange::new(0, 256);
    let (si_bytes, server_state) = PrismaHandshakeServer::process_client_init(
        &client_init_buf,
        padding_range,
        FEATURE_UDP_RELAY | FEATURE_SPEED_TEST | FEATURE_DNS_TUNNEL,
        ticket_key,
        &[],
        verifier,
    )
    .unwrap();
    util::write_framed(stream, &si_bytes).await.unwrap();
    server_state.into_session_keys()
}

/// Perform the PrismaVeil handshake from the client side of a stream.
/// Returns the negotiated SessionKeys.
async fn client_handshake(
    stream: &mut TcpStream,
    client_id: ClientId,
    auth_secret: [u8; 32],
    cipher_suite: CipherSuite,
) -> SessionKeys {
    let hs = PrismaHandshakeClient::new(client_id, auth_secret, cipher_suite);
    let (client_state, init_bytes) = hs.start();
    util::write_framed(stream, &init_bytes).await.unwrap();

    let si_buf = util::read_framed(stream).await.unwrap();
    let (session_keys, _buckets) = client_state.process_server_init(&si_buf).unwrap();
    session_keys
}

/// Send a ChallengeResponse as the first data frame (required by protocol).
async fn send_challenge_response(
    stream: &mut TcpStream,
    session_keys: &mut SessionKeys,
    cipher: &dyn prisma_core::crypto::aead::AeadCipher,
) {
    let challenge = session_keys.challenge.take().unwrap();
    let hash: [u8; 32] = blake3::hash(&challenge).into();
    let frame = DataFrame {
        command: Command::ChallengeResponse { hash },
        flags: 0,
        stream_id: 0,
    };
    let frame_bytes = encode_data_frame(&frame);
    let nonce = session_keys.next_client_nonce();
    let encrypted = encrypt_frame(cipher, &nonce, &frame_bytes).unwrap();
    util::write_framed(stream, &encrypted).await.unwrap();
}

/// Receive and verify the ChallengeResponse from the first data frame.
async fn recv_challenge_response(
    stream: &mut TcpStream,
    session_keys: &SessionKeys,
    cipher: &dyn prisma_core::crypto::aead::AeadCipher,
) {
    let frame_buf = util::read_framed(stream).await.unwrap();
    let (plaintext, _) = decrypt_frame(cipher, &frame_buf).unwrap();
    let frame = decode_data_frame(&plaintext).unwrap();

    let Command::ChallengeResponse { hash } = frame.command else {
        panic!(
            "Expected ChallengeResponse, got cmd={}",
            frame.command.cmd_byte()
        );
    };

    let challenge = session_keys.challenge.as_ref().unwrap();
    let expected: [u8; 32] = blake3::hash(challenge).into();
    assert!(
        util::ct_eq(&hash, &expected),
        "Challenge response hash mismatch"
    );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

/// Full handshake -> challenge response -> Connect -> echo relay -> disconnect
/// over plain TCP transport.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn test_tcp_handshake_echo_relay() {
    let client_id = ClientId::new();
    let auth_secret = [0x42u8; 32];
    let ticket_key = [0xFFu8; 32];

    // Start echo server
    let echo_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let echo_addr = echo_listener.local_addr().unwrap();
    tokio::spawn(async move {
        if let Ok((mut stream, _)) = echo_listener.accept().await {
            let mut buf = vec![0u8; 4096];
            loop {
                match stream.read(&mut buf).await {
                    Ok(0) => break,
                    Ok(n) => {
                        if stream.write_all(&buf[..n]).await.is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
        }
    });

    // Create tunnel pair
    let proxy_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let proxy_addr = proxy_listener.local_addr().unwrap();

    let verifier = Arc::new(TestVerifier {
        client_id,
        auth_secret,
    });

    let v = verifier.clone();
    let server_handle = tokio::spawn(async move {
        let (mut server_stream, _) = proxy_listener.accept().await.unwrap();
        let mut session_keys = server_handshake(&mut server_stream, v.as_ref(), &ticket_key).await;

        let cipher = create_cipher(session_keys.cipher_suite, &session_keys.session_key);

        // Verify challenge response
        recv_challenge_response(&mut server_stream, &session_keys, cipher.as_ref()).await;

        // Read Connect command
        let frame_buf = util::read_framed(&mut server_stream).await.unwrap();
        let (plaintext, _) = decrypt_frame(cipher.as_ref(), &frame_buf).unwrap();
        let frame = decode_data_frame(&plaintext).unwrap();

        if let Command::Connect(dest) = frame.command {
            let mut echo_stream = TcpStream::connect(format!("{}:{}", dest.address, dest.port))
                .await
                .unwrap();

            // Read one data frame, relay to echo, send response back
            let frame_buf = util::read_framed(&mut server_stream).await.unwrap();
            let (plaintext, _) = decrypt_frame(cipher.as_ref(), &frame_buf).unwrap();
            let data_frame = decode_data_frame(&plaintext).unwrap();

            if let Command::Data(data) = data_frame.command {
                echo_stream.write_all(&data).await.unwrap();
                let mut echo_buf = vec![0u8; 4096];
                let n = echo_stream.read(&mut echo_buf).await.unwrap();

                let response_frame = DataFrame {
                    command: Command::Data(bytes::Bytes::copy_from_slice(&echo_buf[..n])),
                    flags: 0,
                    stream_id: 0,
                };
                let response_bytes = encode_data_frame(&response_frame);
                let nonce = session_keys.next_server_nonce();
                let encrypted = encrypt_frame(cipher.as_ref(), &nonce, &response_bytes).unwrap();
                util::write_framed(&mut server_stream, &encrypted)
                    .await
                    .unwrap();
            }
        }
    });

    // Client side
    tokio::time::sleep(Duration::from_millis(50)).await;
    let mut client_stream = TcpStream::connect(proxy_addr).await.unwrap();

    let mut session_keys = client_handshake(
        &mut client_stream,
        client_id,
        auth_secret,
        CipherSuite::ChaCha20Poly1305,
    )
    .await;

    let cipher = create_cipher(session_keys.cipher_suite, &session_keys.session_key);

    // Send challenge response
    send_challenge_response(&mut client_stream, &mut session_keys, cipher.as_ref()).await;

    // Send Connect command
    let connect_frame = DataFrame {
        command: Command::Connect(ProxyDestination {
            address: ProxyAddress::Ipv4(echo_addr.ip().to_string().parse().unwrap()),
            port: echo_addr.port(),
        }),
        flags: 0,
        stream_id: 0,
    };
    let frame_bytes = encode_data_frame(&connect_frame);
    let nonce = session_keys.next_client_nonce();
    let encrypted = encrypt_frame(cipher.as_ref(), &nonce, &frame_bytes).unwrap();
    util::write_framed(&mut client_stream, &encrypted)
        .await
        .unwrap();

    // Send data
    let test_data = b"Hello, Prisma v0.9.0!";
    let data_frame = DataFrame {
        command: Command::Data(bytes::Bytes::from_static(test_data)),
        flags: 0,
        stream_id: 0,
    };
    let frame_bytes = encode_data_frame(&data_frame);
    let nonce = session_keys.next_client_nonce();
    let encrypted = encrypt_frame(cipher.as_ref(), &nonce, &frame_bytes).unwrap();
    util::write_framed(&mut client_stream, &encrypted)
        .await
        .unwrap();

    // Receive echoed data
    let resp_buf = util::read_framed(&mut client_stream).await.unwrap();
    let (plaintext, _) = decrypt_frame(cipher.as_ref(), &resp_buf).unwrap();
    let response_frame = decode_data_frame(&plaintext).unwrap();

    if let Command::Data(data) = response_frame.command {
        assert_eq!(&data[..], &test_data[..], "Echo data mismatch");
    } else {
        panic!("Expected Data command in response");
    }

    let _ = tokio::time::timeout(Duration::from_secs(2), server_handle).await;
}

/// Test that authentication failure is correctly rejected.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn test_auth_failure_rejected() {
    let client_id = ClientId::new();
    let client_secret = [0x42u8; 32];
    let wrong_secret = [0x99u8; 32]; // server expects a different secret
    let ticket_key = [0xFFu8; 32];

    let proxy_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let proxy_addr = proxy_listener.local_addr().unwrap();

    let server_handle = tokio::spawn(async move {
        let (mut server_stream, _) = proxy_listener.accept().await.unwrap();
        let client_init_buf = util::read_framed(&mut server_stream).await.unwrap();

        let verifier = TestVerifier {
            client_id,
            auth_secret: wrong_secret,
        };

        let result = PrismaHandshakeServer::process_client_init(
            &client_init_buf,
            PaddingRange::new(0, 256),
            0,
            &ticket_key,
            &[],
            &verifier,
        );

        assert!(result.is_err(), "Expected auth failure");
        let err = format!("{}", result.unwrap_err());
        assert!(
            err.contains("Authentication failed") || err.contains("auth"),
            "Error should mention auth: {}",
            err
        );
    });

    tokio::time::sleep(Duration::from_millis(50)).await;
    let mut client_stream = TcpStream::connect(proxy_addr).await.unwrap();

    let hs = PrismaHandshakeClient::new(client_id, client_secret, CipherSuite::ChaCha20Poly1305);
    let (_state, init_bytes) = hs.start();
    util::write_framed(&mut client_stream, &init_bytes)
        .await
        .unwrap();

    let _ = tokio::time::timeout(Duration::from_secs(2), server_handle).await;
}

/// Test that wrong client ID is rejected.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn test_wrong_client_id_rejected() {
    let client_id = ClientId::new();
    let other_id = ClientId::new();
    let auth_secret = [0x42u8; 32];
    let ticket_key = [0xFFu8; 32];

    let proxy_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let proxy_addr = proxy_listener.local_addr().unwrap();

    let server_handle = tokio::spawn(async move {
        let (mut server_stream, _) = proxy_listener.accept().await.unwrap();
        let client_init_buf = util::read_framed(&mut server_stream).await.unwrap();

        let verifier = TestVerifier {
            client_id: other_id, // different from what client sends
            auth_secret,
        };

        let result = PrismaHandshakeServer::process_client_init(
            &client_init_buf,
            PaddingRange::new(0, 256),
            0,
            &ticket_key,
            &[],
            &verifier,
        );

        assert!(result.is_err(), "Expected auth failure for wrong client ID");
    });

    tokio::time::sleep(Duration::from_millis(50)).await;
    let mut client_stream = TcpStream::connect(proxy_addr).await.unwrap();

    let hs = PrismaHandshakeClient::new(client_id, auth_secret, CipherSuite::ChaCha20Poly1305);
    let (_state, init_bytes) = hs.start();
    util::write_framed(&mut client_stream, &init_bytes)
        .await
        .unwrap();

    let _ = tokio::time::timeout(Duration::from_secs(2), server_handle).await;
}

/// Test AES-256-GCM cipher suite end-to-end.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn test_aes256gcm_handshake_and_data() {
    let client_id = ClientId::new();
    let auth_secret = [0x42u8; 32];
    let ticket_key = [0xFFu8; 32];

    let proxy_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let proxy_addr = proxy_listener.local_addr().unwrap();

    let verifier = Arc::new(TestVerifier {
        client_id,
        auth_secret,
    });

    let v = verifier.clone();
    let server_handle = tokio::spawn(async move {
        let (mut server_stream, _) = proxy_listener.accept().await.unwrap();
        let session_keys = server_handshake(&mut server_stream, v.as_ref(), &ticket_key).await;

        assert_eq!(
            session_keys.cipher_suite,
            CipherSuite::Aes256Gcm,
            "Server should negotiate AES-256-GCM"
        );

        let cipher = create_cipher(session_keys.cipher_suite, &session_keys.session_key);

        // Verify challenge response
        recv_challenge_response(&mut server_stream, &session_keys, cipher.as_ref()).await;

        // Read one more frame (data)
        let frame_buf = util::read_framed(&mut server_stream).await.unwrap();
        let (plaintext, _) = decrypt_frame(cipher.as_ref(), &frame_buf).unwrap();
        let frame = decode_data_frame(&plaintext).unwrap();

        if let Command::Data(data) = frame.command {
            assert_eq!(&data[..], b"AES-256-GCM test data");
        } else {
            panic!("Expected Data command");
        }
    });

    tokio::time::sleep(Duration::from_millis(50)).await;
    let mut client_stream = TcpStream::connect(proxy_addr).await.unwrap();

    let mut session_keys = client_handshake(
        &mut client_stream,
        client_id,
        auth_secret,
        CipherSuite::Aes256Gcm,
    )
    .await;

    assert_eq!(session_keys.cipher_suite, CipherSuite::Aes256Gcm);

    let cipher = create_cipher(session_keys.cipher_suite, &session_keys.session_key);

    // Send challenge response
    send_challenge_response(&mut client_stream, &mut session_keys, cipher.as_ref()).await;

    // Send data
    let data_frame = DataFrame {
        command: Command::Data(bytes::Bytes::from_static(b"AES-256-GCM test data")),
        flags: 0,
        stream_id: 0,
    };
    let frame_bytes = encode_data_frame(&data_frame);
    let nonce = session_keys.next_client_nonce();
    let encrypted = encrypt_frame(cipher.as_ref(), &nonce, &frame_bytes).unwrap();
    util::write_framed(&mut client_stream, &encrypted)
        .await
        .unwrap();

    let _ = tokio::time::timeout(Duration::from_secs(2), server_handle).await;
}

/// Test session key agreement: both sides derive the same key.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn test_session_key_agreement() {
    let client_id = ClientId::new();
    let auth_secret = [0x42u8; 32];
    let ticket_key = [0xFFu8; 32];

    let proxy_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let proxy_addr = proxy_listener.local_addr().unwrap();

    let verifier = Arc::new(TestVerifier {
        client_id,
        auth_secret,
    });

    let v = verifier.clone();
    let server_handle = tokio::spawn(async move {
        let (mut server_stream, _) = proxy_listener.accept().await.unwrap();
        let session_keys = server_handshake(&mut server_stream, v.as_ref(), &ticket_key).await;
        session_keys
    });

    tokio::time::sleep(Duration::from_millis(50)).await;
    let mut client_stream = TcpStream::connect(proxy_addr).await.unwrap();

    let client_keys = client_handshake(
        &mut client_stream,
        client_id,
        auth_secret,
        CipherSuite::ChaCha20Poly1305,
    )
    .await;

    let server_keys = tokio::time::timeout(Duration::from_secs(2), server_handle)
        .await
        .unwrap()
        .unwrap();

    assert_eq!(
        client_keys.session_key, server_keys.session_key,
        "Client and server must derive the same session key"
    );
    assert_eq!(client_keys.session_id, server_keys.session_id);
    assert_eq!(client_keys.cipher_suite, server_keys.cipher_suite);
    assert_eq!(client_keys.protocol_version, PRISMA_PROTOCOL_VERSION);
}

/// Test that the handshake correctly negotiates v5 features
/// (header authentication and connection migration).
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn test_v5_feature_negotiation() {
    let client_id = ClientId::new();
    let auth_secret = [0x42u8; 32];
    let ticket_key = [0xFFu8; 32];

    let proxy_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let proxy_addr = proxy_listener.local_addr().unwrap();

    let verifier = Arc::new(TestVerifier {
        client_id,
        auth_secret,
    });

    let v = verifier.clone();
    let server_handle = tokio::spawn(async move {
        let (mut server_stream, _) = proxy_listener.accept().await.unwrap();
        let session_keys = server_handshake(&mut server_stream, v.as_ref(), &ticket_key).await;
        session_keys
    });

    tokio::time::sleep(Duration::from_millis(50)).await;
    let mut client_stream = TcpStream::connect(proxy_addr).await.unwrap();

    let client_keys = client_handshake(
        &mut client_stream,
        client_id,
        auth_secret,
        CipherSuite::ChaCha20Poly1305,
    )
    .await;

    let server_keys = tokio::time::timeout(Duration::from_secs(2), server_handle)
        .await
        .unwrap()
        .unwrap();

    // v5 clients should negotiate header authentication
    assert!(
        client_keys.header_key.is_some(),
        "v5 client should have header_key"
    );
    assert_eq!(client_keys.header_key, server_keys.header_key);

    // v5 clients should negotiate connection migration
    assert!(
        client_keys.migration_token.is_some(),
        "v5 client should have migration_token"
    );
    assert_eq!(client_keys.migration_token, server_keys.migration_token);
}

/// Test the Ping/Pong command round-trip through encrypted tunnel.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn test_ping_pong_through_tunnel() {
    let client_id = ClientId::new();
    let auth_secret = [0x42u8; 32];
    let ticket_key = [0xFFu8; 32];

    let proxy_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let proxy_addr = proxy_listener.local_addr().unwrap();

    let verifier = Arc::new(TestVerifier {
        client_id,
        auth_secret,
    });

    let v = verifier.clone();
    let server_handle = tokio::spawn(async move {
        let (mut server_stream, _) = proxy_listener.accept().await.unwrap();
        let mut session_keys = server_handshake(&mut server_stream, v.as_ref(), &ticket_key).await;
        let cipher = create_cipher(session_keys.cipher_suite, &session_keys.session_key);

        // Verify challenge response
        recv_challenge_response(&mut server_stream, &session_keys, cipher.as_ref()).await;

        // Read Ping
        let frame_buf = util::read_framed(&mut server_stream).await.unwrap();
        let (plaintext, _) = decrypt_frame(cipher.as_ref(), &frame_buf).unwrap();
        let frame = decode_data_frame(&plaintext).unwrap();

        let Command::Ping(seq) = frame.command else {
            panic!("Expected Ping");
        };

        // Send Pong
        let pong_frame = DataFrame {
            command: Command::Pong(seq),
            flags: 0,
            stream_id: 0,
        };
        let frame_bytes = encode_data_frame(&pong_frame);
        let nonce = session_keys.next_server_nonce();
        let encrypted = encrypt_frame(cipher.as_ref(), &nonce, &frame_bytes).unwrap();
        util::write_framed(&mut server_stream, &encrypted)
            .await
            .unwrap();
    });

    tokio::time::sleep(Duration::from_millis(50)).await;
    let mut client_stream = TcpStream::connect(proxy_addr).await.unwrap();

    let mut session_keys = client_handshake(
        &mut client_stream,
        client_id,
        auth_secret,
        CipherSuite::ChaCha20Poly1305,
    )
    .await;

    let cipher = create_cipher(session_keys.cipher_suite, &session_keys.session_key);

    // Send challenge response
    send_challenge_response(&mut client_stream, &mut session_keys, cipher.as_ref()).await;

    // Send Ping with seq=42
    let ping_frame = DataFrame {
        command: Command::Ping(42),
        flags: 0,
        stream_id: 0,
    };
    let frame_bytes = encode_data_frame(&ping_frame);
    let nonce = session_keys.next_client_nonce();
    let encrypted = encrypt_frame(cipher.as_ref(), &nonce, &frame_bytes).unwrap();
    util::write_framed(&mut client_stream, &encrypted)
        .await
        .unwrap();

    // Receive Pong
    let resp_buf = util::read_framed(&mut client_stream).await.unwrap();
    let (plaintext, _) = decrypt_frame(cipher.as_ref(), &resp_buf).unwrap();
    let response = decode_data_frame(&plaintext).unwrap();

    assert_eq!(
        response.command,
        Command::Pong(42),
        "Pong should echo the Ping seq"
    );

    let _ = tokio::time::timeout(Duration::from_secs(2), server_handle).await;
}

/// Test graceful close command.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn test_close_command() {
    let client_id = ClientId::new();
    let auth_secret = [0x42u8; 32];
    let ticket_key = [0xFFu8; 32];

    let proxy_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let proxy_addr = proxy_listener.local_addr().unwrap();

    let verifier = Arc::new(TestVerifier {
        client_id,
        auth_secret,
    });

    let v = verifier.clone();
    let server_handle = tokio::spawn(async move {
        let (mut server_stream, _) = proxy_listener.accept().await.unwrap();
        let session_keys = server_handshake(&mut server_stream, v.as_ref(), &ticket_key).await;
        let cipher = create_cipher(session_keys.cipher_suite, &session_keys.session_key);

        recv_challenge_response(&mut server_stream, &session_keys, cipher.as_ref()).await;

        let frame_buf = util::read_framed(&mut server_stream).await.unwrap();
        let (plaintext, _) = decrypt_frame(cipher.as_ref(), &frame_buf).unwrap();
        let frame = decode_data_frame(&plaintext).unwrap();

        assert_eq!(frame.command, Command::Close, "Expected Close command");
    });

    tokio::time::sleep(Duration::from_millis(50)).await;
    let mut client_stream = TcpStream::connect(proxy_addr).await.unwrap();

    let mut session_keys = client_handshake(
        &mut client_stream,
        client_id,
        auth_secret,
        CipherSuite::ChaCha20Poly1305,
    )
    .await;

    let cipher = create_cipher(session_keys.cipher_suite, &session_keys.session_key);

    send_challenge_response(&mut client_stream, &mut session_keys, cipher.as_ref()).await;

    // Send Close
    let close_frame = DataFrame {
        command: Command::Close,
        flags: 0,
        stream_id: 0,
    };
    let frame_bytes = encode_data_frame(&close_frame);
    let nonce = session_keys.next_client_nonce();
    let encrypted = encrypt_frame(cipher.as_ref(), &nonce, &frame_bytes).unwrap();
    util::write_framed(&mut client_stream, &encrypted)
        .await
        .unwrap();

    let _ = tokio::time::timeout(Duration::from_secs(2), server_handle).await;
}

/// Test multiple data frames in sequence (simulated relay).
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn test_multiple_data_frames() {
    let client_id = ClientId::new();
    let auth_secret = [0x42u8; 32];
    let ticket_key = [0xFFu8; 32];

    let proxy_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let proxy_addr = proxy_listener.local_addr().unwrap();

    let verifier = Arc::new(TestVerifier {
        client_id,
        auth_secret,
    });

    let v = verifier.clone();
    let server_handle = tokio::spawn(async move {
        let (mut server_stream, _) = proxy_listener.accept().await.unwrap();
        let session_keys = server_handshake(&mut server_stream, v.as_ref(), &ticket_key).await;
        let cipher = create_cipher(session_keys.cipher_suite, &session_keys.session_key);

        recv_challenge_response(&mut server_stream, &session_keys, cipher.as_ref()).await;

        // Read 5 data frames
        for i in 0u8..5 {
            let frame_buf = util::read_framed(&mut server_stream).await.unwrap();
            let (plaintext, _) = decrypt_frame(cipher.as_ref(), &frame_buf).unwrap();
            let frame = decode_data_frame(&plaintext).unwrap();

            if let Command::Data(data) = frame.command {
                assert_eq!(data.len(), 100, "Frame {} should be 100 bytes", i);
                // Verify payload content
                assert!(
                    data.iter().all(|&b| b == i),
                    "Frame {} should be filled with {}",
                    i,
                    i
                );
            } else {
                panic!("Expected Data command for frame {}", i);
            }
        }
    });

    tokio::time::sleep(Duration::from_millis(50)).await;
    let mut client_stream = TcpStream::connect(proxy_addr).await.unwrap();

    let mut session_keys = client_handshake(
        &mut client_stream,
        client_id,
        auth_secret,
        CipherSuite::ChaCha20Poly1305,
    )
    .await;

    let cipher = create_cipher(session_keys.cipher_suite, &session_keys.session_key);

    send_challenge_response(&mut client_stream, &mut session_keys, cipher.as_ref()).await;

    // Send 5 data frames with distinct payloads
    for i in 0u8..5 {
        let payload = vec![i; 100];
        let data_frame = DataFrame {
            command: Command::Data(bytes::Bytes::from(payload)),
            flags: 0,
            stream_id: 0,
        };
        let frame_bytes = encode_data_frame(&data_frame);
        let nonce = session_keys.next_client_nonce();
        let encrypted = encrypt_frame(cipher.as_ref(), &nonce, &frame_bytes).unwrap();
        util::write_framed(&mut client_stream, &encrypted)
            .await
            .unwrap();
    }

    let _ = tokio::time::timeout(Duration::from_secs(2), server_handle).await;
}

/// Test DNS tunnel command through the encrypted channel.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn test_dns_query_command() {
    let client_id = ClientId::new();
    let auth_secret = [0x42u8; 32];
    let ticket_key = [0xFFu8; 32];

    let proxy_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let proxy_addr = proxy_listener.local_addr().unwrap();

    let verifier = Arc::new(TestVerifier {
        client_id,
        auth_secret,
    });

    let v = verifier.clone();
    let server_handle = tokio::spawn(async move {
        let (mut server_stream, _) = proxy_listener.accept().await.unwrap();
        let mut session_keys = server_handshake(&mut server_stream, v.as_ref(), &ticket_key).await;
        let cipher = create_cipher(session_keys.cipher_suite, &session_keys.session_key);

        recv_challenge_response(&mut server_stream, &session_keys, cipher.as_ref()).await;

        let frame_buf = util::read_framed(&mut server_stream).await.unwrap();
        let (plaintext, _) = decrypt_frame(cipher.as_ref(), &frame_buf).unwrap();
        let frame = decode_data_frame(&plaintext).unwrap();

        if let Command::DnsQuery { query_id, data } = frame.command {
            assert_eq!(query_id, 0x1234);
            assert_eq!(&data, &[0x01, 0x02, 0x03]);

            // Send DNS response back
            let resp_frame = DataFrame {
                command: Command::DnsResponse {
                    query_id,
                    data: vec![0x04, 0x05, 0x06],
                },
                flags: 0,
                stream_id: 0,
            };
            let frame_bytes = encode_data_frame(&resp_frame);
            let nonce = session_keys.next_server_nonce();
            let encrypted = encrypt_frame(cipher.as_ref(), &nonce, &frame_bytes).unwrap();
            util::write_framed(&mut server_stream, &encrypted)
                .await
                .unwrap();
        } else {
            panic!("Expected DnsQuery command");
        }
    });

    tokio::time::sleep(Duration::from_millis(50)).await;
    let mut client_stream = TcpStream::connect(proxy_addr).await.unwrap();

    let mut session_keys = client_handshake(
        &mut client_stream,
        client_id,
        auth_secret,
        CipherSuite::ChaCha20Poly1305,
    )
    .await;

    let cipher = create_cipher(session_keys.cipher_suite, &session_keys.session_key);

    send_challenge_response(&mut client_stream, &mut session_keys, cipher.as_ref()).await;

    // Send DNS query
    let dns_frame = DataFrame {
        command: Command::DnsQuery {
            query_id: 0x1234,
            data: vec![0x01, 0x02, 0x03],
        },
        flags: 0,
        stream_id: 0,
    };
    let frame_bytes = encode_data_frame(&dns_frame);
    let nonce = session_keys.next_client_nonce();
    let encrypted = encrypt_frame(cipher.as_ref(), &nonce, &frame_bytes).unwrap();
    util::write_framed(&mut client_stream, &encrypted)
        .await
        .unwrap();

    // Receive DNS response
    let resp_buf = util::read_framed(&mut client_stream).await.unwrap();
    let (plaintext, _) = decrypt_frame(cipher.as_ref(), &resp_buf).unwrap();
    let response = decode_data_frame(&plaintext).unwrap();

    if let Command::DnsResponse { query_id, data } = response.command {
        assert_eq!(query_id, 0x1234);
        assert_eq!(&data, &[0x04, 0x05, 0x06]);
    } else {
        panic!("Expected DnsResponse command");
    }

    let _ = tokio::time::timeout(Duration::from_secs(2), server_handle).await;
}
