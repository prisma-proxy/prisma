use anyhow::Result;
use tracing::{debug, info};

use prisma_core::crypto::aead::{create_cipher, AeadCipher};
use prisma_core::protocol::codec::*;
use prisma_core::protocol::handshake::PrismaHandshakeClient;
use prisma_core::protocol::types::*;
use prisma_core::types::{CipherSuite, ClientId, ProxyDestination};
use prisma_core::util;

use crate::connector::TransportStream;

/// Send the challenge-response frame if a challenge was issued during handshake.
async fn send_challenge_response(
    stream: &mut TransportStream,
    session_keys: &mut SessionKeys,
    cipher: &dyn AeadCipher,
) -> Result<()> {
    if let Some(challenge) = session_keys.challenge.take() {
        let response_hash: [u8; 32] = blake3::hash(&challenge).into();
        let challenge_frame = DataFrame {
            command: Command::ChallengeResponse {
                hash: response_hash,
            },
            flags: 0,
            stream_id: 0,
        };
        let frame_bytes = encode_data_frame(&challenge_frame);
        let nonce = session_keys.next_client_nonce();
        let encrypted = encrypt_frame(cipher, &nonce, &frame_bytes)?;
        util::write_framed(stream, &encrypted).await?;
        debug!("Challenge response sent");
    }
    Ok(())
}

/// An established encrypted tunnel to the Prisma server.
pub struct TunnelConnection {
    pub stream: TransportStream,
    pub cipher: Box<dyn AeadCipher>,
    pub session_keys: SessionKeys,
    /// Bucket sizes for traffic shaping (empty = no bucket padding).
    pub bucket_sizes: Vec<u16>,
}

/// Perform the Prisma handshake over the transport and send the initial
/// Connect command to proxy to the given destination.
pub async fn establish_tunnel(
    mut stream: TransportStream,
    client_id: ClientId,
    auth_secret: [u8; 32],
    cipher_suite: CipherSuite,
    destination: &ProxyDestination,
) -> Result<TunnelConnection> {
    let (mut session_keys, bucket_sizes) =
        establish_handshake(&mut stream, client_id, auth_secret, cipher_suite).await?;

    let cipher = create_cipher(session_keys.cipher_suite, &session_keys.session_key);
    send_challenge_response(&mut stream, &mut session_keys, cipher.as_ref()).await?;

    // Send Connect command (optionally with bucket padding)
    let connect_frame = DataFrame {
        command: Command::Connect(destination.clone()),
        flags: 0,
        stream_id: 0,
    };
    let frame_bytes = if !bucket_sizes.is_empty() {
        let payload = prisma_core::protocol::codec::encode_command_payload(&connect_frame.command);
        prisma_core::traffic_shaping::encode_bucketed_frame(
            connect_frame.command.cmd_byte(),
            connect_frame.flags,
            connect_frame.stream_id,
            &payload,
            &bucket_sizes,
        )
    } else {
        encode_data_frame(&connect_frame)
    };
    let nonce = session_keys.next_client_nonce();
    let encrypted = encrypt_frame(cipher.as_ref(), &nonce, &frame_bytes)?;

    util::write_framed(&mut stream, &encrypted).await?;
    debug!(dest = %destination, "Connect command sent");

    Ok(TunnelConnection {
        stream,
        cipher,
        session_keys,
        bucket_sizes,
    })
}

/// Perform the PrismaVeil handshake and send a UDP ASSOCIATE command
/// to set up a UDP relay session on the server.
pub async fn establish_udp_tunnel(
    mut stream: TransportStream,
    client_id: ClientId,
    auth_secret: [u8; 32],
    cipher_suite: CipherSuite,
) -> Result<TunnelConnection> {
    let (mut session_keys, bucket_sizes) =
        establish_handshake(&mut stream, client_id, auth_secret, cipher_suite).await?;

    let cipher = create_cipher(session_keys.cipher_suite, &session_keys.session_key);
    send_challenge_response(&mut stream, &mut session_keys, cipher.as_ref()).await?;

    // Send UdpAssociate command
    let udp_frame = DataFrame {
        command: Command::UdpAssociate {
            bind_addr_type: 0x01,
            bind_addr: vec![0, 0, 0, 0], // 0.0.0.0
            bind_port: 0,
        },
        flags: 0,
        stream_id: 0,
    };
    let frame_bytes = encode_data_frame(&udp_frame);
    let nonce = session_keys.next_client_nonce();
    let encrypted = encrypt_frame(cipher.as_ref(), &nonce, &frame_bytes)?;

    util::write_framed(&mut stream, &encrypted).await?;

    debug!("UdpAssociate command sent");

    Ok(TunnelConnection {
        stream,
        cipher,
        session_keys,
        bucket_sizes,
    })
}

/// Establish the Prisma handshake (PrismaClientInit -> PrismaServerInit).
async fn establish_handshake(
    stream: &mut TransportStream,
    client_id: ClientId,
    auth_secret: [u8; 32],
    cipher_suite: CipherSuite,
) -> Result<(SessionKeys, Vec<u16>)> {
    let handshake = PrismaHandshakeClient::new(client_id, auth_secret, cipher_suite);
    let (client_state, init_bytes) = handshake.start();

    util::write_framed(stream, &init_bytes).await?;

    let server_init_buf = util::read_framed(stream).await?;

    let (session_keys, bucket_sizes) = client_state.process_server_init(&server_init_buf)?;
    info!(
        session_id = %session_keys.session_id,
        buckets = bucket_sizes.len(),
        "Tunnel established"
    );

    Ok((session_keys, bucket_sizes))
}

/// Establish a raw tunnel (handshake + challenge only, no initial command).
/// Used by speed test and other special operations that send their own first command.
pub async fn establish_raw_tunnel(
    mut stream: TransportStream,
    client_id: ClientId,
    auth_secret: [u8; 32],
    cipher_suite: CipherSuite,
) -> Result<TunnelConnection> {
    let (mut session_keys, bucket_sizes) =
        establish_handshake(&mut stream, client_id, auth_secret, cipher_suite).await?;

    let cipher = create_cipher(session_keys.cipher_suite, &session_keys.session_key);
    send_challenge_response(&mut stream, &mut session_keys, cipher.as_ref()).await?;

    Ok(TunnelConnection {
        stream,
        cipher,
        session_keys,
        bucket_sizes,
    })
}
