import * as fs from "fs/promises";
import * as path from "path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getAllCrates, parseWorkspace, CrateInfo } from "../utils/cargo.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Check whether a directory exists on disk.
 */
async function dirExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Build an ASCII dependency graph showing crate relationships.
 *
 * Higher-level crates (more dependencies) appear first; leaf crates appear
 * last.  Each crate lists its workspace-internal dependencies with tree
 * connectors.
 */
function buildDependencyGraph(crates: CrateInfo[]): string {
  // Build adjacency map
  const depMap: Record<string, string[]> = {};
  for (const c of crates) {
    depMap[c.name] = c.dependencies;
  }

  // Compute depth (max dependency chain length) for ordering
  const depths: Record<string, number> = {};
  function getDepth(name: string, visited: Set<string> = new Set()): number {
    if (depths[name] !== undefined) return depths[name];
    if (visited.has(name)) return 0;
    visited.add(name);
    const deps = depMap[name] ?? [];
    const maxChild =
      deps.length === 0
        ? 0
        : Math.max(...deps.map((d) => getDepth(d, new Set(visited)) + 1));
    depths[name] = maxChild;
    return maxChild;
  }

  for (const name of Object.keys(depMap)) {
    getDepth(name);
  }

  const sorted = Object.keys(depMap).sort(
    (a, b) => (depths[b] ?? 0) - (depths[a] ?? 0),
  );

  let graph = "";
  for (const name of sorted) {
    const deps = depMap[name] ?? [];
    if (deps.length === 0) {
      graph += `  ${name} (leaf)\n`;
    } else {
      graph += `  ${name}\n`;
      for (let i = 0; i < deps.length; i++) {
        const isLast = i === deps.length - 1;
        const connector = isLast ? "└── " : "├── ";
        graph += `    ${connector}${deps[i]}\n`;
      }
    }
  }

  return graph;
}

/**
 * Build a markdown table summarising per-crate statistics.
 */
function buildCrateTable(crates: CrateInfo[]): string {
  let table = "| Crate | Lines | Source Files | Tests | Dependencies |\n";
  table += "|-------|------:|-------------:|------:|-------------:|\n";

  let totalLines = 0;
  let totalFiles = 0;
  let totalTests = 0;
  let totalDeps = 0;

  for (const c of crates) {
    totalLines += c.lineCount;
    totalFiles += c.sourceFiles;
    totalTests += c.testCount;
    totalDeps += c.dependencies.length;

    table +=
      `| \`${c.name}\` ` +
      `| ${c.lineCount.toLocaleString()} ` +
      `| ${c.sourceFiles} ` +
      `| ${c.testCount} ` +
      `| ${c.dependencies.length} |\n`;
  }

  table +=
    `| **Total** ` +
    `| **${totalLines.toLocaleString()}** ` +
    `| **${totalFiles}** ` +
    `| **${totalTests}** ` +
    `| **${totalDeps}** |\n`;

  return table;
}

/**
 * Format the complete architecture markdown document.
 */
