import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFile } from "fs/promises";
import { join } from "path";

/** A version-bearing file definition. */
interface VersionFile {
  /** Relative path from workspace root. */
  relativePath: string;
  /** Human description. */
  label: string;
  /** Extract the version string from file contents. */
  extract: (content: string) => string | null;
}

const VERSION_FILES: VersionFile[] = [
  {
    relativePath: "Cargo.toml",
    label: "Root Cargo.toml (workspace.package.version)",
    extract: (content) => {
      const match = content.match(
        /\[workspace\.package\]\s[\s\S]*?version\s*=\s*"([^"]+)"/,
      );
      return match?.[1] ?? null;
    },
  },
  {
    relativePath: "prisma-gui/src-tauri/tauri.conf.json",
    label: "Tauri config (version)",
    extract: (content) => {
      try {
        const json = JSON.parse(content);
        return json.version ?? null;
      } catch {
        return null;
      }
    },
  },
  {
    relativePath: "prisma-gui/package.json",
    label: "GUI package.json (version)",
    extract: (content) => {
      try {
        const json = JSON.parse(content);
        return json.version ?? null;
      } catch {
        return null;
      }
    },
  },
  {
    relativePath: "prisma-gui/src-tauri/Cargo.toml",
    label: "Tauri Cargo.toml (package.version)",
    extract: (content) => {
      const match = content.match(
        /\[package\]\s[\s\S]*?version\s*=\s*"([^"]+)"/,
      );
      return match?.[1] ?? null;
    },
  },
];

export function registerVersionTools(
  server: McpServer,
  workspaceRoot: string,
) {
  // ── prisma_version ───────────────────────────────────────────────────────
  server.tool(
    "prisma_version",
    "Return the current workspace version from Cargo.toml and synchronization status of all version-bearing files",
    {},
    async () => {
      try {
        const fileResults = await readVersionFiles(workspaceRoot);
        const primaryVersion = fileResults[0]?.version ?? "unknown";

        let allInSync = true;
        const lines: string[] = [];

        lines.push(`# Prisma Version Status\n`);
        lines.push(`**Primary version**: \`${primaryVersion}\`\n`);
        lines.push(`| File | Version | Status |`);
        lines.push(`|------|---------|--------|`);

        for (const f of fileResults) {
          let status: string;
          if (f.error) {
            status = `File not found or unreadable`;
            allInSync = false;
          } else if (f.version === null) {
            status = `Could not extract version`;
            allInSync = false;
          } else if (f.version === primaryVersion) {
            status = `In sync`;
          } else {
            status = `**MISMATCH** (expected \`${primaryVersion}\`)`;
            allInSync = false;
          }
          lines.push(
            `| \`${f.relativePath}\` | \`${f.version ?? "N/A"}\` | ${status} |`,
          );
        }

        lines.push(``);
        if (allInSync) {
          lines.push(`**All version files are in sync.**`);
        } else {
          lines.push(
            `**WARNING**: Some version files are out of sync or unreadable. Run \`prisma_version_suggest\` for guidance.`,
          );
        }

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        return {
          content: [
            {
              type: "text" as const,
              text: `Error reading version files: ${msg}`,
            },
          ],
        };
      }
    },
  );

  // ── prisma_version_suggest ───────────────────────────────────────────────
  server.tool(
    "prisma_version_suggest",
    "Suggest the next version based on change type (patch/minor/major) and list all files that need updating",
    {
      change_type: z
        .enum(["patch", "minor", "major"])
        .describe("Type of version change"),
    },
    async ({ change_type }) => {
      try {
        const fileResults = await readVersionFiles(workspaceRoot);
        const currentVersion = fileResults[0]?.version ?? "0.0.0";

        const nextVersion = bumpVersion(currentVersion, change_type);

        const lines: string[] = [];
        lines.push(`# Version Bump Suggestion\n`);
        lines.push(`- **Current version**: \`${currentVersion}\``);
        lines.push(`- **Change type**: \`${change_type}\``);
        lines.push(`- **Suggested version**: \`${nextVersion}\`\n`);

        lines.push(`## Files to Update\n`);
        lines.push(`| File | Current | Action |`);
        lines.push(`|------|---------|--------|`);

        for (const f of fileResults) {
          const current = f.version ?? "N/A";
          let action: string;
          if (f.error) {
            action = "File missing -- create or skip";
          } else if (f.version === nextVersion) {
            action = "Already at target";
          } else {
            action = `Update \`${current}\` -> \`${nextVersion}\``;
          }
          lines.push(`| \`${f.relativePath}\` | \`${current}\` | ${action} |`);
        }

        lines.push(``);
        lines.push(`## Update Instructions\n`);
        lines.push(
          `1. **\`Cargo.toml\`** (root): Change \`version = "${currentVersion}"\` to \`version = "${nextVersion}"\` under \`[workspace.package]\``,
        );
        lines.push(
          `2. **\`prisma-gui/src-tauri/tauri.conf.json\`**: Change \`"version": "${currentVersion}"\` to \`"version": "${nextVersion}"\``,
        );
        lines.push(
          `3. **\`prisma-gui/package.json\`**: Change \`"version": "${currentVersion}"\` to \`"version": "${nextVersion}"\``,
        );
        lines.push(
          `4. **\`prisma-gui/src-tauri/Cargo.toml\`**: Change \`version = "${currentVersion}"\` to \`version = "${nextVersion}"\` under \`[package]\``,
        );
        lines.push(``);
        lines.push(
          `> After updating, run \`prisma_version\` to verify all files are in sync.`,
        );

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        return {
          content: [
            {
              type: "text" as const,
              text: `Error suggesting version: ${msg}`,
            },
          ],
        };
      }
    },
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

interface VersionFileResult {
  relativePath: string;
  label: string;
  version: string | null;
  error?: boolean;
}

async function readVersionFiles(
  workspaceRoot: string,
): Promise<VersionFileResult[]> {
  const results: VersionFileResult[] = [];

  for (const vf of VERSION_FILES) {
    const fullPath = join(workspaceRoot, vf.relativePath);
    try {
      const content = await readFile(fullPath, "utf-8");
      const version = vf.extract(content);
      results.push({
        relativePath: vf.relativePath,
        label: vf.label,
        version,
      });
    } catch {
      results.push({
        relativePath: vf.relativePath,
        label: vf.label,
        version: null,
        error: true,
      });
    }
  }

  return results;
}

function bumpVersion(
  version: string,
  change: "patch" | "minor" | "major",
): string {
  const parts = version.split(".").map(Number);
  const major = parts[0] ?? 0;
  const minor = parts[1] ?? 0;
  const patch = parts[2] ?? 0;

  switch (change) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
  }
}
