import type {ReactNode} from 'react';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';
import Mermaid from '@theme/Mermaid';

import styles from '@site/src/pages/dev.module.css';

/* =========================================================================
   开发者文档 — 综合内部参考 (Chinese translation)
   ========================================================================= */

export default function DevPage(): ReactNode {
  return (
    <Layout
      title="开发者文档"
      description="Prisma 代理系统综合开发者参考 — 架构、模块 API、线路协议、配置字段、CLI 命令、管理端点、FFI 函数和扩展指南。"
    >
      <main className={`container ${styles.page}`}>
        {/* ── Hero ────────────────────────────────────────────────── */}
        <div className={styles.hero}>
          <Heading as="h1" className={styles.heroTitle}>
            开发者文档
          </Heading>
          <p className={styles.heroSubtitle}>
            Prisma 代理系统内部参考 — 架构设计、模块 API、线路协议、配置字段、CLI 命令、管理接口、FFI 函数与扩展指南。
          </p>
          <span className={styles.heroVersion}>workspace v1.3.0 &middot; PrismaVeil 协议 v5 &middot; Rust 2021</span>
        </div>

        {/* ── 目录 ────────────────────────────────────────────────── */}
        <div className={styles.toc}>
          <Heading as="h3" className={styles.tocTitle}>目录</Heading>
          <ol className={styles.tocList}>
            <li><a href="#architecture">架构总览</a></li>
            <li><a href="#crate-graph">Crate 依赖图</a></li>
            <li><a href="#data-flow">数据流</a></li>
            <li><a href="#prisma-core">prisma-core 参考</a></li>
            <li><a href="#prisma-server">prisma-server 参考</a></li>
            <li><a href="#prisma-client">prisma-client 参考</a></li>
            <li><a href="#prisma-mgmt">prisma-mgmt 参考</a></li>
            <li><a href="#prisma-ffi">prisma-ffi 参考</a></li>
            <li><a href="#prisma-cli">prisma-cli 参考</a></li>
            <li><a href="#protocol">线路协议 (PrismaVeil v5)</a></li>
            <li><a href="#config-server">服务器配置</a></li>
            <li><a href="#config-client">客户端配置</a></li>
            <li><a href="#dev-guide">开发指南</a></li>
          </ol>
        </div>

        {/* ════════════════════════════════════════════════════════════
            1. 架构总览
            ════════════════════════════════════════════════════════════ */}
        <section className={styles.section} id="architecture">
          <Heading as="h2">架构总览</Heading>
          <p>
            Prisma 是一个包含六个 crate 的 Cargo 工作区。所有 crate 使用 <code>edition = "2021"</code>，
            共享依赖通过根目录 <code>Cargo.toml</code> 的 <code>[workspace.dependencies]</code> 声明。
          </p>
          <div className={styles.refTable}>
            <table>
              <thead><tr><th>Crate</th><th>类型</th><th>职责</th></tr></thead>
              <tbody>
                <tr><td><code>prisma-core</code></td><td>库</td><td>共享库：加密、协议 (PrismaVeil v5)、配置、类型、带宽、DNS、路由、流量整形、多路复用、ACL、订阅、导入</td></tr>
                <tr><td><code>prisma-server</code></td><td>库 + 二进制</td><td>服务器：监听器 (TCP / QUIC / WS / gRPC / XHTTP / XPorta / SSH / WireGuard)、处理器、中继、认证、伪装</td></tr>
                <tr><td><code>prisma-client</code></td><td>库 + 二进制</td><td>客户端：SOCKS5 / HTTP 入站、传输选择器、隧道、TUN 模式、DNS 解析器、PAC、连接池、端口转发</td></tr>
                <tr><td><code>prisma-cli</code></td><td>二进制</td><td>CLI (clap 4)：服务器 + 客户端启动、管理命令、诊断、Web 控制台</td></tr>
                <tr><td><code>prisma-mgmt</code></td><td>库</td><td>管理 API (axum)：REST 端点、WebSocket 流、认证中间件、Prometheus 导出</td></tr>
                <tr><td><code>prisma-ffi</code></td><td>cdylib</td><td>C FFI 共享库：生命周期管理、配置文件、二维码、系统代理、自动更新、按应用代理</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* ════════════════════════════════════════════════════════════
            2. Crate 依赖图
            ════════════════════════════════════════════════════════════ */}
        <section className={styles.section} id="crate-graph">
          <Heading as="h2">Crate 依赖图</Heading>
          <div className={styles.diagram}>
            <Mermaid value={`graph TD
  CLI["prisma-cli<br/>(二进制)"]
  SERVER["prisma-server<br/>(库 + 二进制)"]
  CLIENT["prisma-client<br/>(库 + 二进制)"]
  CORE["prisma-core<br/>(共享库)"]
  MGMT["prisma-mgmt<br/>(库)"]
  FFI["prisma-ffi<br/>(cdylib)"]
  GUI["prisma-gui<br/>(Tauri 应用)"]

  CLI --> SERVER
  CLI --> CLIENT
  CLI --> CORE
  SERVER --> CORE
  SERVER --> MGMT
  CLIENT --> CORE
  MGMT --> CORE
  FFI --> CLIENT
  FFI --> CORE
  GUI -->|Tauri 命令| FFI
`} />
          </div>
        </section>

        {/* ════════════════════════════════════════════════════════════
            3. 数据流
            ════════════════════════════════════════════════════════════ */}
        <section className={styles.section} id="data-flow">
          <Heading as="h2">数据流</Heading>
          <div className={styles.diagram}>
            <Mermaid value={`sequenceDiagram
  participant App as 应用程序
  participant S5 as SOCKS5/HTTP<br/>入站
  participant T as 传输<br/>选择器
  participant TN as 隧道<br/>(PrismaVeil)
  participant SRV as 服务器<br/>处理器
  participant R as 中继
  participant D as 目标

  App->>S5: CONNECT example.com:443
  S5->>T: 选择传输 (QUIC/WS/gRPC/...)
  T->>TN: 建立隧道（握手）
  TN->>SRV: ClientInit + ChallengeResponse
  SRV-->>TN: ServerInit（会话密钥）
  TN->>SRV: CMD_CONNECT example.com:443
  SRV->>R: 连接目标
  R->>D: TCP 连接
  R-->>SRV: 已连接
  Note over TN,R: 加密双向中继
  TN<<->>R: 加密帧
  R<<->>D: 明文 TCP
`} />
          </div>
          <p>
            客户端接受 SOCKS5 或 HTTP CONNECT 请求，选择传输协议，执行 PrismaVeil 握手（1 RTT），
            然后发送加密的 <code>CMD_CONNECT</code> 帧。服务器解析目标、建立连接并双向中继数据。
            客户端与服务器之间的所有帧均使用 ChaCha20-Poly1305 或 AES-256-GCM 加密。
          </p>
        </section>

        {/* ════════════════════════════════════════════════════════════
            4 - 13: 其余章节使用与英文版相同的技术内容
            由于技术术语（函数名、类型名、配置键）保持英文原样，
            此翻译仅翻译说明性文字。
            ════════════════════════════════════════════════════════════ */}

        <section className={styles.section} id="prisma-core">
          <Heading as="h2">prisma-core 参考</Heading>
          <p>
            所有其他 crate 使用的共享库。包含协议实现、密码学原语、配置解析器和路由引擎。
            公共模块包括：
          </p>
          <div className={styles.moduleGrid}>
            <div className={styles.moduleCard}><strong>crypto/aead</strong><span>AEAD 密码：ChaCha20-Poly1305、AES-256-GCM、TransportOnly（BLAKE3 MAC）。<code>AeadCipher</code> trait 提供加密/解密 + 就地变体。</span></div>
            <div className={styles.moduleCard}><strong>crypto/kdf</strong><span>使用 BLAKE3 KDF 的密钥派生。v4 和 v5 域分离函数：初步密钥、会话密钥、头部密钥、迁移令牌、票据密钥。</span></div>
            <div className={styles.moduleCard}><strong>crypto/pq_kem</strong><span>混合后量子：X25519 + ML-KEM-768 (FIPS 203)。客户端/服务器初始化、封装、解封装和组合密钥派生。</span></div>
            <div className={styles.moduleCard}><strong>protocol/handshake</strong><span>PrismaVeil 两步握手状态机。<code>PrismaHandshakeClient</code> 和 <code>PrismaHandshakeServer</code>，支持 PQ-KEM。</span></div>
            <div className={styles.moduleCard}><strong>protocol/types</strong><span>线路类型：<code>Command</code> 枚举（Connect、Data、Close、UDP、DNS、SpeedTest、Migration），<code>DataFrame</code>，<code>SessionKeys</code>。</span></div>
            <div className={styles.moduleCard}><strong>config</strong><span>服务器和客户端配置结构体。分层加载：默认值 → TOML 文件 → 环境变量 (PRISMA_*)。</span></div>
            <div className={styles.moduleCard}><strong>router</strong><span>基于规则的路由引擎。条件：Domain、DomainSuffix、IpCidr、GeoIp、Port、All。动作：Proxy、Direct、Block。</span></div>
            <div className={styles.moduleCard}><strong>dns</strong><span>DNS 模式：Direct、Smart、Fake、Tunnel。协议：UDP、DoH (RFC 8484)、DoT (RFC 7858)。</span></div>
            <div className={styles.moduleCard}><strong>mux</strong><span>XMUX 流多路复用。帧：[stream_id:4][type:1][len:2][payload]。类型：SYN、DATA、FIN、RST。</span></div>
            <div className={styles.moduleCard}><strong>traffic_shaping</strong><span>反指纹识别：桶填充、时序抖动、帧合并、噪声注入。</span></div>
            <div className={styles.moduleCard}><strong>state</strong><span>服务器状态：<code>ServerState</code>、原子指标计数器、连接信息、客户端级指标、历史环形缓冲区。</span></div>
          </div>
          <p>
            完整模块列表请参阅英文版的对应章节 — 技术名称（函数签名、类型名称、配置键）与英文版相同。
          </p>
        </section>

        <section className={styles.section} id="prisma-server">
          <Heading as="h2">prisma-server 参考</Heading>
          <p>
            服务器二进制文件和库。在多种传输协议上监听连接，执行 PrismaVeil 握手，认证客户端，中继流量。
          </p>
          <Heading as="h3">监听器类型</Heading>
          <div className={styles.refTable}>
            <table>
              <thead><tr><th>传输</th><th>描述</th></tr></thead>
              <tbody>
                <tr><td>TCP</td><td>原始 TCP，可选 TLS。伪装支持：窥探前 3 字节区分 Prisma 客户端和探测器。</td></tr>
                <tr><td>QUIC</td><td>QUIC v1/v2 via quinn。支持 Salamander UDP 混淆、端口跳跃、H3 伪装。</td></tr>
                <tr><td>WebSocket</td><td>CDN HTTPS 上的 WebSocket 隧道。CDN 兼容。</td></tr>
                <tr><td>gRPC</td><td>gRPC 双向流隧道。CDN 兼容。</td></tr>
                <tr><td>XHTTP</td><td>HTTP 原生传输：分离的上传 (POST) 和下载 (SSE) 路径。CDN 兼容。</td></tr>
                <tr><td>XPorta</td><td>REST API 模拟：会话初始化、JSON/二进制上传、长轮询下载。</td></tr>
                <tr><td>SSH</td><td>SSH 传输 via russh。可选虚假 shell。</td></tr>
                <tr><td>WireGuard</td><td>WireGuard 兼容 UDP 传输。</td></tr>
              </tbody>
            </table>
          </div>
          <Heading as="h3">中继模式</Heading>
          <ul>
            <li><strong>加密中继</strong> — 标准路径：解密客户端帧，转发明文到目标，加密响应。使用 <code>AtomicNonceCounter</code> 实现无锁 nonce 生成。</li>
            <li><strong>加密 + 限速</strong> — 同上，增加每客户端带宽限制和流量配额。</li>
            <li><strong>splice(2)</strong> — Linux 零拷贝中继：当使用 TransportOnly 密码时内核空间数据传输。</li>
            <li><strong>UDP 中继</strong> — 双向 UDP 数据报中继，可选 Reed-Solomon FEC。</li>
          </ul>
        </section>

        <section className={styles.section} id="prisma-client">
          <Heading as="h2">prisma-client 参考</Heading>
          <p>
            客户端库和二进制文件。接受本地代理请求，选择传输，建立 PrismaVeil 隧道，中继流量到服务器。
          </p>
          <Heading as="h3">入口点</Heading>
          <ul>
            <li><code>run(config_path)</code> — 独立 CLI 模式，自带日志。</li>
            <li><code>run_embedded(config_path, log_tx, metrics)</code> — GUI/FFI 模式，广播日志和共享指标。</li>
            <li><code>run_embedded_with_filter(...)</code> — GUI/FFI 模式，支持按应用代理和优雅关闭。</li>
          </ul>
          <Heading as="h3">关键模块</Heading>
          <ul>
            <li><code>proxy.rs</code> — <code>ProxyContext</code> 中央上下文，<code>connect()</code> 建立到服务器的传输。</li>
            <li><code>connector.rs</code> — <code>TransportStream</code> 枚举：Tcp、Quic、TcpTls、WebSocket、Grpc、Xhttp、XPorta、WireGuard。</li>
            <li><code>tunnel.rs</code> — PrismaVeil 隧道建立：握手 + 质询响应。</li>
            <li><code>socks5/</code>、<code>http/</code> — 入站代理服务器。</li>
            <li><code>tun/</code> — TUN 模式：设备创建、IP 包处理、用户空间 TCP (smoltcp)、按应用过滤。</li>
            <li><code>dns_resolver.rs</code>、<code>dns_server.rs</code> — DNS 解析和本地 DNS 服务器。</li>
            <li><code>connection_pool.rs</code> — 持久传输连接池 + XMUX 多路复用。</li>
            <li><code>pac.rs</code> — PAC 自动代理配置生成器和 HTTP 服务器。</li>
          </ul>
        </section>

        <section className={styles.section} id="prisma-mgmt">
          <Heading as="h2">prisma-mgmt 参考</Heading>
          <p>
            基于 <code>axum</code> 的管理 API。除 <code>/api/prometheus</code> 外，所有端点需要 Bearer 令牌认证。
            完整端点列表请参阅英文版 — 路径和方法相同。
          </p>
          <Heading as="h3">主要端点分类</Heading>
          <ul>
            <li><strong>健康与指标</strong>: <code>GET /api/health</code>、<code>/api/metrics</code>、<code>/api/metrics/history</code>、<code>/api/system/info</code></li>
            <li><strong>连接管理</strong>: <code>GET /api/connections</code>、<code>DELETE /api/connections/&#123;id&#125;</code></li>
            <li><strong>客户端管理</strong>: <code>GET|POST /api/clients</code>、<code>PUT|DELETE /api/clients/&#123;id&#125;</code></li>
            <li><strong>带宽与配额</strong>: <code>/api/clients/&#123;id&#125;/bandwidth</code>、<code>/api/clients/&#123;id&#125;/quota</code>、<code>/api/bandwidth/summary</code></li>
            <li><strong>配置</strong>: <code>GET|PATCH /api/config</code>、<code>/api/config/tls</code>、备份管理</li>
            <li><strong>路由与 ACL</strong>: <code>/api/routes</code>、<code>/api/acls</code></li>
            <li><strong>WebSocket</strong>: <code>/api/ws/metrics</code>、<code>/api/ws/logs</code>、<code>/api/ws/connections</code>、<code>/api/ws/reload</code></li>
            <li><strong>Prometheus</strong>: <code>GET /api/prometheus</code>（无需认证）</li>
          </ul>
        </section>

        <section className={styles.section} id="prisma-ffi">
          <Heading as="h2">prisma-ffi 参考</Heading>
          <p>
            C ABI 共享库 (<code>cdylib</code>)，用于 GUI 和移动端集成。
            所有 <code>extern "C"</code> 函数通过 <code>ffi_catch!</code> 宏保证 panic 安全。
            字符串为 null 结尾 UTF-8；调用方使用 <code>prisma_free_string()</code> 释放返回的字符串。
          </p>
          <Heading as="h3">错误码</Heading>
          <div className={styles.refTable}>
            <table>
              <thead><tr><th>常量</th><th>值</th><th>含义</th></tr></thead>
              <tbody>
                <tr><td><code>PRISMA_OK</code></td><td>0</td><td>成功</td></tr>
                <tr><td><code>PRISMA_ERR_INVALID_CONFIG</code></td><td>1</td><td>无效配置</td></tr>
                <tr><td><code>PRISMA_ERR_ALREADY_CONNECTED</code></td><td>2</td><td>已连接</td></tr>
                <tr><td><code>PRISMA_ERR_NOT_CONNECTED</code></td><td>3</td><td>未连接</td></tr>
                <tr><td><code>PRISMA_ERR_PERMISSION_DENIED</code></td><td>4</td><td>权限不足</td></tr>
                <tr><td><code>PRISMA_ERR_INTERNAL</code></td><td>5</td><td>内部错误</td></tr>
                <tr><td><code>PRISMA_ERR_NULL_POINTER</code></td><td>6</td><td>空指针</td></tr>
              </tbody>
            </table>
          </div>
          <p>
            完整导出函数列表（30+ 函数，含生命周期、配置文件、二维码、系统代理、自动更新、移动端生命周期等）请参阅英文版。
          </p>
        </section>

        <section className={styles.section} id="prisma-cli">
          <Heading as="h2">prisma-cli 参考</Heading>
          <p>
            基于 <code>clap 4</code> 的统一 CLI。全局标志：<code>--json</code>、<code>--mgmt-url</code>、<code>--mgmt-token</code>。
          </p>
          <Heading as="h3">主要命令</Heading>
          <ul>
            <li><code>server</code> / <code>client</code> — 启动服务器/客户端</li>
            <li><code>gen-key</code> / <code>gen-cert</code> / <code>init</code> — 生成密钥、证书、配置文件</li>
            <li><code>validate</code> — 验证配置文件</li>
            <li><code>status</code> / <code>metrics</code> / <code>logs</code> — 查询服务器状态</li>
            <li><code>console</code> — 启动 Web 管理控制台</li>
            <li><code>clients</code> / <code>connections</code> / <code>bandwidth</code> / <code>routes</code> — 管理 API 命令</li>
            <li><code>ping</code> / <code>test-transport</code> / <code>diagnose</code> / <code>speed-test</code> — 诊断工具</li>
            <li><code>subscription</code> / <code>latency-test</code> — 订阅和延迟测试</li>
          </ul>
        </section>

        <section className={styles.section} id="protocol">
          <Heading as="h2">线路协议 (PrismaVeil v5)</Heading>
          <Heading as="h3">握手 (2 步, 1 RTT)</Heading>
          <p>
            客户端发送 <code>ClientInit</code>（版本、X25519 公钥、客户端 ID、时间戳、密码套件、认证令牌、可选 PQ-KEM 封装密钥），
            服务器返回 <code>ServerInit</code>（状态、会话 ID、X25519 公钥、质询、填充范围、功能位、票据、可选 PQ-KEM 密文）。
            客户端随后发送 <code>ChallengeResponse</code>（BLAKE3 哈希）以验证服务器身份。
          </p>
          <Heading as="h3">密钥派生</Heading>
          <ul>
            <li><strong>初步密钥</strong>: <code>BLAKE3-KDF("prisma-v5-preliminary", ...)</code> — 加密 ServerInit</li>
            <li><strong>会话密钥</strong>: <code>BLAKE3-KDF("prisma-v5-session", ...)</code> — 加密数据帧</li>
            <li><strong>头部密钥</strong>: <code>BLAKE3-KDF("prisma-v5-header-auth", ...)</code> — AAD 绑定</li>
            <li><strong>混合后量子</strong>: X25519 + ML-KEM-768 通过 BLAKE3 组合</li>
          </ul>
          <Heading as="h3">数据帧格式</Heading>
          <div className={styles.codeBlock}>
            <code>{`[长度: 2 字节 (大端)][加密帧: 可变长度]

解密后: [cmd: 1][flags: 2 (小端)][stream_id: 4][payload: 可变]`}</code>
          </div>
          <Heading as="h3">密码套件</Heading>
          <ul>
            <li><code>0x01</code> — ChaCha20-Poly1305 (默认，ARM 友好)</li>
            <li><code>0x02</code> — AES-256-GCM (AES-NI 硬件加速)</li>
            <li><code>0x03</code> — TransportOnly (仅 BLAKE3 MAC，用于 TLS/QUIC 上)</li>
          </ul>
        </section>

        <section className={styles.section} id="config-server">
          <Heading as="h2">服务器配置参考</Heading>
          <p>TOML 格式。环境变量覆盖：<code>PRISMA_*</code>。完整字段列表请参阅英文版 — 配置键名相同。</p>
          <Heading as="h3">关键配置分组</Heading>
          <ul>
            <li><strong>顶级</strong>: <code>listen_addr</code>、<code>quic_listen_addr</code></li>
            <li><strong>[tls]</strong>: <code>cert_path</code>、<code>key_path</code></li>
            <li><strong>[[authorized_clients]]</strong>: <code>id</code>、<code>auth_secret</code>、<code>name</code>、<code>bandwidth_up/down</code>、<code>quota</code></li>
            <li><strong>[management_api]</strong>: <code>enabled</code>、<code>listen_addr</code>、<code>auth_token</code></li>
            <li><strong>[camouflage]</strong>: <code>enabled</code>、<code>fallback_addr</code>、<code>salamander_password</code></li>
            <li><strong>[cdn]</strong>: <code>enabled</code>、<code>listen_addr</code>、WS/gRPC/XHTTP/XPorta 路径</li>
            <li><strong>[traffic_shaping]</strong>: <code>padding_mode</code>、<code>bucket_sizes</code>、<code>timing_jitter_ms</code></li>
          </ul>
        </section>

        <section className={styles.section} id="config-client">
          <Heading as="h2">客户端配置参考</Heading>
          <p>TOML 格式。完整字段列表请参阅英文版。</p>
          <Heading as="h3">关键配置分组</Heading>
          <ul>
            <li><strong>顶级</strong>: <code>server_addr</code>、<code>socks5_listen_addr</code>、<code>transport</code>、<code>cipher_suite</code>、<code>fingerprint</code></li>
            <li><strong>[identity]</strong>: <code>client_id</code>、<code>auth_secret</code></li>
            <li><strong>[dns]</strong>: <code>mode</code>、<code>protocol</code>、<code>upstream</code></li>
            <li><strong>[tun]</strong>: <code>enabled</code>、<code>device_name</code>、<code>mtu</code>、<code>include_routes</code></li>
            <li><strong>[congestion]</strong>: <code>mode</code> (bbr/brutal/adaptive)</li>
            <li><strong>[routing]</strong>: <code>rules</code>、<code>geoip_path</code></li>
            <li><strong>多路复用</strong>: <code>[xmux]</code> 配置节（存在即启用）</li>
          </ul>
        </section>

        <section className={styles.section} id="dev-guide">
          <Heading as="h2">开发指南</Heading>
          <Heading as="h3">构建与测试</Heading>
          <div className={styles.codeBlock}>
            <code>{`# 构建所有 crate
cargo build --workspace

# 运行所有测试
cargo test --workspace

# Clippy 检查
cargo clippy --workspace --all-targets

# 格式检查
cargo fmt --all -- --check`}</code>
          </div>
          <Heading as="h3">添加新传输协议</Heading>
          <ol>
            <li>在 <code>crates/prisma-server/src/listener/</code> 创建监听器模块</li>
            <li>在 <code>crates/prisma-client/src/</code> 创建传输流，实现 <code>AsyncRead + AsyncWrite</code></li>
            <li>在 <code>connector.rs</code> 的 <code>TransportStream</code> 枚举中添加变体</li>
            <li>在配置结构体中添加相关字段</li>
            <li>更新 CLI 版本信息</li>
            <li>添加测试</li>
          </ol>
          <Heading as="h3">添加管理 API 端点</Heading>
          <ol>
            <li>在 <code>crates/prisma-mgmt/src/handlers/</code> 创建处理器</li>
            <li>在 <code>router.rs</code> 注册路由</li>
            <li>处理器通过 <code>State&lt;MgmtState&gt;</code> 访问服务器状态</li>
          </ol>
        </section>

      </main>
    </Layout>
  );
}
