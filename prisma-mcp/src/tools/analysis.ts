import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { join } from "path";
import * as TOML from "toml";
import {
  scanTodos,
  scanFfiExports,
  scanUnwraps,
} from "../utils/rust.js";
import { parseWorkspace } from "../utils/cargo.js";
import { mcpError, groupBy } from "../utils/fs.js";

export function registerAnalysisTools(
  server: McpServer,
  workspaceRoot: string,
) {
  // ── prisma_todo_scan ─────────────────────────────────────────────────────
  server.tool(
    "prisma_todo_scan",
    "Scan for TODO, FIXME, HACK, and XXX comments across the workspace Rust source files",
    {
      type: z
        .enum(["TODO", "FIXME", "HACK", "all"])
        .optional()
        .default("all")
        .describe("Type of comment marker to search for"),
      crate: z
        .string()
        .optional()
        .describe("Limit search to a specific crate (e.g., prisma-core)"),
    },
    async ({ type: markerType, crate: crateName }) => {
      try {
        const markers =
          markerType === "all" || !markerType
            ? ["TODO", "FIXME", "HACK", "XXX"]
            : [markerType];

        const crates = crateName
          ? [crateName]
          : (await parseWorkspace(workspaceRoot)).members;

        const allItems = await scanTodos(workspaceRoot, crates, markers);

        if (allItems.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No ${markerType === "all" ? "TODO/FIXME/HACK/XXX" : markerType} comments found.`,
              },
            ],
          };
        }

        let result = `# Comment Markers Found: ${allItems.length}\n\n`;

        // Group by crate
        const byCrate: Record<string, typeof allItems> = {};
        for (const item of allItems) {
          const key = item.crate;
          if (!byCrate[key]) byCrate[key] = [];
          byCrate[key].push(item);
        }

        for (const [crate, items] of Object.entries(byCrate)) {
          result += `## ${crate} (${items.length})\n\n`;
          for (const item of items) {
            result += `- **${item.type}** \`${item.file}:${item.line}\`: ${item.text}\n`;
          }
          result += `\n`;
        }

        return { content: [{ type: "text" as const, text: result }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        return {
          content: [
            { type: "text" as const, text: `Error scanning TODOs: ${msg}` },
          ],
        };
      }
    },
  );

  // ── prisma_ffi_surface ───────────────────────────────────────────────────
  server.tool(
    "prisma_ffi_surface",
    "List all C FFI exports (#[no_mangle] extern functions) from prisma-ffi with signatures and doc comments",
    {},
    async () => {
      try {
        const ffiDir = join(workspaceRoot, "prisma-ffi", "src");
        const exports = await scanFfiExports(ffiDir);

        if (exports.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No FFI exports found in prisma-ffi/src/",
              },
            ],
          };
        }

        let result = `# prisma-ffi C API Surface (${exports.length} exports)\n\n`;

        // Group by source file
        const byFile: Record<string, typeof exports> = {};
        for (const exp of exports) {
          if (!byFile[exp.file]) byFile[exp.file] = [];
          byFile[exp.file].push(exp);
        }

        for (const [file, fns] of Object.entries(byFile)) {
          result += `## ${file}\n\n`;
          for (const fn of fns) {
            result += `### \`${fn.name}\`\n`;
            if (fn.doc) {
              result += `${fn.doc}\n\n`;
            }
            result += `\`\`\`rust\n${fn.signature}\n\`\`\`\n`;
            result += `Line: ${fn.line}\n\n`;
          }
        }

        return { content: [{ type: "text" as const, text: result }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        return {
          content: [
            {
              type: "text" as const,
              text: `Error scanning FFI surface: ${msg}`,
            },
          ],
        };
      }
    },
  );

  // ── prisma_config_schema ─────────────────────────────────────────────────
  server.tool(
    "prisma_config_schema",
    "Validate a TOML config string against the known Prisma server or client config structure",
    {
      config: z.string().describe("TOML config string to validate"),
      mode: z
        .enum(["server", "client"])
        .describe("Whether to validate as server or client config"),
    },
    async ({ config, mode }) => {
      try {
        // Step 1: Parse the TOML
        let parsed: Record<string, unknown>;
        try {
          parsed = TOML.parse(config) as Record<string, unknown>;
        } catch (parseErr: unknown) {
          const msg =
            parseErr instanceof Error ? parseErr.message : "Parse error";
          return {
            content: [
              {
                type: "text" as const,
                text: `# Config Validation: INVALID\n\n**TOML parse error**: ${msg}`,
              },
            ],
          };
        }

        // Step 2: Validate against known schema
        const errors: string[] = [];
        const warnings: string[] = [];

        if (mode === "server") {
          validateServerConfig(parsed, errors, warnings);
        } else {
          validateClientConfig(parsed, errors, warnings);
        }

        let result = `# Config Validation: ${mode}\n\n`;

        if (errors.length === 0) {
          result += `**Status: VALID**\n\n`;
        } else {
          result += `**Status: INVALID** (${errors.length} error(s))\n\n`;
          result += `## Errors\n\n`;
          for (const e of errors) {
            result += `- ${e}\n`;
          }
          result += `\n`;
        }

        if (warnings.length > 0) {
          result += `## Warnings\n\n`;
          for (const w of warnings) {
            result += `- ${w}\n`;
          }
          result += `\n`;
        }

        // Show parsed keys
        result += `## Parsed Top-Level Keys\n\n`;
        for (const key of Object.keys(parsed)) {
          result += `- \`${key}\`: ${typeof parsed[key]}\n`;
        }

        return { content: [{ type: "text" as const, text: result }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        return {
          content: [
            {
              type: "text" as const,
              text: `Error validating config: ${msg}`,
            },
          ],
        };
      }
    },
  );

  // ── prisma_unwrap_audit ──────────────────────────────────────────────────
  server.tool(
    "prisma_unwrap_audit",
    "Find all .unwrap() calls in non-test Rust code, grouped by crate. These are potential panic points in production.",
    {
      crate: z
        .string()
        .optional()
        .describe("Limit audit to a specific crate (e.g., prisma-core)"),
    },
    async ({ crate: crateName }) => {
      try {
        const crates = crateName
          ? [crateName]
          : (await parseWorkspace(workspaceRoot)).members;

        const allUnwraps = await scanUnwraps(workspaceRoot, crates);

        if (allUnwraps.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No .unwrap() calls found in non-test code.",
              },
            ],
          };
        }

        let result = `# Unwrap Audit: ${allUnwraps.length} occurrences\n\n`;

        // Group by crate
        const byCrate: Record<string, typeof allUnwraps> = {};
        for (const item of allUnwraps) {
          const key = item.crate;
          if (!byCrate[key]) byCrate[key] = [];
          byCrate[key].push(item);
        }

        for (const [crate, items] of Object.entries(byCrate)) {
          result += `## ${crate} (${items.length})\n\n`;

          // Sub-group by file
          const byFile: Record<string, typeof items> = {};
          for (const item of items) {
            if (!byFile[item.file]) byFile[item.file] = [];
            byFile[item.file].push(item);
          }

          for (const [file, fileItems] of Object.entries(byFile)) {
            result += `### \`${file}\`\n\n`;
            for (const item of fileItems) {
              result += `- Line ${item.line}: \`${item.context.trim()}\`\n`;
            }
            result += `\n`;
          }
        }

        result += `\n## Summary by Crate\n\n`;
        result += `| Crate | Unwraps |\n`;
        result += `|-------|--------:|\n`;
        for (const [crate, items] of Object.entries(byCrate)) {
          result += `| ${crate} | ${items.length} |\n`;
        }

        return { content: [{ type: "text" as const, text: result }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        return {
          content: [
            {
              type: "text" as const,
              text: `Error auditing unwraps: ${msg}`,
            },
          ],
        };
      }
    },
  );
}

// ── Config validation helpers ────────────────────────────────────────────────

/** Known top-level fields for ServerConfig. */
const SERVER_REQUIRED_FIELDS = ["listen_addr", "quic_listen_addr", "authorized_clients"];
const SERVER_OPTIONAL_FIELDS = [
  "tls",
  "logging",
  "performance",
  "port_forwarding",
  "management_api",
  "camouflage",
  "cdn",
  "padding",
  "congestion",
  "port_hopping",
  "dns_upstream",
  "protocol_version",
  "prisma_tls",
  "traffic_shaping",
  "allow_transport_only_cipher",
  "anti_rtt",
  "routing",
  "shadow_tls",
  "wireguard",
  "acls",
  "shutdown_drain_timeout_secs",
  "config_watch",
  "ssh",
  "ticket_rotation_hours",
  "inbounds",
];

/** Known top-level fields for ClientConfig. */
const CLIENT_REQUIRED_FIELDS = [
  "socks5_listen_addr",
  "server_addr",
  "identity",
];
const CLIENT_OPTIONAL_FIELDS = [
  "http_listen_addr",
  "pac_port",
  "cipher_suite",
  "transport",
  "skip_cert_verify",
  "logging",
  "port_forwards",
  "tls_on_tcp",
  "alpn_protocols",
  "tls_server_name",
  "ws_url",
  "ws_host",
  "ws_extra_headers",
  "grpc_url",
  "xhttp_mode",
  "xhttp_upload_url",
  "xhttp_download_url",
  "xhttp_stream_url",
  "xhttp_extra_headers",
  "xporta",
  "xmux",
  "mux_enabled",
  "mux_max_streams",
  "mux_max_connections",
  "user_agent",
  "referer",
  "congestion",
  "port_hopping",
  "salamander_password",
  "udp_fec",
  "dns",
  "routing",
  "tun",
  "protocol_version",
  "fingerprint",
  "quic_version",
  "transport_mode",
  "fallback_order",
  "sni_slicing",
  "traffic_shaping",
  "entropy_camouflage",
  "prisma_auth_secret",
  "transport_only_cipher",
  "server_key_pin",
  "subscriptions",
  "shadow_tls",
  "wireguard",
  "connection_pool",
  "fallback",
];

function validateServerConfig(
  config: Record<string, unknown>,
  errors: string[],
  warnings: string[],
): void {
  const allKnown = [...SERVER_REQUIRED_FIELDS, ...SERVER_OPTIONAL_FIELDS];

  // Check required fields
  for (const field of SERVER_REQUIRED_FIELDS) {
    if (!(field in config)) {
      errors.push(`Missing required field: \`${field}\``);
    }
  }

  // Check for unknown fields
  for (const key of Object.keys(config)) {
    if (!allKnown.includes(key)) {
      warnings.push(`Unknown field: \`${key}\` (may be ignored)`);
    }
  }

  // Type-specific validations
  if (config.listen_addr !== undefined && typeof config.listen_addr !== "string") {
    errors.push("`listen_addr` must be a string (e.g., \"0.0.0.0:8443\")");
  }
  if (config.quic_listen_addr !== undefined && typeof config.quic_listen_addr !== "string") {
    errors.push("`quic_listen_addr` must be a string (e.g., \"0.0.0.0:8443\")");
  }
  if (config.authorized_clients !== undefined) {
    if (!Array.isArray(config.authorized_clients)) {
      errors.push("`authorized_clients` must be an array");
    } else {
      for (let i = 0; i < config.authorized_clients.length; i++) {
        const client = config.authorized_clients[i] as Record<string, unknown>;
        if (!client.id) errors.push(`authorized_clients[${i}]: missing \`id\``);
        if (!client.auth_secret)
          errors.push(`authorized_clients[${i}]: missing \`auth_secret\``);
      }
    }
  }
  if (config.protocol_version !== undefined && config.protocol_version !== "v5") {
    warnings.push(
      `\`protocol_version\` is "${config.protocol_version}" but only "v5" is supported`,
    );
  }
}

function validateClientConfig(
  config: Record<string, unknown>,
  errors: string[],
  warnings: string[],
): void {
  const allKnown = [...CLIENT_REQUIRED_FIELDS, ...CLIENT_OPTIONAL_FIELDS];

  // Check required fields
  for (const field of CLIENT_REQUIRED_FIELDS) {
    if (!(field in config)) {
      errors.push(`Missing required field: \`${field}\``);
    }
  }

  // Check for unknown fields
  for (const key of Object.keys(config)) {
    if (!allKnown.includes(key)) {
      warnings.push(`Unknown field: \`${key}\` (may be ignored)`);
    }
  }

  // Type-specific validations
  if (config.socks5_listen_addr !== undefined && typeof config.socks5_listen_addr !== "string") {
    errors.push("`socks5_listen_addr` must be a string");
  }
  if (config.server_addr !== undefined && typeof config.server_addr !== "string") {
    errors.push("`server_addr` must be a string");
  }
  if (config.identity !== undefined) {
    const identity = config.identity as Record<string, unknown>;
    if (!identity.client_id) errors.push("`identity.client_id` is required");
    if (!identity.auth_secret)
      errors.push("`identity.auth_secret` is required");
  }
  if (config.cipher_suite !== undefined) {
    const valid = ["chacha20-poly1305", "aes-256-gcm", "transport-only"];
    if (!valid.includes(config.cipher_suite as string)) {
      warnings.push(
        `\`cipher_suite\` is "${config.cipher_suite}" — known values: ${valid.join(", ")}`,
      );
    }
  }
  if (config.transport !== undefined) {
    const valid = [
      "quic",
      "tcp",
      "ws",
      "grpc",
      "xhttp",
      "xporta",
      "shadow-tls",
      "ssh",
      "wireguard",
    ];
    if (!valid.includes(config.transport as string)) {
      warnings.push(
        `\`transport\` is "${config.transport}" — known values: ${valid.join(", ")}`,
      );
    }
  }
  if (config.protocol_version !== undefined && config.protocol_version !== "v5") {
    warnings.push(
      `\`protocol_version\` is "${config.protocol_version}" but only "v5" is supported`,
    );
  }
}
