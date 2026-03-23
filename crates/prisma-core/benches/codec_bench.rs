//! Criterion benchmarks for protocol codec encode/decode round-trips.
//!
//! Tests every Command variant through encode_data_frame / decode_data_frame
//! to ensure codec performance is adequate for the hot relay path.
//!
//! Run: `cargo bench -p prisma-core -- codec`

use criterion::{black_box, criterion_group, criterion_main, Criterion, Throughput};

use prisma_core::protocol::codec::{decode_data_frame, encode_data_frame};
use prisma_core::protocol::types::*;
use prisma_core::types::{ProxyAddress, ProxyDestination};

/// Helper: build a DataFrame from a Command with default flags/stream_id.
fn make_frame(command: Command) -> DataFrame {
    DataFrame {
        command,
        flags: 0,
        stream_id: 42,
    }
}

fn bench_codec_connect(c: &mut Criterion) {
    let frame = make_frame(Command::Connect(ProxyDestination {
        address: ProxyAddress::Domain("example.com".into()),
        port: 443,
    }));
    let encoded = encode_data_frame(&frame);

    c.bench_function("codec/connect/encode", |b| {
        b.iter(|| black_box(encode_data_frame(&frame)));
    });
    c.bench_function("codec/connect/decode", |b| {
        b.iter(|| black_box(decode_data_frame(&encoded).unwrap()));
    });
}

fn bench_codec_data(c: &mut Criterion) {
    let mut group = c.benchmark_group("codec/data");

    for size in [64, 1024, 8192] {
        let label = format!("{}B", size);
        let frame = make_frame(Command::Data(bytes::Bytes::from(vec![0xABu8; size])));
        let encoded = encode_data_frame(&frame);

        group.throughput(Throughput::Bytes(size as u64));
        group.bench_function(format!("encode_{}", label), |b| {
            b.iter(|| black_box(encode_data_frame(&frame)));
        });
        group.bench_function(format!("decode_{}", label), |b| {
            b.iter(|| black_box(decode_data_frame(&encoded).unwrap()));
        });
    }
    group.finish();
}

fn bench_codec_ping_pong(c: &mut Criterion) {
    let ping_frame = make_frame(Command::Ping(12345));
    let pong_frame = make_frame(Command::Pong(12345));
    let ping_encoded = encode_data_frame(&ping_frame);
    let pong_encoded = encode_data_frame(&pong_frame);

    c.bench_function("codec/ping/roundtrip", |b| {
        b.iter(|| {
            let enc = encode_data_frame(&ping_frame);
            black_box(decode_data_frame(&enc).unwrap());
        });
    });
    c.bench_function("codec/pong/roundtrip", |b| {
        b.iter(|| {
            let enc = encode_data_frame(&pong_frame);
            black_box(decode_data_frame(&enc).unwrap());
        });
    });
    c.bench_function("codec/ping/decode", |b| {
        b.iter(|| black_box(decode_data_frame(&ping_encoded).unwrap()));
    });
    c.bench_function("codec/pong/decode", |b| {
        b.iter(|| black_box(decode_data_frame(&pong_encoded).unwrap()));
    });
}

fn bench_codec_port_forward(c: &mut Criterion) {
    let reg_frame = make_frame(Command::RegisterForward {
        remote_port: 8080,
        name: "web-server".into(),
        protocol: "tcp".into(),
        bind_addr: Some("0.0.0.0".into()),
        max_connections: Some(100),
        allowed_ips: vec!["192.168.1.0/24".into(), "10.0.0.0/8".into()],
    });
    let ready_frame = make_frame(Command::ForwardReady {
        remote_port: 8080,
        success: true,
        error_reason: None,
    });
    let connect_frame = make_frame(Command::ForwardConnect { remote_port: 8080 });

    let ready_encoded = encode_data_frame(&ready_frame);
    let connect_encoded = encode_data_frame(&connect_frame);

    c.bench_function("codec/register_forward/roundtrip", |b| {
        b.iter(|| {
            let enc = encode_data_frame(&reg_frame);
            black_box(decode_data_frame(&enc).unwrap());
        });
    });
    c.bench_function("codec/forward_ready/decode", |b| {
        b.iter(|| black_box(decode_data_frame(&ready_encoded).unwrap()));
    });
    c.bench_function("codec/forward_connect/decode", |b| {
        b.iter(|| black_box(decode_data_frame(&connect_encoded).unwrap()));
    });
}

