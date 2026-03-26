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

const SERVER_COLOR = "hsl(142, 71%, 55%)";
const DEFAULT_SERVER_POS: [number, number] = [500, 200];

/** Equirectangular projection: lon/lat -> SVG coords in 1000x500 viewBox */
function geoToSvg(lon: number, lat: number): [number, number] {
  return [(lon + 180) * (1000 / 360), (90 - lat) * (500 / 180)];
}

/** Pick a choropleth fill color + opacity based on connection count */
function countToFill(count: number): { fill: string; opacity: number } {
  if (count <= 0) return { fill: "hsl(var(--muted))", opacity: 0.18 };
  if (count <= 5) return { fill: "hsl(217, 91%, 80%)", opacity: 0.4 };
  if (count <= 20) return { fill: "hsl(217, 91%, 60%)", opacity: 0.55 };
  return { fill: "hsl(217, 91%, 45%)", opacity: 0.7 };
}

export function ConnectionMap() {
  const { t } = useI18n();
  const [hoveredCity, setHoveredCity] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });
  const [tooltipLabel, setTooltipLabel] = useState("");

  const { data: geo } = useQuery({
    queryKey: ["connections-geo"],
    queryFn: () => api.getConnectionGeo(),
    refetchInterval: 15000,
  });

  const { data: serverGeo } = useQuery({
    queryKey: ["server-geo"],
    queryFn: () => api.getServerGeo(),
    staleTime: 5 * 60 * 1000,
  });

  const serverPos = useMemo((): [number, number] => {
    if (serverGeo?.country) {
      const centroid = COUNTRY_CENTROIDS[serverGeo.country];
      if (centroid) return centroid;
    }
    return DEFAULT_SERVER_POS;
  }, [serverGeo]);

  // Aggregate country -> total count for choropleth coloring
  const countryTotals = useMemo(() => {
    if (!geo) return {} as Record<string, number>;
    const m: Record<string, number> = {};
    for (const entry of geo) {
      m[entry.country] = (m[entry.country] || 0) + entry.count;
    }
    return m;
  }, [geo]);

  // City-level entries that have lat/lon coordinates
  const cityEntries = useMemo(() => {
    if (!geo) return [];
    return geo.filter((e) => e.lat != null && e.lon != null);
  }, [geo]);

  const maxCityCount = useMemo(
    () => (cityEntries.length > 0 ? Math.max(...cityEntries.map((e) => e.count), 1) : 1),
    [cityEntries]
  );

  const totalConnections = useMemo(
    () => (geo ? geo.reduce((sum, g) => sum + g.count, 0) : 0),
    [geo]
  );

  const uniqueCountries = useMemo(
    () => Object.keys(countryTotals).length,
    [countryTotals]
  );

  const handleCityEnter = useCallback(
    (key: string, cx: number, cy: number, label: string) => {
      setHoveredCity(key);
      setTooltipPos({ x: cx, y: cy });
      setTooltipLabel(label);
    },
    []
  );

  const handleCityLeave = useCallback(() => {
    setHoveredCity(null);
  }, []);

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
          {totalConnections} {totalConnections === 1 ? "connection" : "connections"} from {uniqueCountries} {uniqueCountries === 1 ? "country" : "countries"}
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
              <filter id="dot-glow" x="-100%" y="-100%" width="300%" height="300%">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <filter id="server-glow" x="-100%" y="-100%" width="300%" height="300%">
                <feGaussianBlur stdDeviation="5" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <radialGradient id="server-gradient">
                <stop offset="0%" stopColor="hsl(142, 71%, 65%)" />
                <stop offset="100%" stopColor={SERVER_COLOR} />
              </radialGradient>
            </defs>

            {/* Ocean background */}
            <rect x="0" y="0" width="1000" height="500" fill="hsl(var(--card))" />

            {/* Subtle graticule grid */}
            {[83, 139, 194, 250, 306, 361, 417].map((y) => (
              <line
                key={`h-${y}`}
                x1="0" y1={y} x2="1000" y2={y}
                stroke="hsl(var(--muted-foreground))"
                strokeWidth="0.3" opacity="0.06"
              />
            ))}
            {[139, 278, 417, 556, 694, 833].map((x) => (
              <line
                key={`v-${x}`}
                x1={x} y1="0" x2={x} y2="500"
                stroke="hsl(var(--muted-foreground))"
                strokeWidth="0.3" opacity="0.06"
              />
            ))}

            {/* Country shapes -- choropleth colored by connection count */}
            {WORLD_COUNTRIES.map((country) => {
              const total = countryTotals[country.id] || 0;
              const { fill, opacity } = countToFill(total);
              return (
                <path
                  key={country.id}
                  d={country.path}
                  fill={fill}
                  fillOpacity={opacity}
                  stroke="hsl(var(--border))"
                  strokeWidth={0.3}
                  strokeOpacity={0.2}
                  strokeLinejoin="round"
                  className="pointer-events-none"
                />
              );
            })}

            {/* City dots */}
            {cityEntries.map((entry) => {
              const [cx, cy] = geoToSvg(entry.lon!, entry.lat!);
              const minR = 2;
              const maxR = 5;
              const r = minR + (entry.count / maxCityCount) * (maxR - minR);
              const key = `${entry.country}-${entry.city ?? "unknown"}-${entry.lat}-${entry.lon}`;
              const isHovered = hoveredCity === key;
              const label = entry.city
                ? `${entry.city}, ${entry.country}: ${entry.count}`
                : `${entry.country}: ${entry.count}`;

              return (
                <g
                  key={key}
                  className="cursor-pointer"
                  onMouseEnter={() => handleCityEnter(key, cx, cy, label)}
                  onMouseLeave={handleCityLeave}
                >
                  {/* Outer glow */}
                  <circle
                    cx={cx} cy={cy} r={r + 2}
                    fill="hsl(217, 91%, 60%)"
                    opacity={isHovered ? 0.25 : 0.1}
                    className="transition-opacity duration-200"
                  />
                  {/* Inner dot */}
                  <circle
                    cx={cx} cy={cy} r={r}
                    fill="white"
                    opacity={isHovered ? 1 : 0.85}
                    filter="url(#dot-glow)"
                    className="transition-opacity duration-200"
                  />
                  {/* Hit area */}
                  <circle
                    cx={cx} cy={cy} r={Math.max(r + 6, 10)}
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
                  <circle cx={sx} cy={sy} r="8" fill={SERVER_COLOR} opacity="0.12" />
                  <circle cx={sx} cy={sy} r="4" fill="url(#server-gradient)" filter="url(#server-glow)" />
                  <circle cx={sx} cy={sy} r="6" fill="none" stroke={SERVER_COLOR} strokeWidth="0.8" opacity="0.5" />
                  <text
                    x={sx} y={sy - 12}
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
            {hoveredCity && (
              <g className="pointer-events-none">
                {(() => {
                  const textWidth = tooltipLabel.length * 5.5 + 16;
                  const boxH = 24;
                  let tx = tooltipPos.x + 18;
                  let ty = tooltipPos.y - 14;
                  if (tx + textWidth > 990) tx = tooltipPos.x - textWidth - 8;
                  if (ty < 4) ty = tooltipPos.y + 20;
                  if (ty + boxH > 496) ty = tooltipPos.y - boxH - 4;

                  return (
                    <>
                      <rect
                        x={tx} y={ty}
                        width={textWidth} height={boxH}
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
                        {tooltipLabel}
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
