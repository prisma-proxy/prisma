---
description: "Docs & README synchronization: audit consistency, sync READMEs (CN/EN), update CLAUDE.md, sync Docusaurus site (EN↔CN, code↔docs), sync subsystem READMEs"
globs:
  - "README.md"
  - "README_EN.md"
  - "CLAUDE.md"
  - "prisma-docs/docs/**/*.md"
  - "prisma-docs/i18n/zh-Hans/docusaurus-plugin-content-docs/current/**/*.md"
  - "prisma-gui/README.md"
  - "prisma-dashboard/README.md"
  - "Cargo.toml"
  - "*/Cargo.toml"
  - "prisma-gui/package.json"
  - "prisma-gui/src-tauri/tauri.conf.json"
  - "prisma-gui/src-tauri/Cargo.toml"
  - "prisma-dashboard/package.json"
  - "prisma-docs/package.json"
---

# Prisma Docs & README Sync Skill

You are a documentation synchronization subagent for the Prisma project. You audit, compare, and sync documentation across READMEs, CLAUDE.md, Docusaurus docs, and subsystem READMEs.

> **Version Sync Rules**
>
> - `Cargo.toml` (workspace root) `workspace.package.version` = **source of truth**
> - `prisma-gui/package.json`, `prisma-gui/src-tauri/tauri.conf.json`, `prisma-gui/src-tauri/Cargo.toml` — must match workspace version
> - `CLAUDE.md`, `.claude/skills/prisma-rust.md` — must mention current version
> - `prisma-dashboard/package.json` (`2.0.0`) — **SEPARATE version, do NOT sync** with workspace
> - `prisma-docs/package.json` (`0.0.0`) — **FROZEN, NEVER change**

## Available Commands

When the user invokes this skill, determine which workflow(s) they want from the sections below. Always start with Audit (0) and end with Completion (5).

---

## 0. Audit (Read-Only Scan)

Scan all documentation and report what is out of sync **without modifying anything**.

### Steps

1. **Read workspace version** from `Cargo.toml` root (`workspace.package.version`)
2. **Check version references** across all files:
   - `Cargo.toml` root
   - `prisma-gui/package.json`
   - `prisma-gui/src-tauri/tauri.conf.json`
   - `prisma-gui/src-tauri/Cargo.toml`
   - `CLAUDE.md` opening line
   - `.claude/skills/prisma-rust.md` architecture overview
   - `prisma-dashboard/package.json` (expect `2.0.0`, independent)
   - `prisma-docs/package.json` (expect `0.0.0`, frozen)
3. **Compare README.md ↔ README_EN.md**:
   - Feature list bullet count (`## 特性亮点` vs `## Highlights`)
   - Transport list (6 transports: QUIC v2, TCP, WebSocket, gRPC, XHTTP, XPorta)
   - Project structure tree (9 directory entries)
   - Install commands (must be byte-identical)
   - Documentation links
   - Dev commands section
4. **Compare CLAUDE.md crate table** against both READMEs' project structure sections
5. **Check CLAUDE.md skill references** match actual files in `.claude/skills/`
6. **Compare Docusaurus EN ↔ CN docs**:
   - File parity (31 EN files in `prisma-docs/docs/`, 31 CN files in `prisma-docs/i18n/zh-Hans/docusaurus-plugin-content-docs/current/`)
   - Line count drift — flag any file pair with >20% difference
7. **Check CLI reference** — `Commands` enum in `prisma-cli/src/main.rs` vs `prisma-docs/docs/cli-reference.md`
8. **Check config docs** — `ServerConfig` in `prisma-core/src/config/server.rs` vs `prisma-docs/docs/configuration/server.md`, `ClientConfig` in `prisma-core/src/config/client.rs` vs `prisma-docs/docs/configuration/client.md`
9. **Check protocol version references** — "PrismaVeil v4" must be consistent across all docs
10. **Verify documentation link targets exist** — spot-check that referenced doc paths resolve
11. **Present findings** as a pass/fail checklist

---

## 1. README Sync (README.md ↔ README_EN.md)

Keep the Chinese and English root READMEs structurally identical.

### Steps

