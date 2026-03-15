use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

use prisma_core::crypto::aead::create_cipher;
use prisma_core::protocol::codec::*;
use prisma_core::protocol::handshake::*;
use prisma_core::protocol::types::*;
use prisma_core::types::*;

use hmac::{Hmac, Mac};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

/// Test verifier for integration tests.
struct TestVerifier {
    client_id: ClientId,
    auth_secret: [u8; 32],
}

impl AuthVerifier for TestVerifier {
    fn verify(&self, client_id: &ClientId, auth_token: &[u8; 32], timestamp: u64) -> bool {
        if *client_id != self.client_id {
            return false;
        }
        let mut mac =
            HmacSha256::new_from_slice(&self.auth_secret).expect("HMAC key length is valid");
        mac.update(client_id.0.as_bytes());
        mac.update(&timestamp.to_be_bytes());
        let expected: [u8; 32] = mac.finalize().into_bytes().into();
        auth_token == &expected
    }
}

/// End-to-end test: echo server -> prisma server logic -> prisma client logic -> verify echo.
/// Uses the v4 handshake (2-step: PrismaClientInit -> PrismaServerInit).
#[tokio::test]
async fn test_e2e_echo_through_tunnel() {
    let client_id = ClientId::new();
    let auth_secret = [0x42u8; 32];
    let cipher_suite = CipherSuite::ChaCha20Poly1305;
    let ticket_key = [0xFFu8; 32];

    // Start echo server on a random port
    let echo_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let echo_addr = echo_listener.local_addr().unwrap();

    tokio::spawn(async move {
        loop {
            if let Ok((mut stream, _)) = echo_listener.accept().await {
                tokio::spawn(async move {
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
                });
            }
        }
    });

    // Create a TCP pair to simulate the tunnel (client side <-> server side)
    let proxy_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let proxy_addr = proxy_listener.local_addr().unwrap();

    let verifier = TestVerifier {
        client_id,
        auth_secret,
    };

    // Server side
    let server_handle = tokio::spawn(async move {
        let (mut server_stream, _) = proxy_listener.accept().await.unwrap();

        // Step 1: Read PrismaClientInit
        let mut len_buf = [0u8; 2];
        server_stream.read_exact(&mut len_buf).await.unwrap();
        let len = u16::from_be_bytes(len_buf) as usize;
        let mut ci_buf = vec![0u8; len];
        server_stream.read_exact(&mut ci_buf).await.unwrap();

        // Process PrismaClientInit, produce PrismaServerInit
        let padding_range = PaddingRange::new(0, 256);
        let (si_bytes, server_state) = PrismaHandshakeServer::process_client_init(
            &ci_buf,
            padding_range,
            FEATURE_UDP_RELAY | FEATURE_SPEED_TEST,
            &ticket_key,
            &[],
            &verifier,
        )
        .unwrap();

        // Step 2: Send PrismaServerInit
        let si_len = (si_bytes.len() as u16).to_be_bytes();
        server_stream.write_all(&si_len).await.unwrap();
        server_stream.write_all(&si_bytes).await.unwrap();

        // Handshake complete — produce session keys
        let mut session_keys = server_state.into_session_keys();

        // Read Connect command
        let cipher = create_cipher(session_keys.cipher_suite, &session_keys.session_key);
        server_stream.read_exact(&mut len_buf).await.unwrap();
        let len = u16::from_be_bytes(len_buf) as usize;
        let mut frame_buf = vec![0u8; len];
        server_stream.read_exact(&mut frame_buf).await.unwrap();

        let (plaintext, _) = decrypt_frame(cipher.as_ref(), &frame_buf).unwrap();
        let frame = decode_data_frame(&plaintext).unwrap();

        if let Command::Connect(dest) = frame.command {
            // Connect to echo server
            let mut echo_stream = TcpStream::connect(format!("{}:{}", dest.address, dest.port))
                .await
                .unwrap();

            // Simple relay: read one data frame, forward to echo, read echo response, send back
            server_stream.read_exact(&mut len_buf).await.unwrap();
            let len = u16::from_be_bytes(len_buf) as usize;
            let mut frame_buf = vec![0u8; len];
            server_stream.read_exact(&mut frame_buf).await.unwrap();

            let (plaintext, _) = decrypt_frame(cipher.as_ref(), &frame_buf).unwrap();
            let data_frame = decode_data_frame(&plaintext).unwrap();

            if let Command::Data(data) = data_frame.command {
                echo_stream.write_all(&data).await.unwrap();

                let mut echo_buf = vec![0u8; 4096];
                let n = echo_stream.read(&mut echo_buf).await.unwrap();

                // Send response back encrypted
                let response_frame = DataFrame {
                    command: Command::Data(bytes::Bytes::copy_from_slice(&echo_buf[..n])),
                    flags: 0,
                    stream_id: 0,
                };
                let response_bytes = encode_data_frame(&response_frame);
                let nonce = session_keys.next_server_nonce();
                let encrypted = encrypt_frame(cipher.as_ref(), &nonce, &response_bytes).unwrap();
                let len = (encrypted.len() as u16).to_be_bytes();
                server_stream.write_all(&len).await.unwrap();
                server_stream.write_all(&encrypted).await.unwrap();
            }
        }
    });

    // Client side
    tokio::time::sleep(Duration::from_millis(50)).await;

    let mut client_stream = TcpStream::connect(proxy_addr).await.unwrap();

    // Step 1: Send PrismaClientInit
    let handshake = PrismaHandshakeClient::new(client_id, auth_secret, cipher_suite);
    let (client_state, init_bytes) = handshake.start();

    let len = (init_bytes.len() as u16).to_be_bytes();
    client_stream.write_all(&len).await.unwrap();
    client_stream.write_all(&init_bytes).await.unwrap();

    // Step 2: Receive PrismaServerInit
    let mut len_buf = [0u8; 2];
    client_stream.read_exact(&mut len_buf).await.unwrap();
    let si_len = u16::from_be_bytes(len_buf) as usize;
    let mut si_buf = vec![0u8; si_len];
    client_stream.read_exact(&mut si_buf).await.unwrap();

    // Process PrismaServerInit — handshake complete
    let (mut session_keys, _bucket_sizes) = client_state.process_server_init(&si_buf).unwrap();

    // Create cipher
    let cipher = create_cipher(session_keys.cipher_suite, &session_keys.session_key);

    // Send Connect command to echo server address
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
    let len = (encrypted.len() as u16).to_be_bytes();
    client_stream.write_all(&len).await.unwrap();
    client_stream.write_all(&encrypted).await.unwrap();

    // Send data through the tunnel
    let test_data = b"Hello, Prisma!";
    let data_frame = DataFrame {
        command: Command::Data(bytes::Bytes::from_static(test_data)),
        flags: 0,
        stream_id: 0,
    };
    let frame_bytes = encode_data_frame(&data_frame);
    let nonce = session_keys.next_client_nonce();
    let encrypted = encrypt_frame(cipher.as_ref(), &nonce, &frame_bytes).unwrap();
    let len = (encrypted.len() as u16).to_be_bytes();
    client_stream.write_all(&len).await.unwrap();
    client_stream.write_all(&encrypted).await.unwrap();

    // Receive echoed data
    client_stream.read_exact(&mut len_buf).await.unwrap();
    let resp_len = u16::from_be_bytes(len_buf) as usize;
    let mut resp_buf = vec![0u8; resp_len];
    client_stream.read_exact(&mut resp_buf).await.unwrap();

    let (plaintext, _) = decrypt_frame(cipher.as_ref(), &resp_buf).unwrap();
    let response_frame = decode_data_frame(&plaintext).unwrap();

    if let Command::Data(data) = response_frame.command {
        assert_eq!(&data[..], &test_data[..], "Echo data mismatch");
    } else {
        panic!("Expected Data command in response");
    }

    // Wait for server to finish
    let _ = tokio::time::timeout(Duration::from_secs(2), server_handle).await;
}
