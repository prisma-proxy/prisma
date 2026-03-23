import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";
import { getAllCrates } from "../utils/cargo.js";

const exec = promisify(execFile);

const CARGO_TIMEOUT = 120_000; // 120 seconds

export function registerWorkspaceTools(
  server: McpServer,
  workspaceRoot: string,
) {
  // ── prisma_build_status ──────────────────────────────────────────────────
  server.tool(
    "prisma_build_status",
    "Run cargo check, clippy, or test on the workspace and return compilation status, warnings, and errors",
    {
      check: z
        .enum(["check", "clippy", "test", "all"])
        .optional()
        .default("check")
        .describe("Which check to run: check, clippy, test, or all"),
    },
    async ({ check }) => {
      const checks =
        check === "all" ? ["check", "clippy", "test"] : [check ?? "check"];
      const results: string[] = [];

      for (const mode of checks) {
        try {
          const args = buildCargoArgs(mode);
          const { stdout, stderr } = await exec("cargo", args, {
            cwd: workspaceRoot,
            timeout: CARGO_TIMEOUT,
            maxBuffer: 10 * 1024 * 1024,
          });

          const parsed = parseCargoOutput(mode, stdout, stderr);
          results.push(parsed);
        } catch (err: unknown) {
          const e = err as {
            stdout?: string;
            stderr?: string;
            code?: number;
            message?: string;
          };
          const parsed = parseCargoOutput(
            mode,
            e.stdout ?? "",
            e.stderr ?? "",
          );
          results.push(
            `## cargo ${mode} (exit code: ${e.code ?? "unknown"})\n\n${parsed}`,
          );
        }
      }

      return {
        content: [{ type: "text" as const, text: results.join("\n\n---\n\n") }],
      };
    },
  );

  // ── prisma_crate_graph ───────────────────────────────────────────────────
  server.tool(
    "prisma_crate_graph",
    "Return the dependency graph between workspace crates as ASCII art and JSON",
    {},
    async () => {
      try {
        const crates = await getAllCrates(workspaceRoot);

        // Build adjacency list
        const depMap: Record<string, string[]> = {};
        for (const c of crates) {
          depMap[c.name] = c.dependencies;
        }

        // ASCII art graph
        const ascii = buildAsciiGraph(depMap);

        // JSON representation
        const json = JSON.stringify(depMap, null, 2);

        const text = `# Workspace Crate Dependency Graph\n\n## ASCII Graph\n\n\`\`\`\n${ascii}\`\`\`\n\n## JSON Dependency Map\n\n\`\`\`json\n${json}\n\`\`\``;

        return { content: [{ type: "text" as const, text }] };
      } catch (err: unknown) {
        const msg =
          err instanceof Error ? err.message : "Unknown error";
        return {
          content: [
            {
              type: "text" as const,
              text: `Error building crate graph: ${msg}`,
            },
          ],
        };
      }
    },
  );

  // ── prisma_test_coverage ─────────────────────────────────────────────────
  server.tool(
    "prisma_test_coverage",
    "Return test count per crate, source file count, lines of code, and tests-per-kLoC ratio",
    {},
    async () => {
      try {
        const crates = await getAllCrates(workspaceRoot);

        const rows: Array<{
          name: string;
          tests: number;
          srcFiles: number;
          lines: number;
          ratio: string;
        }> = [];

        for (const c of crates) {
          rows.push({
            name: c.name,
            tests: c.testCount,
            srcFiles: c.sourceFiles,
            lines: c.lineCount,
            ratio:
              c.lineCount > 0
                ? ((c.testCount / (c.lineCount / 1000)).toFixed(1))
                : "N/A",
          });
        }

        // Totals
        const totalTests = rows.reduce((s, r) => s + r.tests, 0);
        const totalSrc = rows.reduce((s, r) => s + r.srcFiles, 0);
        const totalLines = rows.reduce((s, r) => s + r.lines, 0);
        const totalRatio =
          totalLines > 0
            ? (totalTests / (totalLines / 1000)).toFixed(1)
            : "N/A";

        let table = `# Test Coverage Summary\n\n`;
        table += `| Crate | Tests | Source Files | Lines | Tests/kLoC |\n`;
        table += `|-------|------:|-------------:|------:|-----------:|\n`;
        for (const r of rows) {
          table += `| ${r.name} | ${r.tests} | ${r.srcFiles} | ${r.lines.toLocaleString()} | ${r.ratio} |\n`;
        }
        table += `| **Total** | **${totalTests}** | **${totalSrc}** | **${totalLines.toLocaleString()}** | **${totalRatio}** |\n`;

        // Coverage gaps
        const gaps = rows.filter((r) => r.tests === 0);
        if (gaps.length > 0) {
          table += `\n## Coverage Gaps\n\nThe following crates have **zero tests**:\n`;
          for (const g of gaps) {
            table += `- \`${g.name}\` (${g.srcFiles} source files, ${g.lines.toLocaleString()} lines)\n`;
          }
        }

        const lowCoverage = rows.filter(
          (r) => r.tests > 0 && parseFloat(r.ratio) < 5.0,
        );
        if (lowCoverage.length > 0) {
          table += `\n## Low Coverage (< 5 tests/kLoC)\n\n`;
          for (const r of lowCoverage) {
            table += `- \`${r.name}\`: ${r.ratio} tests/kLoC\n`;
          }
        }

        return { content: [{ type: "text" as const, text: table }] };
      } catch (err: unknown) {
        const msg =
          err instanceof Error ? err.message : "Unknown error";
        return {
          content: [
            {
              type: "text" as const,
              text: `Error calculating test coverage: ${msg}`,
            },
          ],
        };
      }
    },
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildCargoArgs(mode: string): string[] {
  switch (mode) {
    case "clippy":
      return [
        "clippy",
        "--workspace",
        "--all-targets",
        "--message-format=json",
      ];
    case "test":
      return [
        "test",
        "--workspace",
        "--no-run",
        "--message-format=json",
      ];
    case "check":
    default:
      return ["check", "--workspace", "--message-format=json"];
  }
}

function parseCargoOutput(
  mode: string,
  stdout: string,
  stderr: string,
): string {
  const lines = stdout.split("\n").filter((l) => l.trim().length > 0);
  const errors: string[] = [];
  const warnings: string[] = [];
  let compiledCount = 0;

  for (const line of lines) {
    try {
      const msg = JSON.parse(line);
      if (msg.reason === "compiler-message") {
        const level = msg.message?.level;
        const rendered = msg.message?.rendered ?? "";
        if (level === "error") {
          errors.push(rendered.trim());
        } else if (level === "warning") {
          warnings.push(rendered.trim());
        }
      } else if (msg.reason === "build-script-executed" || msg.reason === "compiler-artifact") {
        compiledCount++;
      }
    } catch {
      // Not JSON, skip
    }
  }

  // Also parse stderr for non-JSON messages
  const stderrLines = stderr.split("\n").filter((l) => l.trim().length > 0);
  const stderrInfo: string[] = [];
  for (const line of stderrLines) {
    if (line.startsWith("{")) continue; // skip JSON
    stderrInfo.push(line);
  }

  let result = `## cargo ${mode}\n\n`;
  result += `- **Artifacts compiled**: ${compiledCount}\n`;
  result += `- **Errors**: ${errors.length}\n`;
  result += `- **Warnings**: ${warnings.length}\n`;

  if (errors.length === 0 && warnings.length === 0) {
    result += `\n**Status: PASS** -- No errors or warnings.\n`;
  }

  if (errors.length > 0) {
    result += `\n### Errors\n\n`;
    for (const e of errors.slice(0, 20)) {
      result += `\`\`\`\n${e}\n\`\`\`\n\n`;
    }
    if (errors.length > 20) {
      result += `... and ${errors.length - 20} more errors\n`;
    }
  }

  if (warnings.length > 0) {
    result += `\n### Warnings (first 20)\n\n`;
    for (const w of warnings.slice(0, 20)) {
      result += `\`\`\`\n${w}\n\`\`\`\n\n`;
    }
    if (warnings.length > 20) {
      result += `... and ${warnings.length - 20} more warnings\n`;
    }
  }

  if (stderrInfo.length > 0) {
    result += `\n### Build Output\n\n`;
    result += `\`\`\`\n${stderrInfo.slice(0, 30).join("\n")}\n\`\`\`\n`;
  }

  return result;
}

function buildAsciiGraph(depMap: Record<string, string[]>): string {
  let output = "";

  // Sort crates by dependency depth (leaves first)
  const depths: Record<string, number> = {};
  function getDepth(name: string, visited: Set<string> = new Set()): number {
    if (depths[name] !== undefined) return depths[name];
    if (visited.has(name)) return 0; // cycle guard
    visited.add(name);
    const deps = depMap[name] ?? [];
    const maxChild =
      deps.length === 0
        ? 0
        : Math.max(...deps.map((d) => getDepth(d, visited) + 1));
    depths[name] = maxChild;
    return maxChild;
  }

  for (const name of Object.keys(depMap)) {
    getDepth(name);
  }

  const sorted = Object.keys(depMap).sort(
    (a, b) => (depths[b] ?? 0) - (depths[a] ?? 0),
  );

  for (const name of sorted) {
    const deps = depMap[name] ?? [];
    if (deps.length === 0) {
      output += `${name} (leaf)\n`;
    } else {
      output += `${name}\n`;
      for (let i = 0; i < deps.length; i++) {
        const isLast = i === deps.length - 1;
        const connector = isLast ? "\\--" : "|--";
        output += `  ${connector} ${deps[i]}\n`;
      }
    }
    output += "\n";
  }

  return output;
}
