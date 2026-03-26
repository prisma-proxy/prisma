import { useTheme } from "@/lib/theme-context";
import type { TimeRange, Resolution } from "@/hooks/use-metrics";

/**
 * Shared chart theme using CSS variables for light/dark compatibility.
 */
export const CHART_THEME = {
  grid: "hsl(var(--border) / 0.12)",
  axis: "hsl(var(--muted-foreground) / 0.7)",
  tooltip: {
    bg: "hsl(var(--popover))",
    border: "hsl(var(--border))",
    text: "hsl(var(--popover-foreground))",
  },
  upload: "hsl(217, 91%, 60%)",
  download: "hsl(142, 71%, 45%)",
  brush: {
    stroke: "hsl(var(--border))",
    fill: "hsl(var(--muted))",
  },
} as const;

export const CHART_AXIS_TICK = {
  fill: "hsl(var(--muted-foreground))",
  fontSize: 10,
  fontFamily: "var(--font-geist-sans)",
};
export const CHART_AXIS_TICK_SM = {
  fill: "hsl(var(--muted-foreground))",
  fontSize: 10,
  fontFamily: "var(--font-geist-sans)",
};

/**
 * Returns resolved hex colors based on the current theme.
 * Recharts renders SVG with inline `fill` attributes which cannot resolve
 * CSS custom properties in all browsers — this hook returns concrete values.
 */
export function useChartColors() {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  return {
    axisColor: isDark ? "#A1A1AA" : "#71717A",
    gridColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
    brushStroke: isDark ? "#52525B" : "#D4D4D8",
    brushFill: isDark ? "#27272A" : "#F4F4F5",
    tooltipBg: isDark ? "#18181B" : "#FFFFFF",
    tooltipBorder: isDark ? "#3F3F46" : "#E4E4E7",
    tooltipText: isDark ? "#FAFAFA" : "#18181B",
  };
}

/**
 * 10 line colors for the Top Connections multi-line chart.
 * Ordered for visual distinction.
 */
export const LINE_PALETTE = [
  "hsl(217, 91%, 60%)",  // blue
  "hsl(142, 71%, 45%)",  // green
  "hsl(38, 92%, 50%)",   // amber
  "hsl(0, 72%, 51%)",    // red
  "hsl(280, 65%, 60%)",  // purple
  "hsl(190, 80%, 45%)",  // cyan
  "hsl(330, 70%, 55%)",  // pink
  "hsl(60, 80%, 45%)",   // yellow
  "hsl(200, 75%, 55%)",  // sky
  "hsl(160, 60%, 50%)",  // teal
] as const;

/**
 * All available time range options (shared across TrafficChart, HistoricalCharts, Analytics).
 */
export const TIME_RANGES: { key: TimeRange; i18nKey: string; label: string }[] = [
  { key: "1h", i18nKey: "chart.timeRange.1h", label: "1H" },
  { key: "3h", i18nKey: "chart.timeRange.3h", label: "3H" },
  { key: "6h", i18nKey: "chart.timeRange.6h", label: "6H" },
  { key: "12h", i18nKey: "chart.timeRange.12h", label: "12H" },
  { key: "24h", i18nKey: "chart.timeRange.24h", label: "24H" },
  { key: "3d", i18nKey: "chart.timeRange.3d", label: "3D" },
  { key: "7d", i18nKey: "chart.timeRange.7d", label: "7D" },
  { key: "14d", i18nKey: "chart.timeRange.14d", label: "14D" },
  { key: "30d", i18nKey: "chart.timeRange.30d", label: "30D" },
];

/**
 * Maps each time range to the recommended backend resolution to keep ~300-360 data points.
 */
export const RESOLUTION_MAP: Record<TimeRange, Resolution> = {
  "1h": "10s",
  "3h": "30s",
  "6h": "60s",
  "12h": "120s",
  "24h": "300s",
  "3d": "900s",
  "7d": "1800s",
  "14d": "3600s",
  "30d": "7200s",
};

/**
 * Format an ISO timestamp for x-axis display based on the active time range.
 * - Live/1h/3h: HH:MM:SS
 * - 6h/12h/24h: HH:MM
 * - 3d/7d: ddd HH:MM (e.g. "Mon 14:00")
 * - 14d/30d: MMM DD (e.g. "Mar 15")
 */
export function formatXAxis(timestamp: string | number, range: TimeRange | "live"): string {
  const d = new Date(timestamp);

  switch (range) {
    case "live":
    case "1h":
    case "3h":
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    case "6h":
    case "12h":
    case "24h":
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    case "3d":
    case "7d": {
      const day = d.toLocaleDateString([], { weekday: "short" });
      const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      return `${day} ${time}`;
    }
    case "14d":
    case "30d":
      return d.toLocaleDateString([], { month: "short", day: "numeric" });
    default:
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
}

/**
 * Recommended tick interval (number of data points between ticks) for each range,
 * to avoid x-axis crowding. Returns 0 = auto (let recharts decide).
 */
export function tickInterval(range: TimeRange | "live"): number | "preserveStartEnd" {
  switch (range) {
    case "live":
    case "1h":
      return "preserveStartEnd";
    case "3h":
    case "6h":
      return 59; // ~6 ticks
    case "12h":
    case "24h":
      return 47; // ~6 ticks
    case "3d":
    case "7d":
      return 55;
    case "14d":
    case "30d":
      return 49;
    default:
      return "preserveStartEnd";
  }
}
