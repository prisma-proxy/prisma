# Prisma Docs - Repository Migration Guide

Step-by-step guide for extracting `prisma-docs` from the monorepo into its own repository.

## Prerequisites

- `git-filter-repo` installed (`pip install git-filter-repo`)
- Admin access to the `prisma-proxy` GitHub organization

## Steps

### 1. Create the new repository

Create `prisma-proxy/prisma-docs` on GitHub (empty, no README/license/gitignore).

### 2. Extract from monorepo

```bash
# Clone a fresh copy of the monorepo (do NOT use your working copy)
git clone https://github.com/prisma-proxy/prisma.git prisma-docs-extract
cd prisma-docs-extract

# Extract just the docs subdirectory, rewriting history
git filter-repo --subdirectory-filter docs/
```

This rewrites the repo so the root becomes what was inside `docs/`.

### 3. No Rust dependencies needed

The docs site is pure Docusaurus -- no Rust crate imports or build-time dependencies on the monorepo.

### 4. Update docusaurus.config.ts

Review `docusaurus.config.ts` and update `url` and `baseUrl` if needed to match the new deployment target (e.g., GitHub Pages URL).

### 5. Enable GitHub Pages

In the new repo's Settings > Pages:
- Source: GitHub Actions
- The `deploy.yml` workflow handles build and deployment automatically.

### 6. Push and verify

```bash
git remote add origin https://github.com/prisma-proxy/prisma-docs.git
git push -u origin main
```

After push, the deploy workflow runs automatically. Verify the site is live at the Pages URL.

### 7. Clean up the monorepo

```bash
# In your main monorepo working copy
git rm -r docs
```

Update the following monorepo files to remove docs references:
- CI/CD workflows (`.github/workflows/`)
- `CLAUDE.md` workspace layout table
- Version-sync agent configuration (`.claude/agents/version-sync`)
- Any root-level scripts that reference docs
