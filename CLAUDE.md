# Prisma

Encrypted proxy system built in Rust. Workspace version 1.7.0, edition 2021.

## Workspace Layout

| Crate | Role |
|-------|------|
| `prisma-core` | Shared library: crypto (PrismaVeil v5), protocol, config, types, bandwidth, DNS, routing |
| `prisma-server` | Server binary: listeners (TCP/QUIC/WS/gRPC/XHTTP/XPorta + multi-protocol inbounds), relay, auth, camouflage |
| `prisma-client` | Client library: SOCKS5/HTTP inbound, transport selection, TUN, connection pool |
| `prisma-cli` | CLI binary (clap 4): server/client runners, management commands |
| `prisma-mgmt` | Management API (axum): REST + WebSocket endpoints, auth middleware |
| `prisma-ffi` | C FFI shared library for GUI/mobile: lifecycle, profiles, QR, system proxy, auto-update |

Other packages (not Cargo workspace members):
| Package | Role |
|---------|------|
| `prisma-gui` | Tauri 2 + React 19 desktop app |
| `prisma-console` | Next.js dashboard (independent version) |
| `prisma-docs` | Docusaurus documentation site (EN + CN) |
| `prisma-mcp` | MCP development server for AI agents |

Mobile: `prisma-gui` uses Tauri 2 mobile targets (iOS/Android) — no separate native apps.

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

## AI Agent System

Use `prisma-orchestrator` for any project work — it plans, executes, tests, versions, and commits.

### Agents (`.claude/agents/`)

| Agent | Role |
|-------|------|
| `prisma-orchestrator` | Primary entry point — receives demands, coordinates everything |
| `rust-engineer` | All Rust work: protocol, crypto, transport, routing, relay, security, performance |
| `frontend-engineer` | GUI (Tauri/React), Console (Next.js), CLI UX, Docusaurus docs |
| `platform-engineer` | FFI safety, Tauri 2 mobile, TUN, system proxy, cross-platform |
| `qa-engineer` | Tests, validation, benchmarks, CI/CD, quality gates |

### Skills (`.claude/skills/`)

| Skill | Purpose |
|-------|---------|
| `prisma-workflow.md` | Shared procedures: simplify, test/format, version bump, commit |
| `prisma-crate-map.md` | Module reference for all 6 crates with file paths and extension recipes |
| `prisma-docs-sync.md` | Version sync rules, README audit, Docusaurus sync |

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
