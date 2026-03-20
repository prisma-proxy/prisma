---
description: "Project workflow: simplify changed code, test/format, bump versions across all packages, commit without co-author, pull & push with approval"
globs:
  - "**/*.rs"
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.json"
  - "**/Cargo.toml"
  - "**/package.json"
---

# Prisma Workflow Skill

You are a workflow automation subagent for the Prisma project. You handle code quality checks, version bumping, committing, and git sync operations.

## Available Commands

When the user invokes this skill, determine which workflow(s) they want from the sections below. You may run multiple workflows in sequence.

---

## 0. Simplify

Review changed code for reuse, quality, and efficiency, then fix any issues found. This runs as the first step in combined flows so that Test & Format catches anything the simplification touched.

### Steps

1. **Identify changed files** — get the list of staged and unstaged changes:
   ```bash
   git diff --name-only
   git diff --name-only --staged
   ```
   Scope the review to only these files.

2. **Review each changed file** for:
   - **Reuse** — is there an existing utility, hook, helper, or shared module that already does the same thing?
   - **Efficiency** — unnecessary clones/allocations, sequential I/O that could be parallel, expensive computations in hot paths or render loops
   - **Quality** — dead code, trivial wrappers adding indirection, stale imports, overly broad error handling

3. **Apply fixes** — make the improvements directly (don't just report them)

4. **Report** — summarize what was simplified (files touched, what changed, why)

### Project-Specific Checklist

#### Rust checks
- Duplicated helper logic across crates — extract to `prisma-core` or a shared module
- Unnecessary `Arc::clone()` — pass by reference where lifetime permits
- Redundant variable aliases before use
- Use `prisma_core::error::Result<T>` and `PrismaError` hierarchy, not ad-hoc error types
- Use existing utilities in `prisma-core/src/util.rs` (`hex_encode`, `hex_decode`, `compute_auth_token`, `ct_eq`)

#### TypeScript/React checks (prisma-gui)
- Duplicated logic already in `src/lib/utils.ts` (`downloadJson`, `downloadText`, `pickJsonFile`, `cn`)
- Duplicated logic already in `src/lib/format.ts` (`fmtBytes`, `fmtSpeed`, `fmtDuration`, `fmtRelativeTime`)
- Zustand store access: use `getState()` for non-reactive reads instead of subscribing to entire store
- Closures capturing props/state that cause unnecessary re-renders or stale values
- Sequential IPC/async calls that can be parallelized with `Promise.all()`
- Expensive computation on every render — move to `useMemo()` with correct deps
- Trivial wrapper functions adding indirection — pass callbacks directly
- Check all hooks in `src/hooks/` and stores in `src/store/` before writing new state logic

#### Dashboard checks (prisma-dashboard)
- Shared UI components in `src/components/ui/` — don't recreate existing ones

---

## 1. Test & Format

Run code quality checks across the workspace. Report results clearly — fix auto-fixable issues (formatting) and report errors for manual review.

### Rust (Cargo workspace)

```bash
# Format all Rust code (auto-fix)
cargo fmt --all

# Run clippy lints
cargo clippy --workspace --all-targets -- -D warnings

# Run all tests
cargo test --workspace
```

### Frontend (if changes touch prisma-dashboard or prisma-gui)

```bash
# Dashboard (Next.js)
cd prisma-dashboard && npm run lint && cd ..

# GUI (Vite + Tauri)
cd prisma-gui && npm run build && cd ..
```

### Execution order
1. `cargo fmt --all` — auto-fix formatting
2. `cargo clippy --workspace --all-targets` — lint (report errors, do not auto-fix)
3. `cargo test --workspace` — run tests
4. Frontend lint/build only if relevant files changed

Report a summary: pass/fail for each step, any errors to fix.

---

## 2. Version Bump

Update the version string across ALL version-bearing files in the project. The user provides the new version (e.g., `0.7.0`) or a semver shorthand (`major`, `minor`, or `patch`).

If the user provides a shorthand, calculate the new version from the current one:
- `patch`: `0.6.3` → `0.6.4`
- `minor`: `0.6.3` → `0.7.0`
- `major`: `0.6.3` → `1.0.0`

### Files to update

| File | Field | Format |
|------|-------|--------|
| `Cargo.toml` (workspace root) | `workspace.package.version` | `version = "X.Y.Z"` |
| `prisma-gui/src-tauri/tauri.conf.json` | `version` | `"version": "X.Y.Z"` |
| `prisma-gui/package.json` | `version` | `"version": "X.Y.Z"` |
| `prisma-dashboard/package.json` | `version` | `"version": "X.Y.Z"` |
| `prisma-gui/src-tauri/Cargo.toml` | `package.version` | `version = "X.Y.Z"` |

> Note: The 6 crate Cargo.toml files (`prisma-core`, `prisma-server`, `prisma-client`, `prisma-cli`, `prisma-mgmt`, `prisma-ffi`) inherit `version.workspace = true` from the root — no individual updates needed.
> Note: `prisma-docs/package.json` version is independent (`0.0.0`) and should NOT be bumped.

### Steps

1. Read the current version from `Cargo.toml` workspace root
2. Ask the user for the new version if not provided
3. Update all files listed above using the Edit tool
4. Run `cargo check --workspace` to verify the workspace still compiles
5. Stage the updated `Cargo.lock` (it changes automatically after `cargo check`):
   ```bash
   git add Cargo.lock
   ```
6. Report all files changed and old → new version
7. **Optional — Release tag:** If the user wants to trigger a release, create an annotated git tag:
   ```bash
   git tag -a v{version} -m "Release v{version}"
   ```
   The release CI triggers on `v*` tags. Only tag after the version bump commit is created.

---

## 3. Commit Changes

Create a git commit WITHOUT any Co-Authored-By or Claude Code attribution lines.

### Steps

1. Run `git status` to see what changed
2. Run `git diff --staged` and `git diff` to understand the changes
3. Stage relevant files with `git add <specific files>` (never `git add -A` blindly — exclude `.env`, credentials, large binaries). Include `Cargo.lock` if it changed (e.g., after version bumps or dependency changes).
4. Compose a concise commit message using **conventional commit** format:

   ```
   <type>(<scope>): <description>
   ```

   **Types:** `feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `ci`, `perf`
   **Scopes:** `gui`, `dashboard`, `cli`, `server`, `client`, `core`, `mgmt`, `ffi` (or omit for cross-cutting changes)

   Examples from this repo:
   - `feat(dashboard): bandwidth monitoring, speed test`
   - `fix(gui): infinite re-render loop, TS build errors`
   - `chore: update Cargo.lock and README`
   - `refactor(gui): simplify code reuse, fix efficiency issues`
5. Commit using:

```bash
git commit -m "$(cat <<'EOF'
<commit message here>
EOF
)"
```

**IMPORTANT:** Do NOT append any `Co-Authored-By`, `Generated with`, or similar attribution lines. The commit message should contain ONLY the change description.

6. Run `git status` to verify the commit succeeded

---

## 4. Git Pull & Push

Sync with the remote repository. Always ask for confirmation before pushing.

### Steps

1. Detect the current branch:
   ```bash
   git branch --show-current
   ```

2. Run `git status` to check for uncommitted changes. If there are uncommitted changes, warn the user and ask whether to commit first or stash.

3. Check if the branch has an upstream remote:
   ```bash
   git rev-parse --abbrev-ref @{upstream} 2>/dev/null
   ```
   If no upstream exists, skip the pull step and go straight to push (step 7).

4. Pull from remote with rebase:
   ```bash
   git pull --rebase origin <branch>
   ```

5. **If rebase conflicts occur:** Report the conflicting files and tell the user they can recover with:
   ```bash
   git rebase --abort
   ```
   Then **stop** — do NOT auto-resolve or continue.

6. Show what will be pushed:
   ```bash
   git log origin/<branch>..HEAD --oneline
   ```

7. **Ask the user for explicit approval** before pushing:
   > "Ready to push N commit(s) to origin/\<branch\>. Proceed? (yes/no)"

8. Only after the user confirms with "yes", push with `-u` to set upstream tracking:
   ```bash
   git push -u origin <branch>
   ```

9. Report success with the pushed commit(s)

---

## Combining Workflows

Common combined flows:

- **"test and commit"** → Run Test & Format → if all pass → Commit Changes
- **"simplify and commit"** → Simplify → Test & Format → Commit Changes
- **"bump version and push"** → Version Bump → Commit Changes → Git Pull & Push
- **"full release"** → Simplify → Test & Format → Version Bump → Commit → Pull & Push

Simplify runs before Test & Format so that linting/formatting catches anything the simplification touched. Always run Test & Format BEFORE committing if the user asks for a combined flow. Never push code that hasn't been tested.

---

## Integration with Other Skills

This workflow skill is the **final stage** in the agent pipeline. After other skills implement features:

| Preceding skill | This skill handles |
|----------------|-------------------|
| `prisma-orchestrator.md` → implementation complete | Simplify → Test & Format → Commit |
| `prisma-qa.md` → tests written | Test & Format (verify tests pass) → Commit |
| `prisma-docs.md` → docs synced | Commit docs changes |
| Any feature implementation | Simplify → Test & Format → Commit → Pull & Push |

The orchestrator invokes this skill as the last step. You do not need to invoke other skills — just handle build, test, commit, and git operations.
