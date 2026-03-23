import * as fs from "fs/promises";
import { glob } from "glob";

/**
 * Recursively collect all `.rs` file paths under `dir`, excluding `target/` directories.
 */
export async function findRsFiles(dir: string): Promise<string[]> {
  try {
    return await glob("**/*.rs", {
      cwd: dir,
      absolute: true,
      nodir: true,
      ignore: ["**/target/**"],
    });
  } catch {
    return [];
  }
}

/**
 * Safely read a file to a string. Returns `null` on failure.
 */
export async function safeRead(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Extract an error message from an unknown caught value.
 */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Unknown error";
}

/**
 * Build a standard MCP error response.
 */
export function mcpError(prefix: string, err: unknown) {
  return {
    content: [{ type: "text" as const, text: `${prefix}: ${errorMessage(err)}` }],
  };
}

/**
 * Group an array of items by a key function.
 */
export function groupBy<T>(items: T[], keyFn: (item: T) => string): Record<string, T[]> {
  const result: Record<string, T[]> = {};
  for (const item of items) {
    const key = keyFn(item);
    if (!result[key]) result[key] = [];
    result[key].push(item);
  }
  return result;
}
