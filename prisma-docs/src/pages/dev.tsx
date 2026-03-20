import type {ReactNode} from 'react';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';
import Mermaid from '@theme/Mermaid';

import styles from './dev.module.css';

/* =========================================================================
   Developer Documentation — comprehensive internal reference
   ========================================================================= */

export default function DevPage(): ReactNode {
  return (
    <Layout
      title="Developer Documentation"
      description="Comprehensive developer reference for the Prisma proxy system — architecture, crate APIs, configuration, CLI, management API, and extension guides."
    >
      <main className={`container ${styles.page}`}>
        {/* ── Hero ────────────────────────────────────────────────── */}
        <div className={styles.hero}>
          <Heading as="h1" className={styles.heroTitle}>
            Developer Documentation
          </Heading>
          <p className={styles.heroSubtitle}>
            Internal reference for the Prisma proxy system — architecture,
            module APIs, wire protocol, configuration fields, CLI commands,
            management endpoints, FFI functions, and extension recipes.
          </p>
          <span className={styles.heroVersion}>workspace v0.9.0 &middot; PrismaVeil Protocol v5 &middot; Rust 2021</span>
        </div>

        {/* ── Table of Contents ───────────────────────────────────── */}
        <div className={styles.toc}>
          <Heading as="h3" className={styles.tocTitle}>Contents</Heading>
          <ol className={styles.tocList}>
            <li><a href="#architecture">Architecture Overview</a></li>
            <li><a href="#crate-graph">Crate Dependency Graph</a></li>
            <li><a href="#data-flow">Data Flow</a></li>
            <li><a href="#prisma-core">prisma-core Reference</a></li>
            <li><a href="#prisma-server">prisma-server Reference</a></li>
            <li><a href="#prisma-client">prisma-client Reference</a></li>
            <li><a href="#prisma-mgmt">prisma-mgmt Reference</a></li>
            <li><a href="#prisma-ffi">prisma-ffi Reference</a></li>
            <li><a href="#prisma-cli">prisma-cli Reference</a></li>
            <li><a href="#protocol">Wire Protocol (PrismaVeil v5)</a></li>
            <li><a href="#config-server">Server Configuration</a></li>
            <li><a href="#config-client">Client Configuration</a></li>
            <li><a href="#dev-guide">Development Guide</a></li>
          </ol>
        </div>

        {/* ════════════════════════════════════════════════════════════
            1. Architecture Overview
            ════════════════════════════════════════════════════════════ */}
        <section className={styles.section} id="architecture">
          <Heading as="h2">Architecture Overview</Heading>
          <p>
            Prisma is a Cargo workspace of six crates. Every crate uses <code>edition = "2021"</code> and
            references shared dependencies via <code>[workspace.dependencies]</code> in the root <code>Cargo.toml</code>.
          </p>
          <div className={styles.refTable}>
            <table>
              <thead><tr><th>Crate</th><th>Type</th><th>Role</th></tr></thead>
              <tbody>
                <tr><td><code>prisma-core</code></td><td>lib</td><td>Shared library: crypto, protocol (PrismaVeil v5), config, types, bandwidth, DNS, routing, traffic shaping, mux, ACL, subscriptions, import</td></tr>
                <tr><td><code>prisma-server</code></td><td>lib + bin</td><td>Server: listeners (TCP / QUIC / WS / gRPC / XHTTP / XPorta / ShadowTLS / SSH / WireGuard), handler, relay, auth, camouflage, hot-reload</td></tr>
                <tr><td><code>prisma-client</code></td><td>lib + bin</td><td>Client: SOCKS5 / HTTP inbound, transport selector, tunnel, TUN mode, DNS resolver, PAC, connection pool, port forwarding, latency testing</td></tr>
                <tr><td><code>prisma-cli</code></td><td>bin</td><td>CLI binary (clap 4): wraps server + client runners, management commands, diagnostics, web console launcher</td></tr>
                <tr><td><code>prisma-mgmt</code></td><td>lib</td><td>Management API (axum): REST endpoints, WebSocket streams, auth middleware, Prometheus export</td></tr>
                <tr><td><code>prisma-ffi</code></td><td>cdylib</td><td>C FFI shared library for GUI (Tauri) and mobile (Android JNI / iOS): lifecycle, profiles, QR, system proxy, auto-update, per-app proxy</td></tr>
              </tbody>
            </table>
          </div>
          <p>
            Additionally, <code>prisma-gui</code> is a Tauri + React application that uses <code>prisma-ffi</code> via
            Tauri commands. It is not a Cargo workspace member but lives alongside the crates.
          </p>
        </section>

        {/* ════════════════════════════════════════════════════════════
            2. Crate Dependency Graph
            ════════════════════════════════════════════════════════════ */}
        <section className={styles.section} id="crate-graph">
          <Heading as="h2">Crate Dependency Graph</Heading>
          <div className={styles.diagram}>
            <Mermaid value={`graph TD
  CLI["prisma-cli<br/>(binary)"]
  SERVER["prisma-server<br/>(lib + bin)"]
  CLIENT["prisma-client<br/>(lib + bin)"]
  CORE["prisma-core<br/>(shared lib)"]
  MGMT["prisma-mgmt<br/>(lib)"]
  FFI["prisma-ffi<br/>(cdylib)"]
  GUI["prisma-gui<br/>(Tauri app)"]

  CLI --> SERVER
  CLI --> CLIENT
  CLI --> CORE
  SERVER --> CORE
  SERVER --> MGMT
  CLIENT --> CORE
  MGMT --> CORE
  FFI --> CLIENT
  FFI --> CORE
  GUI -->|Tauri commands| FFI
`} />
          </div>
        </section>

        {/* ════════════════════════════════════════════════════════════
            3. Data Flow
            ════════════════════════════════════════════════════════════ */}
        <section className={styles.section} id="data-flow">
          <Heading as="h2">Data Flow</Heading>
          <div className={styles.diagram}>
            <Mermaid value={`sequenceDiagram
  participant App as Application
  participant S5 as SOCKS5/HTTP<br/>Inbound
  participant T as Transport<br/>Selector
  participant TN as Tunnel<br/>(PrismaVeil)
  participant SRV as Server<br/>Handler
  participant R as Relay
  participant D as Destination

  App->>S5: CONNECT example.com:443
  S5->>T: select transport (QUIC/WS/gRPC/...)
  T->>TN: establish tunnel (handshake)
  TN->>SRV: ClientInit + ChallengeResponse
  SRV-->>TN: ServerInit (session key)
  TN->>SRV: CMD_CONNECT example.com:443
  SRV->>R: connect to destination
  R->>D: TCP connect
  R-->>SRV: connected
  Note over TN,R: Encrypted bidirectional relay
  TN<<->>R: encrypted frames
  R<<->>D: plaintext TCP
`} />
          </div>
          <p>
            The client accepts SOCKS5 or HTTP CONNECT requests, selects a transport, performs the
            PrismaVeil handshake (1 RTT), then sends an encrypted <code>CMD_CONNECT</code> frame.
            The server resolves the destination, connects, and relays data bidirectionally.
            All frames between client and server are encrypted with either ChaCha20-Poly1305 or AES-256-GCM.
          </p>
        </section>

        {/* ════════════════════════════════════════════════════════════
            4. prisma-core Reference
            ════════════════════════════════════════════════════════════ */}
        <section className={styles.section} id="prisma-core">
          <Heading as="h2">prisma-core Reference</Heading>
          <p>
            Shared library used by all other crates. Contains the protocol implementation,
            cryptographic primitives, configuration parsers, and routing engine.
          </p>

          <div className={styles.moduleGrid}>
            <div className={styles.moduleCard}><strong>crypto/aead</strong><span>AEAD ciphers: ChaCha20-Poly1305, AES-256-GCM, TransportOnly (BLAKE3 MAC). Trait <code>AeadCipher</code> with encrypt/decrypt + in-place variants.</span></div>
            <div className={styles.moduleCard}><strong>crypto/kdf</strong><span>Key derivation using BLAKE3 KDF mode. v4 and v5 domain-separated functions: preliminary key, session key, header key, migration token, ticket key.</span></div>
            <div className={styles.moduleCard}><strong>crypto/ecdh</strong><span>X25519 ephemeral key exchange using <code>x25519-dalek</code>. <code>EphemeralKeyPair</code> generates keys and computes Diffie-Hellman shared secrets.</span></div>
            <div className={styles.moduleCard}><strong>crypto/pq_kem</strong><span>Hybrid post-quantum: X25519 + ML-KEM-768 (FIPS 203). Client/server init, encapsulate, decapsulate, and combined secret derivation.</span></div>
            <div className={styles.moduleCard}><strong>crypto/padding</strong><span>Random and bucket-based padding generators for anti-fingerprinting.</span></div>
            <div className={styles.moduleCard}><strong>crypto/ticket_key_ring</strong><span>Automatic session ticket key rotation. Ring of keys with configurable rotation interval and expired key retention.</span></div>
            <div className={styles.moduleCard}><strong>protocol/handshake</strong><span>PrismaVeil 2-step handshake state machines. <code>PrismaHandshakeClient</code> and <code>PrismaHandshakeServer</code> with PQ-KEM support.</span></div>
            <div className={styles.moduleCard}><strong>protocol/codec</strong><span>Frame encoding/decoding: <code>encode_data_frame</code>, <code>decode_data_frame</code>, <code>encrypt_frame</code>, <code>decrypt_frame</code>.</span></div>
            <div className={styles.moduleCard}><strong>protocol/types</strong><span>Wire types: <code>Command</code> enum (Connect, Data, Close, Ping, UDP, DNS, SpeedTest, Migration), <code>DataFrame</code>, <code>SessionKeys</code>, flags, features.</span></div>
            <div className={styles.moduleCard}><strong>protocol/anti_replay</strong><span>Sliding window anti-replay protection. Prevents nonce reuse attacks.</span></div>
            <div className={styles.moduleCard}><strong>protocol/frame_encoder</strong><span>Stateful <code>FrameEncoder</code> / <code>FrameDecoder</code> wrapping AEAD + nonce counter for streaming encryption.</span></div>
            <div className={styles.moduleCard}><strong>config/server</strong><span>Server config structs: <code>ServerConfig</code>, <code>TlsConfig</code>, <code>AuthorizedClient</code>, <code>CdnConfig</code>, <code>CamouflageConfig</code>, <code>PrismaTlsConfig</code>, etc.</span></div>
            <div className={styles.moduleCard}><strong>config/client</strong><span>Client config structs: <code>ClientConfig</code>, <code>ClientIdentity</code>, <code>TunConfig</code>, <code>CongestionConfig</code>, <code>XPortaClientConfig</code>, <code>XmuxConfig</code>, etc.</span></div>
            <div className={styles.moduleCard}><strong>config/validation</strong><span>Config validation with <code>garde</code>: validates server and client configs, checks listen addresses, TLS paths, client UUIDs.</span></div>
            <div className={styles.moduleCard}><strong>router</strong><span>Rule-based routing engine. Conditions: Domain, DomainSuffix, DomainKeyword, IpCidr, GeoIp, Port, All. Actions: Proxy, Direct, Block.</span></div>
            <div className={styles.moduleCard}><strong>dns</strong><span>DNS modes: Direct, Smart, Fake, Tunnel. Protocols: UDP, DoH (RFC 8484), DoT (RFC 7858). Fake IP pool: 198.18.0.0/15.</span></div>
            <div className={styles.moduleCard}><strong>dns/doh</strong><span>DNS-over-HTTPS client implementation using <code>hickory-proto</code> wire format.</span></div>
            <div className={styles.moduleCard}><strong>dns/fake_ip</strong><span>Fake IP allocator: maps domains to IPs from a reserved pool, bidirectional lookup.</span></div>
            <div className={styles.moduleCard}><strong>mux</strong><span>XMUX stream multiplexing. Frame: [stream_id:4][type:1][len:2][payload]. Types: SYN (0x01), DATA (0x02), FIN (0x03), RST (0x04).</span></div>
            <div className={styles.moduleCard}><strong>acl</strong><span>Per-client access control lists. Matchers: Domain, DomainSuffix, DomainKeyword, IpCidr, Port, All. Policies: Allow, Deny.</span></div>
            <div className={styles.moduleCard}><strong>proxy_group</strong><span>Multi-server group strategies: Select (manual), AutoUrl (latency-based), Fallback, LoadBalance (round-robin / random).</span></div>
            <div className={styles.moduleCard}><strong>subscription</strong><span>Fetch and parse server lists from URLs. Formats: base64 URIs, Clash YAML, JSON array.</span></div>
            <div className={styles.moduleCard}><strong>rule_provider</strong><span>Remote rule lists: fetch, parse, and merge external routing rule sets.</span></div>
            <div className={styles.moduleCard}><strong>import</strong><span>URI parsers: <code>ss://</code>, <code>vmess://</code>, <code>trojan://</code>, <code>vless://</code> into <code>ImportedServer</code> with mapped <code>ClientConfig</code>.</span></div>
            <div className={styles.moduleCard}><strong>buffer_pool</strong><span>Lock-free reusable buffer pool for relay. Pre-allocates <code>MAX_FRAME_SIZE</code> buffers, returns on drop.</span></div>
            <div className={styles.moduleCard}><strong>state</strong><span>Server state: <code>ServerState</code>, <code>ServerMetrics</code> (atomic counters), <code>ConnectionInfo</code>, per-client metrics, history ring buffers, shutdown signaling.</span></div>
            <div className={styles.moduleCard}><strong>types</strong><span>Core types: <code>ClientId</code>, <code>ProxyAddress</code>, <code>ProxyDestination</code>, <code>CipherSuite</code>, <code>PaddingRange</code>. Protocol constants.</span></div>
            <div className={styles.moduleCard}><strong>bandwidth</strong><span>Token-bucket bandwidth limiter (<code>governor</code>) and traffic quota enforcement per client.</span></div>
            <div className={styles.moduleCard}><strong>congestion</strong><span>QUIC congestion control modes: BBR (default), Brutal (fixed rate), Adaptive.</span></div>
            <div className={styles.moduleCard}><strong>traffic_shaping</strong><span>Anti-fingerprinting: bucket padding, timing jitter, frame coalescing, chaff injection.</span></div>
            <div className={styles.moduleCard}><strong>port_hop</strong><span>HMAC-based port hopping for QUIC. Derives port sequence from shared secret + epoch.</span></div>
            <div className={styles.moduleCard}><strong>fec</strong><span>Forward Error Correction using Reed-Solomon erasure coding for UDP relay.</span></div>
            <div className={styles.moduleCard}><strong>salamander</strong><span>Salamander v2 UDP obfuscation: nonce-based XOR with derived key material.</span></div>
            <div className={styles.moduleCard}><strong>entropy</strong><span>Entropy camouflage: reshapes byte distribution to bypass GFW entropy detection.</span></div>
            <div className={styles.moduleCard}><strong>xporta</strong><span>XPorta protocol: REST API simulation transport. Session management, encoding (JSON/binary), reassembly.</span></div>
            <div className={styles.moduleCard}><strong>shadow_tls</strong><span>ShadowTLS v3 protocol: HMAC-authenticated frame multiplexing over real TLS.</span></div>
            <div className={styles.moduleCard}><strong>wireguard</strong><span>WireGuard-compatible UDP transport configuration types.</span></div>
            <div className={styles.moduleCard}><strong>prisma_auth</strong><span>PrismaTLS authentication: padding beacon, key rotation, timing-safe verification.</span></div>
            <div className={styles.moduleCard}><strong>prisma_flow</strong><span>PrismaTLS flow control: H2 mimicry, timing normalization for anti-detection.</span></div>
            <div className={styles.moduleCard}><strong>prisma_fp</strong><span>TLS fingerprint mimicry (uTLS-style): Chrome, Firefox, Safari profiles. JA3/JA4 evasion, GREASE injection.</span></div>
            <div className={styles.moduleCard}><strong>prisma_mask</strong><span>Entropy masking: reshapes ciphertext entropy distribution to match legitimate TLS traffic.</span></div>
            <div className={styles.moduleCard}><strong>utls</strong><span>uTLS fingerprint database: curated browser fingerprints for TLS ClientHello mimicry.</span></div>
            <div className={styles.moduleCard}><strong>geodata</strong><span>GeoIP database loader (v2ray/xray <code>geoip.dat</code> format). Protobuf parsing, CIDR matching by country code.</span></div>
            <div className={styles.moduleCard}><strong>cache</strong><span>DNS cache (<code>moka</code> async cache) for resolved addresses.</span></div>
            <div className={styles.moduleCard}><strong>logging</strong><span>Structured logging setup with <code>tracing</code>. Broadcast mode for GUI/management API log streaming.</span></div>
            <div className={styles.moduleCard}><strong>error</strong><span>Error types: <code>PrismaError</code>, <code>CryptoError</code>, <code>ProtocolError</code>, <code>ConfigError</code>.</span></div>
            <div className={styles.moduleCard}><strong>proto</strong><span>Protobuf definitions for gRPC tunnel transport and geodata.</span></div>
            <div className={styles.moduleCard}><strong>util</strong><span>Helpers: hex encode/decode, auth token computation, constant-time comparison, framed read/write.</span></div>
          </div>
        </section>

        {/* ════════════════════════════════════════════════════════════
            5. prisma-server Reference
            ════════════════════════════════════════════════════════════ */}
        <section className={styles.section} id="prisma-server">
          <Heading as="h2">prisma-server Reference</Heading>
          <p>
            Server binary and library. Listens for incoming connections on multiple transports,
            performs the PrismaVeil handshake, authenticates clients, and relays traffic.
          </p>

          <Heading as="h3" id="server-listeners">Listener Types</Heading>
          <div className={styles.refTable}>
            <table>
              <thead><tr><th>Module</th><th>Transport</th><th>Description</th></tr></thead>
              <tbody>
                <tr><td><code>listener/tcp</code></td><td>TCP</td><td>Raw TCP with optional TLS. Camouflage support: peek first 3 bytes to distinguish Prisma clients from probes, relay non-clients to fallback decoy.</td></tr>
                <tr><td><code>listener/quic</code></td><td>QUIC</td><td>QUIC v1/v2 via <code>quinn</code>. Supports Salamander UDP obfuscation, port hopping, H3 masquerade for active probers.</td></tr>
                <tr><td><code>listener/ws_tunnel</code></td><td>WebSocket</td><td>WebSocket tunnel over CDN HTTPS. Path-based routing (<code>/ws-tunnel</code> default). CDN-compatible.</td></tr>
                <tr><td><code>listener/grpc_tunnel</code></td><td>gRPC</td><td>gRPC bidirectional streaming tunnel. Path: <code>/tunnel.PrismaTunnel</code>. CDN-compatible.</td></tr>
                <tr><td><code>listener/xhttp</code></td><td>XHTTP</td><td>HTTP-native transport: separate upload (POST) and download (SSE/long-poll) paths. CDN-compatible.</td></tr>
                <tr><td><code>listener/xporta</code></td><td>XPorta</td><td>REST API simulation: session init, JSON/binary data upload, long-poll download. Mimics normal API traffic.</td></tr>
                <tr><td><code>listener/cdn</code></td><td>CDN HTTPS</td><td>Unified CDN listener: routes WS/gRPC/XHTTP/XPorta by path, serves cover site for non-matching requests.</td></tr>
                <tr><td><code>listener/shadowtls</code></td><td>ShadowTLS</td><td>ShadowTLS v3: real TLS handshake with cover server, HMAC-authenticated proxy data in application data frames.</td></tr>
                <tr><td><code>listener/ssh</code></td><td>SSH</td><td>SSH transport via <code>russh</code>. Proxy data over SSH channels. Optional fake shell for interactive probers.</td></tr>
                <tr><td><code>listener/wireguard</code></td><td>WireGuard</td><td>WireGuard-compatible UDP transport. Proxy data inside WireGuard tunnels.</td></tr>
                <tr><td><code>listener/reality</code></td><td>PrismaTLS</td><td>PrismaTLS (replaces REALITY): mask server pool, padding beacon auth, browser fingerprint mimicry.</td></tr>
                <tr><td><code>listener/h3_masquerade</code></td><td>HTTP/3</td><td>H3 cover site for QUIC active probing. Reverse-proxies a real website or serves static files.</td></tr>
                <tr><td><code>listener/reverse_proxy</code></td><td>HTTP</td><td>Reverse proxy to upstream cover sites for non-Prisma traffic.</td></tr>
              </tbody>
            </table>
          </div>

          <Heading as="h3" id="server-handler">Handler Pipeline</Heading>
          <p>
            All transports converge in <code>handler.rs</code> which runs the PrismaVeil handshake,
            then dispatches based on the first command frame:
          </p>
          <ul>
            <li><code>CMD_CONNECT</code> — Proxy mode: connect to destination, relay encrypted data. Checks server-side routing rules and per-client ACLs.</li>
            <li><code>CMD_REGISTER_FORWARD</code> — Port forwarding mode: listen on a server port, relay inbound connections back to the client.</li>
            <li><code>CMD_UDP_ASSOCIATE</code> — UDP relay mode: bidirectional UDP datagram relay with optional FEC.</li>
            <li><code>CMD_DNS_QUERY</code> — DNS tunnel: forward encrypted DNS query to upstream, return response.</li>
            <li><code>CMD_SPEED_TEST</code> — Bandwidth measurement: server sends/receives bulk data for specified duration.</li>
          </ul>

          <Heading as="h3" id="server-relay">Relay Modes</Heading>
          <div className={styles.refTable}>
            <table>
              <thead><tr><th>Mode</th><th>Module</th><th>Description</th></tr></thead>
              <tbody>
                <tr><td>Encrypted relay</td><td><code>relay.rs</code></td><td>Standard path: decrypt client frames, forward plaintext to destination, encrypt responses. Uses <code>AtomicNonceCounter</code> for lock-free nonce generation and <code>BufferPool</code> for zero-alloc buffers.</td></tr>
                <tr><td>Encrypted + limits</td><td><code>relay.rs</code></td><td>Same as above with per-client bandwidth throttling (token bucket) and quota enforcement.</td></tr>
                <tr><td>splice(2)</td><td><code>relay_uring.rs</code></td><td>Linux zero-copy relay: kernel-space data transfer between sockets when transport-only cipher is used.</td></tr>
                <tr><td>UDP relay</td><td><code>udp_relay.rs</code></td><td>Bidirectional UDP datagram relay with optional Reed-Solomon FEC.</td></tr>
              </tbody>
            </table>
          </div>

          <Heading as="h3" id="server-other">Other Server Modules</Heading>
          <ul>
            <li><code>auth.rs</code> — <code>AuthStore</code> wrapping <code>AuthStoreInner</code> from core. Verifies client IDs and auth tokens.</li>
            <li><code>camouflage.rs</code> — Decoy relay to fallback server for non-Prisma traffic. Peek-based client detection.</li>
            <li><code>state.rs</code> — <code>ServerContext</code> bundles state + bandwidth stores + ticket key ring + config path.</li>
            <li><code>reload.rs</code> — Hot-reload: re-reads config file, diffs changes, updates auth/routing/TLS. SIGHUP handler on Unix.</li>
            <li><code>mux_handler.rs</code> — Server-side XMUX demuxer: accepts multiplexed streams, spawns per-stream handlers.</li>
            <li><code>forward.rs</code> — Port forwarding session manager.</li>
            <li><code>outbound.rs</code> — Outbound connection to proxy destinations with DNS resolution.</li>
            <li><code>bandwidth/</code> — Per-client bandwidth limiter and quota stores (server-side wrappers around core).</li>
          </ul>
        </section>

        {/* ════════════════════════════════════════════════════════════
            6. prisma-client Reference
            ════════════════════════════════════════════════════════════ */}
        <section className={styles.section} id="prisma-client">
          <Heading as="h2">prisma-client Reference</Heading>
          <p>
            Client library and binary. Accepts local proxy requests, selects a transport,
            establishes the PrismaVeil tunnel, and relays traffic to the server.
          </p>

          <Heading as="h3">Entry Points</Heading>
          <ul>
            <li><code>run(config_path)</code> — Standalone CLI mode with own logging.</li>
            <li><code>run_embedded(config_path, log_tx, metrics)</code> — GUI/FFI mode with broadcast logging and shared metrics.</li>
            <li><code>run_embedded_with_filter(..., app_filter, shutdown)</code> — GUI/FFI with per-app proxy filter and graceful shutdown.</li>
          </ul>

          <Heading as="h3">Modules</Heading>
          <div className={styles.refTable}>
            <table>
              <thead><tr><th>Module</th><th>Description</th></tr></thead>
              <tbody>
                <tr><td><code>proxy.rs</code></td><td><code>ProxyContext</code> — central context holding all connection parameters. <code>connect()</code> establishes transport to server.</td></tr>
                <tr><td><code>connector.rs</code></td><td><code>TransportStream</code> enum: Tcp, Quic, TcpTls, WebSocket, Grpc, Xhttp, XPorta, ShadowTls, WireGuard. Implements <code>AsyncRead + AsyncWrite</code>.</td></tr>
                <tr><td><code>transport_selector.rs</code></td><td>Auto-fallback transport selection: tries transports in <code>fallback_order</code> until one succeeds.</td></tr>
                <tr><td><code>tunnel.rs</code></td><td>PrismaVeil tunnel establishment: handshake + challenge response over any <code>TransportStream</code>.</td></tr>
                <tr><td><code>socks5/server.rs</code></td><td>SOCKS5 inbound server: accepts CONNECT and UDP ASSOCIATE requests.</td></tr>
                <tr><td><code>http/server.rs</code></td><td>HTTP CONNECT proxy inbound server.</td></tr>
                <tr><td><code>tun/</code></td><td>TUN mode: <code>device.rs</code> (TUN device creation), <code>handler.rs</code> (IP packet processing), <code>tcp_stack.rs</code> (userspace TCP via <code>smoltcp</code>), <code>process.rs</code> (per-app filter).</td></tr>
                <tr><td><code>dns_resolver.rs</code></td><td>Client-side DNS resolver supporting Smart/Fake/Tunnel modes with DoH/DoT.</td></tr>
                <tr><td><code>dns_server.rs</code></td><td>Local DNS server for Fake/Tunnel modes. Listens on configurable address (default: 127.0.0.1:10053).</td></tr>
                <tr><td><code>connection_pool.rs</code></td><td>Persistent transport connection pool with XMUX multiplexing support.</td></tr>
                <tr><td><code>forward.rs</code></td><td>Port forwarding: local listener → encrypted tunnel → remote destination.</td></tr>
                <tr><td><code>pac.rs</code></td><td>PAC (Proxy Auto-Configuration) generator and HTTP server. Generates JavaScript from routing rules.</td></tr>
                <tr><td><code>relay.rs</code></td><td>Client-side encrypted relay between local connection and tunnel.</td></tr>
                <tr><td><code>udp_relay.rs</code></td><td>Client-side UDP relay with CMD_UDP_ASSOCIATE/CMD_UDP_DATA.</td></tr>
                <tr><td><code>latency.rs</code></td><td>Latency testing: TCP connect + handshake RTT measurement for server selection.</td></tr>
                <tr><td><code>metrics.rs</code></td><td><code>ClientMetrics</code> — atomic counters for bytes up/down, connections, used by GUI stats display.</td></tr>
                <tr><td><code>ws_stream.rs</code></td><td>WebSocket transport stream: wraps <code>tokio-tungstenite</code> into <code>AsyncRead + AsyncWrite</code>.</td></tr>
                <tr><td><code>grpc_stream.rs</code></td><td>gRPC transport stream: bidirectional streaming over HTTP/2.</td></tr>
                <tr><td><code>xhttp_stream.rs</code></td><td>XHTTP transport stream: separate upload/download HTTP connections.</td></tr>
                <tr><td><code>xporta_stream.rs</code></td><td>XPorta transport stream: REST API simulation with session cookies.</td></tr>
                <tr><td><code>shadow_tls_stream.rs</code></td><td>ShadowTLS v3 client stream.</td></tr>
                <tr><td><code>ssh_stream.rs</code></td><td>SSH transport stream via <code>russh</code>.</td></tr>
                <tr><td><code>wg_stream.rs</code></td><td>WireGuard transport stream.</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* ════════════════════════════════════════════════════════════
            7. prisma-mgmt Reference
            ════════════════════════════════════════════════════════════ */}
        <section className={styles.section} id="prisma-mgmt">
          <Heading as="h2">prisma-mgmt Reference</Heading>
          <p>
            Management API built with <code>axum</code>. All endpoints require Bearer token auth
            (set via <code>management_api.auth_token</code> in server config) except <code>/api/prometheus</code>.
          </p>

          <Heading as="h3">REST API Endpoints</Heading>
          <div className={styles.refTable}>
            <table>
              <thead><tr><th>Method</th><th>Path</th><th>Description</th></tr></thead>
              <tbody>
                <tr><td>GET</td><td><code>/api/health</code></td><td>Health check and basic status</td></tr>
                <tr><td>GET</td><td><code>/api/metrics</code></td><td>Current metrics snapshot (uptime, connections, bytes, handshake failures)</td></tr>
                <tr><td>GET</td><td><code>/api/metrics/history</code></td><td>Historical metrics (up to 24h ring buffer, 1s resolution)</td></tr>
                <tr><td>GET</td><td><code>/api/system/info</code></td><td>System information (OS, CPU, memory, load)</td></tr>
                <tr><td>GET</td><td><code>/api/connections</code></td><td>List active connections with details</td></tr>
                <tr><td>DELETE</td><td><code>/api/connections/&#123;id&#125;</code></td><td>Disconnect a specific session</td></tr>
                <tr><td>GET</td><td><code>/api/clients</code></td><td>List authorized clients with per-client metrics</td></tr>
                <tr><td>POST</td><td><code>/api/clients</code></td><td>Create a new authorized client (generates UUID + auth_secret)</td></tr>
                <tr><td>PUT</td><td><code>/api/clients/&#123;id&#125;</code></td><td>Update client (name, enabled, bandwidth, quota)</td></tr>
                <tr><td>DELETE</td><td><code>/api/clients/&#123;id&#125;</code></td><td>Remove an authorized client</td></tr>
                <tr><td>GET</td><td><code>/api/clients/&#123;id&#125;/bandwidth</code></td><td>Get client bandwidth limits</td></tr>
                <tr><td>PUT</td><td><code>/api/clients/&#123;id&#125;/bandwidth</code></td><td>Set client bandwidth limits (upload/download bps)</td></tr>
                <tr><td>GET</td><td><code>/api/clients/&#123;id&#125;/quota</code></td><td>Get client traffic quota</td></tr>
                <tr><td>PUT</td><td><code>/api/clients/&#123;id&#125;/quota</code></td><td>Set client traffic quota (bytes)</td></tr>
                <tr><td>GET</td><td><code>/api/bandwidth/summary</code></td><td>Summary of all client bandwidth and quota usage</td></tr>
                <tr><td>GET</td><td><code>/api/config</code></td><td>Current server configuration (sanitized)</td></tr>
                <tr><td>PATCH</td><td><code>/api/config</code></td><td>Update configuration values (dotted key notation)</td></tr>
                <tr><td>GET</td><td><code>/api/config/tls</code></td><td>TLS certificate info (expiry, issuer, SANs)</td></tr>
                <tr><td>GET</td><td><code>/api/config/backups</code></td><td>List config backups</td></tr>
                <tr><td>POST</td><td><code>/api/config/backup</code></td><td>Create a new config backup</td></tr>
                <tr><td>GET</td><td><code>/api/config/backups/&#123;name&#125;</code></td><td>Get a specific backup</td></tr>
                <tr><td>DELETE</td><td><code>/api/config/backups/&#123;name&#125;</code></td><td>Delete a backup</td></tr>
                <tr><td>POST</td><td><code>/api/config/backups/&#123;name&#125;/restore</code></td><td>Restore config from backup</td></tr>
                <tr><td>GET</td><td><code>/api/config/backups/&#123;name&#125;/diff</code></td><td>Diff between backup and current config</td></tr>
                <tr><td>GET</td><td><code>/api/forwards</code></td><td>List active port forwards with per-forward stats</td></tr>
                <tr><td>POST</td><td><code>/api/forwards</code></td><td>Create a port forward rule (name, local_addr, remote_port)</td></tr>
                <tr><td>DELETE</td><td><code>/api/forwards/&#123;id&#125;</code></td><td>Remove a port forward</td></tr>
                <tr><td>GET</td><td><code>/api/forwards/&#123;id&#125;/stats</code></td><td>Get stats for a specific port forward (bytes, connections)</td></tr>
                <tr><td>GET</td><td><code>/api/subscriptions</code></td><td>List configured subscription sources</td></tr>
                <tr><td>POST</td><td><code>/api/subscriptions</code></td><td>Add a subscription URL</td></tr>
                <tr><td>POST</td><td><code>/api/subscriptions/refresh</code></td><td>Refresh all subscriptions from their URLs</td></tr>
                <tr><td>DELETE</td><td><code>/api/subscriptions/&#123;id&#125;</code></td><td>Remove a subscription</td></tr>
                <tr><td>GET</td><td><code>/api/routes</code></td><td>List routing rules</td></tr>
                <tr><td>POST</td><td><code>/api/routes</code></td><td>Create a routing rule</td></tr>
                <tr><td>PUT</td><td><code>/api/routes/&#123;id&#125;</code></td><td>Update a routing rule</td></tr>
                <tr><td>DELETE</td><td><code>/api/routes/&#123;id&#125;</code></td><td>Delete a routing rule</td></tr>
                <tr><td>GET</td><td><code>/api/acls</code></td><td>List all per-client ACLs</td></tr>
                <tr><td>GET</td><td><code>/api/acls/&#123;client_id&#125;</code></td><td>Get ACL for a specific client</td></tr>
                <tr><td>PUT</td><td><code>/api/acls/&#123;client_id&#125;</code></td><td>Set ACL for a specific client</td></tr>
                <tr><td>DELETE</td><td><code>/api/acls/&#123;client_id&#125;</code></td><td>Remove ACL for a specific client</td></tr>
                <tr><td>GET</td><td><code>/api/alerts/config</code></td><td>Get alert threshold configuration</td></tr>
                <tr><td>PUT</td><td><code>/api/alerts/config</code></td><td>Update alert thresholds (cert expiry, quota warning, handshake spike)</td></tr>
                <tr><td>POST</td><td><code>/api/reload</code></td><td>Trigger config hot-reload from disk</td></tr>
                <tr><td>GET</td><td><code>/api/prometheus</code></td><td>Prometheus metrics export (no auth required)</td></tr>
              </tbody>
            </table>
          </div>

          <Heading as="h3">WebSocket Endpoints</Heading>
          <div className={styles.refTable}>
            <table>
              <thead><tr><th>Path</th><th>Description</th></tr></thead>
              <tbody>
                <tr><td><code>/api/ws/metrics</code></td><td>Real-time metrics stream (1s interval <code>MetricsSnapshot</code> JSON)</td></tr>
                <tr><td><code>/api/ws/logs</code></td><td>Live log streaming (structured <code>LogEntry</code> JSON)</td></tr>
                <tr><td><code>/api/ws/connections</code></td><td>Real-time connection updates</td></tr>
                <tr><td><code>/api/ws/reload</code></td><td>Config reload event notifications</td></tr>
              </tbody>
            </table>
          </div>

          <Heading as="h3">Authentication</Heading>
          <p>
            All API/WS endpoints (except <code>/api/prometheus</code>) require the <code>Authorization: Bearer &lt;token&gt;</code> header.
            The token is configured in <code>management_api.auth_token</code> in the server config.
            CORS origins are configurable via <code>management_api.cors_origins</code>.
          </p>
        </section>

        {/* ════════════════════════════════════════════════════════════
            8. prisma-ffi Reference
            ════════════════════════════════════════════════════════════ */}
        <section className={styles.section} id="prisma-ffi">
          <Heading as="h2">prisma-ffi Reference</Heading>
          <p>
            C ABI shared library (<code>cdylib</code>) for GUI and mobile integration.
            All <code>extern "C"</code> functions are panic-safe via <code>ffi_catch!</code> macro.
            Strings are null-terminated UTF-8; caller frees returned strings with <code>prisma_free_string()</code>.
          </p>

          <Heading as="h3">Error Codes</Heading>
          <div className={styles.refTable}>
            <table>
              <thead><tr><th>Constant</th><th>Value</th><th>Meaning</th></tr></thead>
              <tbody>
                <tr><td><code>PRISMA_OK</code></td><td>0</td><td>Success</td></tr>
                <tr><td><code>PRISMA_ERR_INVALID_CONFIG</code></td><td>1</td><td>Invalid config JSON or parameter</td></tr>
                <tr><td><code>PRISMA_ERR_ALREADY_CONNECTED</code></td><td>2</td><td>Connection already active</td></tr>
                <tr><td><code>PRISMA_ERR_NOT_CONNECTED</code></td><td>3</td><td>No active connection</td></tr>
                <tr><td><code>PRISMA_ERR_PERMISSION_DENIED</code></td><td>4</td><td>OS permission denied (system proxy)</td></tr>
                <tr><td><code>PRISMA_ERR_INTERNAL</code></td><td>5</td><td>Internal error</td></tr>
                <tr><td><code>PRISMA_ERR_NULL_POINTER</code></td><td>6</td><td>Null pointer argument</td></tr>
              </tbody>
            </table>
          </div>

          <Heading as="h3">Exported Functions</Heading>
          <div className={styles.refTable}>
            <table>
              <thead><tr><th>Function</th><th>Signature</th><th>Description</th></tr></thead>
              <tbody>
                <tr><td><code>prisma_create</code></td><td><code>() -&gt; *mut PrismaClient</code></td><td>Create client handle (returns NULL on failure)</td></tr>
                <tr><td><code>prisma_destroy</code></td><td><code>(*mut PrismaClient)</code></td><td>Destroy handle, disconnect, stop poller</td></tr>
                <tr><td><code>prisma_connect</code></td><td><code>(handle, config_json, modes) -&gt; c_int</code></td><td>Connect with config JSON and mode flags</td></tr>
                <tr><td><code>prisma_disconnect</code></td><td><code>(handle) -&gt; c_int</code></td><td>Disconnect active session</td></tr>
                <tr><td><code>prisma_get_status</code></td><td><code>(handle) -&gt; c_int</code></td><td>Get status (0=disconnected, 1=connecting, 2=connected, 3=error)</td></tr>
                <tr><td><code>prisma_get_stats_json</code></td><td><code>(handle) -&gt; *mut c_char</code></td><td>Get stats as JSON (caller frees)</td></tr>
                <tr><td><code>prisma_set_callback</code></td><td><code>(handle, callback, userdata)</code></td><td>Register event callback</td></tr>
                <tr><td><code>prisma_free_string</code></td><td><code>(*mut c_char)</code></td><td>Free a string returned by prisma_* functions</td></tr>
                <tr><td><code>prisma_profiles_list_json</code></td><td><code>() -&gt; *mut c_char</code></td><td>List all profiles as JSON array</td></tr>
                <tr><td><code>prisma_profile_save</code></td><td><code>(json) -&gt; c_int</code></td><td>Save a profile from JSON</td></tr>
                <tr><td><code>prisma_profile_delete</code></td><td><code>(id) -&gt; c_int</code></td><td>Delete a profile by ID</td></tr>
                <tr><td><code>prisma_import_subscription</code></td><td><code>(url) -&gt; *mut c_char</code></td><td>Import profiles from subscription URL</td></tr>
                <tr><td><code>prisma_refresh_subscriptions</code></td><td><code>() -&gt; *mut c_char</code></td><td>Refresh all subscription profiles</td></tr>
                <tr><td><code>prisma_profile_to_qr_svg</code></td><td><code>(json) -&gt; *mut c_char</code></td><td>Generate QR code SVG from profile</td></tr>
                <tr><td><code>prisma_profile_from_qr</code></td><td><code>(data, *out_json) -&gt; c_int</code></td><td>Decode QR data to profile JSON</td></tr>
                <tr><td><code>prisma_profile_to_uri</code></td><td><code>(json) -&gt; *mut c_char</code></td><td>Generate prisma:// URI from profile</td></tr>
                <tr><td><code>prisma_profile_config_to_toml</code></td><td><code>(json) -&gt; *mut c_char</code></td><td>Convert profile config JSON to TOML</td></tr>
                <tr><td><code>prisma_set_system_proxy</code></td><td><code>(host, port) -&gt; c_int</code></td><td>Set OS system proxy</td></tr>
                <tr><td><code>prisma_clear_system_proxy</code></td><td><code>() -&gt; c_int</code></td><td>Clear OS system proxy</td></tr>
                <tr><td><code>prisma_check_update_json</code></td><td><code>() -&gt; *mut c_char</code></td><td>Check GitHub for updates (returns JSON or NULL)</td></tr>
                <tr><td><code>prisma_apply_update</code></td><td><code>(url, sha256) -&gt; c_int</code></td><td>Download and apply update</td></tr>
                <tr><td><code>prisma_ping</code></td><td><code>(server_addr) -&gt; *mut c_char</code></td><td>TCP latency measurement (3 attempts, median)</td></tr>
                <tr><td><code>prisma_get_pac_url</code></td><td><code>(handle, port) -&gt; *mut c_char</code></td><td>Get PAC URL string</td></tr>
                <tr><td><code>prisma_set_per_app_filter</code></td><td><code>(json) -&gt; c_int</code></td><td>Set per-app proxy filter (include/exclude mode)</td></tr>
                <tr><td><code>prisma_get_per_app_filter</code></td><td><code>() -&gt; *mut c_char</code></td><td>Get current per-app filter config</td></tr>
                <tr><td><code>prisma_get_running_apps</code></td><td><code>() -&gt; *mut c_char</code></td><td>List running application names (JSON array)</td></tr>
                <tr><td><code>prisma_speed_test</code></td><td><code>(handle, server, secs, dir) -&gt; c_int</code></td><td>Run speed test (result via callback)</td></tr>
                <tr><td><code>prisma_on_network_change</code></td><td><code>(handle, type) -&gt; c_int</code></td><td>Notify network change (mobile)</td></tr>
                <tr><td><code>prisma_on_memory_warning</code></td><td><code>(handle) -&gt; c_int</code></td><td>Handle low-memory warning (mobile)</td></tr>
                <tr><td><code>prisma_on_background</code></td><td><code>(handle) -&gt; c_int</code></td><td>App entered background (mobile)</td></tr>
                <tr><td><code>prisma_on_foreground</code></td><td><code>(handle) -&gt; c_int</code></td><td>App returned to foreground (mobile)</td></tr>
                <tr><td><code>prisma_get_traffic_stats</code></td><td><code>(handle) -&gt; *mut c_char</code></td><td>Compact traffic stats for widgets</td></tr>
                <tr><td><code>prisma_version</code></td><td><code>() -&gt; *const c_char</code></td><td>Version string (static, do NOT free)</td></tr>
              </tbody>
            </table>
          </div>

          <Heading as="h3">Proxy Mode Flags (bitfield)</Heading>
          <div className={styles.refTable}>
            <table>
              <thead><tr><th>Flag</th><th>Value</th><th>Mode</th></tr></thead>
              <tbody>
                <tr><td><code>PRISMA_MODE_SOCKS5</code></td><td>0x01</td><td>SOCKS5 proxy</td></tr>
                <tr><td><code>PRISMA_MODE_SYSTEM_PROXY</code></td><td>0x02</td><td>Set OS system proxy</td></tr>
                <tr><td><code>PRISMA_MODE_TUN</code></td><td>0x04</td><td>TUN device mode</td></tr>
                <tr><td><code>PRISMA_MODE_PER_APP</code></td><td>0x08</td><td>Per-application proxy</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* ════════════════════════════════════════════════════════════
            9. prisma-cli Reference
            ════════════════════════════════════════════════════════════ */}
        <section className={styles.section} id="prisma-cli">
          <Heading as="h2">prisma-cli Reference</Heading>
          <p>
            Unified CLI built with <code>clap 4</code>. Global flags: <code>--json</code> (raw JSON output),
            <code>--mgmt-url</code>, <code>--mgmt-token</code>.
          </p>

          <div className={styles.refTable}>
            <table>
              <thead><tr><th>Command</th><th>Flags</th><th>Description</th></tr></thead>
              <tbody>
                <tr><td><code>server</code></td><td><code>-c, --config</code> (default: server.toml)</td><td>Start the proxy server</td></tr>
                <tr><td><code>client</code></td><td><code>-c, --config</code> (default: client.toml)</td><td>Start the proxy client</td></tr>
                <tr><td><code>gen-key</code></td><td>&mdash;</td><td>Generate UUID + 256-bit auth secret</td></tr>
                <tr><td><code>gen-cert</code></td><td><code>-o, --output</code>, <code>--cn</code></td><td>Generate self-signed TLS certificate</td></tr>
                <tr><td><code>init</code></td><td><code>--cdn</code>, <code>--server-only</code>, <code>--client-only</code>, <code>--force</code></td><td>Generate annotated config files with auto-generated keys</td></tr>
                <tr><td><code>validate</code></td><td><code>-c, --config</code>, <code>-t, --type</code></td><td>Validate config file without starting</td></tr>
                <tr><td><code>status</code></td><td>&mdash;</td><td>Query management API for server status</td></tr>
                <tr><td><code>version</code></td><td>&mdash;</td><td>Show version, protocol, ciphers, transports</td></tr>
                <tr><td><code>console</code></td><td><code>--mgmt-url</code>, <code>--token</code>, <code>--port</code>, <code>--bind</code>, <code>--no-open</code>, <code>--update</code>, <code>--dir</code></td><td>Launch web console (auto-downloads UI assets)</td></tr>
                <tr><td><code>completions</code></td><td><code>bash|zsh|fish|powershell</code></td><td>Generate shell completions</td></tr>
                <tr><td><code>ping</code></td><td><code>-c, --config</code>, <code>-s, --server</code>, <code>--count</code>, <code>--interval</code></td><td>Measure connect + handshake RTT</td></tr>
                <tr><td><code>test-transport</code></td><td><code>-c, --config</code></td><td>Test all configured transports</td></tr>
                <tr><td><code>diagnose</code></td><td><code>-c, --config</code></td><td>Run connectivity diagnostics</td></tr>
                <tr><td><code>speed-test</code></td><td><code>-s, --server</code>, <code>-d, --duration</code>, <code>--direction</code>, <code>-C, --config</code></td><td>Bandwidth test (download/upload/both)</td></tr>
                <tr><td><code>latency-test</code></td><td><code>--url</code> or <code>--servers</code></td><td>Test latency to multiple servers</td></tr>
                <tr><td><code>clients list</code></td><td>&mdash;</td><td>List all authorized clients</td></tr>
                <tr><td><code>clients show</code></td><td><code>&lt;id&gt;</code></td><td>Show client details</td></tr>
                <tr><td><code>clients create</code></td><td><code>--name</code></td><td>Create a new client</td></tr>
                <tr><td><code>clients delete</code></td><td><code>&lt;id&gt;</code>, <code>--yes</code></td><td>Delete a client</td></tr>
                <tr><td><code>clients enable/disable</code></td><td><code>&lt;id&gt;</code></td><td>Enable or disable a client</td></tr>
                <tr><td><code>connections list</code></td><td>&mdash;</td><td>List active connections</td></tr>
                <tr><td><code>connections disconnect</code></td><td><code>&lt;id&gt;</code></td><td>Disconnect a session</td></tr>
                <tr><td><code>connections watch</code></td><td><code>--interval</code></td><td>Real-time connection monitor</td></tr>
                <tr><td><code>metrics</code></td><td><code>--watch</code>, <code>--history</code>, <code>--system</code>, <code>--period</code>, <code>--interval</code></td><td>View metrics, history, or system info</td></tr>
                <tr><td><code>bandwidth summary</code></td><td>&mdash;</td><td>All client bandwidth/quota summary</td></tr>
                <tr><td><code>bandwidth get/set</code></td><td><code>&lt;id&gt;</code>, <code>--upload</code>, <code>--download</code></td><td>Get/set client bandwidth limits</td></tr>
                <tr><td><code>bandwidth quota</code></td><td><code>&lt;id&gt;</code>, <code>--limit</code></td><td>Get/set client traffic quota</td></tr>
                <tr><td><code>config get</code></td><td>&mdash;</td><td>Show current server config</td></tr>
                <tr><td><code>config set</code></td><td><code>&lt;key&gt; &lt;value&gt;</code></td><td>Update config value (dotted notation)</td></tr>
                <tr><td><code>config tls</code></td><td>&mdash;</td><td>Show TLS certificate details</td></tr>
                <tr><td><code>config backup create/list/restore/diff/delete</code></td><td>&mdash;</td><td>Config backup management</td></tr>
                <tr><td><code>routes list/create/update/delete/setup</code></td><td>Various</td><td>Routing rule management</td></tr>
                <tr><td><code>logs</code></td><td><code>--level</code>, <code>--lines</code></td><td>Stream live server logs via WebSocket</td></tr>
                <tr><td><code>subscription add/update/list/test</code></td><td><code>-u, --url</code>, <code>-n, --name</code></td><td>Manage server subscriptions</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* ════════════════════════════════════════════════════════════
            10. Wire Protocol (PrismaVeil v5)
            ════════════════════════════════════════════════════════════ */}
        <section className={styles.section} id="protocol">
          <Heading as="h2">Wire Protocol (PrismaVeil v5)</Heading>

          <Heading as="h3">Handshake (2-Step, 1 RTT)</Heading>
          <div className={styles.diagram}>
            <Mermaid value={`sequenceDiagram
  participant C as Client
  participant S as Server
  C->>S: ClientInit [version, flags, X25519 pub, client_id,<br/>timestamp, cipher_suite, auth_token, PQ-KEM encap key?, padding]
  S-->>C: ServerInit [status, session_id, X25519 pub, challenge,<br/>padding_range, features, ticket, bucket_sizes,<br/>PQ-KEM ciphertext?, padding]
  Note over C,S: Session key derived via ECDH (+ ML-KEM-768 hybrid)
  C->>S: ChallengeResponse [BLAKE3(challenge)]
  Note over C,S: Data transfer begins
`} />
          </div>

          <Heading as="h3">Key Derivation</Heading>
          <ul>
            <li><strong>Preliminary key</strong> (v5): <code>BLAKE3-KDF("prisma-v5-preliminary", shared_secret || client_pub || server_pub || timestamp)</code> — encrypts ServerInit.</li>
            <li><strong>Session key</strong> (v5): <code>BLAKE3-KDF("prisma-v5-session", shared_secret || client_pub || server_pub || timestamp || challenge || 0x05)</code> — encrypts data frames.</li>
            <li><strong>Header key</strong> (v5): <code>BLAKE3-KDF("prisma-v5-header-auth", session_key)</code> — AAD binding for header-authenticated encryption.</li>
            <li><strong>Migration token</strong> (v5): <code>BLAKE3-KDF("prisma-v5-migration", session_key || session_id)</code> — seamless transport reconnection.</li>
            <li><strong>Hybrid PQ</strong>: When PQ-KEM flag is set, <code>BLAKE3-KDF("prisma-v5-hybrid-pq-kem", x25519_shared || mlkem_shared)</code> replaces the X25519-only shared secret.</li>
          </ul>

          <Heading as="h3">Data Frame Format</Heading>
          <div className={styles.codeBlock}>
            <code>{`[length: 2 bytes (big-endian)][encrypted_frame: variable]

Encrypted frame (after decryption):
  [cmd: 1 byte][flags: 2 bytes (LE)][stream_id: 4 bytes][payload: variable]

When FLAG_BUCKETED is set:
  [cmd: 1][flags: 2][stream_id: 4][bucket_pad_len: 2][payload][bucket_padding]`}</code>
          </div>

          <Heading as="h3">Command Bytes</Heading>
          <div className={styles.refTable}>
            <table>
              <thead><tr><th>Byte</th><th>Command</th><th>Direction</th><th>Description</th></tr></thead>
              <tbody>
                <tr><td><code>0x01</code></td><td>Connect</td><td>C → S</td><td>Proxy connect to destination (addr_type + addr + port)</td></tr>
                <tr><td><code>0x02</code></td><td>Data</td><td>Both</td><td>Application data payload</td></tr>
                <tr><td><code>0x03</code></td><td>Close</td><td>Both</td><td>Graceful stream close</td></tr>
                <tr><td><code>0x04</code></td><td>Ping</td><td>Both</td><td>Keepalive / latency measurement (seq: u32)</td></tr>
                <tr><td><code>0x05</code></td><td>Pong</td><td>Both</td><td>Ping response (seq: u32)</td></tr>
                <tr><td><code>0x06</code></td><td>RegisterForward</td><td>C → S</td><td>Request port forwarding (port + name)</td></tr>
                <tr><td><code>0x07</code></td><td>ForwardReady</td><td>S → C</td><td>Port forward acknowledged</td></tr>
                <tr><td><code>0x08</code></td><td>ForwardConnect</td><td>S → C</td><td>New inbound connection on forwarded port</td></tr>
                <tr><td><code>0x09</code></td><td>UdpAssociate</td><td>C → S</td><td>Set up UDP relay session</td></tr>
                <tr><td><code>0x0A</code></td><td>UdpData</td><td>Both</td><td>UDP datagram relay (assoc_id, frag, addr, port, payload)</td></tr>
                <tr><td><code>0x0B</code></td><td>SpeedTest</td><td>Both</td><td>Bandwidth measurement (direction, duration, data)</td></tr>
                <tr><td><code>0x0C</code></td><td>DnsQuery</td><td>C → S</td><td>Encrypted DNS query (query_id, raw DNS packet)</td></tr>
                <tr><td><code>0x0D</code></td><td>DnsResponse</td><td>S → C</td><td>DNS response (query_id, raw DNS packet)</td></tr>
                <tr><td><code>0x0E</code></td><td>ChallengeResponse</td><td>C → S</td><td>BLAKE3 hash of server challenge (first frame after handshake)</td></tr>
                <tr><td><code>0x0F</code></td><td>Migration</td><td>C → S</td><td>v5: Connection migration (token + session_id)</td></tr>
              </tbody>
            </table>
          </div>

          <Heading as="h3">Frame Flags (2-byte LE bitmask)</Heading>
          <div className={styles.refTable}>
            <table>
              <thead><tr><th>Bit</th><th>Flag</th><th>Description</th></tr></thead>
              <tbody>
                <tr><td>0x0001</td><td><code>FLAG_PADDED</code></td><td>Frame contains random padding</td></tr>
                <tr><td>0x0002</td><td><code>FLAG_FEC</code></td><td>Frame includes FEC parity data</td></tr>
                <tr><td>0x0004</td><td><code>FLAG_PRIORITY</code></td><td>High-priority frame</td></tr>
                <tr><td>0x0008</td><td><code>FLAG_DATAGRAM</code></td><td>Unreliable datagram (UDP-like)</td></tr>
                <tr><td>0x0010</td><td><code>FLAG_COMPRESSED</code></td><td>Payload is compressed</td></tr>
                <tr><td>0x0020</td><td><code>FLAG_0RTT</code></td><td>0-RTT resumption data</td></tr>
                <tr><td>0x0040</td><td><code>FLAG_BUCKETED</code></td><td>Bucket-padded frame (anti-fingerprint)</td></tr>
                <tr><td>0x0080</td><td><code>FLAG_CHAFF</code></td><td>Dummy chaff frame (discard payload)</td></tr>
                <tr><td>0x0100</td><td><code>FLAG_HEADER_AUTHENTICATED</code></td><td>v5: Header fields bound as AEAD AAD</td></tr>
                <tr><td>0x0200</td><td><code>FLAG_MIGRATION</code></td><td>v5: Frame carries migration token</td></tr>
              </tbody>
            </table>
          </div>

          <Heading as="h3">Nonce Construction</Heading>
          <p>12-byte nonce: <code>[direction:1][0x00:3][counter:8 BE]</code>. Direction: <code>0x00</code> = client → server, <code>0x01</code> = server → client. Counter increments atomically per frame.</p>

          <Heading as="h3">Cipher Suites</Heading>
          <div className={styles.refTable}>
            <table>
              <thead><tr><th>ID</th><th>Suite</th><th>Description</th></tr></thead>
              <tbody>
                <tr><td>0x01</td><td>ChaCha20-Poly1305</td><td>Default. XChaCha20 with Poly1305 MAC. Best on ARM / no AES-NI.</td></tr>
                <tr><td>0x02</td><td>AES-256-GCM</td><td>Hardware-accelerated on AES-NI CPUs.</td></tr>
                <tr><td>0x03</td><td>TransportOnly</td><td>BLAKE3 keyed MAC only (no encryption). For use over TLS/QUIC.</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* ════════════════════════════════════════════════════════════
            11. Server Configuration Reference
            ════════════════════════════════════════════════════════════ */}
        <section className={styles.section} id="config-server">
          <Heading as="h2">Server Configuration Reference</Heading>
          <p>TOML format. Env var overrides: <code>PRISMA_*</code> with <code>_</code> separator. Loaded via <code>config</code> crate with layered defaults.</p>

          <div className={styles.refTable}>
            <table>
              <thead><tr><th>Key</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
              <tbody>
                <tr><td><code>listen_addr</code></td><td>String</td><td><code>"0.0.0.0:8443"</code></td><td>TCP listen address</td></tr>
                <tr><td><code>quic_listen_addr</code></td><td>String</td><td><code>"0.0.0.0:8443"</code></td><td>QUIC listen address</td></tr>
                <tr><td><code>protocol_version</code></td><td>String</td><td><code>"v4"</code></td><td>Protocol version ("v4" or "v5")</td></tr>
                <tr><td><code>allow_transport_only_cipher</code></td><td>bool</td><td><code>false</code></td><td>Allow TransportOnly cipher mode</td></tr>
                <tr><td><code>dns_upstream</code></td><td>String</td><td><code>"8.8.8.8:53"</code></td><td>Upstream DNS for CMD_DNS_QUERY</td></tr>
                <tr><td><code>ticket_rotation_hours</code></td><td>u64</td><td><code>6</code></td><td>Session ticket key rotation interval</td></tr>
                <tr><td><code>shutdown_drain_timeout_secs</code></td><td>u64</td><td><code>30</code></td><td>Graceful shutdown drain timeout</td></tr>
                <tr><td><code>config_watch</code></td><td>bool</td><td><code>false</code></td><td>Watch config file for auto-reload</td></tr>
                <tr><td colSpan={4}><strong>[tls]</strong></td></tr>
                <tr><td><code>tls.cert_path</code></td><td>String</td><td>&mdash;</td><td>TLS certificate PEM path</td></tr>
                <tr><td><code>tls.key_path</code></td><td>String</td><td>&mdash;</td><td>TLS private key PEM path</td></tr>
                <tr><td colSpan={4}><strong>[logging]</strong></td></tr>
                <tr><td><code>logging.level</code></td><td>String</td><td><code>"info"</code></td><td>Log level: trace, debug, info, warn, error</td></tr>
                <tr><td><code>logging.format</code></td><td>String</td><td><code>"pretty"</code></td><td>Log format: pretty, json, compact</td></tr>
                <tr><td colSpan={4}><strong>[performance]</strong></td></tr>
                <tr><td><code>performance.max_connections</code></td><td>u32</td><td><code>1024</code></td><td>Maximum concurrent connections</td></tr>
                <tr><td><code>performance.connection_timeout_secs</code></td><td>u64</td><td><code>300</code></td><td>Connection idle timeout</td></tr>
                <tr><td colSpan={4}><strong>[padding]</strong></td></tr>
                <tr><td><code>padding.min</code></td><td>u16</td><td><code>0</code></td><td>Minimum per-frame padding bytes</td></tr>
                <tr><td><code>padding.max</code></td><td>u16</td><td><code>256</code></td><td>Maximum per-frame padding bytes</td></tr>
                <tr><td colSpan={4}><strong>[[authorized_clients]]</strong></td></tr>
                <tr><td><code>id</code></td><td>String</td><td>&mdash;</td><td>Client UUID</td></tr>
                <tr><td><code>auth_secret</code></td><td>String</td><td>&mdash;</td><td>Hex-encoded 256-bit auth secret</td></tr>
                <tr><td><code>name</code></td><td>String?</td><td>&mdash;</td><td>Human-readable client name</td></tr>
                <tr><td><code>bandwidth_up</code></td><td>String?</td><td>&mdash;</td><td>Upload limit (e.g., "100mbps")</td></tr>
                <tr><td><code>bandwidth_down</code></td><td>String?</td><td>&mdash;</td><td>Download limit (e.g., "100mbps")</td></tr>
                <tr><td><code>quota</code></td><td>String?</td><td>&mdash;</td><td>Traffic quota (e.g., "100GB")</td></tr>
                <tr><td colSpan={4}><strong>[management_api]</strong></td></tr>
                <tr><td><code>management_api.enabled</code></td><td>bool</td><td><code>false</code></td><td>Enable management API</td></tr>
                <tr><td><code>management_api.listen_addr</code></td><td>String</td><td><code>"0.0.0.0:9090"</code></td><td>Management API listen address</td></tr>
                <tr><td><code>management_api.auth_token</code></td><td>String</td><td><code>""</code></td><td>Bearer token for auth</td></tr>
                <tr><td><code>management_api.cors_origins</code></td><td>[String]</td><td><code>[]</code></td><td>Allowed CORS origins (empty = allow all)</td></tr>
                <tr><td colSpan={4}><strong>[camouflage]</strong></td></tr>
                <tr><td><code>camouflage.enabled</code></td><td>bool</td><td><code>false</code></td><td>Enable active probing resistance</td></tr>
                <tr><td><code>camouflage.fallback_addr</code></td><td>String?</td><td>&mdash;</td><td>Decoy server address for non-Prisma traffic</td></tr>
                <tr><td><code>camouflage.salamander_password</code></td><td>String?</td><td>&mdash;</td><td>Salamander UDP obfuscation password</td></tr>
                <tr><td colSpan={4}><strong>[cdn]</strong></td></tr>
                <tr><td><code>cdn.enabled</code></td><td>bool</td><td><code>false</code></td><td>Enable CDN HTTPS listener</td></tr>
                <tr><td><code>cdn.listen_addr</code></td><td>String</td><td><code>"0.0.0.0:443"</code></td><td>CDN listener address</td></tr>
                <tr><td><code>cdn.ws_tunnel_path</code></td><td>String</td><td><code>"/ws-tunnel"</code></td><td>WebSocket tunnel path</td></tr>
                <tr><td><code>cdn.grpc_tunnel_path</code></td><td>String</td><td><code>"/tunnel.PrismaTunnel"</code></td><td>gRPC tunnel path</td></tr>
                <tr><td colSpan={4}><strong>[traffic_shaping]</strong></td></tr>
                <tr><td><code>traffic_shaping.padding_mode</code></td><td>String</td><td><code>"none"</code></td><td>Padding: "none", "random", "bucket"</td></tr>
                <tr><td><code>traffic_shaping.bucket_sizes</code></td><td>[u16]</td><td><code>[128..16384]</code></td><td>Fixed bucket sizes for bucket padding</td></tr>
                <tr><td><code>traffic_shaping.timing_jitter_ms</code></td><td>u32</td><td><code>0</code></td><td>Random delay on handshake frames</td></tr>
                <tr><td><code>traffic_shaping.chaff_interval_ms</code></td><td>u32</td><td><code>0</code></td><td>Chaff injection interval (0=disabled)</td></tr>
                <tr><td colSpan={4}><strong>[shadow_tls]</strong></td></tr>
                <tr><td><code>shadow_tls.enabled</code></td><td>bool</td><td><code>false</code></td><td>Enable ShadowTLS v3 listener</td></tr>
                <tr><td><code>shadow_tls.listen_addr</code></td><td>String</td><td><code>"0.0.0.0:8444"</code></td><td>ShadowTLS listen address</td></tr>
                <tr><td><code>shadow_tls.cover_server</code></td><td>String</td><td>&mdash;</td><td>Cover server for TLS mimicry (e.g., "www.google.com:443")</td></tr>
                <tr><td><code>shadow_tls.password</code></td><td>String</td><td>&mdash;</td><td>Shared ShadowTLS password</td></tr>
                <tr><td colSpan={4}><strong>[ssh_transport]</strong></td></tr>
                <tr><td><code>ssh_transport.enabled</code></td><td>bool</td><td><code>false</code></td><td>Enable SSH transport listener</td></tr>
                <tr><td><code>ssh_transport.listen_addr</code></td><td>String</td><td><code>"0.0.0.0:22222"</code></td><td>SSH transport listen address</td></tr>
                <tr><td><code>ssh_transport.host_key_path</code></td><td>String</td><td>&mdash;</td><td>SSH host key file path</td></tr>
                <tr><td><code>ssh_transport.fake_shell</code></td><td>bool</td><td><code>false</code></td><td>Show fake shell to interactive probers</td></tr>
                <tr><td colSpan={4}><strong>[wireguard_transport]</strong></td></tr>
                <tr><td><code>wireguard_transport.enabled</code></td><td>bool</td><td><code>false</code></td><td>Enable WireGuard transport listener</td></tr>
                <tr><td><code>wireguard_transport.listen_addr</code></td><td>String</td><td><code>"0.0.0.0:51820"</code></td><td>WireGuard UDP listen address</td></tr>
                <tr><td><code>wireguard_transport.private_key</code></td><td>String</td><td>&mdash;</td><td>WireGuard private key</td></tr>
                <tr><td colSpan={4}><strong>[port_forwarding]</strong></td></tr>
                <tr><td><code>port_forwarding.enabled</code></td><td>bool</td><td><code>false</code></td><td>Enable server-side port forwarding</td></tr>
                <tr><td><code>port_forwarding.allowed_ports</code></td><td>[u16]</td><td><code>[]</code></td><td>Ports clients can forward</td></tr>
                <tr><td><code>port_forwarding.max_forwards_per_client</code></td><td>u32</td><td><code>5</code></td><td>Max forwards per client</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* ════════════════════════════════════════════════════════════
            12. Client Configuration Reference
            ════════════════════════════════════════════════════════════ */}
        <section className={styles.section} id="config-client">
          <Heading as="h2">Client Configuration Reference</Heading>
          <p>TOML format. Env var overrides: <code>PRISMA_*</code>.</p>

          <div className={styles.refTable}>
            <table>
              <thead><tr><th>Key</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
              <tbody>
                <tr><td><code>server_addr</code></td><td>String</td><td>&mdash;</td><td>Server address (host:port)</td></tr>
                <tr><td><code>socks5_listen_addr</code></td><td>String</td><td><code>"127.0.0.1:1080"</code></td><td>SOCKS5 listen address</td></tr>
                <tr><td><code>http_listen_addr</code></td><td>String?</td><td>&mdash;</td><td>HTTP proxy listen address</td></tr>
                <tr><td><code>pac_port</code></td><td>u16?</td><td>&mdash;</td><td>PAC server port (e.g., 8070)</td></tr>
                <tr><td><code>transport</code></td><td>String</td><td><code>"quic"</code></td><td>Transport: quic, ws, grpc, xhttp, xporta, prisma-tls, shadow-tls, wireguard</td></tr>
                <tr><td><code>cipher_suite</code></td><td>String</td><td><code>"chacha20-poly1305"</code></td><td>Cipher: chacha20-poly1305, aes-256-gcm</td></tr>
                <tr><td><code>fingerprint</code></td><td>String</td><td><code>"chrome"</code></td><td>uTLS fingerprint: chrome, firefox, safari, random, none</td></tr>
                <tr><td><code>quic_version</code></td><td>String</td><td><code>"auto"</code></td><td>QUIC version: v1, v2, auto</td></tr>
                <tr><td><code>skip_cert_verify</code></td><td>bool</td><td><code>false</code></td><td>Skip TLS certificate verification</td></tr>
                <tr><td><code>tls_on_tcp</code></td><td>bool</td><td><code>false</code></td><td>Enable TLS on TCP transport</td></tr>
                <tr><td><code>server_key_pin</code></td><td>String?</td><td>&mdash;</td><td>SHA-256 pin of server ephemeral public key</td></tr>
                <tr><td colSpan={4}><strong>[identity]</strong></td></tr>
                <tr><td><code>identity.client_id</code></td><td>String</td><td>&mdash;</td><td>Client UUID</td></tr>
                <tr><td><code>identity.auth_secret</code></td><td>String</td><td>&mdash;</td><td>Hex-encoded 256-bit auth secret</td></tr>
                <tr><td colSpan={4}><strong>[dns]</strong></td></tr>
                <tr><td><code>dns.mode</code></td><td>String</td><td><code>"direct"</code></td><td>DNS mode: direct, smart, fake, tunnel</td></tr>
                <tr><td><code>dns.protocol</code></td><td>String</td><td><code>"udp"</code></td><td>DNS protocol: udp, doh, dot</td></tr>
                <tr><td><code>dns.upstream</code></td><td>String</td><td><code>"8.8.8.8:53"</code></td><td>Upstream DNS server</td></tr>
                <tr><td><code>dns.doh_url</code></td><td>String</td><td><code>"https://cloudflare-dns.com/dns-query"</code></td><td>DoH server URL</td></tr>
                <tr><td><code>dns.dns_listen_addr</code></td><td>String</td><td><code>"127.0.0.1:10053"</code></td><td>Local DNS server address</td></tr>
                <tr><td colSpan={4}><strong>[tun]</strong></td></tr>
                <tr><td><code>tun.enabled</code></td><td>bool</td><td><code>false</code></td><td>Enable TUN mode</td></tr>
                <tr><td><code>tun.device_name</code></td><td>String</td><td><code>"prisma-tun0"</code></td><td>TUN device name</td></tr>
                <tr><td><code>tun.mtu</code></td><td>u16</td><td><code>1500</code></td><td>MTU</td></tr>
                <tr><td><code>tun.include_routes</code></td><td>[String]</td><td><code>["0.0.0.0/0"]</code></td><td>Routes to capture</td></tr>
                <tr><td><code>tun.exclude_routes</code></td><td>[String]</td><td><code>[]</code></td><td>Routes to bypass</td></tr>
                <tr><td colSpan={4}><strong>[congestion]</strong></td></tr>
                <tr><td><code>congestion.mode</code></td><td>String</td><td><code>"bbr"</code></td><td>Congestion control: bbr, brutal, adaptive</td></tr>
                <tr><td><code>congestion.target_bandwidth</code></td><td>String?</td><td>&mdash;</td><td>Target for brutal/adaptive (e.g., "100mbps")</td></tr>
                <tr><td colSpan={4}><strong>[routing]</strong></td></tr>
                <tr><td><code>routing.geoip_path</code></td><td>String?</td><td>&mdash;</td><td>Path to geoip.dat</td></tr>
                <tr><td><code>routing.rules</code></td><td>Array</td><td><code>[]</code></td><td>Rule array: type (domain/domain-suffix/domain-keyword/ip-cidr/geoip/port/all), value, action (proxy/direct/block)</td></tr>
                <tr><td colSpan={4}><strong>[[port_forwards]]</strong></td></tr>
                <tr><td><code>name</code></td><td>String</td><td>&mdash;</td><td>Forward rule name</td></tr>
                <tr><td><code>local_addr</code></td><td>String</td><td>&mdash;</td><td>Local service address</td></tr>
                <tr><td><code>remote_port</code></td><td>u16</td><td>&mdash;</td><td>Remote port on server</td></tr>
                <tr><td colSpan={4}><strong>Multiplexing</strong></td></tr>
                <tr><td><code>mux_enabled</code></td><td>bool</td><td><code>false</code></td><td>Enable XMUX stream multiplexing</td></tr>
                <tr><td><code>mux_max_streams</code></td><td>u32</td><td><code>128</code></td><td>Max concurrent streams per mux connection</td></tr>
                <tr><td><code>mux_max_connections</code></td><td>u16</td><td><code>4</code></td><td>Max mux transport connections in pool</td></tr>
                <tr><td colSpan={4}><strong>[[subscriptions]]</strong></td></tr>
                <tr><td><code>url</code></td><td>String</td><td>&mdash;</td><td>Subscription URL (SS/VMess/Trojan/VLESS/Clash YAML)</td></tr>
                <tr><td><code>name</code></td><td>String</td><td>&mdash;</td><td>Subscription name</td></tr>
                <tr><td><code>auto_update</code></td><td>bool</td><td><code>true</code></td><td>Auto-refresh subscription</td></tr>
                <tr><td><code>update_interval_hours</code></td><td>u64</td><td><code>24</code></td><td>Refresh interval in hours</td></tr>
                <tr><td colSpan={4}><strong>[[proxy_groups]]</strong></td></tr>
                <tr><td><code>name</code></td><td>String</td><td>&mdash;</td><td>Group name</td></tr>
                <tr><td><code>type</code></td><td>String</td><td>&mdash;</td><td>Type: select, auto-url, fallback, load-balance</td></tr>
                <tr><td><code>servers</code></td><td>[String]</td><td>&mdash;</td><td>Server names in this group</td></tr>
                <tr><td><code>test_url</code></td><td>String?</td><td>&mdash;</td><td>URL for latency testing (auto-url type)</td></tr>
                <tr><td><code>test_interval_secs</code></td><td>u64?</td><td><code>300</code></td><td>Test interval in seconds</td></tr>
                <tr><td><code>strategy</code></td><td>String?</td><td><code>"round-robin"</code></td><td>Load balance strategy: round-robin, random</td></tr>
                <tr><td colSpan={4}><strong>[[rule_providers]]</strong></td></tr>
                <tr><td><code>name</code></td><td>String</td><td>&mdash;</td><td>Rule provider name</td></tr>
                <tr><td><code>type</code></td><td>String</td><td>&mdash;</td><td>Type: domain, ipcidr, mixed</td></tr>
                <tr><td><code>url</code></td><td>String</td><td>&mdash;</td><td>URL to fetch rules from</td></tr>
                <tr><td><code>interval_hours</code></td><td>u64</td><td><code>24</code></td><td>Refresh interval in hours</td></tr>
                <tr><td><code>action</code></td><td>String</td><td>&mdash;</td><td>Action for matched rules: proxy, direct, block</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* ════════════════════════════════════════════════════════════
            13. Development Guide
            ════════════════════════════════════════════════════════════ */}
        <section className={styles.section} id="dev-guide">
          <Heading as="h2">Development Guide</Heading>

          <Heading as="h3">Build and Test</Heading>
          <div className={styles.codeBlock}>
            <code>{`# Build all crates
cargo build --workspace

# Run all tests
cargo test --workspace

# Lint with clippy
cargo clippy --workspace --all-targets

# Format check
cargo fmt --all -- --check

# Run benchmarks (prisma-core)
cargo bench -p prisma-core

# Run with specific features
cargo build --workspace --release`}</code>
          </div>

          <Heading as="h3">Project Conventions</Heading>
          <ul>
            <li>All workspace dependencies are declared in root <code>Cargo.toml</code> under <code>[workspace.dependencies]</code>. Crates reference them with <code>dep.workspace = true</code>.</li>
            <li>Error types are defined in <code>prisma-core/src/error.rs</code> using <code>thiserror</code>. Use <code>anyhow::Result</code> in binary crates, typed errors in library APIs.</li>
            <li>Async runtime: <code>tokio</code> with full features. All I/O uses <code>AsyncRead + AsyncWrite</code> traits.</li>
            <li>Logging: <code>tracing</code> crate with structured fields. Use <code>info!</code>, <code>warn!</code>, <code>debug!</code>.</li>
            <li>Configuration: <code>serde</code> + <code>config</code> crate with layered defaults → TOML file → env vars.</li>
            <li>FFI: All <code>extern "C"</code> functions use the <code>ffi_catch!</code> macro for panic safety. Strings are null-terminated UTF-8.</li>
            <li>Release profile: <code>strip = true</code>, <code>lto = "thin"</code>, <code>codegen-units = 1</code>.</li>
          </ul>

          <Heading as="h3">Adding a New Transport</Heading>
          <ol>
            <li><strong>Server listener</strong>: Create <code>prisma-server/src/listener/my_transport.rs</code> with a <code>pub async fn listen(...)</code> that accepts connections and calls <code>handler::handle_generic_connection()</code>.</li>
            <li><strong>Server lib.rs</strong>: Add the listener module and spawn it in <code>run()</code> when enabled in config.</li>
            <li><strong>Client stream</strong>: Create <code>prisma-client/src/my_transport_stream.rs</code> implementing <code>AsyncRead + AsyncWrite</code>.</li>
            <li><strong>Connector</strong>: Add a variant to <code>TransportStream</code> enum in <code>connector.rs</code>. Implement <code>poll_read</code> and <code>poll_write</code> delegation.</li>
            <li><strong>ProxyContext</strong>: Add <code>use_my_transport</code> flag in <code>proxy.rs</code>. Add connection logic in <code>connect()</code>.</li>
            <li><strong>Config</strong>: Add config structs to <code>prisma-core/src/config/server.rs</code> and <code>client.rs</code>. Add <code>#[serde(default)]</code> fields to <code>ServerConfig</code> / <code>ClientConfig</code>.</li>
            <li><strong>CLI</strong>: Update <code>prisma-cli/src/main.rs</code> <code>print_version()</code> to list the new transport.</li>
            <li><strong>Tests</strong>: Add integration test in the crate's test module. Use <code>tokio::io::duplex()</code> for mock streams.</li>
          </ol>

          <Heading as="h3">Adding a New CLI Command</Heading>
          <ol>
            <li>Add the subcommand variant to the <code>Commands</code> enum in <code>prisma-cli/src/main.rs</code> with <code>clap</code> attributes.</li>
            <li>Create a handler module (e.g., <code>prisma-cli/src/my_command.rs</code>).</li>
            <li>Add the module declaration and match arm in <code>main.rs</code>.</li>
            <li>If it calls the management API, use <code>api_client::ApiClient::resolve()</code> for auto-detection of URL and token.</li>
          </ol>

          <Heading as="h3">Adding a Management API Endpoint</Heading>
          <ol>
            <li>Create a handler in <code>prisma-mgmt/src/handlers/my_handler.rs</code> with axum handler functions.</li>
            <li>Add the module to <code>handlers/mod.rs</code>.</li>
            <li>Register the route in <code>router.rs</code> using <code>.route("/api/my-endpoint", get(my_handler::handler))</code>.</li>
            <li>The handler receives <code>State&lt;MgmtState&gt;</code> which provides access to <code>ServerState</code>, bandwidth stores, and config path.</li>
          </ol>

          <Heading as="h3">Key Dependencies</Heading>
          <div className={styles.refTable}>
            <table>
              <thead><tr><th>Category</th><th>Crate</th><th>Purpose</th></tr></thead>
              <tbody>
                <tr><td>Runtime</td><td><code>tokio</code></td><td>Async runtime (full features)</td></tr>
                <tr><td>QUIC</td><td><code>quinn</code></td><td>QUIC v1/v2 implementation</td></tr>
                <tr><td>TLS</td><td><code>rustls</code> + <code>tokio-rustls</code></td><td>TLS 1.3 (ring backend)</td></tr>
                <tr><td>Crypto</td><td><code>chacha20poly1305</code>, <code>aes-gcm</code></td><td>AEAD ciphers</td></tr>
                <tr><td>Crypto</td><td><code>x25519-dalek</code></td><td>X25519 key exchange</td></tr>
                <tr><td>Crypto</td><td><code>ml-kem</code></td><td>ML-KEM-768 post-quantum KEM</td></tr>
                <tr><td>Crypto</td><td><code>blake3</code></td><td>Hash / KDF / keyed MAC</td></tr>
                <tr><td>Web</td><td><code>axum</code></td><td>Management API framework</td></tr>
                <tr><td>HTTP</td><td><code>hyper</code> + <code>reqwest</code></td><td>HTTP client/server</td></tr>
                <tr><td>WebSocket</td><td><code>tokio-tungstenite</code></td><td>WS transport</td></tr>
                <tr><td>gRPC</td><td><code>tonic</code> + <code>prost</code></td><td>gRPC transport</td></tr>
                <tr><td>SSH</td><td><code>russh</code></td><td>SSH transport</td></tr>
                <tr><td>DNS</td><td><code>hickory-proto</code></td><td>DNS wire format</td></tr>
                <tr><td>TUN</td><td><code>smoltcp</code></td><td>Userspace TCP/IP stack</td></tr>
                <tr><td>FEC</td><td><code>reed-solomon-erasure</code></td><td>Forward error correction</td></tr>
                <tr><td>CLI</td><td><code>clap</code></td><td>Command-line parser</td></tr>
                <tr><td>Config</td><td><code>config</code> + <code>toml</code></td><td>Layered config loading</td></tr>
                <tr><td>Serialization</td><td><code>serde</code> + <code>serde_json</code></td><td>Serialize/deserialize</td></tr>
                <tr><td>Cache</td><td><code>moka</code></td><td>Async TTL cache (DNS)</td></tr>
                <tr><td>Bandwidth</td><td><code>governor</code></td><td>Token-bucket rate limiter</td></tr>
                <tr><td>Metrics</td><td><code>prometheus</code></td><td>Prometheus metrics export</td></tr>
                <tr><td>Testing</td><td><code>proptest</code>, <code>insta</code>, <code>criterion</code></td><td>Property tests, snapshots, benchmarks</td></tr>
              </tbody>
            </table>
          </div>
        </section>

      </main>
    </Layout>
  );
}
