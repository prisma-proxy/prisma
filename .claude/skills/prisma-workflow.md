---
description: "Project workflow: quality gates, version bump, commit, git push — single source of truth for all agents"
globs:
  - "**/*.rs"
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.json"
  - "**/Cargo.toml"
  - "**/package.json"
---

# Prisma Workflow

Single source of truth for quality gates, version bumping, and committing. All agents reference this skill.

## Quality Gates

Run in order. Fix failures before proceeding.

```bash
cargo fmt --all
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

If frontend changed:
```bash
cd apps/prisma-gui && npm run build && cd ../..
cd apps/prisma-console && npm run build && cd ../..
```

## Version Bump

Auto-determine bump type from conventional commit type:

| Commit type | Bump |
|-------------|------|
| `feat` | **minor** |
| `fix`, `perf`, `refactor` | **patch** |
| `BREAKING CHANGE` or `!:` in message | **major** |
| `docs`, `test`, `ci`, `chore` | **no bump** |

When a task produces multiple changes, use the highest-priority bump across all accumulated changes (major > minor > patch > none).

### Synced files (all 10)

| # | File | Field |
|---|------|-------|
| 1 | `Cargo.toml` (root) | `workspace.package.version` |
| 2 | `apps/prisma-gui/package.json` | `version` |
| 3 | `apps/prisma-gui/src-tauri/tauri.conf.json` | `version` |
| 4 | `apps/prisma-gui/src-tauri/Cargo.toml` | `package.version` |
| 5 | `apps/prisma-console/package.json` | `version` |
| 6 | `CLAUDE.md` | "Workspace version X.Y.Z" |
| 7 | `docs/docusaurus.config.ts` | version label |
| 8 | `tools/prisma-mcp/src/tools/evolution.ts` | competitive matrix version |
| 9 | `apps/prisma-console/src/components/layout/sidebar.tsx` | fallback version |
| 10 | `.claude/skills/prisma-crate-map.md` | header version |

The 6 crate Cargo.toml files inherit `version.workspace = true` — no individual updates needed.

**Do NOT touch:** `docs/package.json` (frozen 0.0.0), `tools/prisma-mcp/package.json` (independent).

### Validation

After bumping, grep for the old version across all synced files to confirm nothing was missed:

```bash
grep -rn "OLD_VERSION" Cargo.toml apps/prisma-gui/package.json apps/prisma-gui/src-tauri/tauri.conf.json apps/prisma-gui/src-tauri/Cargo.toml apps/prisma-console/package.json CLAUDE.md docs/docusaurus.config.ts tools/prisma-mcp/src/tools/evolution.ts apps/prisma-console/src/components/layout/sidebar.tsx .claude/skills/prisma-crate-map.md
```

If any match remains, fix it before proceeding.

After updating: `cargo check --workspace` to regenerate Cargo.lock, then stage it.

## Commit

Conventional commit format. **NO co-author or AI attribution lines.**

```
<type>(<scope>): <description>
```

**Types:** `feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `ci`, `perf`
**Scopes:** `core`, `server`, `client`, `cli`, `mgmt`, `ffi`, `gui`, `dashboard` (or omit for cross-cutting)

Stage specific files (never `git add -A`). Include `Cargo.lock` if it changed.

```bash
git commit -m "$(cat <<'EOF'
<commit message here>
EOF
)"
```

## Git Push

1. Check for uncommitted changes — warn if any
2. `git pull --rebase origin <branch>` (skip if no upstream)
3. If rebase conflicts: report and **stop**
4. Show what will be pushed
5. **Ask user for approval before pushing**
6. `git push -u origin <branch>`
