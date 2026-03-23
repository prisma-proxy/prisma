#!/usr/bin/env node

import * as path from "path";
import { fileURLToPath } from "url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { registerWorkspaceTools } from "./tools/workspace.js";
import { registerVersionTools } from "./tools/version.js";
import { registerAnalysisTools } from "./tools/analysis.js";
import { registerEvolutionTools } from "./tools/evolution.js";
import { registerArchitectureResource } from "./resources/architecture.js";
import { registerProtocolResource } from "./resources/protocol.js";
import { registerChangelogResource } from "./resources/changelog.js";
import { registerWorkflowPrompts } from "./prompts/workflows.js";
import { initDatabase } from "./db/store.js";

/**
 * Resolve the Prisma workspace root directory.
 *
 * Priority:
 *   1. PRISMA_WORKSPACE environment variable (if set)
 *   2. Parent directory of the MCP server package location
 */
function resolveWorkspaceRoot(): string {
  if (process.env.PRISMA_WORKSPACE) {
    return path.resolve(process.env.PRISMA_WORKSPACE);
  }

  // __dirname equivalent for ESM — the directory containing this compiled file
  const thisFile = fileURLToPath(import.meta.url);
  const thisDir = path.dirname(thisFile);

  // The compiled file lives at dist/index.js, so the package root is one
  // level up (dist/..), and the workspace root is one more level up (../..).
  return path.resolve(thisDir, "..", "..");
}

async function main(): Promise<void> {
  const workspaceRoot = resolveWorkspaceRoot();

  // Initialize the SQLite database for persistent state
  await initDatabase(workspaceRoot);

  // Create the MCP server
  const server = new McpServer({
    name: "prisma-dev",
    version: "1.0.0",
  });

  // ── Register tools ──────────────────────────────────────────────────
  registerWorkspaceTools(server, workspaceRoot);
  registerVersionTools(server, workspaceRoot);
  registerAnalysisTools(server, workspaceRoot);
  registerEvolutionTools(server, workspaceRoot);

  // ── Register resources ──────────────────────────────────────────────
  registerArchitectureResource(server, workspaceRoot);
  registerProtocolResource(server, workspaceRoot);
  registerChangelogResource(server, workspaceRoot);

  // ── Register prompts ────────────────────────────────────────────────
  registerWorkflowPrompts(server, workspaceRoot);

  // ── Start the server over stdio transport ───────────────────────────
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error: unknown) => {
  console.error("prisma-dev MCP server failed to start:", error);
  process.exit(1);
});
