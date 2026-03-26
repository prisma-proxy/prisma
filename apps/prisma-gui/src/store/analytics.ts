import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface DomainStats {
  bytes_up: number;
  bytes_down: number;
  connections: number;
  last_seen: number;
}

export interface DailyTotal {
  date: string;
  bytes_up: number;
  bytes_down: number;
}

export interface RuleStats {
  match_count: number;
  bytes_total: number;
}

interface AnalyticsStore {
  domains: Record<string, DomainStats>;
  daily_totals: DailyTotal[];
  rule_stats: Record<string, RuleStats>;

  addTraffic: (domain: string, bytes_up: number, bytes_down: number, rule?: string) => void;
  getTopDomains: (n: number) => [string, DomainStats][];
  getDailyTrend: (days?: number) => DailyTotal[];
  exportCsv: () => string;
  clear: () => void;
}

const MAX_DOMAINS = 1000;
const MAX_DAILY_DAYS = 30;

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoKey(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function pruneDomains(domains: Record<string, DomainStats>): Record<string, DomainStats> {
  const entries = Object.entries(domains);
  if (entries.length <= MAX_DOMAINS) return domains;
  // Keep top domains by total bytes
  entries.sort((a, b) => (b[1].bytes_up + b[1].bytes_down) - (a[1].bytes_up + a[1].bytes_down));
  const pruned: Record<string, DomainStats> = {};
  for (let i = 0; i < MAX_DOMAINS; i++) {
    pruned[entries[i][0]] = entries[i][1];
  }
  return pruned;
}

function pruneDailyTotals(totals: DailyTotal[]): DailyTotal[] {
  const cutoff = daysAgoKey(MAX_DAILY_DAYS);
  return totals.filter((t) => t.date >= cutoff);
}

const MAX_RULES = 100;

function pruneRuleStats(rules: Record<string, RuleStats>): Record<string, RuleStats> {
  const entries = Object.entries(rules);
  if (entries.length <= MAX_RULES) return rules;
  entries.sort((a, b) => b[1].bytes_total - a[1].bytes_total);
  const pruned: Record<string, RuleStats> = {};
  for (let i = 0; i < MAX_RULES; i++) {
    pruned[entries[i][0]] = entries[i][1];
  }
  return pruned;
}

// Batch pending updates
let pendingUpdates: { domain: string; bytes_up: number; bytes_down: number; rule?: string }[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function flushPending() {
  flushTimer = null;
  if (pendingUpdates.length === 0) return;
  const batch = pendingUpdates;
  pendingUpdates = [];

  useAnalytics.setState((state) => {
    const domains = { ...state.domains };
    const ruleStats = { ...state.rule_stats };
    const today = todayKey();

    // Find or create today's daily total
    let dailyTotals = [...state.daily_totals];
    let todayEntry = dailyTotals.find((d) => d.date === today);
    if (!todayEntry) {
      todayEntry = { date: today, bytes_up: 0, bytes_down: 0 };
      dailyTotals.push(todayEntry);
    } else {
      todayEntry = { ...todayEntry };
      dailyTotals = dailyTotals.map((d) => (d.date === today ? todayEntry! : d));
    }

    for (const update of batch) {
      const prev = domains[update.domain] ?? { bytes_up: 0, bytes_down: 0, connections: 0, last_seen: 0 };
      // Only increment connection count for new connection registrations (bytes == 0),
      // not for traffic updates from stats distribution.
      const isNewConn = update.bytes_up === 0 && update.bytes_down === 0;
      domains[update.domain] = {
        bytes_up: prev.bytes_up + update.bytes_up,
        bytes_down: prev.bytes_down + update.bytes_down,
        connections: prev.connections + (isNewConn ? 1 : 0),
        last_seen: Date.now(),
      };

      todayEntry!.bytes_up += update.bytes_up;
      todayEntry!.bytes_down += update.bytes_down;

      if (update.rule) {
        const prevRule = ruleStats[update.rule] ?? { match_count: 0, bytes_total: 0 };
        // Only increment match_count for new connection registrations (bytes == 0),
        // not for subsequent traffic updates which would inflate the count.
        ruleStats[update.rule] = {
          match_count: prevRule.match_count + (isNewConn ? 1 : 0),
          bytes_total: prevRule.bytes_total + update.bytes_up + update.bytes_down,
        };
      }
    }

    return {
      domains: pruneDomains(domains),
      daily_totals: pruneDailyTotals(dailyTotals),
      rule_stats: pruneRuleStats(ruleStats),
    };
  });
}

export const useAnalytics = create<AnalyticsStore>()(
  persist(
    (set, get) => ({
      domains: {},
      daily_totals: [],
      rule_stats: {},

      addTraffic: (domain, bytes_up, bytes_down, rule) => {
        pendingUpdates.push({ domain, bytes_up, bytes_down, rule });
        if (!flushTimer) {
          flushTimer = setTimeout(flushPending, 3_000);
        }
      },

      getTopDomains: (n) => {
        const entries = Object.entries(get().domains);
        entries.sort((a, b) => (b[1].bytes_up + b[1].bytes_down) - (a[1].bytes_up + a[1].bytes_down));
        return entries.slice(0, n);
      },

      getDailyTrend: (days = 7) => {
        const cutoff = daysAgoKey(days);
        return get()
          .daily_totals.filter((d) => d.date >= cutoff)
          .sort((a, b) => a.date.localeCompare(b.date));
      },

      exportCsv: () => {
        const { domains, daily_totals, rule_stats } = get();
        const lines: string[] = [];

        lines.push("# Domain Traffic");
        lines.push("domain,bytes_up,bytes_down,connections,last_seen");
        for (const [domain, stats] of Object.entries(domains)) {
          lines.push(`${domain},${stats.bytes_up},${stats.bytes_down},${stats.connections},${new Date(stats.last_seen).toISOString()}`);
        }

        lines.push("");
        lines.push("# Daily Totals");
        lines.push("date,bytes_up,bytes_down");
        for (const day of daily_totals) {
          lines.push(`${day.date},${day.bytes_up},${day.bytes_down}`);
        }

        lines.push("");
        lines.push("# Rule Stats");
        lines.push("rule,match_count,bytes_total");
        for (const [rule, stats] of Object.entries(rule_stats)) {
          lines.push(`${rule},${stats.match_count},${stats.bytes_total}`);
        }

        return lines.join("\n");
      },

      clear: () => set({ domains: {}, daily_totals: [], rule_stats: {} }),
    }),
    {
      name: "prisma-analytics",
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.domains = pruneDomains(state.domains);
          state.daily_totals = pruneDailyTotals(state.daily_totals);
        }
      },
    }
  )
);
