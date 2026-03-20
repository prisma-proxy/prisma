---
name: feature-validator
description: "Use this agent when you need to verify that features and functions work correctly, diagnose bugs, and fix issues. This includes validating network protocol connections, transport layers, crypto operations, and any other functional components. Use this agent after implementing new features, after refactoring, or when investigating reported bugs."
---

# Feature Validator Agent

You validate that Prisma features work correctly and catch common issues before they reach CI.

## Pre-Commit Checks (ALWAYS run these before committing)

### Rust
1. `cargo check --workspace` — must have zero errors
2. `cargo clippy --workspace --all-targets -- -D warnings` — must have zero warnings (CI uses `-D warnings` which turns warnings into errors)
3. `cargo fmt --all -- --check` — must be clean
4. `cargo test -p prisma-core --lib` — core tests must pass

### Common Rust Issues on CI (Rust stable, currently 1.94+)
- **Unused imports**: CI fails on any unused import with `-D warnings`. Always remove them.
- **needless_borrows_for_generic_args**: Don't use `&x` when `x` already implements the required trait. Use `x` directly. Common in `nix::sys::sendfile::splice()` calls.
- **large_enum_variant**: Box variants larger than 200 bytes. Use `Box<LargeType>`.
- **type_complexity**: Extract type aliases for complex nested types like `Pin<Box<dyn Future<...>>>`.
- **too_many_arguments**: Add `#[allow(clippy::too_many_arguments)]` only when args are semantically distinct.
- **Dead code in `#[cfg]` blocks**: Code gated behind `#[cfg(target_os = "linux")]` won't be checked on macOS. Always verify Linux-specific code compiles.
- **macro_rules! scope**: `macro_rules!` macros are only available to code that appears AFTER their definition in the same file. `mod` declarations that use them must come after.

### Frontend
1. `cd prisma-gui && npx tsc --noEmit` — TypeScript must compile
2. `cd prisma-console && npm run build` — Next.js must build

### Common Frontend Issues
- **zustand selector infinite loops**: Never call functions that create new objects inside `useStore()` selectors. Select raw state, derive outside.
- **i18n key mismatch**: en.json and zh-CN.json (GUI) or en.json and zh.json (console) must have identical key sets.

### Docs
1. `cd prisma-docs && npx docusaurus build` — both locales must build
2. Common issues:
   - MDX interprets `<` and `{` as JSX. Use `≤` instead of `<=` in prose, or put in code blocks.
   - Multi-instance plugins: guide at `/guide/`, dev at `/dev/`. Index pages need `slug: /`.
   - Broken links: all internal links must use correct paths for their instance.

### GitHub Actions / CI
- **Linux apt packages**: `libappindicator3-dev` conflicts with `libayatana-appindicator3-dev`. Tauri v2 only needs ayatana.
- **Android NDK**: `CC_*` and `AR_*` env vars must use lowercase target (`CC_aarch64_linux_android`), not uppercase. `CARGO_TARGET_*_LINKER` uses uppercase.
- **iOS builds**: Ensure `ffi_catch!` macro is defined before `mod ios;` declaration.
