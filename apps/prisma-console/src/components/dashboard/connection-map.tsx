"use client";

import { useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/loading-placeholder";
import { Globe } from "lucide-react";
import {
  WORLD_COUNTRIES,
  COUNTRY_CENTROIDS,
} from "@/lib/world-map-paths";

// Accent colors for active-connection countries
const COUNTRY_COLORS = [
  "hsl(217, 91%, 60%)",
  "hsl(142, 71%, 45%)",
  "hsl(38, 92%, 50%)",
  "hsl(0, 84%, 60%)",
  "hsl(271, 91%, 65%)",
  "hsl(187, 85%, 43%)",
  "hsl(315, 80%, 60%)",
  "hsl(60, 100%, 45%)",
];

// Build a lookup: country ISO code -> color index (only for countries with connections)
function buildColorMap(
  countryCodes: string[]
): Record<string, string> {
  const map: Record<string, string> = {};
  countryCodes.forEach((code, idx) => {
    map[code] = COUNTRY_COLORS[idx % COUNTRY_COLORS.length];
  });
  return map;
}

export function ConnectionMap() {
  const { t } = useI18n();
  const [hoveredCountry, setHoveredCountry] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });

  const { data: geo } = useQuery({
    queryKey: ["connections-geo"],
    queryFn: () => api.getConnectionGeo(),
    refetchInterval: 15000,
  });

  // Map of country code -> connection count
  const countMap = useMemo(() => {
    if (!geo) return {} as Record<string, number>;
    const m: Record<string, number> = {};
    for (const entry of geo) {
      m[entry.country] = entry.count;
    }
    return m;
  }, [geo]);

  const maxCount = useMemo(
    () => (geo ? Math.max(...geo.map((g) => g.count), 1) : 1),
    [geo]
  );

  // Assign stable colors to countries that have connections
  const colorMap = useMemo(
    () => (geo ? buildColorMap(geo.map((g) => g.country)) : {}),
    [geo]
  );

  const handleMouseEnter = useCallback(
    (countryId: string, cx: number, cy: number) => {
      setHoveredCountry(countryId);
      setTooltipPos({ x: cx, y: cy });
    },
    []
  );

  const handleMouseLeave = useCallback(() => {
    setHoveredCountry(null);
  }, []);

  // Tooltip data for the hovered country
  const tooltipData = useMemo(() => {
    if (!hoveredCountry || !countMap[hoveredCountry]) return null;
    return {
      country: hoveredCountry,
      count: countMap[hoveredCountry],
    };
  }, [hoveredCountry, countMap]);

  if (!geo || geo.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">
            {t("connectionMap.title")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState
            icon={Globe}
            title={t("empty.noConnections")}
            description={t("empty.noConnectionsHint")}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">
          {t("connectionMap.title")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="relative">
          <svg
            viewBox="0 0 1000 500"
            className="w-full h-auto select-none"
            role="img"
            aria-label={t("connectionMap.title")}
          >
            {/* Definitions: drop shadow for badges, glow for active countries */}
            <defs>
              <filter id="map-badge-shadow" x="-50%" y="-50%" width="200%" height="200%">
                <feDropShadow dx="0" dy="1" stdDeviation="1.5" floodOpacity="0.25" />
              </filter>
              <filter id="map-glow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="4" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {/* Ocean background */}
            <rect
              x="0"
              y="0"
              width="1000"
              height="500"
              rx="0"
              fill="hsl(var(--card))"
            />

            {/* Subtle grid / graticule lines */}
            {[83, 139, 194, 250, 306, 361, 417].map((y) => (
              <line
                key={`h-${y}`}
                x1="0"
                y1={y}
                x2="1000"
                y2={y}
                stroke="hsl(var(--muted-foreground))"
                strokeWidth="0.3"
                opacity="0.08"
              />
            ))}
            {[139, 278, 417, 556, 694, 833].map((x) => (
              <line
                key={`v-${x}`}
                x1={x}
                y1="0"
                x2={x}
                y2="500"
                stroke="hsl(var(--muted-foreground))"
                strokeWidth="0.3"
                opacity="0.08"
              />
            ))}

            {/* Country shapes */}
            {WORLD_COUNTRIES.map((country) => {
              // Skip background continent fills if a real country covers it
              const isBackground = country.id.startsWith("_");
              const hasConnections = !!countMap[country.id];
              const isHovered = hoveredCountry === country.id;
              const centroid = COUNTRY_CENTROIDS[country.id];

              let fill: string;
              let fillOpacity: number;
              let strokeColor: string;
              let strokeWidth: number;

              if (isBackground) {
                fill = "hsl(var(--muted))";
                fillOpacity = 0.35;
                strokeColor = "hsl(var(--border))";
                strokeWidth = 0.3;
              } else if (hasConnections) {
                const color = colorMap[country.id];
                fill = color;
                fillOpacity = isHovered ? 0.85 : 0.6;
                strokeColor = color;
                strokeWidth = isHovered ? 1.2 : 0.8;
              } else {
                fill = "hsl(var(--muted))";
                fillOpacity = isHovered ? 0.7 : 0.5;
                strokeColor = "hsl(var(--border))";
                strokeWidth = 0.5;
              }

              return (
                <path
                  key={country.id}
                  d={country.path}
                  fill={fill}
                  fillOpacity={fillOpacity}
                  stroke={strokeColor}
                  strokeWidth={strokeWidth}
                  strokeLinejoin="round"
                  className={
                    isBackground
                      ? "pointer-events-none"
                      : "cursor-pointer transition-[fill-opacity,stroke-width] duration-150"
                  }
                  onMouseEnter={
                    !isBackground && centroid
                      ? () => handleMouseEnter(country.id, centroid[0], centroid[1])
                      : undefined
                  }
                  onMouseLeave={!isBackground ? handleMouseLeave : undefined}
                >
                  <title>
                    {country.name}
                    {hasConnections
                      ? ` — ${countMap[country.id]} connections`
                      : ""}
                  </title>
                </path>
              );
            })}

            {/* Active-connection indicators: pulse dot + count badge at centroid */}
            {geo.map((entry, idx) => {
              const centroid = COUNTRY_CENTROIDS[entry.country];
              if (!centroid) return null;

              const color = COUNTRY_COLORS[idx % COUNTRY_COLORS.length];
              const [cx, cy] = centroid;

              // Scale badge radius by relative connection count
              const minR = 6;
              const maxR = 16;
              const r = minR + (entry.count / maxCount) * (maxR - minR);
              const isHovered = hoveredCountry === entry.country;

              return (
                <g
                  key={entry.country}
                  className="cursor-pointer"
                  onMouseEnter={() => handleMouseEnter(entry.country, cx, cy)}
                  onMouseLeave={handleMouseLeave}
                >
                  {/* Outer glow ring */}
                  <circle
                    cx={cx}
                    cy={cy}
                    r={r + 4}
                    fill={color}
                    opacity={isHovered ? 0.25 : 0.12}
                    className="transition-opacity duration-150"
                  />
                  {/* Badge circle */}
                  <circle
                    cx={cx}
                    cy={cy}
                    r={r}
                    fill={color}
                    opacity={isHovered ? 1 : 0.85}
                    stroke="hsl(var(--card))"
                    strokeWidth="1.5"
                    filter="url(#map-badge-shadow)"
                    className="transition-opacity duration-150"
                  />
                  {/* Count number */}
                  <text
                    x={cx}
                    y={cy + 0.5}
                    textAnchor="middle"
                    dominantBaseline="central"
                    className="fill-white font-semibold pointer-events-none select-none"
                    style={{ fontSize: r > 10 ? "9px" : "7px" }}
                  >
                    {entry.count}
                  </text>
                </g>
              );
            })}

            {/* Floating tooltip */}
            {tooltipData && (
              <g className="pointer-events-none">
                {(() => {
                  const label = t("connectionMap.tooltip", {
                    country: tooltipData.country,
                    count: tooltipData.count,
                  });
                  const textWidth = label.length * 5.5 + 16;
                  const boxH = 24;
                  // Keep tooltip within the viewport
                  let tx = tooltipPos.x + 18;
                  let ty = tooltipPos.y - 14;
                  if (tx + textWidth > 990) tx = tooltipPos.x - textWidth - 8;
                  if (ty < 4) ty = tooltipPos.y + 20;
                  if (ty + boxH > 496) ty = tooltipPos.y - boxH - 4;

                  return (
                    <>
                      <rect
                        x={tx}
                        y={ty}
                        width={textWidth}
                        height={boxH}
                        rx="4"
                        fill="hsl(var(--popover))"
                        stroke="hsl(var(--border))"
                        strokeWidth="0.6"
                        opacity="0.95"
                      />
                      <text
                        x={tx + 8}
                        y={ty + boxH / 2 + 1}
                        dominantBaseline="central"
                        className="fill-foreground"
                        style={{ fontSize: "10px" }}
                      >
                        {label}
                      </text>
                    </>
                  );
                })()}
              </g>
            )}
          </svg>
        </div>
      </CardContent>
    </Card>
  );
}
