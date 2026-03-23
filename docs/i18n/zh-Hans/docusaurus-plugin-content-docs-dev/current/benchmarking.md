---
title: 性能基准测试
sidebar_position: 9
---

# 性能基准测试

Prisma 包含两层基准测试：**微基准测试**（Criterion，进程内）用于加密/编解码/中继热路径，**宏基准测试**（Shell 脚本，端到端）用于与 xray-core 和 sing-box 的对比吞吐量测试。

## 微基准测试（Criterion）

### 运行基准测试

```bash
# 运行所有 prisma-core 基准测试
cargo bench -p prisma-core

# 运行特定基准测试文件
cargo bench -p prisma-core -- relay
cargo bench -p prisma-core -- codec
cargo bench -p prisma-core -- handshake
cargo bench -p prisma-core -- crypto
```

### 基准测试文件

| 文件 | 测量内容 |
|------|---------|
| `crates/prisma-core/benches/crypto_bench.rs` | AEAD 加密/解密（ChaCha20-Poly1305、AES-256-GCM）、帧编码器/解码器（seal/unseal）、编解码 encode/decode、KDF（BLAKE3）、抗重放窗口、填充生成、握手消息编码/解码 |
| `crates/prisma-core/benches/relay_bench.rs` | 模拟中继循环：在 1KB/8KB/32KB 负载大小下的 seal+unseal 往返、仅加密、仅解密以及带填充的中继路径，覆盖两种密码套件 |
| `crates/prisma-core/benches/codec_bench.rs` | 所有 16 种 Command 类型的编码/解码往返：Connect、Data、Close、Ping、Pong、RegisterForward、ForwardReady、ForwardConnect、UdpData、SpeedTest、DnsQuery、DnsResponse、ChallengeResponse、Migration、FallbackAdvertisement |
| `crates/prisma-core/benches/handshake_bench.rs` | 完整握手计时：客户端初始化生成、服务端解码+认证验证、ECDH（X25519）、KDF 链（预备密钥+会话密钥）、服务端初始化加密/解密、端到端握手往返 |

### 与历史运行对比

Criterion 自动在 `target/criterion/` 中存储基线。对比方法：

```bash
# 在修改前保存基线
cargo bench -p prisma-core -- --save-baseline before

# 进行修改...

# 与基线对比
cargo bench -p prisma-core -- --baseline before
```

Criterion 在 `target/criterion/report/index.html` 生成包含对比图表的 HTML 报告。

### 关键指标

| 指标 | 基准测试组 | 目标 |
|------|-----------|------|
| 中继吞吐量 | `relay_roundtrip` | > 5 Gbps (32KB 帧) |
| AEAD 加密延迟 | `aead_encrypt` | < 1 us (1KB) |
| 帧密封延迟 | `frame_encoder/seal` | < 2 us (16KB) |
| 编解码往返 | `codec/data` | < 200 ns (1KB) |
| 握手总时间 | `handshake/full_roundtrip` | < 500 us |
| ECDH (X25519) | `handshake/ecdh_x25519` | < 100 us |

### 添加新基准测试

1. 在 `crates/prisma-core/benches/` 中创建或编辑文件
2. 使用 Criterion 框架：
   ```rust
   use criterion::{black_box, criterion_group, criterion_main, Criterion};

   fn bench_my_thing(c: &mut Criterion) {
       c.bench_function("my_thing", |b| {
           b.iter(|| black_box(do_something()));
       });
   }

   criterion_group!(benches, bench_my_thing);
   criterion_main!(benches);
   ```
3. 在 `crates/prisma-core/Cargo.toml` 中添加 `[[bench]]` 条目：
   ```toml
   [[bench]]
   name = "my_bench"
   harness = false
   ```
4. 运行 `cargo bench -p prisma-core -- my_thing` 验证

## 性能分析

### CPU 分析（Flamegraph）

```bash
cargo install flamegraph

# 在负载下分析服务端
cargo flamegraph -p prisma-cli -- server -c server.toml

# 分析特定基准测试
cargo flamegraph --bench crypto_bench -- --bench
```

### 内存分析（DHAT）

```bash
# 构建 release 二进制
cargo build --release -p prisma-cli

# 使用 DHAT 运行（仅 Linux，需要 valgrind）
valgrind --tool=dhat ./target/release/prisma server -c server.toml
```

### 异步分析（tokio-console）

```bash
# 使用 tokio_unstable cfg 构建
RUSTFLAGS="--cfg tokio_unstable" cargo build -p prisma-cli

# 在另一个终端
tokio-console
```

## 宏基准测试（对比测试）

`scripts/benchmark.sh` 脚本运行端到端吞吐量对比：

```bash
# 快速模式：5 个场景，64MB 负载，3 次运行
./scripts/benchmark.sh quick

# 完整模式：25 个场景，3 种负载（1MB/32MB/256MB），7 次运行
./scripts/benchmark.sh full
```

结果写入 `benchmark-results/`，并由 CI 自动发布到[基准测试页面](/benchmarks)。

### CI 集成

- **每周运行**：`.github/workflows/benchmark.yml` 每周一 04:00 UTC 运行
- **PR 检查**：`.github/workflows/ci.yml` 在 PR 上包含基准测试回归检查
- **历史记录**：最近 12 周的结果保存在 `docs/static/data/benchmark-results.json`

## 性能回归检测

对热路径文件的任何修改都应检查回归：

```bash
# 快速检查：运行内置速度测试
prisma speed-test --server localhost:8443 --duration 10 --direction both

# 彻底检查：运行带对比的微基准测试
cargo bench -p prisma-core -- --save-baseline before
# ... 进行修改 ...
cargo bench -p prisma-core -- --baseline before

# 标记任何 > 5% 的回归
```
