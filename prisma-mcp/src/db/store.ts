import Database from "better-sqlite3";
import * as path from "path";
import * as fs from "fs";

// ── Module state ─────────────────────────────────────────────────────────────

let db: Database.Database | null = null;

// ── Initialization ───────────────────────────────────────────────────────────

/**
 * Initialize the SQLite database for persistent MCP server state.
 *
 * Creates the database file at `<workspaceRoot>/prisma-mcp/.prisma-mcp.db`
 * and ensures all required tables and indexes exist.
 */
export function initDatabase(workspaceRoot: string): void {
  const dbDir = path.join(workspaceRoot, "prisma-mcp");
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const dbPath = path.join(dbDir, ".prisma-mcp.db");
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS evolution_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      agent TEXT NOT NULL,
      event_type TEXT NOT NULL,
      description TEXT NOT NULL,
      files_changed TEXT,
      version TEXT
    );

    CREATE TABLE IF NOT EXISTS benchmark_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      suite TEXT NOT NULL,
      metric TEXT NOT NULL,
      value REAL NOT NULL,
      unit TEXT NOT NULL,
      version TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS build_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      check_type TEXT NOT NULL,
      success INTEGER NOT NULL,
      output TEXT,
      duration_ms INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_evolution_timestamp
      ON evolution_log(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_evolution_agent
      ON evolution_log(agent, timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_benchmark_suite
      ON benchmark_history(suite, timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_benchmark_version
      ON benchmark_history(version, suite);
    CREATE INDEX IF NOT EXISTS idx_build_cache_type
      ON build_cache(check_type, timestamp DESC);
  `);
}

/**
 * Get the initialized database instance.
 * Throws if `initDatabase()` has not been called.
 */
export function getDatabase(): Database.Database {
  if (!db) {
    throw new Error(
      "Database not initialized. Call initDatabase() first.",
    );
  }
  return db;
}

// ── Prepared statement cache ─────────────────────────────────────────────────
//
// Prepared statements are created lazily on first use and cached for the
// lifetime of the database connection.  This avoids re-parsing SQL on every
// call, which matters for high-frequency operations like benchmark recording.

let _stmtInsertEvolution: Database.Statement | null = null;
let _stmtQueryEvolution: Database.Statement | null = null;
let _stmtQueryEvolutionByAgent: Database.Statement | null = null;
let _stmtInsertBenchmark: Database.Statement | null = null;
let _stmtQueryBenchmarks: Database.Statement | null = null;
let _stmtQueryBenchmarksBySuite: Database.Statement | null = null;
let _stmtCompareBenchmarks: Database.Statement | null = null;
let _stmtInsertBuild: Database.Statement | null = null;
let _stmtGetLastBuild: Database.Statement | null = null;


// ── Evolution log operations ─────────────────────────────────────────────────

/**
 * Record an evolution event (feature implementation, refactor, release, etc.).
 *
 * @returns The auto-generated row id.
 */
export function recordEvolution(
  agent: string,
  eventType: string,
  description: string,
  filesChanged: string[],
  version?: string,
): number {
  const d = getDatabase();
  if (!_stmtInsertEvolution) {
    _stmtInsertEvolution = d.prepare(`
      INSERT INTO evolution_log (agent, event_type, description, files_changed, version)
      VALUES (@agent, @eventType, @description, @filesChanged, @version)
    `);
  }

  const result = _stmtInsertEvolution.run({
    agent,
    eventType,
    description,
    filesChanged: JSON.stringify(filesChanged),
    version: version ?? null,
  });

  return Number(result.lastInsertRowid);
}

/**
 * Query evolution log entries.
 *
 * @param limit  Maximum number of entries to return (default: 50).
 * @param agent  Optional filter by agent name.
 */
export function queryEvolution(
  limit?: number,
  agent?: string,
): Array<{
  id: number;
  timestamp: string;
  agent: string;
  event_type: string;
  description: string;
  files_changed: string[];
  version: string | null;
}> {
  const d = getDatabase();
  const effectiveLimit = limit ?? 50;

  let rows: Array<Record<string, unknown>>;

  if (agent) {
    if (!_stmtQueryEvolutionByAgent) {
      _stmtQueryEvolutionByAgent = d.prepare(`
        SELECT id, timestamp, agent, event_type, description, files_changed, version
        FROM evolution_log
        WHERE agent = @agent
        ORDER BY timestamp DESC
        LIMIT @limit
      `);
    }
    rows = _stmtQueryEvolutionByAgent.all({
      agent,
      limit: effectiveLimit,
    }) as Array<Record<string, unknown>>;
  } else {
    if (!_stmtQueryEvolution) {
      _stmtQueryEvolution = d.prepare(`
        SELECT id, timestamp, agent, event_type, description, files_changed, version
        FROM evolution_log
        ORDER BY timestamp DESC
        LIMIT @limit
      `);
    }
    rows = _stmtQueryEvolution.all({
      limit: effectiveLimit,
    }) as Array<Record<string, unknown>>;
  }

  return rows.map((row) => ({
    id: row.id as number,
    timestamp: row.timestamp as string,
    agent: row.agent as string,
    event_type: row.event_type as string,
    description: row.description as string,
    files_changed: parseJsonArray(row.files_changed as string | null),
    version: (row.version as string) ?? null,
  }));
}

// ── Benchmark history operations ─────────────────────────────────────────────

/**
 * Record a benchmark measurement.
 *
 * @returns The auto-generated row id.
 */
export function recordBenchmark(
  suite: string,
  metric: string,
  value: number,
  unit: string,
  version: string,
): number {
  const d = getDatabase();
  if (!_stmtInsertBenchmark) {
    _stmtInsertBenchmark = d.prepare(`
      INSERT INTO benchmark_history (suite, metric, value, unit, version)
      VALUES (@suite, @metric, @value, @unit, @version)
    `);
  }

  const result = _stmtInsertBenchmark.run({
    suite,
    metric,
    value,
    unit,
    version,
  });

  return Number(result.lastInsertRowid);
}

/**
 * Query benchmark history entries.
 *
 * @param suite  Optional filter by benchmark suite name.
 * @param limit  Maximum number of entries to return (default: 100).
 */
export function queryBenchmarks(
  suite?: string,
  limit?: number,
): Array<{
  id: number;
  timestamp: string;
  suite: string;
  metric: string;
  value: number;
  unit: string;
  version: string;
}> {
  const d = getDatabase();
  const effectiveLimit = limit ?? 100;

  let rows: Array<Record<string, unknown>>;

  if (suite) {
    if (!_stmtQueryBenchmarksBySuite) {
      _stmtQueryBenchmarksBySuite = d.prepare(`
        SELECT id, timestamp, suite, metric, value, unit, version
        FROM benchmark_history
        WHERE suite = @suite
        ORDER BY timestamp DESC
        LIMIT @limit
      `);
    }
    rows = _stmtQueryBenchmarksBySuite.all({
      suite,
      limit: effectiveLimit,
    }) as Array<Record<string, unknown>>;
  } else {
    if (!_stmtQueryBenchmarks) {
      _stmtQueryBenchmarks = d.prepare(`
        SELECT id, timestamp, suite, metric, value, unit, version
        FROM benchmark_history
        ORDER BY timestamp DESC
        LIMIT @limit
      `);
    }
    rows = _stmtQueryBenchmarks.all({
      limit: effectiveLimit,
    }) as Array<Record<string, unknown>>;
  }

  return rows.map((row) => ({
    id: row.id as number,
    timestamp: row.timestamp as string,
    suite: row.suite as string,
    metric: row.metric as string,
    value: row.value as number,
    unit: row.unit as string,
    version: row.version as string,
  }));
}

/**
 * Compare benchmark results between two versions for a given suite.
 *
 * For each metric in the suite, returns the most recent value recorded for
 * each version along with the absolute and percentage delta.
 */
export function compareBenchmarks(
  suite: string,
  version1: string,
  version2: string,
): Array<{
  metric: string;
  value1: number;
  value2: number;
  unit: string;
  delta: number;
  delta_pct: number;
}> {
  const d = getDatabase();
  if (!_stmtCompareBenchmarks) {
    // For each metric, get the latest value per version using a window function.
    // We join version1 and version2 results on metric name.
    _stmtCompareBenchmarks = d.prepare(`
      WITH v1 AS (
        SELECT metric, value, unit,
               ROW_NUMBER() OVER (PARTITION BY metric ORDER BY timestamp DESC) AS rn
        FROM benchmark_history
        WHERE suite = @suite AND version = @version1
      ),
      v2 AS (
        SELECT metric, value, unit,
               ROW_NUMBER() OVER (PARTITION BY metric ORDER BY timestamp DESC) AS rn
        FROM benchmark_history
        WHERE suite = @suite AND version = @version2
      )
      SELECT
        COALESCE(v1.metric, v2.metric) AS metric,
        COALESCE(v1.value, 0) AS value1,
        COALESCE(v2.value, 0) AS value2,
        COALESCE(v1.unit, v2.unit) AS unit
      FROM v1
      FULL OUTER JOIN v2 ON v1.metric = v2.metric AND v2.rn = 1
      WHERE v1.rn = 1 OR v1.rn IS NULL
      ORDER BY metric
    `);
  }

  const rows = _stmtCompareBenchmarks.all({
    suite,
    version1,
    version2,
  }) as Array<Record<string, unknown>>;

  return rows.map((row) => {
    const val1 = row.value1 as number;
    const val2 = row.value2 as number;
    const delta = val2 - val1;
    const deltaPct = val1 !== 0 ? (delta / Math.abs(val1)) * 100 : val2 !== 0 ? 100 : 0;

    return {
      metric: row.metric as string,
      value1: val1,
      value2: val2,
      unit: row.unit as string,
      delta,
      delta_pct: Math.round(deltaPct * 100) / 100,
    };
  });
}

// ── Build cache operations ───────────────────────────────────────────────────

/**
 * Record a build/check result.
 *
 * @returns The auto-generated row id.
 */
export function recordBuild(
  checkType: string,
  success: boolean,
  output: string,
  durationMs: number,
): number {
  const d = getDatabase();
  if (!_stmtInsertBuild) {
    _stmtInsertBuild = d.prepare(`
      INSERT INTO build_cache (check_type, success, output, duration_ms)
      VALUES (@checkType, @success, @output, @durationMs)
    `);
  }

  const result = _stmtInsertBuild.run({
    checkType,
    success: success ? 1 : 0,
    output,
    durationMs,
  });

  return Number(result.lastInsertRowid);
}

/**
 * Get the most recent build result for a given check type.
 *
 * @returns The most recent build entry, or `null` if none exists.
 */
export function getLastBuild(
  checkType: string,
): {
  timestamp: string;
  success: boolean;
  output: string;
  duration_ms: number;
} | null {
  const d = getDatabase();
  if (!_stmtGetLastBuild) {
    _stmtGetLastBuild = d.prepare(`
      SELECT timestamp, success, output, duration_ms
      FROM build_cache
      WHERE check_type = @checkType
      ORDER BY timestamp DESC
      LIMIT 1
    `);
  }

  const row = _stmtGetLastBuild.get({ checkType }) as Record<
    string,
    unknown
  > | undefined;

  if (!row) return null;

  return {
    timestamp: row.timestamp as string,
    success: (row.success as number) === 1,
    output: (row.output as string) ?? "",
    duration_ms: (row.duration_ms as number) ?? 0,
  };
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Safely parse a JSON string as a string array.
 * Returns an empty array if the input is null or not valid JSON.
 */
function parseJsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === "string");
    }
    return [];
  } catch {
    return [];
  }
}
