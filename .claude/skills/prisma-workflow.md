---
description: "Project workflow: simplify changed code, test/format, bump versions across all packages, commit without co-author"
globs:
  - "**/*.rs"
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.json"
  - "**/Cargo.toml"
  - "**/package.json"
---

# Prisma Workflow Skill

Shared procedures for code quality, version bumping, and committing.

---

## 0. Simplify

Review changed code for reuse, quality, and efficiency, then fix issues.

1. Get changed files: `git diff --name-only` + `git diff --name-only --staged`
2. Review each file for:
   - **Reuse** — existing utility/helper that does the same thing?
   - **Efficiency** — unnecessary clones, sequential I/O that could be parallel
   - **Quality** — dead code, stale imports, overly broad error handling
3. Apply fixes directly
4. Summarize what was simplified

### Rust checks
- Duplicated logic across crates — extract to `prisma-core`
- Unnecessary `Arc::clone()` — pass by reference where lifetime permits
- Use `prisma_core::error::Result<T>` and `PrismaError`, not ad-hoc errors
- Use existing utilities in `prisma-core/src/util.rs`

### TypeScript checks (prisma-gui)
- Duplicated logic in `src/lib/utils.ts` or `src/lib/format.ts`
- Zustand: use `getState()` for non-reactive reads
- Sequential IPC calls that can use `Promise.all()`
- Expensive computation on every render — use `useMemo()`

---

## 1. Test & Format

```bash
cargo fmt --all
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

If frontend changed:
```bash
cd prisma-gui && npm run build && cd ..
cd prisma-console && npm run build && cd ..
```

---

## 2. Version Bump

Update version across ALL version-bearing files. User provides new version or semver shorthand (`major`, `minor`, `patch`).

### Files to update

| File | Field |
|------|-------|
| `Cargo.toml` (root) | `workspace.package.version` |
| `prisma-gui/src-tauri/tauri.conf.json` | `version` |
| `prisma-gui/package.json` | `version` |
| `prisma-gui/src-tauri/Cargo.toml` | `package.version` |

> The 6 crate Cargo.toml files inherit `version.workspace = true` — no individual updates needed.
> `prisma-console/package.json` version is independent — do NOT sync.
> `prisma-docs/package.json` is frozen at `0.0.0` — NEVER change.

### Steps
1. Read current version from `Cargo.toml` root
2. Update all files listed above
3. Run `cargo check --workspace` to update Cargo.lock
4. Stage `Cargo.lock`

---

## 3. Commit

Conventional commit format, **NO co-author or AI attribution lines**:
```
<type>(<scope>): <description>
```

**Types:** `feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `ci`, `perf`
**Scopes:** `core`, `server`, `client`, `cli`, `mgmt`, `ffi`, `gui`, `dashboard` (or omit for cross-cutting)

Steps:
1. `git status` to see changes
2. Stage specific files with `git add <files>` (never `git add -A`)
3. Include `Cargo.lock` if it changed
4. Commit:
```bash
git commit -m "$(cat <<'EOF'
<commit message here>
EOF
)"
```

---

## 4. Git Pull & Push

1. `git branch --show-current`
2. Check for uncommitted changes — warn if any
3. `git pull --rebase origin <branch>` (skip if no upstream)
4. If rebase conflicts: report and stop — do NOT auto-resolve
5. Show what will be pushed: `git log origin/<branch>..HEAD --oneline`
6. **Ask user for approval before pushing**
7. `git push -u origin <branch>`

---

## Combining Workflows

- **"test and commit"** -> Test & Format -> Commit
- **"simplify and commit"** -> Simplify -> Test & Format -> Commit
- **"bump and push"** -> Version Bump -> Commit -> Pull & Push
- **"full release"** -> Simplify -> Test & Format -> Version Bump -> Commit -> Pull & Push
