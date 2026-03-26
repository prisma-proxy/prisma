import type { DiffChange } from "./types";

/**
 * Compute a simple line-by-line diff between two strings.
 * Uses a longest common subsequence (LCS) approach for accurate results.
 */
export function computeDiff(left: string, right: string): DiffChange[] {
  const leftLines = left.split("\n");
  const rightLines = right.split("\n");

  // Build LCS table
  const m = leftLines.length;
  const n = rightLines.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (leftLines[i - 1] === rightLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to build diff
  const changes: DiffChange[] = [];
  let i = m;
  let j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && leftLines[i - 1] === rightLines[j - 1]) {
      changes.push({ tag: "equal", old_value: leftLines[i - 1], new_value: rightLines[j - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      changes.push({ tag: "insert", old_value: null, new_value: rightLines[j - 1] });
      j--;
    } else {
      changes.push({ tag: "delete", old_value: leftLines[i - 1], new_value: null });
      i--;
    }
  }

  return changes.reverse();
}
