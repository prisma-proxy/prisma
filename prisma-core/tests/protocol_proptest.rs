use proptest::prelude::*;

use prisma_core::crypto::aead::create_cipher;
use prisma_core::crypto::kdf::derive_session_key;
use prisma_core::protocol::codec::*;
use prisma_core::protocol::types::*;
use prisma_core::types::*;

use std::net::Ipv4Addr;

// --- Codec round-trip proptests ---

fn arb_proxy_address() -> impl Strategy<Value = ProxyAddress> {
    prop_oneof![
        (0u8..=255, 0u8..=255, 0u8..=255, 0u8..=255)
            .prop_map(|(a, b, c, d)| ProxyAddress::Ipv4(Ipv4Addr::new(a, b, c, d))),
        "[a-z]{1,63}\\.[a-z]{2,6}".prop_map(ProxyAddress::Domain),
    ]
}

fn arb_destination() -> impl Strategy<Value = ProxyDestination> {
    (arb_proxy_address(), 1u16..=65535)
        .prop_map(|(address, port)| ProxyDestination { address, port })
}

fn arb_command() -> impl Strategy<Value = Command> {
    prop_oneof![
        arb_destination().prop_map(Command::Connect),
        proptest::collection::vec(any::<u8>(), 0..1024)
            .prop_map(|v| Command::Data(bytes::Bytes::from(v))),
        Just(Command::Close),
        any::<u32>().prop_map(Command::Ping),
        any::<u32>().prop_map(Command::Pong),
    ]
}

proptest! {
    #[test]
    fn test_data_frame_round_trip(
        cmd in arb_command(),
        flags in any::<u16>(),
        stream_id in any::<u32>(),
    ) {
        let frame = DataFrame {
            command: cmd.clone(),
            flags,
            stream_id,
        };
        let encoded = encode_data_frame(&frame);
        let decoded = decode_data_frame(&encoded).unwrap();
        prop_assert_eq!(decoded.command, cmd);
        prop_assert_eq!(decoded.flags, flags);
        prop_assert_eq!(decoded.stream_id, stream_id);
    }

    #[test]
    fn test_prisma_client_init_round_trip(
        pub_key in proptest::array::uniform32(any::<u8>()),
        timestamp in any::<u64>(),
        auth_token in proptest::array::uniform32(any::<u8>()),
        padding in proptest::collection::vec(any::<u8>(), 0..64),
    ) {
        let msg = PrismaClientInit {
            version: PRISMA_PROTOCOL_VERSION,
            flags: 0,
            client_ephemeral_pub: pub_key,
            client_id: ClientId(uuid::Uuid::nil()),
            timestamp,
            cipher_suite: CipherSuite::ChaCha20Poly1305,
            auth_token,
            pq_kem_encap_key: None,
            padding: padding.clone(),
        };
        let encoded = encode_client_init(&msg);
        let decoded = decode_client_init(&encoded).unwrap();
        prop_assert_eq!(decoded.version, PRISMA_PROTOCOL_VERSION);
        prop_assert_eq!(decoded.client_ephemeral_pub, pub_key);
        prop_assert_eq!(decoded.timestamp, timestamp);
        prop_assert_eq!(decoded.auth_token, auth_token);
        prop_assert_eq!(decoded.padding, padding);
    }

    #[test]
    fn test_prisma_server_init_round_trip(
        server_pub in proptest::array::uniform32(any::<u8>()),
        challenge in proptest::array::uniform32(any::<u8>()),
        padding_min in 0u16..=128,
        padding_max in 128u16..=512,
        ticket in proptest::collection::vec(any::<u8>(), 0..128),
        padding in proptest::collection::vec(any::<u8>(), 0..64),
    ) {
        let msg = PrismaServerInit {
            status: AcceptStatus::Ok,
            session_id: uuid::Uuid::nil(),
            server_ephemeral_pub: server_pub,
            challenge,
            padding_min,
            padding_max,
            server_features: FEATURE_UDP_RELAY,
            session_ticket: ticket.clone(),
            bucket_sizes: vec![],
            pq_kem_ciphertext: None,
            padding: padding.clone(),
        };
        let encoded = encode_server_init(&msg);
        let decoded = decode_server_init(&encoded).unwrap();
        prop_assert_eq!(decoded.server_ephemeral_pub, server_pub);
        prop_assert_eq!(decoded.challenge, challenge);
        prop_assert_eq!(decoded.padding_min, padding_min);
        prop_assert_eq!(decoded.padding_max, padding_max);
        prop_assert_eq!(decoded.session_ticket, ticket);
        prop_assert_eq!(decoded.padding, padding);
    }
}

// --- Crypto round-trip proptests ---

proptest! {
    #[test]
    fn test_aead_round_trip(
        key in proptest::array::uniform32(any::<u8>()),
        plaintext in proptest::collection::vec(any::<u8>(), 0..4096),
        aad in proptest::collection::vec(any::<u8>(), 0..64),
    ) {
        let cipher = create_cipher(CipherSuite::ChaCha20Poly1305, &key);
        let nonce = [0u8; NONCE_SIZE];
        let ciphertext = cipher.encrypt(&nonce, &plaintext, &aad).unwrap();
        let decrypted = cipher.decrypt(&nonce, &ciphertext, &aad).unwrap();
        prop_assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_kdf_different_timestamps(
        secret in proptest::array::uniform32(any::<u8>()),
        client_pub in proptest::array::uniform32(any::<u8>()),
        server_pub in proptest::array::uniform32(any::<u8>()),
        ts1 in any::<u64>(),
        ts2 in any::<u64>(),
    ) {
        let key1 = derive_session_key(&secret, &client_pub, &server_pub, ts1);
        let key2 = derive_session_key(&secret, &client_pub, &server_pub, ts2);
        if ts1 != ts2 {
            prop_assert_ne!(key1, key2);
        } else {
            prop_assert_eq!(key1, key2);
        }
    }
}

// --- Anti-replay monotonicity proptest ---

proptest! {
    #[test]
    fn test_anti_replay_monotonic(counters in proptest::collection::vec(0u64..2048, 1..100)) {
        use prisma_core::protocol::anti_replay::AntiReplayWindow;
        let mut window = AntiReplayWindow::new();
        let mut seen = std::collections::HashSet::new();

        for c in counters {
            let result = window.check_and_update(c);
            if seen.contains(&c) {
                // Should be rejected as replay
                prop_assert!(result.is_err(), "Replay of {} was not detected", c);
            }
            // Even if it was rejected for being too old, that's also fine
            seen.insert(c);
        }
    }
}
