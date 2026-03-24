# 贡献指南

如何扩展 Prisma 代理系统：添加传输、CLI 命令、API 端点、配置字段、测试、模糊测试和基准测试。

---

## 添加新传输

传输是在客户端和服务端之间承载 PrismaVeil 帧的双向字节流 (`AsyncRead + AsyncWrite`)。

### 步骤

1. **在 `crates/prisma-client/src/` 创建客户端流适配器：**

   ```
   crates/prisma-client/src/my_transport_stream.rs
   ```

   实现 `AsyncRead + AsyncWrite + Send + Unpin` 的结构体。

2. **在传输选择器中注册** (`crates/prisma-client/src/transport_selector.rs`)

3. **在 `crates/prisma-client/src/lib.rs` 添加模块**

4. **在 `crates/prisma-server/src/listener/` 创建服务端监听器**

5. **在服务端注册** (`crates/prisma-server/src/listener/mod.rs` 和 `crates/prisma-server/src/lib.rs`)

6. **添加配置字段**

7. **更新版本命令** (`crates/prisma-cli/src/main.rs`)

### 需要修改的文件

| 文件 | 修改 |
|------|------|
| `crates/prisma-client/src/lib.rs` | 添加模块 |
| `crates/prisma-client/src/my_transport_stream.rs` | 新文件 |
| `crates/prisma-client/src/transport_selector.rs` | 添加匹配分支 |
| `crates/prisma-server/src/listener/mod.rs` | 添加模块 |
| `crates/prisma-server/src/listener/my_transport.rs` | 新文件 |
| `crates/prisma-server/src/lib.rs` | 启动监听器 |
| `crates/prisma-core/src/config/server.rs` | 添加配置结构体 |
| `crates/prisma-core/src/config/client.rs` | 添加配置字段 |

---

## 添加新 CLI 命令

1. 在 `Commands` 枚举中添加命令变体
2. 在 `crates/prisma-cli/src/` 创建处理器模块
3. 在 `main.rs` 注册模块和匹配分支

---

## 添加新管理 API 端点

1. 在 `crates/prisma-mgmt/src/handlers/` 创建处理器
2. 在 `crates/prisma-mgmt/src/router.rs` 注册路由
3. 可选添加 CLI 命令调用该端点

---

## 添加新配置字段

1. 在配置结构体中添加字段（带 `#[serde(default)]`）
2. 添加默认值函数
3. 在 `validation.rs` 添加验证
4. 在相应的 crate 中使用该字段
5. 如需热重载，添加到 `reload.rs`

---

## 测试指南

```bash
# 所有测试
cargo test --workspace

# 特定 crate
cargo test -p prisma-core

# 特定测试
cargo test -p prisma-core test_handshake

# 显示输出
cargo test --workspace -- --nocapture
```

### 测试规范

- 异步测试使用 `#[tokio::test]`
- 编解码/协议函数使用 `proptest` 属性测试
- 握手测试 Mock `AuthVerifier` trait
- 传输测试使用 `tokio::net::TcpStream` 对

---

## 模糊测试

```bash
cargo install cargo-fuzz
cargo fuzz list
cargo fuzz run fuzz_decode_client_init
```

### 关键模糊测试目标

| 目标 | 描述 |
|------|------|
| `fuzz_decode_client_init` | PrismaClientInit 解码 |
| `fuzz_decode_server_init` | PrismaServerInit 解码 |
| `fuzz_decode_data_frame` | DataFrame 解码 |
| `fuzz_mux_frame` | XMUX 帧解码 |

---

## 基准测试

```bash
# 运行所有基准测试
cargo bench --workspace

# 运行特定基准测试
cargo bench -p prisma-core -- handshake
```

### 关键基准测试

| 基准测试 | 描述 |
|----------|------|
| `bench_aead_encrypt` | AEAD 加密吞吐量 |
| `bench_handshake` | 完整握手 |
| `bench_handshake_pq` | 带 ML-KEM-768 的握手 |
| `bench_relay_throughput` | 双向中继吞吐量 |
| `bench_router_evaluate` | 路由规则评估 |

---

## 代码风格

- 提交前运行 `cargo fmt --all`
- 运行 `cargo clippy --workspace --all-targets` 并修复所有警告
- 日志使用 `tracing`（不用 `println!` 或 `log`）
- 可失败函数使用 `anyhow::Result`
- `prisma-core` 自定义错误类型使用 `thiserror`
- 所有公共项应有文档注释
- FFI 函数必须使用 `ffi_catch!` 捕获 panic
