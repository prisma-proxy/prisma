---
description: "Documentation sync: README audit (CN/EN), CLAUDE.md accuracy, Docusaurus EN/CN parity, code-docs consistency"
globs:
  - "README.md"
  - "README_CN.md"
  - "CLAUDE.md"
  - "docs/docs/**/*.md"
  - "docs/i18n/zh-Hans/docusaurus-plugin-content-docs/current/**/*.md"
  - "apps/prisma-gui/README.md"
  - "apps/prisma-console/README.md"
---

# Prisma Docs Sync

Procedures for keeping documentation in sync with code. Version sync rules live in `prisma-workflow.md`.

## README Sync (CN <-> EN)

1. Determine source of truth (`git log` or ask user)
2. Sync feature bullets: `## 特性亮点` <-> `## Highlights` (1:1 match)
3. Sync transport list, project structure tree, install commands (byte-identical)
4. Verify language toggle at top of each file

## CLAUDE.md Sync

1. Version in opening line matches `Cargo.toml` root
2. Crate table matches `[workspace.members]`
3. Agent/skill tables match actual files in `.claude/agents/` and `.claude/skills/`

## Docusaurus Sync

**EN:** `docs/docs/` | **CN:** `docs/i18n/zh-Hans/docusaurus-plugin-content-docs/current/`

- Every EN file must have a CN counterpart and vice versa
- Code blocks must be identical across languages
- Flag pairs with >20% line count difference

### Code <-> Docs
- CLI reference vs `Commands` enum in `crates/prisma-cli/src/main.rs`
- Config docs vs `ServerConfig`/`ClientConfig` structs
- API docs vs routes in `crates/prisma-mgmt/src/router.rs`

## Subsystem READMEs

- `apps/prisma-gui/README.md` — features vs actual pages/hooks/stores
- `apps/prisma-console/README.md` — pages vs routes, version stays independent
