import * as path from "path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { safeRead } from "../utils/fs.js";

/**
 * Extract all `pub const NAME: TYPE = VALUE;` declarations from Rust source.
 * Returns an array of `{ name, type, value, comment }` objects.
 */
function extractConstants(
  source: string,
): Array<{ name: string; type: string; value: string; comment: string }> {
  const results: Array<{
    name: string;
    type: string;
    value: string;
    comment: string;
  }> = [];

  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(
      /^pub\s+const\s+(\w+)\s*:\s*(\w+)\s*=\s*(.+?)\s*;/,
    );
    if (!match) continue;

    // Collect preceding doc/line comments
    const comments: string[] = [];
    for (let j = i - 1; j >= 0; j--) {
      const prev = lines[j].trim();
      if (prev.startsWith("///")) {
        comments.unshift(prev.replace(/^\/\/\/\s?/, ""));
      } else if (prev.startsWith("//")) {
        comments.unshift(prev.replace(/^\/\/\s?/, ""));
      } else if (prev === "") {
        continue;
      } else {
        break;
      }
    }

    results.push({
      name: match[1],
      type: match[2],
      value: match[3],
      comment: comments.join(" "),
    });
  }

  return results;
}

/**
 * Extract Rust enum variants from a `pub enum EnumName { ... }` block.
 * Returns the enum name and a list of `{ name, comment }` variant objects.
 */
function extractEnum(
  source: string,
  enumName: string,
): Array<{ variant: string; comment: string }> {
  const results: Array<{ variant: string; comment: string }> = [];

  // Find the enum declaration
  const enumPattern = new RegExp(
    `pub\\s+enum\\s+${enumName}\\s*\\{([\\s\\S]*?)^\\}`,
    "m",
  );
  const match = source.match(enumPattern);
  if (!match) return results;

  const body = match[1];
  const lines = body.split("\n");

  let pendingComment = "";
  for (const line of lines) {
    const trimmed = line.trim();

    // Collect doc comments
    if (trimmed.startsWith("///")) {
      const commentText = trimmed.replace(/^\/\/\/\s?/, "");
      pendingComment = pendingComment
        ? `${pendingComment} ${commentText}`
        : commentText;
      continue;
    }

    // Match variant lines: VariantName { ... }, VariantName(Type), or plain VariantName,
    const variantMatch = trimmed.match(/^(\w+)/);
    if (variantMatch && /^[A-Z]/.test(variantMatch[1])) {
      results.push({
        variant: variantMatch[1],
        comment: pendingComment,
      });
      pendingComment = "";
    } else if (trimmed === "" || trimmed.startsWith("//")) {
      // blank or non-doc comment -- preserve pending comment
    } else {
      pendingComment = "";
    }
  }

  return results;
}

/**
 * Extract struct fields from a `pub struct StructName { ... }` block.
 */
function extractStructFields(
  source: string,
  structName: string,
): Array<{ name: string; type: string; comment: string }> {
  const results: Array<{ name: string; type: string; comment: string }> = [];

  const structPattern = new RegExp(
    `pub\\s+struct\\s+${structName}\\s*\\{([\\s\\S]*?)^\\}`,
    "m",
  );
  const match = source.match(structPattern);
  if (!match) return results;

  const body = match[1];
  const lines = body.split("\n");

  let pendingComment = "";
  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("///")) {
      const commentText = trimmed.replace(/^\/\/\/\s?/, "");
      pendingComment = pendingComment
        ? `${pendingComment} ${commentText}`
        : commentText;
      continue;
    }

    // Match field: `pub field_name: Type,`
    const fieldMatch = trimmed.match(/^pub\s+(\w+)\s*:\s*(.+?)\s*,?\s*$/);
    if (fieldMatch) {
      results.push({
        name: fieldMatch[1],
        type: fieldMatch[2],
        comment: pendingComment,
      });
      pendingComment = "";
    } else {
      pendingComment = "";
    }
  }

  return results;
}

/**
 * Build the full protocol specification markdown from source files.
 */
