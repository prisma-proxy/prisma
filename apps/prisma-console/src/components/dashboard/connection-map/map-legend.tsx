"use client";

import type { MapColors } from "./use-map-colors";

const TIERS = ["0", "1–5", "6–20", "21–50", "51+"];

export function MapLegend({ colors }: { colors: MapColors }) {
  return (
    <div className="flex items-center justify-center gap-3 pt-2">
      {colors.choropleth.map((color, i) => (
        <div key={i} className="flex items-center gap-1">
          <span
            className="inline-block h-2.5 w-4 rounded-sm border border-border/40"
            style={{ backgroundColor: color }}
          />
          <span className="text-[10px] text-muted-foreground">{TIERS[i]}</span>
        </div>
      ))}
    </div>
  );
}
