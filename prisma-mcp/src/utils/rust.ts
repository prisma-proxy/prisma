import * as path from "path";
import { findRsFiles, safeRead } from "./fs.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface TodoItem {
  file: string;
  line: number;
  type: "TODO" | "FIXME" | "HACK" | "WARN" | "XXX" | "SAFETY";
  text: string;
  crate: string;   // name of the containing workspace crate
}

export interface FfiExport {
  name: string;
  signature: string;
  file: string;
  line: number;
  doc: string;
}

export interface UnwrapLocation {
  file: string;
  line: number;
  context: string; // surrounding code
  inTest: boolean;
  crate: string;   // name of the containing workspace crate
}

export interface PublicItem {
  name: string;
  kind: "fn" | "struct" | "enum" | "trait" | "type" | "const" | "mod";
  file: string;
  line: number;
  hasDocComment: boolean;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/** Valid TODO-style comment tag types. */
const TODO_TAGS = ["TODO", "FIXME", "HACK", "WARN", "XXX", "SAFETY"] as const;
type TodoTag = (typeof TODO_TAGS)[number];

/**
 * Build a regex that matches any of the TODO-style tags in a comment context.
 * Captures: (1) the tag, (2) the trailing text.
 */
const TODO_PATTERN = new RegExp(
  `\\b(${TODO_TAGS.join("|")})\\b[:\\s]*(.*)`,
  "i",
);

/**
 * Extract surrounding lines of context around a given line index.
 * Returns at most `radius` lines above and below.
 */
function extractContext(lines: string[], lineIndex: number, radius = 2): string {
  const start = Math.max(0, lineIndex - radius);
  const end = Math.min(lines.length, lineIndex + radius + 1);
  return lines.slice(start, end).join("\n");
}

/**
 * Check whether a line at `lineIndex` falls inside a `#[cfg(test)]` block
 * or a `mod tests` module.
 *
 * This uses a simple heuristic: scan backwards from the line looking for
 * `#[cfg(test)]` or `mod tests` without encountering a closing brace that
 * would indicate the test module has already ended.
 */
function isInTestContext(lines: string[], lineIndex: number): boolean {
  let braceDepth = 0;
  for (let i = lineIndex; i >= 0; i--) {
    const trimmed = lines[i].trim();

    // Count braces to track scope
    for (const ch of trimmed) {
      if (ch === "}") braceDepth++;
      if (ch === "{") braceDepth--;
    }

    // If we've ascended out of the current block, check for test markers.
    if (/^#\[(tokio::)?test/.test(trimmed)) {
      return true;
    }
    if (/^#\[cfg\(test\)\]/.test(trimmed)) {
      return true;
    }
    if (/^\s*mod\s+tests\s*\{/.test(lines[i])) {
      return true;
    }

    // If we've gone above the enclosing block (brace depth < 0), check if
    // any ancestor scope is a test module.
    if (braceDepth < -1) {
      break;
    }
  }

  return false;
}

/**
 * Infer the workspace crate name from a file path.
 *
 * Given a path like `/workspace/prisma-core/src/lib.rs`, extracts
 * `prisma-core`.  Falls back to the file path itself if the crate
 * directory cannot be determined.
 */
function inferCrateName(filePath: string, workspaceRoot: string): string {
  const rel = path.relative(workspaceRoot, filePath);
  const first = rel.split(path.sep)[0];
  return first ?? path.basename(filePath);
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Scan `.rs` files in the workspace for TODO / FIXME / HACK / WARN / XXX /
 * SAFETY comments.
 *
 * @param workspaceRoot  Absolute path to the Rust workspace root.
 * @param crates         Optional list of crate directory names to limit the
 *                       search (e.g. `["prisma-core", "prisma-server"]`).
 *                       If omitted, all `.rs` files under `workspaceRoot` are
 *                       scanned.
 * @param markers        Optional list of marker types to match (e.g.
 *                       `["TODO", "FIXME"]`). If omitted, all known tags are
 *                       matched.
 */
export async function scanTodos(
  workspaceRoot: string,
  crates?: string[],
  markers?: string[],
): Promise<TodoItem[]> {
  // Determine directories to scan
  const dirsToScan: string[] = crates
    ? crates.map((c) => path.join(workspaceRoot, c))
    : [workspaceRoot];

  // Normalise requested markers to uppercase
  const wantedMarkers = markers
    ? new Set(markers.map((m) => m.toUpperCase()))
    : null; // null means all

  const results: TodoItem[] = [];

  for (const dir of dirsToScan) {
    const files = await findRsFiles(dir);

    for (const file of files) {
      const content = await safeRead(file);
      if (!content) continue;

      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Only look inside comments (// or /* ... */)
        const commentStart = line.indexOf("//");
        const blockCommentStart = line.indexOf("/*");
        const commentPos = commentStart >= 0 ? commentStart : blockCommentStart;
        if (commentPos < 0) continue;

        const commentText = line.slice(commentPos);
        const match = TODO_PATTERN.exec(commentText);
        if (!match) continue;

        const tag = match[1].toUpperCase() as TodoTag;
        if (!TODO_TAGS.includes(tag)) continue;
        if (wantedMarkers && !wantedMarkers.has(tag)) continue;

        const relativePath = path.relative(workspaceRoot, file);

        results.push({
          file: relativePath,
          line: i + 1,
          type: tag,
          text: match[2].trim(),
          crate: inferCrateName(file, workspaceRoot),
        });
      }
    }
  }

  return results;
}

/**
 * Extract all `#[no_mangle] pub extern "C"` functions (FFI exports) from a
 * directory tree.
 *
 * @param searchDir  The directory to scan (e.g. workspace root or a specific
 *                   crate's `src/` directory).
 */
export async function scanFfiExports(searchDir: string): Promise<FfiExport[]> {
  const files = await findRsFiles(searchDir);
  const results: FfiExport[] = [];

  for (const file of files) {
    if (file.includes(`${path.sep}target${path.sep}`)) continue;

    const content = await safeRead(file);
    if (!content) continue;

    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();

      // Look for `pub extern "C" fn` or `pub unsafe extern "C" fn`
      const externMatch = trimmed.match(
        /^pub\s+(unsafe\s+)?extern\s+"C"\s+fn\s+(\w+)/,
      );
      if (!externMatch) continue;

      const fnName = externMatch[2];

      // Check that #[no_mangle] appears somewhere above (within 5 lines)
      let hasNoMangle = false;
      for (let j = Math.max(0, i - 5); j < i; j++) {
        if (lines[j].trim().includes("#[no_mangle]")) {
          hasNoMangle = true;
          break;
        }
      }
      if (!hasNoMangle) continue;

      // Collect the full function signature up to the opening brace
      let signature = trimmed;
      let k = i + 1;
      while (k < lines.length && !signature.includes("{")) {
        signature += " " + lines[k].trim();
        k++;
      }
      // Strip the body — keep only up to (and including) the opening brace
      const braceIdx = signature.indexOf("{");
      if (braceIdx >= 0) {
        signature = signature.slice(0, braceIdx).trim();
      }

      // Collect preceding doc comments (/// lines)
      const docLines: string[] = [];
      for (let j = i - 1; j >= 0; j--) {
        const docTrimmed = lines[j].trim();
        if (docTrimmed.startsWith("///")) {
          docLines.unshift(docTrimmed.replace(/^\/\/\/\s?/, ""));
        } else if (docTrimmed.startsWith("#[")) {
          // skip attributes like #[no_mangle]
          continue;
        } else {
          break;
        }
      }

      results.push({
        name: fnName,
        signature,
        file,
        line: i + 1,
        doc: docLines.join("\n"),
      });
    }
  }

  return results;
}

/**
 * Find all `.unwrap()` calls in the workspace, along with context and whether
 * they appear inside test code.
 *
 * @param workspaceRoot  Absolute path to the Rust workspace root.
 * @param crates         Optional list of crate directory names to limit the
 *                       search. If omitted, all `.rs` files under
 *                       `workspaceRoot` are scanned.
 */
export async function scanUnwraps(
  workspaceRoot: string,
  crates?: string[],
): Promise<UnwrapLocation[]> {
  const dirsToScan: string[] = crates
    ? crates.map((c) => path.join(workspaceRoot, c))
    : [workspaceRoot];

  const results: UnwrapLocation[] = [];
  const unwrapPattern = /\.unwrap\(\)/;

  for (const dir of dirsToScan) {
    const files = await findRsFiles(dir);

    for (const file of files) {
      const content = await safeRead(file);
      if (!content) continue;

      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Skip comments
        const trimmed = line.trim();
        if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;

        if (!unwrapPattern.test(line)) continue;

        const inTest = isInTestContext(lines, i);

        const relativePath = path.relative(workspaceRoot, file);

        results.push({
          file: relativePath,
          line: i + 1,
          context: extractContext(lines, i, 2),
          inTest,
          crate: inferCrateName(file, workspaceRoot),
        });
      }
    }
  }

  return results;
}

/**
 * Scan a single crate directory for public items (`pub fn`, `pub struct`,
 * `pub enum`, `pub trait`, `pub type`, `pub const`, `pub mod`) and check
 * whether each has a preceding doc comment (`///` or `//!`).
 */
export async function scanPublicApi(cratePath: string): Promise<PublicItem[]> {
  const srcDir = path.join(cratePath, "src");
  const files = await findRsFiles(srcDir);
  const results: PublicItem[] = [];

  // Map of regex patterns to their corresponding item kinds
  const patterns: { pattern: RegExp; kind: PublicItem["kind"] }[] = [
    { pattern: /^pub(?:\s*\(crate\))?\s+(?:async\s+)?fn\s+(\w+)/, kind: "fn" },
    { pattern: /^pub(?:\s*\(crate\))?\s+struct\s+(\w+)/, kind: "struct" },
    { pattern: /^pub(?:\s*\(crate\))?\s+enum\s+(\w+)/, kind: "enum" },
    { pattern: /^pub(?:\s*\(crate\))?\s+trait\s+(\w+)/, kind: "trait" },
    { pattern: /^pub(?:\s*\(crate\))?\s+type\s+(\w+)/, kind: "type" },
    { pattern: /^pub(?:\s*\(crate\))?\s+const\s+(\w+)/, kind: "const" },
    { pattern: /^pub(?:\s*\(crate\))?\s+mod\s+(\w+)/, kind: "mod" },
  ];

  for (const file of files) {
    const content = await safeRead(file);
    if (!content) continue;

    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();

      for (const { pattern, kind } of patterns) {
        const match = trimmed.match(pattern);
        if (!match) continue;

        const name = match[1];

        // Check for doc comments above (/// or //!) — skip blank lines and
        // attributes (#[...]).
        let hasDocComment = false;
        for (let j = i - 1; j >= 0; j--) {
          const prev = lines[j].trim();
          if (prev.startsWith("///") || prev.startsWith("//!")) {
            hasDocComment = true;
            break;
          }
          if (prev.startsWith("#[") || prev === "") {
            // Attributes and blank lines are allowed between doc and item
            continue;
          }
          // Anything else means no doc comment directly above
          break;
        }

        results.push({
          name,
          kind,
          file,
          line: i + 1,
          hasDocComment,
        });

        // Only match the first pattern per line
        break;
      }
    }
  }

  return results;
}