async function buildProtocolSpec(workspaceRoot: string): Promise<string> {
  const coreDir = path.join(workspaceRoot, "prisma-core", "src");
  const protocolDir = path.join(coreDir, "protocol");
  const cryptoDir = path.join(coreDir, "crypto");

  // Read source files
  const [typesSource, handshakeSource, codecSource, kdfSource, coreTypesSource] =
    await Promise.all([
      safeRead(path.join(protocolDir, "types.rs")),
      safeRead(path.join(protocolDir, "handshake.rs")),
      safeRead(path.join(protocolDir, "codec.rs")),
      safeRead(path.join(cryptoDir, "kdf.rs")),
      safeRead(path.join(coreDir, "types.rs")),
    ]);

  const sections: string[] = [];

  // ── Header ──────────────────────────────────────────────────────────────
  sections.push("# PrismaVeil v5 Protocol Specification\n\n*Auto-generated from source code*");

  // ── Protocol constants ──────────────────────────────────────────────────
  const allConstants: Array<{ name: string; type: string; value: string; comment: string }> = [];

  if (coreTypesSource) {
    allConstants.push(...extractConstants(coreTypesSource));
  }
  if (typesSource) {
    allConstants.push(...extractConstants(typesSource));
  }

  // Group constants by prefix
  const coreConsts = allConstants.filter(
    (c) =>
      c.name.startsWith("PRISMA_") ||
      c.name.startsWith("MAX_") ||
      c.name.startsWith("NONCE_") ||
      c.name.startsWith("SESSION_") ||
      c.name.startsWith("QUIC_"),
  );
  const cmdConsts = allConstants.filter((c) => c.name.startsWith("CMD_"));
  const flagConsts = allConstants.filter((c) => c.name.startsWith("FLAG_"));
  const featureConsts = allConstants.filter((c) =>
    c.name.startsWith("FEATURE_"),
  );
  const clientInitFlags = allConstants.filter((c) =>
    c.name.startsWith("CLIENT_INIT_FLAG_"),
  );

  if (coreConsts.length > 0) {
    let section = "## Protocol Constants\n\n";
    section += "| Constant | Type | Value | Description |\n";
    section += "|----------|------|-------|-------------|\n";
    for (const c of coreConsts) {
      section += `| \`${c.name}\` | \`${c.type}\` | \`${c.value}\` | ${c.comment || "--"} |\n`;
    }
    sections.push(section);
  }

  // ── Command bytes ───────────────────────────────────────────────────────
  if (cmdConsts.length > 0) {
    let section = "## Command Bytes\n\n";
    section +=
      "Each data frame carries a 1-byte command field identifying the payload type.\n\n";
    section += "| Command | Value | Description |\n";
    section += "|---------|-------|-------------|\n";
    for (const c of cmdConsts) {
      section += `| \`${c.name}\` | \`${c.value}\` | ${c.comment || "--"} |\n`;
    }
    sections.push(section);
  }

  // ── Frame flags ─────────────────────────────────────────────────────────
  if (flagConsts.length > 0) {
    let section = "## Frame Flags (2-byte little-endian bitmask)\n\n";
    section += "| Flag | Value | Description |\n";
    section += "|------|-------|-------------|\n";
    for (const c of flagConsts) {
      section += `| \`${c.name}\` | \`${c.value}\` | ${c.comment || "--"} |\n`;
    }
    sections.push(section);
  }

  // ── Feature flags ───────────────────────────────────────────────────────
  if (featureConsts.length > 0) {
    let section = "## Server Feature Flags (32-bit bitmask)\n\n";
    section +=
      "Negotiated during handshake. The server advertises supported features in `PrismaServerInit.server_features`.\n\n";
    section += "| Feature | Value | Description |\n";
    section += "|---------|-------|-------------|\n";
    for (const c of featureConsts) {
      section += `| \`${c.name}\` | \`${c.value}\` | ${c.comment || "--"} |\n`;
    }
    sections.push(section);
  }

  // ── Client init flags ──────────────────────────────────────────────────
  if (clientInitFlags.length > 0) {
    let section = "## Client Init Flags (1-byte bitmask)\n\n";
    section +=
      "Sent by the client in `PrismaClientInit.flags` to request optional features.\n\n";
    section += "| Flag | Value | Description |\n";
    section += "|------|-------|-------------|\n";
    for (const c of clientInitFlags) {
      section += `| \`${c.name}\` | \`${c.value}\` | ${c.comment || "--"} |\n`;
    }
    sections.push(section);
  }

  // ── DataFrame wire format ──────────────────────────────────────────────
  if (typesSource) {
    const dataFrameFields = extractStructFields(typesSource, "DataFrame");
    let section = "## DataFrame Wire Format\n\n";
    section += "```\n";
    section +=
      "[cmd:1][flags:2][stream_id:4][payload:var][padding:var]\n";
    section += "\n";
    section +=
      "When FLAG_BUCKETED is set:\n";
    section +=
      "[cmd:1][flags:2][stream_id:4][bucket_pad_len:2][payload:var][bucket_padding:var]\n";
    section += "```\n\n";

    if (dataFrameFields.length > 0) {
      section += "### DataFrame Fields\n\n";
      section += "| Field | Type | Description |\n";
      section += "|-------|------|-------------|\n";
      for (const f of dataFrameFields) {
        section += `| \`${f.name}\` | \`${f.type}\` | ${f.comment || "--"} |\n`;
      }
    }
    sections.push(section);
  }

  // ── Encrypted frame wire format ────────────────────────────────────────
  if (codecSource) {
    let section = "## Encrypted Frame Wire Format\n\n";
    section += "```\n";
    section += "[nonce:12][len:2][ciphertext][tag:16]\n";
    section += "```\n\n";
    section +=
      "- **Nonce**: 12 bytes -- format: `[direction:1][0:3][counter:8]`\n";
    section += "  - `direction`: `0x00` for client-to-server, `0x01` for server-to-client\n";
    section += "  - `counter`: monotonically increasing 64-bit big-endian counter\n";
    section += "- **len**: 2-byte big-endian length of ciphertext (including AEAD tag)\n";
    section += "- **ciphertext**: AEAD-encrypted payload\n";
    section += "- **tag**: 16-byte AEAD authentication tag\n\n";
    section +=
      "### v5 Header-Authenticated Encryption\n\n" +
      "When `FLAG_HEADER_AUTHENTICATED` is set, the frame header fields " +
      "(cmd, flags, stream_id) are bound as Additional Authenticated Data (AAD) " +
      "to the AEAD cipher. The AAD is computed as `BLAKE3(header_key, nonce)[..16]`, " +
      "preventing cross-session frame injection.";
    sections.push(section);
  }

  // ── Command enum ────────────────────────────────────────────────────────
  if (typesSource) {
    const variants = extractEnum(typesSource, "Command");
    if (variants.length > 0) {
      let section = "## Command Variants\n\n";
      section += "| Variant | Description |\n";
      section += "|---------|-------------|\n";
      for (const v of variants) {
        section += `| \`${v.variant}\` | ${v.comment || "--"} |\n`;
      }
      sections.push(section);
    }
  }

  // ── AcceptStatus enum ──────────────────────────────────────────────────
  if (typesSource) {
    const variants = extractEnum(typesSource, "AcceptStatus");
    if (variants.length > 0) {
      let section = "## Accept Status Codes\n\n";
      section += "Returned in `PrismaServerInit.status` during handshake.\n\n";
      section += "| Status | Description |\n";
      section += "|--------|-------------|\n";
      for (const v of variants) {
        section += `| \`${v.variant}\` | ${v.comment || "--"} |\n`;
      }
      sections.push(section);
    }
  }

  // ── Handshake flow ─────────────────────────────────────────────────────
  {
    let section = "## Handshake Flow\n\n";
    section +=
      "PrismaVeil v5 uses a 2-step handshake with optional hybrid post-quantum key exchange.\n\n";
    section += "```\n";
    section += "Client                                Server\n";
    section += "  |                                      |\n";
    section +=
      "  |--- PrismaClientInit ------------------->|\n";
    section += "  |    version: 0x05                       |\n";
    section += "  |    flags (PQ KEM, header auth, etc.)   |\n";
    section += "  |    client_ephemeral_pub (X25519)       |\n";
    section += "  |    client_id (UUID)                    |\n";
    section += "  |    timestamp                           |\n";
    section += "  |    cipher_suite preference             |\n";
    section += "  |    auth_token = HMAC(secret, id, ts)   |\n";
    section += "  |    [ml_kem_encap_key if PQ KEM]        |\n";
    section += "  |                                      |\n";
    section +=
      "  |<-- PrismaServerInit (encrypted) -------|\n";
    section += "  |    [server_pub:32][encrypted_payload]  |\n";
    section += "  |    status, session_id                  |\n";
    section += "  |    server_ephemeral_pub (X25519)       |\n";
    section += "  |    challenge (32 bytes)                |\n";
    section += "  |    padding_range, server_features      |\n";
    section += "  |    session_ticket (encrypted)          |\n";
    section += "  |    bucket_sizes (traffic shaping)      |\n";
    section += "  |    [ml_kem_ciphertext if PQ KEM]       |\n";
    section += "  |                                      |\n";
    section += "  |--- ChallengeResponse ----------------->|\n";
    section += "  |    hash = BLAKE3(challenge)            |\n";
    section += "  |                                      |\n";
    section += "  |======= Encrypted data frames =========|\n";
    section += "```\n";

    if (handshakeSource) {
      section += "\n### Key Derivation Steps\n\n";
      section += "1. **X25519 ECDH**: Client and server exchange ephemeral X25519 public keys\n";
      section += "2. **Preliminary key**: `BLAKE3-KDF(\"prisma-v5-preliminary\", shared_secret || client_pub || server_pub || timestamp)`\n";
      section += "   - Used to encrypt `PrismaServerInit`\n";
      section += "3. **Hybrid PQ KEM** (optional): ML-KEM-768 encapsulation combines with X25519 shared secret\n";
      section += "   - `combined = BLAKE3(x25519_shared || mlkem_shared)`\n";
      section += "4. **Session key**: `BLAKE3-KDF(\"prisma-v5-session\", shared_secret || client_pub || server_pub || challenge || timestamp || 0x05)`\n";
      section += "   - Version byte `0x05` is bound into KDF context to prevent cross-version key confusion\n";
      section += "5. **Header key** (v5): `BLAKE3-KDF(\"prisma-v5-header-auth\", session_key)`\n";
      section += "   - Used for AAD computation in header-authenticated frames\n";
      section += "6. **Migration token** (v5): `BLAKE3-KDF(\"prisma-v5-migration\", session_key || session_id)`\n";
      section += "   - Allows resuming sessions on new transport connections\n";
    }

    sections.push(section);
  }

  // ── 0-RTT Resumption ──────────────────────────────────────────────────
  if (typesSource) {
    const resumeFields = extractStructFields(typesSource, "PrismaClientResume");
    if (resumeFields.length > 0) {
      let section = "## 0-RTT Session Resumption\n\n";
      section +=
        "Clients can resume sessions without a full handshake using a previously issued session ticket.\n\n";
      section += "### PrismaClientResume Fields\n\n";
      section += "| Field | Type | Description |\n";
      section += "|-------|------|-------------|\n";
      for (const f of resumeFields) {
        section += `| \`${f.name}\` | \`${f.type}\` | ${f.comment || "--"} |\n`;
      }
      sections.push(section);
    }
  }

  // ── SessionKeys ────────────────────────────────────────────────────────
  if (typesSource) {
    const sessionKeyFields = extractStructFields(typesSource, "SessionKeys");
    if (sessionKeyFields.length > 0) {
      let section = "## Session Keys\n\n";
      section +=
        "Produced after a successful handshake. Both client and server derive identical keys.\n\n";
      section += "| Field | Type | Description |\n";
      section += "|-------|------|-------------|\n";
      for (const f of sessionKeyFields) {
        section += `| \`${f.name}\` | \`${f.type}\` | ${f.comment || "--"} |\n`;
      }
      sections.push(section);
    }
  }

  // ── KDF domains ────────────────────────────────────────────────────────
  if (kdfSource) {
    // Extract all domain strings from blake3_derive calls
    const domainPattern = /blake3_derive\("([^"]+)"/g;
    const domains: string[] = [];
    let domainMatch: RegExpExecArray | null;
    while ((domainMatch = domainPattern.exec(kdfSource)) !== null) {
      if (!domains.includes(domainMatch[1])) {
        domains.push(domainMatch[1]);
      }
    }

    if (domains.length > 0) {
      let section = "## KDF Domain Separation Strings\n\n";
      section +=
        "All key derivation uses BLAKE3 in key-derivation mode with explicit domain separation.\n\n";
      section += "| Domain | Purpose |\n";
      section += "|--------|----------|\n";
      const domainDescriptions: Record<string, string> = {
        "prisma-v3-session-ticket": "Session ticket encryption key",
        "prisma-v5-preliminary":
          "Preliminary key for encrypting PrismaServerInit",
        "prisma-v5-session":
          "Final session key with challenge and version binding",
        "prisma-v5-header-auth":
          "Header authentication key for AAD computation",
        "prisma-v5-migration":
          "Connection migration token for session resumption",
      };
      for (const d of domains) {
        section += `| \`${d}\` | ${domainDescriptions[d] ?? "--"} |\n`;
      }
      sections.push(section);
    }
  }

  // ── Cipher suites ──────────────────────────────────────────────────────
  if (coreTypesSource) {
    const cipherVariants = extractEnum(coreTypesSource, "CipherSuite");
    if (cipherVariants.length > 0) {
      let section = "## Cipher Suites\n\n";
      section += "| Suite | Description |\n";
      section += "|-------|-------------|\n";
      for (const v of cipherVariants) {
        section += `| \`${v.variant}\` | ${v.comment || "--"} |\n`;
      }
      sections.push(section);
    }
  }

  return sections.join("\n\n---\n\n");
}

// ── Registration ─────────────────────────────────────────────────────────────

export function registerProtocolResource(
  server: McpServer,
  workspaceRoot: string,
) {
  server.resource(
    "protocol",
    "prisma://protocol",
    {
      description:
        "PrismaVeil v5 protocol specification extracted from source code: commands, flags, handshake flow, wire format, and KDF",
    },
    async (uri) => {
      const text = await buildProtocolSpec(workspaceRoot);

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/markdown",
            text,
          },
        ],
      };
    },
  );
}
