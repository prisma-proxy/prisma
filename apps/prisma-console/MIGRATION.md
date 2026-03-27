# Prisma Console - Repository Migration Guide

Step-by-step guide for extracting `prisma-console` from the monorepo into its own repository.

## Prerequisites

- `git-filter-repo` installed (`pip install git-filter-repo`)
- Admin access to the `prisma-proxy` GitHub organization

## Steps

### 1. Create the new repository

Create `prisma-proxy/prisma-console` on GitHub (empty, no README/license/gitignore).

### 2. Extract from monorepo

```bash
# Clone a fresh copy of the monorepo (do NOT use your working copy)
git clone https://github.com/prisma-proxy/prisma.git prisma-console-extract
cd prisma-console-extract

# Extract just the console subdirectory, rewriting history
git filter-repo --subdirectory-filter apps/prisma-console/
```

This rewrites the repo so the root becomes what was inside `apps/prisma-console/`.

### 3. No submodule or Rust dependency needed

The console connects to `prisma-mgmt` exclusively via REST API. There are no Rust crate imports or monorepo-relative path dependencies.

### 4. Update next.config.ts

Check `next.config.ts` for any monorepo-relative paths and update if needed (unlikely since the console is self-contained).

### 5. Push to the new repository

```bash
git remote add origin https://github.com/prisma-proxy/prisma-console.git
git push -u origin main
```

### 6. Clean up the monorepo

```bash
# In your main monorepo working copy
git rm -r apps/prisma-console
```

Update the following monorepo files to remove console references:
- CI/CD workflows (`.github/workflows/`)
- Release scripts
- `CLAUDE.md` workspace layout table
- Version-sync agent configuration (`.claude/agents/version-sync`)
- Any root-level scripts that reference the console

### 7. Tag the first release

```bash
# In the new prisma-console repo
git tag v0.1.0
git push origin v0.1.0
```

This triggers the `release.yml` workflow which builds and publishes the static export.