1. **Determine source of truth** — check `git log` to see which was edited more recently, or ask the user
2. **Sync feature bullets** — `## 特性亮点` ↔ `## Highlights` must have 1:1 matching items
3. **Sync transport list** — 6 transports: QUIC v2, TCP, WebSocket, gRPC, XHTTP, XPorta
4. **Sync project structure tree** — 9 directory entries with translated descriptions
5. **Sync install commands** — must be byte-identical between both files
6. **Sync documentation links** — same URLs, translated link text
7. **Sync dev commands section**
8. **Verify language toggle line** at top of each file points to the other

---

## 2. CLAUDE.md Sync

Keep CLAUDE.md accurate relative to actual project state.

### Steps

1. **Sync workspace version** in the opening line ("Workspace version X.Y.Z")
2. **Sync crate table** — compare `[workspace.members]` in `Cargo.toml` and each crate's `lib.rs`/`main.rs` doc comments against the CLAUDE.md `## Workspace Layout` table
3. **Verify build commands** — confirm the `## Key Commands` still work (quick syntax check, no full build)
4. **Sync skills section** — must list all files in `.claude/skills/` with accurate one-line descriptions
5. **Cross-check** crate descriptions against README project structure sections

---

## 3. Docusaurus Docs Sync

Two sub-tasks: translation sync and code-docs sync.

### 3A. English ↔ Chinese Translation Sync

**File inventory** (31 docs per language):
- Root: `introduction.md`, `installation.md`, `getting-started.md`, `cli-reference.md`, `troubleshooting.md` (5)
- Configuration: `server.md`, `client.md`, `environment-variables.md` (3)
- Features: `anti-detection.md`, `benchmarks.md`, `camouflage.md`, `dashboard.md`, `gui-clients.md`, `http-connect-proxy.md`, `management-api.md`, `port-forwarding.md`, `prisma-tls.md`, `prismaudp.md`, `routing-rules.md`, `socks5-proxy.md`, `traffic-shaping.md`, `tun-mode.md`, `xhttp-transport.md`, `xporta-transport.md` (14)
- Deployment: `cloudflare-cdn.md`, `config-examples.md`, `docker.md`, `linux-systemd.md` (4)
- Security: `anti-replay-padding.md`, `cryptography.md`, `prismaveil-protocol.md` (3)

**EN path:** `prisma-docs/docs/`
**CN path:** `prisma-docs/i18n/zh-Hans/docusaurus-plugin-content-docs/current/`

#### Steps

1. **Check file parity** — every EN file must have a CN counterpart and vice versa
2. **Check content parity** for each pair:
   - Frontmatter (`sidebar_position`, `sidebar_label`, `title`) — structure must match, values translated
   - Heading structure (same `##`/`###` hierarchy)
   - Code blocks — must be identical (code is not translated)
   - Tables — same structure, content translated
   - Links — same targets, link text translated
3. **Detect drift** — compare line counts; flag pairs with >20% difference
4. **Fix drift** — translate missing/changed content. Ask user which is source of truth if unclear
5. **Report** per-file status

### 3B. Code ↔ Docs Sync

Verify documentation matches actual code. Key mappings:

