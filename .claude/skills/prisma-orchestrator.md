---
description: "Autonomous demand-driven orchestrator: receives plain-language demands (features, fixes, optimizations, releases), plans across all crates/frontends, executes via team agents, runs quality gates, auto-versions, commits, and self-evolves"
globs:
  - "**/*.rs"
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.toml"
  - "**/*.json"
  - "**/*.md"
  - ".claude/**/*.md"
---

# Prisma Autonomous Orchestrator Skill

This skill defines the orchestration protocol. The orchestrator agent (`.claude/agents/prisma-orchestrator.md`) uses this as its execution playbook.

## Demand Processing Pipeline

```
DEMAND → Analyze → Plan → Execute → Quality Gates → Version Bump → Commit → Self-Evolve
                            │
                   ┌────────┴────────┐
                   │ Spawn team      │
                   │ agents if       │
                   │ cross-cutting   │
                   └─────────────────┘
```

---

## 0. Analyze the Demand

Parse the user's request:

1. **Classify**: feature | improvement | optimization | bugfix | refactor | release | audit
2. **Scope**: which crates, frontends, platforms are affected?
   - `prisma-core` — protocol, crypto, config, types, routing, bandwidth, DNS
   - `prisma-server` — listeners, relay, auth, camouflage, handlers
   - `prisma-client` — SOCKS5/HTTP inbound, transports, TUN, connection pool
   - `prisma-cli` — CLI commands, TUI dashboard
   - `prisma-mgmt` — REST/WebSocket management API
   - `prisma-ffi` — C FFI for GUI/mobile
   - `prisma-gui` — Tauri desktop client
   - `prisma-console` — Next.js web dashboard
   - `prisma-mobile/ios` — Swift iOS app
   - `prisma-mobile/android` — Kotlin Android app
   - `prisma-docs` — Docusaurus documentation
   - `prisma-mcp` — MCP development server (workspace intelligence tools)
3. **Complexity**: simple (direct execute) | medium (sequential) | complex (parallel agents)
4. **Version impact**: patch (fix) | minor (feature) | major (breaking, user-requested only)
5. **Cross-cutting concerns**:
   - Hot path touched? → perf-engineer
   - Protocol wire format changed? → security-engineer
   - Config structs changed? → update validation, CLI, docs
   - CLI commands added? → update reference, completions
   - API endpoints added? → update mgmt docs, dashboard
   - FFI exposure needed? → platform-engineer
   - Platform-specific code? → platform-engineer

---

## 1. Plan the Implementation

### Standard Order (adapt as needed)

```
1. Core types/traits       (prisma-core)      — shared interfaces first
2. Protocol changes        (prisma-core)      — wire format, codec, handshake
3. Server implementation   (prisma-server)    — server-side handling
4. Client implementation   (prisma-client)    — client-side handling
5. Config additions        (prisma-core)      — new config fields, validation
6. CLI integration         (prisma-cli)       — commands, TUI updates
7. Management API          (prisma-mgmt)      — REST/WS endpoints
8. FFI exposure            (prisma-ffi)       — C ABI exports
9. GUI integration         (prisma-gui)       — Tauri frontend
10. Dashboard integration  (prisma-console)   — Next.js admin panel
11. Mobile updates         (prisma-mobile)    — iOS/Android if affected
12. MCP server updates     (prisma-mcp)       — workspace intelligence tools
13. Tests                  (all crates)       — unit, integration, property-based
14. Documentation          (prisma-docs)      — EN + CN docs
15. Quality gates          (workspace)        — fmt, clippy, test, build
```

### Agent Spawning Decision

| Complexity | Strategy |
|-----------|----------|
| Simple (1-2 files) | Orchestrator handles directly |
| Medium (2-3 crates) | Orchestrator handles sequentially |
| Complex (4+ crates or cross-domain) | Spawn team agents in parallel |

### Available Team Agents

| Agent | Spawn When | Skill Reference |
|-------|-----------|-----------------|
| `rust-architect` | Multi-crate Rust changes | `prisma-rust.md` |
| `perf-engineer` | Hot path / performance work | `prisma-perf.md` |
| `security-engineer` | Protocol / crypto / detection | `prisma-security.md` |
| `ux-engineer` | GUI / dashboard / CLI UX | `prisma-ux.md` |
| `platform-engineer` | FFI / mobile / TUN / cross-platform | `prisma-platform.md` |
| `qa-engineer` | Test writing / coverage / CI | `prisma-qa.md` |
| `docs-engineer` | Documentation sync | `prisma-docs.md` |
| `feature-validator` | Post-implementation validation | (built-in) |

