use prisma_core::protocol::codec::*;
use prisma_core::protocol::types::*;
use prisma_core::types::*;

use std::net::Ipv4Addr;

#[test]
fn test_data_frame_connect_snapshot() {
    let frame = DataFrame {
        command: Command::Connect(ProxyDestination {
            address: ProxyAddress::Ipv4(Ipv4Addr::new(93, 184, 216, 34)),
            port: 443,
        }),
        flags: 0,
        stream_id: 1,
    };
    let encoded = encode_data_frame(&frame);
    insta::assert_yaml_snapshot!("data_frame_connect_wire", encoded);
}

#[test]
fn test_data_frame_domain_connect_snapshot() {
    let frame = DataFrame {
        command: Command::Connect(ProxyDestination {
            address: ProxyAddress::Domain("example.com".into()),
            port: 80,
        }),
        flags: 0,
        stream_id: 0,
    };
    let encoded = encode_data_frame(&frame);
    insta::assert_yaml_snapshot!("data_frame_domain_connect_wire", encoded);
}

#[test]
fn test_data_frame_data_snapshot() {
    let frame = DataFrame {
        command: Command::Data(bytes::Bytes::from_static(b"GET / HTTP/1.1\r\n\r\n")),
        flags: 0,
        stream_id: 1,
    };
    let encoded = encode_data_frame(&frame);
    insta::assert_yaml_snapshot!("data_frame_data_wire", encoded);
}

#[test]
fn test_prisma_client_init_snapshot() {
    let msg = PrismaClientInit {
        version: PRISMA_PROTOCOL_VERSION,
        flags: 0,
        client_ephemeral_pub: [0xAA; 32],
        client_id: ClientId(uuid::Uuid::nil()),
        timestamp: 1700000000,
        cipher_suite: CipherSuite::ChaCha20Poly1305,
        auth_token: [0xBB; 32],
        padding: vec![],
    };
    let encoded = encode_client_init(&msg);
    insta::assert_yaml_snapshot!("prisma_client_init_wire", encoded);
}

#[test]
fn test_prisma_server_init_snapshot() {
    let msg = PrismaServerInit {
        status: AcceptStatus::Ok,
        session_id: uuid::Uuid::nil(),
        server_ephemeral_pub: [0xCC; 32],
        challenge: [0xDD; 32],
        padding_min: 0,
        padding_max: 256,
        server_features: FEATURE_UDP_RELAY | FEATURE_SPEED_TEST,
        session_ticket: vec![0x01, 0x02, 0x03],
        bucket_sizes: vec![128, 256, 512],
        padding: vec![],
    };
    let encoded = encode_server_init(&msg);
    insta::assert_yaml_snapshot!("prisma_server_init_wire", encoded);
}
