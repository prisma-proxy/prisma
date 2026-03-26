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

// Single accent color for the network visualization
const ACCENT = "hsl(217, 91%, 60%)";
const ACCENT_LIGHT = "hsl(217, 91%, 72%)";
const SERVER_COLOR = "hsl(142, 71%, 55%)";

// Default server position (center of map) when server geo is unavailable
const DEFAULT_SERVER_POS: [number, number] = [500, 200];

/** Generate a quadratic bezier arc from origin to server with upward curvature */
function arcPath(
  x1: number,
  y1: number,
  x2: number,
  y2: number
): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const midX = (x1 + x2) / 2;
  // Curve upward; curvature proportional to distance
  const curvature = Math.max(dist * 0.3, 30);
  const controlY = Math.min(y1, y2) - curvature;
  return `M ${x1} ${y1} Q ${midX} ${controlY} ${x2} ${y2}`;
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

  const { data: serverGeo } = useQuery({
    queryKey: ["server-geo"],
    queryFn: () => api.getServerGeo(),
    staleTime: 5 * 60 * 1000, // 5 min cache
  });

  // Server position on the map
  const serverPos = useMemo((): [number, number] => {
    if (serverGeo?.country) {
      const centroid = COUNTRY_CENTROIDS[serverGeo.country];
      if (centroid) return centroid;
    }
    return DEFAULT_SERVER_POS;
  }, [serverGeo]);

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

  const totalConnections = useMemo(
    () => (geo ? geo.reduce((sum, g) => sum + g.count, 0) : 0),
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
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium">
          {t("connectionMap.title")}
        </CardTitle>
        <span className="text-xs text-muted-foreground">
          {totalConnections} {totalConnections === 1 ? "connection" : "connections"} from {geo.length} {geo.length === 1 ? "country" : "countries"}
        </span>
      </CardHeader>
      <CardContent>
        <div className="relative">
          <svg
            viewBox="0 0 1000 500"
            className="w-full h-auto select-none"
            role="img"
            aria-label={t("connectionMap.title")}
          >
            <defs>
              {/* Glow filter for dots */}
              <filter id="dot-glow" x="-100%" y="-100%" width="300%" height="300%">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              {/* Server glow */}
              <filter id="server-glow" x="-100%" y="-100%" width="300%" height="300%">
                <feGaussianBlur stdDeviation="5" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              {/* Radial gradient for connection dots */}
              <radialGradient id="dot-gradient">
                <stop offset="0%" stopColor={ACCENT_LIGHT} />
                <stop offset="100%" stopColor={ACCENT} />
              </radialGradient>
              <radialGradient id="server-gradient">
                <stop offset="0%" stopColor="hsl(142, 71%, 65%)" />
                <stop offset="100%" stopColor={SERVER_COLOR} />
              </radialGradient>
            </defs>

            {/* Ocean background */}
            <rect
              x="0"
              y="0"
              width="1000"
              height="500"
              fill="hsl(var(--card))"
            />

            {/* Subtle graticule grid */}
            {[83, 139, 194, 250, 306, 361, 417].map((y) => (
              <line
                key={`h-${y}`}
                x1="0"
                y1={y}
                x2="1000"
                y2={y}
                stroke="hsl(var(--muted-foreground))"
                strokeWidth="0.3"
                opacity="0.06"
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
                opacity="0.06"
              />
            ))}

            {/* Country shapes — all dim, no color differentiation */}
            {WORLD_COUNTRIES.map((country) => (
              <path
                key={country.id}
                d={country.path}
                fill="hsl(var(--muted))"
                fillOpacity={0.18}
                stroke="hsl(var(--border))"
                strokeWidth={0.3}
                strokeOpacity={0.2}
                strokeLinejoin="round"
                className="pointer-events-none"
              />
            ))}

            {/* Arc lines from each origin to server */}
            {geo.map((entry) => {
              const centroid = COUNTRY_CENTROIDS[entry.country];
              if (!centroid) return null;
              // Don't draw arc to self
              if (serverGeo?.country === entry.country) return null;

              const [cx, cy] = centroid;
              const [sx, sy] = serverPos;
              const d = arcPath(cx, cy, sx, sy);
              const strokeWidth = 0.5 + (entry.count / maxCount) * 1.5;
              const isHovered = hoveredCountry === entry.country;

              return (
                <path
                  key={`arc-${entry.country}`}
                  d={d}
                  fill="none"
                  stroke={ACCENT}
                  strokeWidth={strokeWidth}
                  strokeOpacity={isHovered ? 0.6 : 0.2}
                  strokeLinecap="round"
                  strokeDasharray="4 6"
                  className="transition-[stroke-opacity] duration-200"
                  style={{
                    animation: "dash-flow 2s linear infinite",
                  }}
                />
              );
            })}

            {/* Connection origin dots with pulse */}
            {geo.map((entry) => {
              const centroid = COUNTRY_CENTROIDS[entry.country];
              if (!centroid) return null;

              const [cx, cy] = centroid;
              const minR = 3;
              const maxR = 7;
              const r = minR + (entry.count / maxCount) * (maxR - minR);
              const isHovered = hoveredCountry === entry.country;

              return (
                <g
                  key={`dot-${entry.country}`}
                  className="cursor-pointer"
                  onMouseEnter={() => handleMouseEnter(entry.country, cx, cy)}
                  onMouseLeave={handleMouseLeave}
                >
                  {/* Animated pulse ring */}
                  <circle
                    cx={cx}
                    cy={cy}
                    r={r}
                    fill="none"
                    stroke={ACCENT}
                    strokeWidth="1"
                    opacity="0"
                    className="connection-pulse"
                  />
                  {/* Outer glow */}
                  <circle
                    cx={cx}
                    cy={cy}
                    r={r + 3}
                    fill={ACCENT}
                    opacity={isHovered ? 0.2 : 0.08}
                    className="transition-opacity duration-200"
                  />
                  {/* Inner dot */}
                  <circle
                    cx={cx}
                    cy={cy}
                    r={r}
                    fill="url(#dot-gradient)"
                    opacity={isHovered ? 1 : 0.85}
                    filter="url(#dot-glow)"
                    className="transition-opacity duration-200"
                  />
                  {/* Hit area (invisible, larger for easier hover) */}
                  <circle
                    cx={cx}
                    cy={cy}
                    r={Math.max(r + 6, 12)}
                    fill="transparent"
                  />
                </g>
              );
            })}

            {/* Server marker */}
            {(() => {
              const [sx, sy] = serverPos;
              return (
                <g className="pointer-events-none">
                  {/* Server pulse ring */}
                  <circle
                    cx={sx}
                    cy={sy}
                    r="5"
                    fill="none"
                    stroke={SERVER_COLOR}
                    strokeWidth="1"
                    opacity="0"
                    className="server-pulse"
                  />
                  {/* Server glow */}
                  <circle
                    cx={sx}
                    cy={sy}
                    r="8"
                    fill={SERVER_COLOR}
                    opacity="0.12"
                  />
                  {/* Server dot */}
                  <circle
                    cx={sx}
                    cy={sy}
                    r="4"
                    fill="url(#server-gradient)"
                    filter="url(#server-glow)"
                  />
                  {/* Server ring */}
                  <circle
                    cx={sx}
                    cy={sy}
                    r="6"
                    fill="none"
                    stroke={SERVER_COLOR}
                    strokeWidth="0.8"
                    opacity="0.5"
                  />
                  {/* Label */}
                  <text
                    x={sx}
                    y={sy - 12}
                    textAnchor="middle"
                    className="fill-muted-foreground pointer-events-none select-none"
                    style={{ fontSize: "7px", letterSpacing: "0.5px" }}
                  >
                    SERVER
                  </text>
                </g>
              );
            })()}

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

            {/* Inline CSS for SVG animations */}
            <style>{`
              @keyframes pulse-expand {
                0% { r: 3; opacity: 0.6; stroke-width: 1.5; }
                100% { r: 16; opacity: 0; stroke-width: 0.5; }
              }
              @keyframes dash-flow {
                to { stroke-dashoffset: -20; }
              }
              @keyframes server-pulse-expand {
                0% { r: 5; opacity: 0.5; stroke-width: 1.5; }
                100% { r: 20; opacity: 0; stroke-width: 0.5; }
              }
              .connection-pulse {
                animation: pulse-expand 2s ease-out infinite;
              }
              .server-pulse {
                animation: server-pulse-expand 2.5s ease-out infinite;
              }
            `}</style>
          </svg>
        </div>
      </CardContent>
    </Card>
  );
}