| Doc file | Source file(s) |
|----------|---------------|
| `cli-reference.md` | `prisma-cli/src/main.rs` (`Commands` enum) |
| `configuration/server.md` | `prisma-core/src/config/server.rs` (`ServerConfig`) |
| `configuration/client.md` | `prisma-core/src/config/client.rs` (`ClientConfig`) |
| `configuration/environment-variables.md` | grep for `std::env::var` across workspace |
| `features/management-api.md` | `prisma-mgmt/src/router.rs` (route definitions) |
| `features/socks5-proxy.md` | `prisma-client/src/socks5.rs` |
| `features/http-connect-proxy.md` | `prisma-client/src/http_proxy.rs` |
| `features/tun-mode.md` | `prisma-client/src/tun/` |
| `features/routing-rules.md` | `prisma-core/src/routing/` |
| `features/traffic-shaping.md` | `prisma-core/src/bandwidth/` |
| `features/camouflage.md` | `prisma-server/src/camouflage/` |
| `features/anti-detection.md` | `prisma-core/src/protocol/` |
| `features/prisma-tls.md` | `prisma-core/src/crypto/` |
| `features/prismaudp.md` | `prisma-core/src/protocol/udp.rs` |
| `features/xhttp-transport.md` | `prisma-server/src/transport/xhttp.rs` |
| `features/xporta-transport.md` | `prisma-server/src/transport/xporta.rs` |
| `features/port-forwarding.md` | `prisma-server/src/relay/` |
| `features/dashboard.md` | `prisma-dashboard/` |
| `features/gui-clients.md` | `prisma-gui/`, `prisma-ffi/` |
| `features/benchmarks.md` | benchmark results (informational, no direct source) |
| `security/prismaveil-protocol.md` | `prisma-core/src/protocol/` |
| `security/cryptography.md` | `prisma-core/src/crypto/` |
| `security/anti-replay-padding.md` | `prisma-core/src/protocol/padding.rs` |
| `deployment/docker.md` | `Dockerfile`, `docker-compose.yml` |
| `deployment/linux-systemd.md` | systemd unit files |
| `deployment/cloudflare-cdn.md` | deployment guide (informational) |
| `deployment/config-examples.md` | example config files |

#### Steps

1. For each mapping, read the source file and the doc file
2. Check that documented CLI commands match actual `Commands` enum variants
3. Check that documented config fields match actual struct fields (names, types, defaults)
4. Check that documented API endpoints match actual routes
5. Flag any documented feature that doesn't exist in code, or code feature missing from docs
6. Report per-mapping status

---

## 4. Subsystem README Sync

Keep `prisma-gui/README.md` and `prisma-dashboard/README.md` accurate.

### prisma-gui/README.md

1. **Features list** — compare against actual pages in `prisma-gui/src/pages/`, hooks in `src/hooks/`, stores in `src/store/`
2. **Keyboard shortcuts table** — compare against actual keybinding hook implementation
3. **Architecture tree** — compare against actual `prisma-gui/src/` directory structure
4. **Tech stack versions** — compare against `prisma-gui/package.json` dependencies
5. **Prerequisites** — verify listed tool versions are still accurate

### prisma-dashboard/README.md

1. **Pages table** — compare against actual routes in `prisma-dashboard/src/app/`
2. **Tech stack** — compare against `prisma-dashboard/package.json` dependencies
3. **Build commands** — verify documented commands work
4. **Server config TOML snippet** — compare against actual `ServerConfig` struct fields for management API
5. **Version** — must stay at `2.0.0` (independent from workspace)

---

## 5. Completion Checklist

Run this after any sync operation to verify everything is consistent.

### Checks

1. **Version consistency** — 8 files checked:
   - `Cargo.toml` root (source of truth)
   - `prisma-gui/package.json` (matches workspace)
   - `prisma-gui/src-tauri/tauri.conf.json` (matches workspace)
   - `prisma-gui/src-tauri/Cargo.toml` (matches workspace)
   - `CLAUDE.md` (mentions current version)
   - `.claude/skills/prisma-rust.md` (mentions current version)
   - `prisma-dashboard/package.json` (independent: `2.0.0`)
   - `prisma-docs/package.json` (frozen: `0.0.0`)
2. **README parity** — 6 checks: features, transports, structure, install, links, dev commands
3. **CLAUDE.md accuracy** — 3 checks: version, crate table, skills list
4. **Docusaurus completeness** — 31 EN + 31 CN files, frontmatter match
5. **No broken links** — spot-check that referenced doc paths exist
6. **Report** pass/fail to user

---

## Combining Workflows

| User request | Sections |
|-------------|----------|
| **"full docs sync"** | 0 → 1 → 2 → 3 → 4 → 5 |
| **"just READMEs"** | 0 → 1 → 2 → 5 |
| **"sync translations"** | 0 → 3A → 5 |
| **"sync code docs"** | 0 → 3B → 5 |
| **"post-version-bump docs"** | 0 → 2 → 5 |
| **"post-feature-add docs"** | 0 → 1 → 2 → 3B → 3A → 4 → 5 |

Always start with Audit (0), always end with Completion (5).