async function formatArchitecture(
  workspaceRoot: string,
  crates: CrateInfo[],
): Promise<string> {
  const workspace = await parseWorkspace(workspaceRoot);

  const sections: string[] = [];

  // ── Header ──────────────────────────────────────────────────────────────
  sections.push(
    `# Prisma Workspace Architecture\n\n` +
      `**Workspace version**: ${workspace.version}  \n` +
      `**Rust edition**: ${workspace.edition}  \n` +
      `**Crate count**: ${crates.length}`,
  );

  // ── Dependency graph ────────────────────────────────────────────────────
  sections.push(
    `## Dependency Graph\n\n` +
      "```\n" +
      buildDependencyGraph(crates) +
      "```",
  );

  // ── Crate statistics table ──────────────────────────────────────────────
  sections.push(`## Crate Statistics\n\n` + buildCrateTable(crates));

  // ── Crate roles ─────────────────────────────────────────────────────────
  const roles: Record<string, string> = {
    "prisma-core":
      "Shared library: crypto, protocol (PrismaVeil v5), config, types, bandwidth, DNS, routing",
    "prisma-server":
      "Server binary: listeners (TCP/QUIC/WS/gRPC/XHTTP/XPorta), relay, auth, camouflage",
    "prisma-client":
      "Client library: SOCKS5/HTTP inbound, transport selection, TUN, connection pool",
    "prisma-cli":
      "CLI binary (clap 4): server/client runners, management commands, web console",
    "prisma-mgmt":
      "Management API (axum): REST + WebSocket endpoints, auth middleware",
    "prisma-ffi":
      "C FFI shared library for GUI/mobile: lifecycle, profiles, QR, system proxy, auto-update",
  };

  let roleSection = `## Crate Roles\n\n`;
  for (const c of crates) {
    const role = roles[c.name] ?? "No description available";
    roleSection += `- **\`${c.name}\`** -- ${role}\n`;
  }
  sections.push(roleSection);

  // ── Frontends ───────────────────────────────────────────────────────────
  const frontends: Array<{ name: string; dir: string; description: string }> =
    [];

  const guiDir = path.join(workspaceRoot, "apps", "prisma-gui");
  if (await dirExists(guiDir)) {
    frontends.push({
      name: "prisma-gui",
      dir: guiDir,
      description: "Desktop GUI (Tauri + React)",
    });
  }

  const consoleDir = path.join(workspaceRoot, "apps", "prisma-console");
  if (await dirExists(consoleDir)) {
    frontends.push({
      name: "prisma-console",
      dir: consoleDir,
      description: "Web management console (Next.js)",
    });
  }

  if (frontends.length > 0) {
    let frontendSection = `## Frontends\n\n`;
    for (const f of frontends) {
      frontendSection += `- **\`${f.name}\`** -- ${f.description} (\`${path.relative(workspaceRoot, f.dir)}\`)\n`;
    }
    sections.push(frontendSection);
  }

  // ── Mobile apps ─────────────────────────────────────────────────────────
  const mobileApps: Array<{
    name: string;
    dir: string;
    description: string;
  }> = [];

  const iosDir = path.join(workspaceRoot, "prisma-mobile", "ios");
  if (await dirExists(iosDir)) {
    mobileApps.push({
      name: "prisma-mobile/ios",
      dir: iosDir,
      description: "iOS app (Swift + prisma-ffi)",
    });
  }

  const androidDir = path.join(workspaceRoot, "prisma-mobile", "android");
  if (await dirExists(androidDir)) {
    mobileApps.push({
      name: "prisma-mobile/android",
      dir: androidDir,
      description: "Android app (Kotlin + prisma-ffi)",
    });
  }

  if (mobileApps.length > 0) {
    let mobileSection = `## Mobile Apps\n\n`;
    for (const m of mobileApps) {
      mobileSection += `- **\`${m.name}\`** -- ${m.description} (\`${path.relative(workspaceRoot, m.dir)}\`)\n`;
    }
    sections.push(mobileSection);
  }

  // ── Workspace-level dependencies ────────────────────────────────────────
  const depNames = Object.keys(workspace.dependencies);
  if (depNames.length > 0) {
    sections.push(
      `## Workspace Dependencies\n\n` +
        `${depNames.length} shared dependencies declared in root \`Cargo.toml\`:\n\n` +
        depNames.map((d) => `\`${d}\``).join(", "),
    );
  }

  return sections.join("\n\n---\n\n");
}

// ── Registration ─────────────────────────────────────────────────────────────

export function registerArchitectureResource(
  server: McpServer,
  workspaceRoot: string,
) {
  server.resource(
    "architecture",
    "prisma://architecture",
    {
      description:
        "Live Prisma workspace architecture: crate dependency graph, line counts, test counts, and API surface",
    },
    async (uri) => {
      const crates = await getAllCrates(workspaceRoot);
      const text = await formatArchitecture(workspaceRoot, crates);

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/markdown",
            text,
          },
        ],
      };
    },
  );
}
