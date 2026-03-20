import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  recordEvolution,
  queryEvolution,
  recordBenchmark,
  queryBenchmarks,
  compareBenchmarks,
} from "../db/store.js";
import { mcpError } from "../utils/fs.js";

export function registerEvolutionTools(
  server: McpServer,
  _workspaceRoot: string,
) {
  // ── prisma_evolution_log ─────────────────────────────────────────────────
  server.tool(
    "prisma_evolution_log",
    "Record or query agent evolution events (design decisions, architecture changes, feature additions)",
    {
      action: z
        .enum(["record", "query"])
        .describe("Whether to record a new event or query existing events"),
      event: z
        .object({
          type: z.string().describe("Event type (e.g., feature, refactor, bugfix, design-decision)"),
          description: z.string().describe("Description of the evolution event"),
          files_changed: z
            .array(z.string())
            .describe("List of files changed"),
          agent: z.string().describe("Agent or person who made the change"),
        })
        .optional()
        .describe("Event to record (required when action is 'record')"),
      limit: z
        .number()
        .optional()
        .default(20)
        .describe("Max number of events to return when querying"),
      agent: z
        .string()
        .optional()
        .describe("Filter events by agent name when querying"),
    },
    async ({ action, event, limit, agent }) => {
      try {
        if (action === "record") {
          if (!event) {
            return {
              content: [{ type: "text" as const, text: "Error: `event` is required when action is 'record'" }],
            };
          }

          const id = recordEvolution(
            event.agent,
            event.type,
            event.description,
            event.files_changed,
          );

          return {
            content: [{
              type: "text" as const,
              text: `# Evolution Event Recorded\n\n- **ID**: ${id}\n- **Type**: ${event.type}\n- **Agent**: ${event.agent}\n- **Description**: ${event.description}\n- **Files**: ${event.files_changed.join(", ")}`,
            }],
          };
        }

        // Query
        const rows = queryEvolution(limit ?? 20, agent);

        if (rows.length === 0) {
          return { content: [{ type: "text" as const, text: "No evolution events found." }] };
        }

        const lines = [`# Evolution Log (${rows.length} events)\n`];
        for (const row of rows) {
          lines.push(`## #${row.id} — ${row.event_type} (${row.timestamp})`);
          lines.push(`- **Agent**: ${row.agent}`);
          lines.push(`- **Description**: ${row.description}`);
          lines.push(`- **Files**: ${row.files_changed.join(", ")}\n`);
        }

        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch (err: unknown) {
        return mcpError("Error in evolution log", err);
      }
    },
  );

  // ── prisma_benchmark_history ─────────────────────────────────────────────
  server.tool(
    "prisma_benchmark_history",
    "Record, query, or compare benchmark results over time for tracking performance regressions",
    {
      action: z
        .enum(["record", "query", "compare"])
        .describe("Whether to record, query, or compare benchmarks"),
      benchmark: z
        .object({
          suite: z.string().describe("Benchmark suite name (e.g., throughput, latency, handshake)"),
          metric: z.string().describe("Metric name (e.g., tcp_throughput, quic_handshake_ms)"),
          value: z.number().describe("Measured value"),
          unit: z.string().describe("Unit of measurement (e.g., Mbps, ms, ops/sec)"),
          version: z.string().describe("Version string (e.g., 0.9.0)"),
        })
        .optional()
        .describe("Benchmark result to record (required when action is 'record')"),
      suite: z
        .string()
        .optional()
        .describe("Filter by suite name for query/compare"),
      limit: z
        .number()
        .optional()
        .default(20)
        .describe("Max results to return"),
    },
    async ({ action, benchmark, suite, limit }) => {
      try {
        if (action === "record") {
          if (!benchmark) {
            return {
              content: [{ type: "text" as const, text: "Error: `benchmark` is required when action is 'record'" }],
            };
          }

          const id = recordBenchmark(
            benchmark.suite,
            benchmark.metric,
            benchmark.value,
            benchmark.unit,
            benchmark.version,
          );

          return {
            content: [{
              type: "text" as const,
              text: `# Benchmark Recorded\n\n- **ID**: ${id}\n- **Suite**: ${benchmark.suite}\n- **Metric**: ${benchmark.metric}\n- **Value**: ${benchmark.value} ${benchmark.unit}\n- **Version**: ${benchmark.version}`,
            }],
          };
        }

        if (action === "compare") {
          const rows = queryBenchmarks(suite, 100);
          const versions = [...new Set(rows.map(r => r.version))].slice(0, 2);

          if (versions.length < 2) {
            return {
              content: [{ type: "text" as const, text: "Not enough versions to compare. Need at least 2 recorded benchmark versions." }],
            };
          }

          const comparison = compareBenchmarks(suite ?? "", versions[1], versions[0]);

          const lines = [`# Benchmark Comparison: ${versions[1]} -> ${versions[0]}\n`];
          if (suite) lines.push(`Suite: ${suite}\n`);
          lines.push(`| Metric | ${versions[1]} | ${versions[0]} | Change |`);
          lines.push(`|--------|-------|-------|--------|`);

          for (const row of comparison) {
            const sign = row.delta_pct >= 0 ? "+" : "";
            lines.push(`| ${row.metric} | ${row.value2} ${row.unit} | ${row.value1} ${row.unit} | ${sign}${row.delta_pct.toFixed(1)}% |`);
          }

          return { content: [{ type: "text" as const, text: lines.join("\n") }] };
        }

        // Query
        const rows = queryBenchmarks(suite, limit ?? 20);

        if (rows.length === 0) {
          return { content: [{ type: "text" as const, text: "No benchmark records found." }] };
        }

        const lines = [`# Benchmark History (${rows.length} records)\n`];
        lines.push(`| ID | Suite | Metric | Value | Unit | Version | Timestamp |`);
        lines.push(`|----|-------|--------|------:|------|---------|----------|`);
        for (const row of rows) {
          lines.push(`| ${row.id} | ${row.suite} | ${row.metric} | ${row.value} | ${row.unit} | ${row.version} | ${row.timestamp} |`);
        }

        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch (err: unknown) {
        return mcpError("Error in benchmark history", err);
      }
    },
  );

  // ── prisma_competitive_matrix ────────────────────────────────────────────
  server.tool(
    "prisma_competitive_matrix",
    "Return a feature comparison matrix: Prisma vs xray-core vs sing-box across protocol, transport, security, performance, and UX categories",
    {
      category: z
        .enum(["protocol", "transport", "security", "performance", "ux", "all"])
        .optional()
        .default("all")
        .describe("Category to filter the comparison"),
    },
    async ({ category }) => {
      type Category = "protocol" | "transport" | "security" | "performance" | "ux";
      const categories: Category[] =
        category === "all" || !category
          ? ["protocol", "transport", "security", "performance", "ux"]
          : [category as Category];

      const lines = [
        `# Competitive Matrix: Prisma vs xray-core vs sing-box\n`,
        `> Version: Prisma 1.4.0 | xray-core 1.8.x | sing-box 1.9.x\n`,
      ];

      for (const cat of categories) {
        const matrix = COMPETITIVE_DATA[cat];
        if (!matrix) continue;

        lines.push(`## ${cat.charAt(0).toUpperCase() + cat.slice(1)}\n`);
        lines.push(`| Feature | Prisma | xray-core | sing-box |`);
        lines.push(`|---------|--------|-----------|----------|`);

        for (const row of matrix) {
          lines.push(`| ${row.feature} | ${row.prisma} | ${row.xray} | ${row.singbox} |`);
        }
        lines.push(``);
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    },
  );
}

// ── Competitive comparison data ──────────────────────────────────────────────

interface ComparisonRow {
  feature: string;
  prisma: string;
  xray: string;
  singbox: string;
}

type ComparisonCategory = "protocol" | "transport" | "security" | "performance" | "ux";

const COMPETITIVE_DATA: Record<ComparisonCategory, ComparisonRow[]> = {
  protocol: [
    { feature: "Custom protocol", prisma: "PrismaVeil v5", xray: "VMess/VLESS", singbox: "Relies on xray/hysteria protocols" },
    { feature: "Multi-protocol inbounds", prisma: "VMess, VLESS, Shadowsocks, Trojan", xray: "VMess, VLESS, Shadowsocks, Trojan", singbox: "VMess, VLESS, Shadowsocks, Trojan, Hysteria" },
    { feature: "Post-quantum key exchange", prisma: "ML-KEM 768 hybrid", xray: "No", singbox: "No" },
    { feature: "Protocol obfuscation", prisma: "PrismaTLS (REALITY-like)", xray: "REALITY", singbox: "Via REALITY (xray compat)" },
    { feature: "Multiplexing", prisma: "XMUX (built-in)", xray: "Mux.cool", singbox: "Multiplex" },
    { feature: "Forward Error Correction", prisma: "Reed-Solomon FEC", xray: "No", singbox: "No (hysteria has built-in)" },
    { feature: "Session tickets", prisma: "Auto-rotating (configurable)", xray: "Standard TLS", singbox: "Standard TLS" },
  ],
  transport: [
    { feature: "QUIC", prisma: "Quinn (v1 + v2)", xray: "quic-go", singbox: "quic-go" },
    { feature: "WebSocket", prisma: "tokio-tungstenite", xray: "gorilla/websocket", singbox: "gorilla/websocket" },
    { feature: "gRPC", prisma: "tonic", xray: "grpc-go", singbox: "grpc-go" },
    { feature: "XHTTP (splitHTTP)", prisma: "Full (upload/download/stream)", xray: "SplitHTTP", singbox: "No" },
    { feature: "XPorta (next-gen CDN)", prisma: "Yes (session-based, JSON encoding)", xray: "No", singbox: "No" },
    { feature: "ShadowTLS v3", prisma: "Yes", xray: "No", singbox: "Yes" },
    { feature: "SSH transport", prisma: "Yes (russh)", xray: "No", singbox: "Yes" },
    { feature: "WireGuard", prisma: "Yes", xray: "No", singbox: "Yes" },
    { feature: "Salamander UDP obfuscation", prisma: "Yes", xray: "No", singbox: "No (hysteria has obfs)" },
    { feature: "Port hopping (QUIC)", prisma: "Yes", xray: "No", singbox: "No (hysteria has it)" },
    { feature: "Transport auto-fallback", prisma: "Yes (ordered fallback list)", xray: "No (manual)", singbox: "No (manual)" },
  ],
  security: [
    { feature: "Cipher suites", prisma: "ChaCha20-Poly1305, AES-256-GCM, transport-only", xray: "AES/ChaCha (VMess), none (VLESS)", singbox: "Depends on protocol" },
    { feature: "Key exchange", prisma: "X25519 + ML-KEM hybrid", xray: "X25519 (REALITY only)", singbox: "Via protocol" },
    { feature: "Anti-RTT fingerprinting", prisma: "Yes (cross-layer normalization)", xray: "No", singbox: "No" },
    { feature: "Traffic shaping", prisma: "Configurable padding + timing", xray: "No", singbox: "No" },
    { feature: "Entropy camouflage", prisma: "Yes (UDP packets)", xray: "No", singbox: "No" },
    { feature: "SNI slicing", prisma: "Yes (QUIC ClientHello fragmentation)", xray: "fragment (TCP only)", singbox: "No" },
    { feature: "Server key pinning", prisma: "Yes (SHA-256 pin)", xray: "No", singbox: "No" },
    { feature: "uTLS fingerprinting", prisma: "chrome/firefox/safari/random", xray: "Yes (utls)", singbox: "Yes (utls)" },
    { feature: "Memory safety", prisma: "Rust (compile-time guarantees)", xray: "Go (GC, runtime safety)", singbox: "Go (GC, runtime safety)" },
    { feature: "Zeroize secrets", prisma: "Yes (zeroize crate)", xray: "No explicit zeroing", singbox: "No explicit zeroing" },
  ],
  performance: [
    { feature: "Language", prisma: "Rust (zero-cost abstractions)", xray: "Go", singbox: "Go" },
    { feature: "Async runtime", prisma: "Tokio (multi-threaded)", xray: "goroutines", singbox: "goroutines" },
    { feature: "Memory footprint", prisma: "Low (no GC, no runtime)", xray: "Medium (Go GC)", singbox: "Medium (Go GC)" },
    { feature: "Congestion control", prisma: "BBR, Brutal, Adaptive", xray: "BBR (QUIC only)", singbox: "BBR, Brutal (hysteria)" },
    { feature: "Connection pooling", prisma: "XMUX pool (configurable)", xray: "Mux.cool", singbox: "Multiplex" },
    { feature: "Bandwidth management", prisma: "governor (per-client, per-forward)", xray: "Basic", singbox: "Basic" },
    { feature: "Binary size", prisma: "~10-15 MB (stripped + LTO)", xray: "~25 MB", singbox: "~30 MB" },
  ],
  ux: [
    { feature: "Desktop GUI", prisma: "Tauri + React (native, lightweight)", xray: "Third-party (v2rayN, etc.)", singbox: "Third-party (Clash Verge, etc.)" },
    { feature: "Web console", prisma: "Built-in (Next.js, real-time)", xray: "No (third-party dashboards)", singbox: "Clash-compatible API" },
    { feature: "iOS app", prisma: "Native (Swift + FFI)", xray: "Third-party", singbox: "SFI (official)" },
    { feature: "Android app", prisma: "Native (Kotlin + JNI)", xray: "Third-party (v2rayNG)", singbox: "SFA (official)" },
    { feature: "CLI", prisma: "Clap 4 (completions, management)", xray: "Basic CLI", singbox: "Good CLI" },
    { feature: "Management API", prisma: "REST + WebSocket (axum)", xray: "gRPC API", singbox: "Clash-compatible REST" },
    { feature: "Config format", prisma: "TOML", xray: "JSON", singbox: "JSON" },
    { feature: "QR code sharing", prisma: "Built-in (SVG generation)", xray: "Via GUI clients", singbox: "Via GUI clients" },
    { feature: "Subscription support", prisma: "Built-in (auto-refresh)", xray: "Via GUI clients", singbox: "Built-in" },
    { feature: "System proxy", prisma: "Built-in FFI (macOS/Win/Linux)", xray: "Via GUI clients", singbox: "Built-in" },
    { feature: "TUN mode", prisma: "Built-in (smoltcp/wintun)", xray: "Via tun2socks", singbox: "Built-in (tun)" },
    { feature: "Per-app proxy (mobile)", prisma: "Yes", xray: "Via GUI clients", singbox: "Yes" },
    { feature: "Auto-update", prisma: "Built-in (GitHub releases)", xray: "No", singbox: "No" },
    { feature: "Proxy groups", prisma: "Built-in (auto-select, load-balance)", xray: "Via GUI clients", singbox: "Built-in (outbound providers)" },
    { feature: "Speed test", prisma: "Built-in FFI", xray: "No", singbox: "No" },
  ],
};
