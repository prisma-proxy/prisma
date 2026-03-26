"use client";

import { useState, useMemo, useCallback, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/loading-placeholder";
import { Globe, Plus, Minus, RotateCcw } from "lucide-react";
import {
  WORLD_COUNTRIES,
  COUNTRY_CENTROIDS,
} from "@/lib/world-map-paths";

const SERVER_COLOR = "#4CAF50";
const DEFAULT_SERVER_POS: [number, number] = [500, 200];

// AnyChart-style map constants — clean, professional, always light
const OCEAN_BG = "#F7F7F7";
const LAND_BASE = "#E2E2E2";
const BORDER_COLOR = "#CCCCCC";
const CITY_DOT_BORDER = "#3D8BC9";

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 1.5;

/** Equirectangular projection: lon/lat -> SVG coords in 1000x500 viewBox */
function geoToSvg(lon: number, lat: number): [number, number] {
  return [(lon + 180) * (1000 / 360), (90 - lat) * (500 / 180)];
}

/** AnyChart-style choropleth fill by connection count */
function countToFill(count: number): { fill: string; opacity: number } {
  if (count <= 0) return { fill: LAND_BASE, opacity: 1 };
  if (count <= 5) return { fill: "#C8DCEF", opacity: 1 };
  if (count <= 20) return { fill: "#7DB5E0", opacity: 1 };
  if (count <= 50) return { fill: "#3D8BC9", opacity: 1 };
  return { fill: "#1A5A96", opacity: 1 };
}

export function ConnectionMap() {
  const { t } = useI18n();
  const [tooltip, setTooltip] = useState<{
    key: string;
    x: number;
    y: number;
    label: string;
  } | null>(null);

  // Zoom and pan state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

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

  // Compute viewBox from zoom + pan
  const viewBox = useMemo(() => {
    const vw = 1000 / zoom;
    const vh = 500 / zoom;
    // Clamp pan so we don't go out of bounds
    const maxPanX = 1000 - vw;
    const maxPanY = 500 - vh;
    const vx = Math.max(0, Math.min(pan.x, maxPanX));
    const vy = Math.max(0, Math.min(pan.y, maxPanY));
    return `${vx} ${vy} ${vw} ${vh}`;
  }, [zoom, pan]);

  const handleCityEnter = useCallback(
    (key: string, cx: number, cy: number, label: string) => {
      setTooltip({ key, x: cx, y: cy, label });
    },
    []
  );

  const handleCityLeave = useCallback(() => {
    setTooltip(null);
  }, []);

  const handleZoomIn = useCallback(() => {
    setZoom((z) => {
      const next = Math.min(z * ZOOM_STEP, MAX_ZOOM);
      // Center the zoom
      const oldW = 1000 / z;
      const newW = 1000 / next;
      const oldH = 500 / z;
      const newH = 500 / next;
      setPan((p) => ({
        x: p.x + (oldW - newW) / 2,
        y: p.y + (oldH - newH) / 2,
      }));
      return next;
    });
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom((z) => {
      const next = Math.max(z / ZOOM_STEP, MIN_ZOOM);
      const oldW = 1000 / z;
      const newW = 1000 / next;
      const oldH = 500 / z;
      const newH = 500 / next;
      setPan((p) => ({
        x: Math.max(0, p.x + (oldW - newW) / 2),
        y: Math.max(0, p.y + (oldH - newH) / 2),
      }));
      return next;
    });
  }, []);

  const handleReset = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const handleWheel = useCallback(
    (e: React.WheelEvent<SVGSVGElement>) => {
      e.preventDefault();
      if (e.deltaY < 0) {
        handleZoomIn();
      } else {
        handleZoomOut();
      }
    },
    [handleZoomIn, handleZoomOut]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (zoom <= 1) return;
      setDragging(true);
      dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
    },
    [zoom, pan]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!dragging || !dragStart.current || !svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const scaleX = (1000 / zoom) / rect.width;
      const scaleY = (500 / zoom) / rect.height;
      const dx = (e.clientX - dragStart.current.x) * scaleX;
      const dy = (e.clientY - dragStart.current.y) * scaleY;
      setPan({
        x: Math.max(0, dragStart.current.panX - dx),
        y: Math.max(0, dragStart.current.panY - dy),
      });
    },
    [dragging, zoom]
  );

  const handleMouseUp = useCallback(() => {
    setDragging(false);
    dragStart.current = null;
  }, []);

  if (!geo || geo.length === 0) {
    return (
      <Card className="shadow-sm">
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
    <Card className="shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium">
          {t("connectionMap.title")}
        </CardTitle>
        <span className="text-xs font-medium text-muted-foreground">
          {totalConnections} {totalConnections === 1 ? "connection" : "connections"} from {uniqueCountries} {uniqueCountries === 1 ? "country" : "countries"}
        </span>
      </CardHeader>
      <CardContent>
        <div className="relative rounded-lg overflow-hidden border shadow-sm">
          {/* Zoom controls */}
          <div className="absolute top-2 right-2 z-10 flex flex-col gap-1">
            <Button
              size="icon"
              variant="outline"
              className="h-6 w-6 bg-white/90 hover:bg-white shadow-sm"
              onClick={handleZoomIn}
              disabled={zoom >= MAX_ZOOM}
            >
              <Plus className="h-3 w-3" />
            </Button>
            <Button
              size="icon"
              variant="outline"
              className="h-6 w-6 bg-white/90 hover:bg-white shadow-sm"
              onClick={handleZoomOut}
              disabled={zoom <= MIN_ZOOM}
            >
              <Minus className="h-3 w-3" />
            </Button>
            <Button
              size="icon"
              variant="outline"
              className="h-6 w-6 bg-white/90 hover:bg-white shadow-sm"
              onClick={handleReset}
              disabled={zoom === 1}
            >
              <RotateCcw className="h-3 w-3" />
            </Button>
          </div>

          <svg
            ref={svgRef}
            viewBox={viewBox}
            className={`w-full h-auto select-none ${zoom > 1 ? (dragging ? "cursor-grabbing" : "cursor-grab") : ""}`}
            role="img"
            aria-label={t("connectionMap.title")}
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            <defs>
              <filter id="marker-shadow" x="-50%" y="-50%" width="200%" height="200%">
                <feDropShadow dx="0" dy="1" stdDeviation="1" floodOpacity="0.2" />
              </filter>
            </defs>

            {/* Ocean background */}
            <rect x="0" y="0" width="1000" height="500" fill={OCEAN_BG} rx="8" />

            {/* AnyChart style: no grid lines — clean professional look */}

            {/* Country shapes — AnyChart choropleth */}
            {WORLD_COUNTRIES.map((country) => {
              const total = countryTotals[country.id] || 0;
              const { fill, opacity } = countToFill(total);
              const isHovered = tooltip?.key === `country-${country.id}`;
              return (
                <path
                  key={country.id}
                  d={country.path}
                  fill={isHovered ? "#FFC107" : fill}
                  fillOpacity={opacity}
                  stroke={isHovered ? "#999" : BORDER_COLOR}
                  strokeWidth={isHovered ? 1 : 0.8}
                  strokeLinejoin="round"
                  className="cursor-pointer transition-colors duration-150"
                  onMouseEnter={() => {
                    const centroid = COUNTRY_CENTROIDS[country.id];
                    if (centroid && total > 0) {
                      setTooltip({ key: `country-${country.id}`, x: centroid[0], y: centroid[1], label: `${country.name}: ${total} connections` });
                    }
                  }}
                  onMouseLeave={() => setTooltip((t) => t?.key === `country-${country.id}` ? null : t)}
                />
              );
            })}

            {/* City markers — AnyChart style: white fill + colored border ring */}
            {cityEntries.map((entry) => {
              const [cx, cy] = geoToSvg(entry.lon!, entry.lat!);
              const minR = 2.5;
              const maxR = 6;
              const r = minR + (entry.count / maxCityCount) * (maxR - minR);
              const key = `${entry.country}-${entry.city ?? "unknown"}-${entry.lat}-${entry.lon}`;
              const isHovered = tooltip?.key === key;
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
                  {/* White ring border */}
                  <circle
                    cx={cx} cy={cy} r={r + 1.5}
                    fill="white"
                    opacity={isHovered ? 1 : 0.9}
                    className="transition-opacity duration-200"
                  />
                  {/* AnyChart-style: white fill + colored border */}
                  <circle
                    cx={cx} cy={cy} r={r}
                    fill="white"
                    stroke={CITY_DOT_BORDER}
                    strokeWidth={1.5}
                    opacity={isHovered ? 1 : 0.9}
                    filter="url(#marker-shadow)"
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

            {/* Server marker — AnyChart-style green diamond */}
            <g className="pointer-events-none">
              <rect
                x={serverPos[0] - 5} y={serverPos[1] - 5}
                width="10" height="10"
                fill={SERVER_COLOR} stroke="white" strokeWidth="1.5"
                transform={`rotate(45, ${serverPos[0]}, ${serverPos[1]})`}
                filter="url(#marker-shadow)"
              />
              <text
                x={serverPos[0]} y={serverPos[1] - 12}
                textAnchor="middle"
                fill="#666"
                className="pointer-events-none select-none"
                style={{ fontSize: "8px", fontWeight: 600, letterSpacing: "0.3px" }}
              >
                Server
              </text>
            </g>

            {/* Floating tooltip -- card-like with shadow */}
            {tooltip && <MapTooltip label={tooltip.label} pos={{ x: tooltip.x, y: tooltip.y }} />}
          </svg>
        </div>
      </CardContent>
    </Card>
  );
}

const TOOLTIP_BOX_H = 28;

function MapTooltip({ label, pos }: { label: string; pos: { x: number; y: number } }) {
  const textWidth = label.length * 5.5 + 20;
  let tx = pos.x + 18;
  let ty = pos.y - 16;
  if (tx + textWidth > 990) tx = pos.x - textWidth - 8;
  if (ty < 4) ty = pos.y + 20;
  if (ty + TOOLTIP_BOX_H > 496) ty = pos.y - TOOLTIP_BOX_H - 4;

  return (
    <g className="pointer-events-none">
      {/* Shadow */}
      <rect
        x={tx + 1} y={ty + 1}
        width={textWidth} height={TOOLTIP_BOX_H}
        rx="6"
        fill="black"
        opacity="0.08"
      />
      {/* Card background */}
      <rect
        x={tx} y={ty}
        width={textWidth} height={TOOLTIP_BOX_H}
        rx="6"
        fill="white"
        stroke="hsl(210, 15%, 85%)"
        strokeWidth="0.6"
      />
      <text
        x={tx + 10}
        y={ty + TOOLTIP_BOX_H / 2 + 1}
        dominantBaseline="central"
        fill="hsl(210, 15%, 20%)"
        style={{ fontSize: "10px", fontWeight: 500 }}
      >
        {label}
      </text>
    </g>
  );
}
