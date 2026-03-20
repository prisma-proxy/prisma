import * as fs from "fs/promises";
import * as path from "path";
import * as TOML from "toml";
import { findRsFiles, safeRead } from "./fs.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface WorkspaceInfo {
  version: string;
  edition: string;
  members: string[];
  dependencies: Record<string, unknown>;
}

export interface CrateInfo {
  name: string;
  path: string;
  version: string;
  dependencies: string[];
  sourceFiles: number;
  lineCount: number;
  testCount: number;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Safely read and parse a TOML file. Returns `null` if the file does not exist
 * or cannot be parsed.
 */
export async function readToml(filePath: string): Promise<Record<string, unknown> | null> {
  const content = await safeRead(filePath);
  if (content === null) return null;
  try {
    return TOML.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Gather source file count, total line count, and test count in a single pass.
 * Globs once, reads each file once.
 */
async function gatherSourceStats(dir: string): Promise<{ sourceFiles: number; lineCount: number; testCount: number }> {
  const files = await findRsFiles(dir);
  const testAttrPattern = /^\s*#\[(tokio::)?test/;
  let lineCount = 0;
  let testCount = 0;

  const contents = await Promise.all(files.map(f => safeRead(f)));
  for (const content of contents) {
    if (content === null) continue;
    const lines = content.split("\n");
    lineCount += lines.length;
    for (const line of lines) {
      if (testAttrPattern.test(line)) testCount++;
    }
  }

  return { sourceFiles: files.length, lineCount, testCount };
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse the workspace-level `Cargo.toml` and return high-level workspace
 * metadata (version, edition, member crate list, shared dependencies).
 */
export async function parseWorkspace(workspaceRoot: string): Promise<WorkspaceInfo> {
  const parsed = await readToml(path.join(workspaceRoot, "Cargo.toml"));

  if (!parsed) {
    return { version: "unknown", edition: "unknown", members: [], dependencies: {} };
  }

  const workspace = (parsed.workspace ?? {}) as Record<string, unknown>;
  const pkg = (workspace.package ?? {}) as Record<string, unknown>;
  const members = (workspace.members ?? []) as string[];
  const deps = (workspace.dependencies ?? {}) as Record<string, unknown>;

  return {
    version: typeof pkg.version === "string" ? pkg.version : "unknown",
    edition: typeof pkg.edition === "string" ? pkg.edition : "unknown",
    members,
    dependencies: deps,
  };
}

/**
 * Parse a single crate's `Cargo.toml` and gather metadata including source
 * file counts, line counts, and test counts.
 */
export async function parseCrate(cratePath: string): Promise<CrateInfo> {
  const parsed = await readToml(path.join(cratePath, "Cargo.toml"));

  if (!parsed) {
    return {
      name: path.basename(cratePath),
      path: cratePath,
      version: "unknown",
      dependencies: [],
      sourceFiles: 0,
      lineCount: 0,
      testCount: 0,
    };
  }

  const pkg = (parsed.package ?? {}) as Record<string, unknown>;

  let version = "unknown";
  const rawVersion = pkg.version;
  if (typeof rawVersion === "string") {
    version = rawVersion;
  } else if (
    rawVersion &&
    typeof rawVersion === "object" &&
    (rawVersion as Record<string, unknown>).workspace === true
  ) {
    version = "workspace";
  }

  const workspaceCrateDeps: string[] = [];
  const deps = (parsed.dependencies ?? {}) as Record<string, unknown>;
  for (const [depName, depValue] of Object.entries(deps)) {
    if (depValue && typeof depValue === "object") {
      const depObj = depValue as Record<string, unknown>;
      if (typeof depObj.path === "string" && depObj.path.includes("prisma-")) {
        workspaceCrateDeps.push(depName);
      }
    }
  }

  const stats = await gatherSourceStats(path.join(cratePath, "src"));

  return {
    name: typeof pkg.name === "string" ? pkg.name : path.basename(cratePath),
    path: cratePath,
    version,
    dependencies: workspaceCrateDeps,
    ...stats,
  };
}

/**
 * Parse every member crate in the workspace and return their metadata.
 */
export async function getAllCrates(workspaceRoot: string): Promise<CrateInfo[]> {
  const workspace = await parseWorkspace(workspaceRoot);

  const crates = await Promise.all(
    workspace.members.map(member => parseCrate(path.join(workspaceRoot, member)))
  );

  for (const crate of crates) {
    if (crate.version === "workspace") {
      crate.version = workspace.version;
    }
  }

  return crates;
}