fn bench_codec_udp(c: &mut Criterion) {
    let udp_data_frame = make_frame(Command::UdpData {
        assoc_id: 1,
        frag: 0,
        addr_type: 0x01, // IPv4
        dest_addr: vec![192, 168, 1, 1],
        dest_port: 53,
        payload: vec![0xABu8; 512],
    });
    let udp_encoded = encode_data_frame(&udp_data_frame);

    c.bench_function("codec/udp_data/encode", |b| {
        b.iter(|| black_box(encode_data_frame(&udp_data_frame)));
    });
    c.bench_function("codec/udp_data/decode", |b| {
        b.iter(|| black_box(decode_data_frame(&udp_encoded).unwrap()));
    });
}

fn bench_codec_fallback_advertisement(c: &mut Criterion) {
    let frame = make_frame(Command::FallbackAdvertisement {
        transports: vec![
            "quic".into(),
            "websocket".into(),
            "grpc".into(),
            "xhttp".into(),
            "xporta".into(),
        ],
    });
    let encoded = encode_data_frame(&frame);

    c.bench_function("codec/fallback_advertisement/encode", |b| {
        b.iter(|| black_box(encode_data_frame(&frame)));
    });
    c.bench_function("codec/fallback_advertisement/decode", |b| {
        b.iter(|| black_box(decode_data_frame(&encoded).unwrap()));
    });
}

fn bench_codec_challenge_response(c: &mut Criterion) {
    let frame = make_frame(Command::ChallengeResponse { hash: [0xCCu8; 32] });
    let encoded = encode_data_frame(&frame);

    c.bench_function("codec/challenge_response/roundtrip", |b| {
        b.iter(|| {
            let enc = encode_data_frame(&frame);
            black_box(decode_data_frame(&enc).unwrap());
        });
    });
    c.bench_function("codec/challenge_response/decode", |b| {
        b.iter(|| black_box(decode_data_frame(&encoded).unwrap()));
    });
}

fn bench_codec_migration(c: &mut Criterion) {
    let frame = make_frame(Command::Migration {
        token: [0xAAu8; 32],
        session_id: [0xBBu8; 16],
    });
    let encoded = encode_data_frame(&frame);

    c.bench_function("codec/migration/roundtrip", |b| {
        b.iter(|| {
            let enc = encode_data_frame(&frame);
            black_box(decode_data_frame(&enc).unwrap());
        });
    });
    c.bench_function("codec/migration/decode", |b| {
        b.iter(|| black_box(decode_data_frame(&encoded).unwrap()));
    });
}

fn bench_codec_dns(c: &mut Criterion) {
    let query_frame = make_frame(Command::DnsQuery {
        query_id: 1234,
        data: vec![0xABu8; 64],
    });
    let response_frame = make_frame(Command::DnsResponse {
        query_id: 1234,
        data: vec![0xCDu8; 256],
    });
    let query_encoded = encode_data_frame(&query_frame);
    let response_encoded = encode_data_frame(&response_frame);

    c.bench_function("codec/dns_query/decode", |b| {
        b.iter(|| black_box(decode_data_frame(&query_encoded).unwrap()));
    });
    c.bench_function("codec/dns_response/decode", |b| {
        b.iter(|| black_box(decode_data_frame(&response_encoded).unwrap()));
    });
}

fn bench_codec_speed_test(c: &mut Criterion) {
    let frame = make_frame(Command::SpeedTest {
        direction: 0,
        duration_secs: 10,
        data: vec![0u8; 4096],
    });
    let encoded = encode_data_frame(&frame);

    c.bench_function("codec/speed_test/encode", |b| {
        b.iter(|| black_box(encode_data_frame(&frame)));
    });
    c.bench_function("codec/speed_test/decode", |b| {
        b.iter(|| black_box(decode_data_frame(&encoded).unwrap()));
    });
}

criterion_group!(
    benches,
    bench_codec_connect,
    bench_codec_data,
    bench_codec_ping_pong,
    bench_codec_port_forward,
    bench_codec_udp,
    bench_codec_fallback_advertisement,
    bench_codec_challenge_response,
    bench_codec_migration,
    bench_codec_dns,
    bench_codec_speed_test,
);
criterion_main!(benches);
