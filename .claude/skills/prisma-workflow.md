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

User provides new version or semver shorthand (`major`, `minor`, `patch`).

| File | Field |
|------|-------|
| `Cargo.toml` (root) | `workspace.package.version` |
| `apps/prisma-gui/src-tauri/tauri.conf.json` | `version` |
| `apps/prisma-gui/package.json` | `version` |
| `apps/prisma-gui/src-tauri/Cargo.toml` | `package.version` |

The 6 crate Cargo.toml files inherit `version.workspace = true` — no individual updates needed.
`apps/prisma-console/package.json` is independent — do NOT sync.
`docs/package.json` is frozen at `0.0.0` — NEVER change.

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
