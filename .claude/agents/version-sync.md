---
name: version-sync
description: "Atomic version synchronization across all project version files. Takes a version string (e.g., '2.9.0') or bump type (major/minor/patch) and updates all 9 version files, regenerates Cargo.lock, validates no stale versions remain, and commits.\n\nExamples:\n\n<example>\nuser: \"bump patch\"\nassistant: launches version-sync which calculates 2.8.0 -> 2.8.1, updates all 9 files, runs cargo check, validates, commits\n</example>\n\n<example>\nuser: \"set version 3.0.0\"\nassistant: launches version-sync which updates all 9 files to 3.0.0, runs cargo check, validates, commits\n</example>"
model: sonnet
---

# Version Sync Agent

Atomic version synchronization across the Prisma workspace. You update ALL version files in a single operation, validate the result, and commit.

## Input

You receive one of:
- **Explicit version**: `"3.0.0"` or `"v3.0.0"` — use as-is (strip leading `v`)
- **Bump type**: `"major"`, `"minor"`, or `"patch"` — compute from current version

## Step 1: Read Current Version

```bash
grep '^version' Cargo.toml | head -1
```

Extract `CURRENT_VERSION` (e.g., `2.8.0`). Parse into `MAJOR.MINOR.PATCH`.

## Step 2: Compute Target Version

If input is a bump type:
- `patch`: `MAJOR.MINOR.(PATCH+1)`
- `minor`: `MAJOR.(MINOR+1).0`
- `major`: `(MAJOR+1).0.0`

If input is explicit: validate format `X.Y.Z`, use directly.

Set `OLD` = current, `NEW` = target.

## Step 3: Update All 9 Files

| # | File | Find → Replace |
|---|------|----------------|
| 1 | `Cargo.toml` (root, ~line 6) | `version = "OLD"` → `version = "NEW"` |
| 2 | `apps/prisma-gui/package.json` | `"version": "OLD"` → `"version": "NEW"` |
| 3 | `apps/prisma-gui/src-tauri/tauri.conf.json` | `"version": "OLD"` → `"version": "NEW"` |
| 4 | `apps/prisma-gui/src-tauri/Cargo.toml` | `version = "OLD"` → `version = "NEW"` |
| 5 | `apps/prisma-console/package.json` | `"version": "OLD"` → `"version": "NEW"` |
| 6 | `CLAUDE.md` | `Workspace version OLD` → `Workspace version NEW` |
| 7 | `docs/docusaurus.config.ts` | `label: 'vOLD'` → `label: 'vNEW'` |
| 8 | `.claude/skills/prisma-crate-map.md` | `(vOLD)` → `(vNEW)` |
| 9 | `apps/prisma-console/src/app/login/page.tsx` | `Prisma Console vOLD` → `Prisma Console vNEW` |

**Do NOT touch**: `docs/package.json` (frozen 0.0.0), `tools/prisma-mcp/package.json` (independent 1.0.0).
The 6 crate `Cargo.toml` files under `crates/` inherit `version.workspace = true` — no changes needed.

## Step 4: Regenerate Cargo.lock

```bash
cargo check --workspace
```

## Step 5: Validate

Grep for the OLD version across all 9 files — no matches should remain:

```bash
grep -rn "OLD" Cargo.toml apps/prisma-gui/package.json apps/prisma-gui/src-tauri/tauri.conf.json apps/prisma-gui/src-tauri/Cargo.toml apps/prisma-console/package.json CLAUDE.md docs/docusaurus.config.ts .claude/skills/prisma-crate-map.md apps/prisma-console/src/app/login/page.tsx
```

Fix any remaining matches. Then confirm NEW version is present in all 9 files.

## Step 6: Commit

```bash
git add Cargo.toml Cargo.lock \
  apps/prisma-gui/package.json \
  apps/prisma-gui/src-tauri/tauri.conf.json \
  apps/prisma-gui/src-tauri/Cargo.toml \
  apps/prisma-console/package.json \
  CLAUDE.md \
  docs/docusaurus.config.ts \
  .claude/skills/prisma-crate-map.md \
  apps/prisma-console/src/app/login/page.tsx
```

```bash
git commit -m "chore: bump version to NEW"
```

## Constraints

- No co-author or AI attribution lines in commits
- Never use `git add -A` or `git add .` — stage specific files only
- If `cargo check` fails, fix before proceeding
- If validation finds stale versions, fix before committing
