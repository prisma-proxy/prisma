"use client";

import { useState, useMemo, useCallback, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { ComposableMap, ZoomableGroup } from "react-simple-maps";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/loading-placeholder";
import { Globe, Plus, Minus, RotateCcw } from "lucide-react";
import { useMapColors } from "./connection-map/use-map-colors";
import { MapGeography } from "./connection-map/map-geography";
import { CityMarkers, ServerMarker } from "./connection-map/map-markers";
import { MapTooltip } from "./connection-map/map-tooltip";
import { MapLegend } from "./connection-map/map-legend";

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

export function ConnectionMap() {
  const { t } = useI18n();
  const colors = useMapColors();
  const containerRef = useRef<HTMLDivElement>(null);

  // Tooltip state — positioned relative to container
  const [tooltipContent, setTooltipContent] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const [hoveredGeo, setHoveredGeo] = useState<string | null>(null);
  const [hoveredCity, setHoveredCity] = useState<string | null>(null);

  // Zoom state
  const [zoom, setZoom] = useState(1);

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

  const countryTotals = useMemo(() => {
    if (!geo) return {} as Record<string, number>;
    const m: Record<string, number> = {};
    for (const entry of geo) {
      m[entry.country] = (m[entry.country] || 0) + entry.count;
    }
    return m;
  }, [geo]);

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

  const clearTooltip = useCallback(() => {
    setTooltipContent(null);
    setTooltipPos(null);
    setHoveredGeo(null);
    setHoveredCity(null);
  }, []);

  const handleGeoHover = useCallback((id: string, name: string, count: number) => {
    setHoveredGeo(id);
    setHoveredCity(null);
    setTooltipContent(`${name}: ${count} connection${count !== 1 ? "s" : ""}`);
  }, []);

  const handleCityHover = useCallback((key: string, label: string) => {
    setHoveredCity(key);
    setHoveredGeo(null);
    setTooltipContent(label);
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  }, []);

  const handleZoomIn = useCallback(() => {
    setZoom((z) => Math.min(z * 1.5, MAX_ZOOM));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom((z) => Math.max(z / 1.5, MIN_ZOOM));
  }, []);

  const handleReset = useCallback(() => {
    setZoom(1);
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
        <div
          ref={containerRef}
          className="relative rounded-lg overflow-hidden border shadow-sm"
          onMouseMove={handleMouseMove}
          onMouseLeave={clearTooltip}
          style={{ backgroundColor: colors.ocean }}
        >
          {/* Zoom controls */}
          <div className="absolute top-2 right-2 z-10 flex flex-col gap-1">
            <Button
              size="icon"
              variant="outline"
              className="h-6 w-6 bg-background/90 hover:bg-background shadow-sm"
              onClick={handleZoomIn}
              disabled={zoom >= MAX_ZOOM}
            >
              <Plus className="h-3 w-3" />
            </Button>
            <Button
              size="icon"
              variant="outline"
              className="h-6 w-6 bg-background/90 hover:bg-background shadow-sm"
              onClick={handleZoomOut}
              disabled={zoom <= MIN_ZOOM}
            >
              <Minus className="h-3 w-3" />
            </Button>
            <Button
              size="icon"
              variant="outline"
              className="h-6 w-6 bg-background/90 hover:bg-background shadow-sm"
              onClick={handleReset}
              disabled={zoom === 1}
            >
              <RotateCcw className="h-3 w-3" />
            </Button>
          </div>

          <ComposableMap
            projection="geoNaturalEarth1"
            projectionConfig={{ scale: 147, center: [0, 0] }}
            width={800}
            height={400}
            style={{ width: "100%", height: "auto" }}
          >
            <ZoomableGroup
              zoom={zoom}
              minZoom={MIN_ZOOM}
              maxZoom={MAX_ZOOM}
              onMoveEnd={({ zoom: z }) => setZoom(z)}
            >
              <MapGeography
                countryTotals={countryTotals}
                colors={colors}
                hoveredGeo={hoveredGeo}
                onHover={handleGeoHover}
                onLeave={clearTooltip}
              />
              <CityMarkers
                cityEntries={cityEntries}
                maxCityCount={maxCityCount}
                colors={colors}
                hoveredCity={hoveredCity}
                onHover={handleCityHover}
                onLeave={clearTooltip}
              />
              <ServerMarker
                serverGeo={serverGeo}
                colors={colors}
              />
            </ZoomableGroup>
          </ComposableMap>

          <MapTooltip content={tooltipContent} position={tooltipPos} />
        </div>
        <MapLegend colors={colors} />
      </CardContent>
    </Card>
  );
}
