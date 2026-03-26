"use client";

import { memo, useMemo } from "react";
import { Marker, Geographies } from "react-simple-maps";
import { geoCentroid } from "d3-geo";
import type { Feature, Geometry } from "geojson";
import geoData from "@/data/world-50m.json";
import { feature } from "topojson-client";
import type { Topology } from "topojson-specification";
import type { GeoEntry } from "@/lib/types";
import type { MapColors } from "./use-map-colors";

interface CityMarkersProps {
  cityEntries: GeoEntry[];
  maxCityCount: number;
  colors: MapColors;
  hoveredCity: string | null;
  onHover: (key: string, label: string) => void;
  onLeave: () => void;
}

export const CityMarkers = memo(function CityMarkers({
  cityEntries,
  maxCityCount,
  colors,
  hoveredCity,
  onHover,
  onLeave,
}: CityMarkersProps) {
  const minR = 3;
  const maxR = 8;

  return (
    <>
      {cityEntries.map((entry) => {
        const key = `${entry.country}-${entry.city ?? "unknown"}-${entry.lat}-${entry.lon}`;
        const r = minR + (entry.count / maxCityCount) * (maxR - minR);
        const isHovered = hoveredCity === key;
        const label = entry.city
          ? `${entry.city}, ${entry.country}: ${entry.count}`
          : `${entry.country}: ${entry.count}`;

        return (
          <Marker key={key} coordinates={[entry.lon!, entry.lat!]}>
            <circle
              r={r + 1.5}
              fill={colors.cityDotFill}
              opacity={isHovered ? 1 : 0.85}
            />
            <circle
              r={r}
              fill={colors.cityDotFill}
              stroke={colors.cityDotStroke}
              strokeWidth={1.5}
              opacity={isHovered ? 1 : 0.85}
              style={{
                transition: "transform 150ms ease, opacity 150ms ease",
                transform: isHovered ? "scale(1.3)" : "scale(1)",
                transformOrigin: "center",
              }}
            />
            {/* Invisible larger hit area */}
            <circle
              r={Math.max(r + 6, 10)}
              fill="transparent"
              onMouseEnter={() => onHover(key, label)}
              onMouseLeave={onLeave}
              style={{ cursor: "pointer" }}
            />
          </Marker>
        );
      })}
    </>
  );
});

interface ServerMarkerProps {
  serverGeo: { country: string } | null | undefined;
  colors: MapColors;
}

export const ServerMarker = memo(function ServerMarker({
  serverGeo,
  colors,
}: ServerMarkerProps) {
  const coordinates = useMemo((): [number, number] | null => {
    if (!serverGeo?.country) return null;

    const topo = geoData as unknown as Topology;
    const objectKey = Object.keys(topo.objects)[0];
    if (!objectKey) return null;

    const fc = feature(topo, topo.objects[objectKey]);
    const features = "features" in fc ? fc.features : [fc];

    for (const f of features) {
      const id =
        (f.properties?.ISO_A2 as string) ??
        (f.properties?.iso_a2 as string) ??
        (f.id as string);
      if (id === serverGeo.country) {
        return geoCentroid(f as Feature<Geometry>) as [number, number];
      }
    }
    return null;
  }, [serverGeo]);

  if (!coordinates) return null;

  return (
    <Marker coordinates={coordinates}>
      <g className="pointer-events-none">
        <rect
          x={-5}
          y={-5}
          width={10}
          height={10}
          fill={colors.serverColor}
          stroke={colors.cityDotFill}
          strokeWidth={1.5}
          transform="rotate(45)"
        />
        <text
          y={-12}
          textAnchor="middle"
          fill={colors.serverLabel}
          style={{ fontSize: "8px", fontWeight: 600, letterSpacing: "0.3px" }}
          className="select-none"
        >
          Server
        </text>
      </g>
    </Marker>
  );
});
