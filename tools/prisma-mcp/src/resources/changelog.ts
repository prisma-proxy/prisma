import { execFile } from "child_process";
import { promisify } from "util";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const exec = promisify(execFile);

const GIT_TIMEOUT = 15_000; // 15 seconds

// ── Types ────────────────────────────────────────────────────────────────────

interface CommitInfo {
  hash: string;
  subject: string;
  author: string;
  date: string;
  type: string;
  scope: string;
  description: string;
}

interface ChangelogGroup {
  type: string;
  label: string;
  commits: CommitInfo[];
}

// ── Conventional commit type labels ──────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  feat: "Features",
  fix: "Bug Fixes",
  refactor: "Refactoring",
  perf: "Performance",
  docs: "Documentation",
  test: "Tests",
  chore: "Chores",
  ci: "CI/CD",
  build: "Build",
  style: "Style",
  revert: "Reverts",
  other: "Other Changes",
};

/**
 * Ordered list of types for display — features and fixes first.
 */
const TYPE_ORDER = [
  "feat",
  "fix",
  "perf",
  "refactor",
  "docs",
  "test",
  "ci",
  "build",
  "chore",
  "style",
  "revert",
  "other",
];

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Run a git command and return stdout. Returns `null` if the command fails.
 */
async function git(
  workspaceRoot: string,
  args: string[],
): Promise<string | null> {
  try {
    const { stdout } = await exec("git", args, {
      cwd: workspaceRoot,
      timeout: GIT_TIMEOUT,
      maxBuffer: 5 * 1024 * 1024,
    });
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Parse a conventional commit subject into type, scope, and description.
 *
 * Examples:
 *   "feat(server): add QUIC listener" -> { type: "feat", scope: "server", description: "add QUIC listener" }
 *   "fix: resolve DNS race"           -> { type: "fix", scope: "", description: "resolve DNS race" }
 *   "initial commit"                  -> { type: "other", scope: "", description: "initial commit" }
 */
function parseConventionalCommit(subject: string): {
  type: string;
  scope: string;
  description: string;
} {
  const match = subject.match(
    /^(\w+)(?:\(([^)]*)\))?(!)?:\s*(.*)$/,
  );
  if (match) {
    return {
      type: match[1].toLowerCase(),
      scope: match[2] ?? "",
      description: match[4],
    };
  }
  return { type: "other", scope: "", description: subject };
}

/**
 * Get the most recent git tag, or `null` if none exists.
 */
async function getLastTag(workspaceRoot: string): Promise<string | null> {
  return git(workspaceRoot, ["describe", "--tags", "--abbrev=0"]);
}

/**
 * Get the list of commits since a given ref (or all commits if ref is null).
 */
async function getCommitsSince(
  workspaceRoot: string,
  sinceRef: string | null,
): Promise<CommitInfo[]> {
  const range = sinceRef ? `${sinceRef}..HEAD` : "HEAD";
  const logArgs = [
    "log",
    range,
    "--pretty=format:%H|%s|%an|%aI",
    "--no-merges",
  ];

  const output = await git(workspaceRoot, logArgs);
  if (!output) return [];

  const commits: CommitInfo[] = [];
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;

    const parts = line.split("|");
    if (parts.length < 4) continue;

    const hash = parts[0];
    const subject = parts[1];
    const author = parts[2];
    const date = parts[3];

    const parsed = parseConventionalCommit(subject);

    commits.push({
      hash,
      subject,
      author,
      date,
      type: parsed.type,
      scope: parsed.scope,
      description: parsed.description,
    });
  }

  return commits;
}

/**
 * Get file change stats for the range since the last tag.
 */
async function getFileStats(
  workspaceRoot: string,
  sinceRef: string | null,
): Promise<string | null> {
  const range = sinceRef ? `${sinceRef}..HEAD` : "HEAD";
  return git(workspaceRoot, ["diff", "--stat", range]);
}

/**
 * Group commits by conventional commit type.
 */
function groupCommits(commits: CommitInfo[]): ChangelogGroup[] {
  const groups: Record<string, CommitInfo[]> = {};

  for (const commit of commits) {
    const type = TYPE_LABELS[commit.type] ? commit.type : "other";
    if (!groups[type]) {
      groups[type] = [];
    }
    groups[type].push(commit);
  }

  // Return groups in the preferred order
  const result: ChangelogGroup[] = [];
  for (const type of TYPE_ORDER) {
    if (groups[type] && groups[type].length > 0) {
      result.push({
        type,
        label: TYPE_LABELS[type] ?? "Other",
        commits: groups[type],
      });
    }
  }

  return result;
}

/**
 * Format the changelog as markdown.
 */
function formatChangelog(
  lastTag: string | null,
  groups: ChangelogGroup[],
  totalCommits: number,
  fileStats: string | null,
): string {
  const sections: string[] = [];

  // Header
  const rangeLabel = lastTag ? `${lastTag}..HEAD` : "all commits";
  sections.push(
    `# Changelog\n\n` +
      `**Range**: \`${rangeLabel}\`  \n` +
      `**Total commits**: ${totalCommits}`,
  );

  if (totalCommits === 0) {
    sections.push("*No commits found in this range.*");
    return sections.join("\n\n");
  }

  // Grouped commits
  for (const group of groups) {
    let section = `## ${group.label} (${group.commits.length})\n\n`;
    for (const c of group.commits) {
      const scope = c.scope ? `**${c.scope}**: ` : "";
      const shortHash = c.hash.slice(0, 8);
      const dateStr = c.date.slice(0, 10);
      section += `- ${scope}${c.description} (\`${shortHash}\`, ${dateStr}, ${c.author})\n`;
    }
    sections.push(section);
  }

  // File change stats
  if (fileStats) {
    sections.push(`## File Change Statistics\n\n\`\`\`\n${fileStats}\n\`\`\``);
  }

  // Commit type breakdown
  {
    let breakdown = "## Commit Type Breakdown\n\n";
    breakdown += "| Type | Count | Percentage |\n";
    breakdown += "|------|------:|-----------:|\n";
    for (const g of groups) {
      const pct = ((g.commits.length / totalCommits) * 100).toFixed(1);
      breakdown += `| ${g.label} | ${g.commits.length} | ${pct}% |\n`;
    }
    sections.push(breakdown);
  }

  return sections.join("\n\n---\n\n");
}

// ── Registration ─────────────────────────────────────────────────────────────

export function registerChangelogResource(
  server: McpServer,
  workspaceRoot: string,
) {
  server.resource(
    "changelog",
    "prisma://changelog",
    {
      description:
        "Structured changelog from git log since last tag, grouped by conventional commit type",
    },
    async (uri) => {
      const lastTag = await getLastTag(workspaceRoot);
      const commits = await getCommitsSince(workspaceRoot, lastTag);
      const fileStats = await getFileStats(workspaceRoot, lastTag);
      const groups = groupCommits(commits);
      const text = formatChangelog(lastTag, groups, commits.length, fileStats);

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
