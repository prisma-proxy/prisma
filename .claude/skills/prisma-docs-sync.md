---
description: "Documentation sync: version references, README audit (CN/EN), CLAUDE.md accuracy, Docusaurus EN/CN parity"
globs:
  - "README.md"
  - "README_EN.md"
  - "CLAUDE.md"
  - "prisma-docs/docs/**/*.md"
  - "prisma-docs/i18n/zh-Hans/docusaurus-plugin-content-docs/current/**/*.md"
  - "prisma-gui/README.md"
  - "prisma-console/README.md"
  - "Cargo.toml"
  - "*/Cargo.toml"
  - "prisma-gui/package.json"
  - "prisma-gui/src-tauri/tauri.conf.json"
  - "prisma-gui/src-tauri/Cargo.toml"
---

# Prisma Docs Sync Skill

Documentation synchronization procedures for the Prisma project.

## Version Sync Rules

- `Cargo.toml` root `workspace.package.version` = **source of truth**
- Must match: `prisma-gui/package.json`, `prisma-gui/src-tauri/tauri.conf.json`, `prisma-gui/src-tauri/Cargo.toml`
- Must mention current version: `CLAUDE.md`, `.claude/skills/prisma-crate-map.md`
- `prisma-console/package.json` — **SEPARATE version, do NOT sync**
- `prisma-docs/package.json` — **FROZEN at 0.0.0, NEVER change**

---

## 1. Audit (Read-Only)

Scan all documentation and report what is out of sync:

1. Check version references across all files listed above
2. Compare `README.md` (CN) vs `README_EN.md`: features, transports, structure, install commands
3. Compare `CLAUDE.md` crate table against actual `[workspace.members]`
4. Check CLAUDE.md agent/skill references match actual files in `.claude/agents/` and `.claude/skills/`
5. Check Docusaurus EN/CN file parity
6. Report pass/fail checklist

---

## 2. README Sync (CN <-> EN)

1. Determine source of truth (check `git log` or ask user)
2. Sync feature bullets: `## 特性亮点` <-> `## Highlights`
3. Sync transport list (6 transports: QUIC v2, TCP, WebSocket, gRPC, XHTTP, XPorta)
4. Sync project structure tree
5. Sync install commands (byte-identical)
6. Verify language toggle at top of each file

---

## 3. CLAUDE.md Sync

1. Sync workspace version in opening line
2. Sync crate table against `[workspace.members]`
3. Verify build commands
4. Sync agent/skill tables against actual files

---

## 4. Docusaurus Sync

### EN <-> CN Translation
- **EN path:** `prisma-docs/docs/`
- **CN path:** `prisma-docs/i18n/zh-Hans/docusaurus-plugin-content-docs/current/`
- Every EN file must have a CN counterpart and vice versa
- Code blocks must be identical across languages
- Flag pairs with >20% line count difference

### Code <-> Docs
- CLI reference vs `Commands` enum in `prisma-cli/src/main.rs`
- Config docs vs `ServerConfig`/`ClientConfig` structs
- API docs vs routes in `prisma-mgmt/src/router.rs`
- Flag any documented feature missing from code or vice versa

---

## 5. Subsystem READMEs

- `prisma-gui/README.md` — features vs actual pages/hooks/stores, tech stack vs package.json
- `prisma-console/README.md` — pages vs routes, version stays at `1.3.0`

---

## Combining Workflows

| Request | Sections |
|---------|----------|
| "full docs sync" | 1 -> 2 -> 3 -> 4 -> 5 |
| "just READMEs" | 1 -> 2 -> 3 |
| "sync translations" | 1 -> 4 |
| "post-version-bump" | 1 -> 3 |
