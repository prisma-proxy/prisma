import { useTheme } from "@/lib/theme-context";

/**
 * Returns resolved hex colors for the connection map based on the current theme.
 * SVG inline `fill` attributes cannot resolve CSS custom properties in all browsers,
 * so this hook returns concrete values — same pattern as useChartColors().
 */
export function useMapColors() {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  return {
    ocean: isDark ? "#0F1117" : "#F8FAFC",
    landBase: isDark ? "#2A2A2E" : "#E8E8E8",
    border: isDark ? "#374151" : "#D1D5DB",
    hoverFill: isDark ? "#1E40AF" : "#93C5FD",
    cityDotFill: isDark ? "#1E293B" : "#FFFFFF",
    cityDotStroke: isDark ? "#60A5FA" : "#3D8BC9",
    serverColor: isDark ? "#4ADE80" : "#4CAF50",
    serverLabel: isDark ? "#9CA3AF" : "#666666",
    choropleth: isDark
      ? ["#2A2A2E", "#1E3A5F", "#2B6CB0", "#3B82F6", "#60A5FA"]
      : ["#E8E8E8", "#C6DBEF", "#6BAED6", "#3182BD", "#08519C"],
  };
}

export type MapColors = ReturnType<typeof useMapColors>;

export function countToFill(count: number, colors: MapColors): string {
  if (count <= 0) return colors.choropleth[0];
  if (count <= 5) return colors.choropleth[1];
  if (count <= 20) return colors.choropleth[2];
  if (count <= 50) return colors.choropleth[3];
  return colors.choropleth[4];
}