---

## 2. Execute

### Direct Execution Rules
1. **Read before writing** — always read existing code first
2. **Follow conventions** — patterns from `prisma-rust.md`
3. **Minimize blast radius** — change only what's needed
4. **Compile-check** — `cargo check -p <crate>` after each crate change
5. **Don't guess** — if uncertain, check the code or ask the user

### Cross-Crate Patterns

**Core → Server + Client:**
- Define shared types/traits in `prisma-core`
- Implement server-side in `prisma-server`
- Implement client-side in `prisma-client`
- Both use codec from `prisma-core/src/protocol/codec.rs`

**Server → Management API → Dashboard:**
- Add state to `ServerState` in `prisma-core/src/state.rs`
- Expose via handler in `prisma-mgmt/src/handlers/`
- Add route in `prisma-mgmt/src/router.rs`
- Consume in dashboard via TanStack Query

**Client → FFI → GUI/Mobile:**
- Add to `prisma-client`
- Expose via C ABI in `prisma-ffi/src/lib.rs`
- Call from Tauri command (GUI) or Swift/Kotlin (mobile)

---

## 3. Quality Gates

Run in order. Fix failures before proceeding.

```bash
cargo fmt --all
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo build --release --workspace
```

If frontend touched:
```bash
cd prisma-gui && npm run build && cd ..
cd prisma-console && npm run build && cd ..
```

---

## 4. Auto-Version Bump

| Change Type | Bump | Example |
|------------|------|---------|
| Bug fix, docs, small improvement | patch | 1.5.1 → 0.9.1 |
| New feature, non-breaking enhancement | minor | 1.5.1 → 0.10.0 |
| Breaking change (user-requested only) | major | 1.5.1 → 1.0.0 |

Files to update (per `prisma-workflow.md`):
- `Cargo.toml` (root) `workspace.package.version`
- `prisma-gui/src-tauri/tauri.conf.json` `version`
- `prisma-gui/package.json` `version`
- `prisma-gui/src-tauri/Cargo.toml` `package.version`

Then `cargo check --workspace` to update `Cargo.lock`.

---

## 5. Commit

Conventional commit format, NO co-author tags:
```
<type>(<scope>): <description>
```

Types: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `ci`, `perf`
Scopes: `core`, `server`, `client`, `cli`, `mgmt`, `ffi`, `gui`, `dashboard`, `mobile`, `docs`

Stage specific files. Include `Cargo.lock` if changed.

---

## 6. Self-Evolution

After completing each demand, check `.claude/skills/prisma-evolve.md` and:
1. Update skill files if new patterns were discovered
2. Update agent definitions if capabilities need expanding
3. Record findings in agent memory
4. Create new agents if a capability gap was found

---

## Demand Patterns

| Demand | Flow |
|--------|------|
| "add feature X" | Analyze → Plan → Execute → Tests → QG → bump minor → commit |
| "fix bug Y" | Reproduce → Root cause → Fix → Regression test → QG → bump patch → commit |
| "optimize Z" | Profile → Identify → Implement → Benchmark → QG → bump patch → commit |
| "release vX.Y.Z" | Full audit → Fix all → Bump → Sync docs → QG → commit → tag |
| "evolve the project" | Read memory → Audit → Prioritize → Implement top items → QG → bump → commit |
| "match competitor feature" | Competitive analysis → Adapt plan → Execute → QG → bump minor → commit |

---

## Competitive Context

| Competitor | Stack | Key Features |
|-----------|-------|-------------|
| xray-core | Go | VMess/VLESS/Trojan, XTLS-Vision, Reality, Splice |
| sing-box | Go | Multi-protocol, rule routing, Clash API |
| Clash Verge | Tauri | Profile management, rule editor, real-time traffic |
| v2rayN | C# WPF | Server management, routing, subscription |
| Shadowrocket | Swift | iOS one-tap connect, clean UX |
| v2rayNG | Kotlin | Android, subscription, routing |

**Prisma advantages**: Rust zero-cost abstractions, no GC, zero-copy relay, QUIC v2, Salamander, XPorta, integrated dashboard.
