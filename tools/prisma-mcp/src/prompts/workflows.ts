import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// ── Registration ─────────────────────────────────────────────────────────────

export function registerWorkflowPrompts(
  server: McpServer,
  _workspaceRoot: string,
) {
  // ── implement_feature ──────────────────────────────────────────────────
  server.prompt(
    "implement_feature",
    "Structured template for implementing a new feature across the Prisma workspace",
    {
      feature_name: z.string().describe("Name of the feature"),
      description: z.string().describe("Description of what the feature should do"),
    },
    async ({ feature_name, description }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text:
              `## Feature Implementation Request: ${feature_name}\n\n` +
              `### Description\n${description}\n\n` +
              `### Analysis Checklist\n` +
              `1. **Affected crates**: [identify which of prisma-core/server/client/cli/mgmt/ffi are touched]\n` +
              `2. **Cross-cutting concerns**:\n` +
              `   - [ ] Hot path impact? -- profile with perf-engineer\n` +
              `   - [ ] Protocol change? -- review with security-engineer\n` +
              `   - [ ] Config change? -- update validation, CLI, docs\n` +
              `   - [ ] FFI exposure? -- update prisma-ffi exports\n` +
              `   - [ ] UI change? -- update apps/prisma-gui and apps/prisma-console\n` +
              `3. **Implementation order**: core types -> protocol -> server -> client -> config -> cli -> mgmt -> ffi -> gui -> tests -> docs\n` +
              `4. **Version impact**: patch | minor | major\n\n` +
              `### Dependency Analysis\n` +
              `- prisma-core: [ ] new types [ ] new protocol messages [ ] new config fields\n` +
              `- prisma-server: [ ] new listener [ ] relay changes [ ] auth changes\n` +
              `- prisma-client: [ ] transport changes [ ] inbound changes [ ] TUN changes\n` +
              `- prisma-cli: [ ] new subcommand [ ] config generation [ ] output format\n` +
              `- prisma-mgmt: [ ] new API endpoints [ ] WebSocket events\n` +
              `- prisma-ffi: [ ] new FFI exports [ ] mobile API changes\n\n` +
              `### Quality Gates\n` +
              `- [ ] \`cargo check --workspace\` passes\n` +
              `- [ ] \`cargo clippy --workspace --all-targets\` has zero warnings\n` +
              `- [ ] \`cargo test --workspace\` passes\n` +
              `- [ ] \`cargo fmt --all -- --check\` passes\n` +
              `- [ ] New code has unit tests (target: >80% coverage)\n` +
              `- [ ] Documentation updated (doc comments, README, CLAUDE.md if needed)\n\n` +
              `### Execute\n` +
              `Use prisma-orchestrator to implement this feature autonomously.`,
          },
        },
      ],
    }),
  );

  // ── security_audit ─────────────────────────────────────────────────────
  server.prompt(
    "security_audit",
    "Security audit checklist for a specific file, crate, or subsystem in the Prisma workspace",
    {
      target: z.string().describe(
        "File path or crate name to audit (e.g., 'prisma-core' or 'crates/prisma-core/src/crypto/aead.rs')",
      ),
    },
    async ({ target }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text:
              `## Security Audit: ${target}\n\n` +
              `Perform a thorough security review of \`${target}\` covering each category below.\n` +
              `For each item, report: PASS / FAIL / N/A with a brief justification.\n\n` +
              `### 1. Cryptographic Usage\n` +
              `- [ ] Correct AEAD cipher construction (ChaCha20-Poly1305 / AES-256-GCM)\n` +
              `- [ ] Nonces are never reused (monotonic counter, direction byte separation)\n` +
              `- [ ] Key material is zeroized after use (\`Zeroizing<T>\`, \`zeroize\` crate)\n` +
              `- [ ] No hardcoded keys, IVs, or secrets\n` +
              `- [ ] BLAKE3 KDF uses proper domain separation strings\n` +
              `- [ ] X25519 ephemeral keys are generated fresh per handshake\n` +
              `- [ ] ML-KEM-768 encapsulation/decapsulation handled correctly\n` +
              `- [ ] Session tickets encrypted with rotating keys (TicketKeyRing)\n` +
              `- [ ] Constant-time comparison used for auth tokens and MACs (\`subtle::ConstantTimeEq\`)\n\n` +
              `### 2. Error Handling & Panics\n` +
              `- [ ] No \`.unwrap()\` on user-controlled or network-derived data in non-test code\n` +
              `- [ ] No \`.expect()\` that could leak sensitive information in the message\n` +
              `- [ ] All \`Result\` types propagated or handled with appropriate error variants\n` +
              `- [ ] Error messages do not leak internal state (session keys, client IDs, addresses)\n` +
              `- [ ] Index operations use \`.get()\` or bounds-checked access, not raw indexing\n\n` +
              `### 3. FFI Safety (if applicable)\n` +
              `- [ ] All \`extern "C"\` functions validate input pointers for null\n` +
              `- [ ] String arguments use \`CStr::from_ptr\` with proper lifetime management\n` +
              `- [ ] Returned strings are allocated with \`CString\` and caller frees with provided function\n` +
              `- [ ] No Rust panics can unwind across the FFI boundary (\`catch_unwind\`)\n` +
              `- [ ] Thread safety: no unprotected static mutable state\n\n` +
              `### 4. Input Validation\n` +
              `- [ ] Protocol version checked before processing handshake messages\n` +
              `- [ ] Frame sizes validated against \`MAX_FRAME_SIZE\` (32768)\n` +
              `- [ ] Address types validated (IPv4/IPv6/domain) before parsing\n` +
              `- [ ] String inputs length-bounded to prevent allocation amplification\n` +
              `- [ ] Config values validated with \`garde\` derive macros\n` +
              `- [ ] Port numbers and numeric ranges checked\n\n` +
              `### 5. Timing & Side-Channel Attacks\n` +
              `- [ ] Authentication token verification uses constant-time comparison\n` +
              `- [ ] Challenge response verification uses constant-time comparison\n` +
              `- [ ] No early-return patterns that leak validity of partial inputs\n` +
              `- [ ] Padding generation uses cryptographic randomness (\`rand::thread_rng\`)\n\n` +
              `### 6. Information Leakage\n` +
              `- [ ] Error responses do not distinguish auth failure reasons to the network\n` +
              `- [ ] Log statements do not print session keys, auth tokens, or plaintext\n` +
              `- [ ] Debug trait implementations on sensitive types are redacted\n` +
              `- [ ] Stack traces and backtraces disabled in release builds\n\n` +
              `### 7. Anti-Detection & Traffic Analysis Resistance\n` +
              `- [ ] TLS fingerprint mimicry (uTLS) applied correctly\n` +
              `- [ ] QUIC ALPN set to standard values (\`h3\`, \`h2\`) to avoid DPI detection\n` +
              `- [ ] Padding applied per-frame within configured range\n` +
              `- [ ] Traffic shaping (bucket sizes) hides payload length distribution\n` +
              `- [ ] Chaff frames generated at configurable intervals\n` +
              `- [ ] HTTP camouflage responses are indistinguishable from real web servers\n\n` +
              `### 8. Resource Exhaustion\n` +
              `- [ ] Connection limits enforced per client ID\n` +
              `- [ ] Bandwidth limits enforced via governor rate limiter\n` +
              `- [ ] Anti-replay window prevents nonce reuse attacks\n` +
              `- [ ] Session cache has bounded capacity (moka cache with TTL)\n` +
              `- [ ] Buffer pool used for relay frames to prevent allocation storms\n\n` +
              `### Summary\n` +
              `After completing the audit, provide:\n` +
              `1. **Critical findings** (must fix before release)\n` +
              `2. **Moderate findings** (should fix)\n` +
              `3. **Low-risk observations** (nice to have)\n` +
              `4. **Overall security posture** (1-10 score with justification)`,
          },
        },
      ],
    }),
  );

  // ── release_checklist ──────────────────────────────────────────────────
  server.prompt(
    "release_checklist",
    "Complete release gate sequence for a new Prisma version",
    {
      version: z.string().describe("Target version number (e.g., '1.0.0', '0.10.0')"),
    },
    async ({ version }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text:
              `## Release Checklist: v${version}\n\n` +
              `Complete each gate in order. A gate must pass before proceeding to the next.\n\n` +
              `### Gate 1: Code Quality\n` +
              `- [ ] \`cargo fmt --all -- --check\` passes\n` +
              `- [ ] \`cargo clippy --workspace --all-targets -- -D warnings\` has zero warnings\n` +
              `- [ ] \`cargo check --workspace\` compiles without errors\n` +
              `- [ ] No TODO/FIXME items tagged as release-blocking\n` +
              `- [ ] All \`.unwrap()\` calls in non-test code reviewed and justified\n\n` +
              `### Gate 2: Test Suite\n` +
              `- [ ] \`cargo test --workspace\` -- all tests pass\n` +
              `- [ ] Integration tests pass (client-server handshake, relay, UDP)\n` +
              `- [ ] Property-based tests pass (protocol fuzzing, codec round-trips)\n` +
              `- [ ] No test flakiness in 3 consecutive runs\n` +
              `- [ ] Test coverage meets minimum threshold per crate\n\n` +
              `### Gate 3: Security Audit\n` +
              `- [ ] Crypto subsystem audit (crates/prisma-core/src/crypto/)\n` +
              `- [ ] Protocol handshake audit (crates/prisma-core/src/protocol/)\n` +
              `- [ ] FFI boundary audit (crates/prisma-ffi/src/)\n` +
              `- [ ] No known CVEs in dependencies (\`cargo audit\`)\n` +
              `- [ ] Auth token generation and verification reviewed\n` +
              `- [ ] Anti-replay mechanism verified\n` +
              `- [ ] Session ticket encryption with key rotation verified\n\n` +
              `### Gate 4: Performance\n` +
              `- [ ] Relay throughput benchmark (target: >=1 Gbps single stream)\n` +
              `- [ ] Handshake latency benchmark (target: <10ms local)\n` +
              `- [ ] Memory usage under load (target: <100MB for 1000 connections)\n` +
              `- [ ] No performance regressions vs previous release\n` +
              `- [ ] Buffer pool and atomic nonce counters verified on hot path\n\n` +
              `### Gate 5: Cross-Platform Build\n` +
              `- [ ] Linux x86_64 build succeeds\n` +
              `- [ ] Linux aarch64 build succeeds\n` +
              `- [ ] macOS x86_64 build succeeds\n` +
              `- [ ] macOS aarch64 (Apple Silicon) build succeeds\n` +
              `- [ ] Windows x86_64 build succeeds\n` +
              `- [ ] iOS (aarch64-apple-ios) FFI library builds\n` +
              `- [ ] Android (aarch64-linux-android) FFI library builds\n\n` +
              `### Gate 6: Version Bump\n` +
              `- [ ] Root Cargo.toml workspace version set to \`${version}\`\n` +
              `- [ ] All crate versions resolve to \`${version}\`\n` +
              `- [ ] prisma-gui package.json version set to \`${version}\`\n` +
              `- [ ] prisma-console package.json version set to \`${version}\`\n` +
              `- [ ] prisma-ffi version constants updated\n` +
              `- [ ] CHANGELOG.md updated with release notes\n\n` +
              `### Gate 7: Documentation\n` +
              `- [ ] README.md (EN) up to date\n` +
              `- [ ] README.zh-CN.md (CN) in sync with EN version\n` +
              `- [ ] CLAUDE.md reflects current architecture\n` +
              `- [ ] API documentation (\`cargo doc --workspace --no-deps\`) builds clean\n` +
              `- [ ] Docusaurus site builds without errors\n` +
              `- [ ] Subsystem READMEs updated (protocol, crypto, transport)\n\n` +
              `### Gate 8: Release Artifacts\n` +
              `- [ ] Git tag \`v${version}\` created and signed\n` +
              `- [ ] GitHub Release created with changelog\n` +
              `- [ ] Binary artifacts attached (Linux/macOS/Windows)\n` +
              `- [ ] Docker image built and tagged\n` +
              `- [ ] Homebrew formula updated (if applicable)\n\n` +
              `### Gate 9: Post-Release Verification\n` +
              `- [ ] Fresh install from release artifacts works\n` +
              `- [ ] Client-server connectivity verified across transports (TCP, QUIC, WS)\n` +
              `- [ ] GUI connects and operates correctly\n` +
              `- [ ] Auto-update mechanism serves new version\n` +
              `- [ ] Monitor error rates for 24 hours post-release\n\n` +
              `### Sign-Off\n` +
              `- [ ] All gates PASS\n` +
              `- [ ] Release approved by maintainer\n` +
              `- [ ] Version \`${version}\` is live`,
          },
        },
      ],
    }),
  );
}
