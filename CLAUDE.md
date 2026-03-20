# Prisma

Encrypted proxy system built in Rust. Workspace version 1.5.0, edition 2021.

## Workspace Layout

| Crate | Role |
|-------|------|
| `prisma-core` | Shared library: crypto, protocol (PrismaVeil v5 + VMess/VLESS/Shadowsocks/Trojan compat), config, types, bandwidth, DNS, routing |
| `prisma-server` | Server binary: listeners (TCP/QUIC/WS/gRPC/XHTTP/XPorta + multi-protocol inbounds), relay, auth, camouflage |
| `prisma-client` | Client library: SOCKS5/HTTP inbound, transport selection, TUN, connection pool |
| `prisma-cli` | CLI binary (clap 4): server/client runners, management commands, web console |
| `prisma-mgmt` | Management API (axum): REST + WebSocket endpoints, auth middleware |
| `prisma-ffi` | C FFI shared library for GUI/mobile: lifecycle, profiles, QR, system proxy, auto-update |
| `prisma-mcp` | MCP development server: workspace intelligence tools for AI agents |
| `prisma-ios` | iOS app (Swift/SwiftUI, uses prisma-ffi via C bridge) |
| `prisma-android` | Android app (Kotlin, uses prisma-ffi via JNI) |

## Key Commands

```bash
cargo build --workspace                 # Build all
cargo test --workspace                  # Test all
cargo clippy --workspace --all-targets  # Lint
cargo fmt --all -- --check              # Format check
```

## Dependencies

All workspace deps are declared in the root `Cargo.toml` under `[workspace.dependencies]`.
Crates reference them with `dep.workspace = true`.

## AI Agent Team System

Prisma uses a self-evolving AI agent team for autonomous development. Send demands in plain language — the system plans, implements, tests, versions, and commits automatically.

### Usage
Just invoke `prisma-orchestrator` with any demand:
- "add feature X" → analyzes, plans, implements, tests, bumps version, commits
- "optimize Y" → profiles, identifies bottleneck, optimizes, benchmarks, ships
- "release 1.0.0" → full audit, fix issues, bump, sync docs, commit + tag
- "evolve the project" → reads memory, audits, prioritizes, implements top items

### Agent Registry
| Agent | Role |
|-------|------|
| `prisma-orchestrator` | Autonomous brain — receives demands, coordinates everything |
| `rust-architect` | Cross-crate Rust implementation |
| `perf-engineer` | Hot path optimization, benchmarking |
| `security-engineer` | Protocol, crypto, anti-detection |
| `ux-engineer` | GUI, dashboard, CLI UX |
| `platform-engineer` | FFI, mobile, cross-platform |
| `qa-engineer` | Tests, coverage, CI/CD |
| `docs-engineer` | Documentation sync |
| `feature-validator` | Post-implementation validation |

### Skills (domain knowledge)
- `.claude/skills/prisma-rust.md` — Rust architecture, conventions, crate map
- `.claude/skills/prisma-perf.md` — Performance engineering, benchmarking
- `.claude/skills/prisma-security.md` — Security, protocol, anti-detection
- `.claude/skills/prisma-ux.md` — UI/UX, Tauri/React, Next.js
- `.claude/skills/prisma-platform.md` — FFI, mobile, cross-platform
- `.claude/skills/prisma-qa.md` — Testing, CI/CD, coverage
- `.claude/skills/prisma-docs.md` — Documentation sync
- `.claude/skills/prisma-workflow.md` — Build, test, version, commit
- `.claude/skills/prisma-orchestrator.md` — Orchestration protocol
- `.claude/skills/prisma-evolve.md` — Self-evolution protocol

### Self-Evolution
The system improves itself after each task — updating skills, agents, and memory based on what it learned. See `.claude/agents/prisma-agent-teams.md` for the full architecture.

## MCP Server (prisma-dev)

A local MCP server at `prisma-mcp/` provides persistent workspace intelligence to AI agents.

### Setup
```bash
cd prisma-mcp && npm install && npm run build
```

Configured in `.claude/settings.local.json` as `prisma-dev` MCP server.

### Tools
| Tool | Purpose |
|------|---------|
| `prisma_build_status` | Run cargo check/clippy/test, get cached results |
| `prisma_version` | Current version + sync status across all files |
| `prisma_version_suggest` | Suggest next version based on change type |
| `prisma_crate_graph` | Dependency graph between workspace crates |
| `prisma_test_coverage` | Per-crate test count and coverage gaps |
| `prisma_todo_scan` | Find TODO/FIXME/HACK comments |
| `prisma_ffi_surface` | List all C FFI exports with signatures |
| `prisma_config_schema` | Validate TOML config |
| `prisma_unwrap_audit` | Find unwrap() in non-test code |
| `prisma_evolution_log` | Record/query agent evolution events |
| `prisma_benchmark_history` | Record/query performance benchmarks |
| `prisma_competitive_matrix` | Feature comparison vs xray/sing-box |

### Resources
| Resource | URI |
|----------|-----|
| Architecture | `prisma://architecture` |
| Protocol spec | `prisma://protocol` |
| Changelog | `prisma://changelog` |

### Prompts
| Prompt | Purpose |
|--------|---------|
| `implement_feature` | Structured feature analysis template |
| `security_audit` | Security checklist for a file/crate |
| `release_checklist` | Full release gate sequence |
