"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Simplified world map SVG path (natural earth-style outline)
const WORLD_PATH =
  "M 131,32 L 135,35 138,33 142,35 145,32 150,33 155,30 160,32 165,30 170,35 175,33 178,30 " +
  "180,25 185,22 190,20 195,22 200,25 205,22 210,25 215,28 220,25 225,22 230,25 235,28 " +
  "240,30 245,28 250,25 255,28 260,30 265,33 270,35 275,33 280,30 285,28 290,25 295,28 " +
  "300,30 305,33 310,35 315,40 320,38 325,35 330,33 335,30 340,28 345,25 350,28 355,30 " +
  "360,33 365,35 370,38 375,40 380,42 385,45 380,48 375,50 370,52 365,55 360,58 355,60 " +
  "350,58 345,55 340,52 335,50 330,48 325,50 320,52 315,55 310,58 305,60 300,62 295,60 " +
  "290,58 285,55 280,52 275,55 270,58 265,60 260,62 255,65 250,68 245,70 240,72 235,70 " +
  "230,68 225,65 220,68 215,70 210,72 205,75 200,78 195,80 190,82 185,85 180,88 175,85 " +
  "170,82 165,80 160,78 155,80 150,82 145,85 140,82 135,80 130,78 125,75 120,72 115,70 " +
  "110,68 105,65 100,62 95,60 90,58 85,55 80,52 75,50 70,48 65,45 60,42 55,40 50,38 " +
  "45,35 40,33 45,30 50,28 55,30 60,33 65,35 70,33 75,30 80,28 85,30 90,33 95,30 100,28 " +
  "105,30 110,33 115,30 120,28 125,30 131,32 Z";

// Country code to approximate [x, y] position on the SVG viewport (500x250)
const COUNTRY_POSITIONS: Record<string, [number, number]> = {
  US: [100, 55],
  CA: [105, 38],
  MX: [85, 72],
  BR: [155, 105],
  AR: [140, 130],
  CL: [130, 125],
  CO: [120, 85],
  PE: [120, 100],
  VE: [130, 80],
  GB: [230, 40],
  FR: [240, 48],
  DE: [250, 42],
  IT: [252, 52],
  ES: [232, 55],
  PT: [225, 55],
  NL: [245, 40],
  BE: [243, 43],
  CH: [248, 48],
  AT: [255, 46],
  PL: [260, 40],
  CZ: [255, 42],
  SE: [255, 28],
  NO: [250, 25],
  FI: [265, 25],
  DK: [250, 35],
  IE: [225, 40],
  RU: [330, 35],
  UA: [275, 42],
  TR: [278, 55],
  GR: [265, 55],
  RO: [268, 48],
  HU: [260, 46],
  CN: [370, 55],
  JP: [405, 52],
  KR: [395, 52],
  IN: [340, 72],
  PK: [325, 62],
  BD: [350, 70],
  TH: [365, 75],
  VN: [370, 72],
  MY: [368, 85],
  SG: [368, 88],
  ID: [378, 92],
  PH: [388, 78],
  TW: [390, 68],
  HK: [382, 68],
  AU: [400, 120],
  NZ: [425, 135],
  ZA: [270, 125],
  EG: [275, 65],
  NG: [248, 82],
  KE: [285, 92],
  MA: [228, 62],
  DZ: [242, 62],
  SA: [295, 70],
  AE: [310, 68],
  IL: [280, 62],
  IR: [308, 58],
  IQ: [295, 58],
};

const CIRCLE_COLORS = [
  "hsl(217, 91%, 60%)",
  "hsl(142, 71%, 45%)",
  "hsl(38, 92%, 50%)",
  "hsl(0, 84%, 60%)",
  "hsl(271, 91%, 65%)",
  "hsl(187, 85%, 43%)",
  "hsl(315, 80%, 60%)",
  "hsl(60, 100%, 45%)",
];

export function ConnectionMap() {
  const { t } = useI18n();
  const [hoveredCountry, setHoveredCountry] = useState<{
    country: string;
    count: number;
    x: number;
    y: number;
  } | null>(null);

  const { data: geo } = useQuery({
    queryKey: ["connections-geo"],
    queryFn: () => api.getConnectionGeo(),
    refetchInterval: 15000,
  });

  const maxCount = useMemo(
    () => (geo ? Math.max(...geo.map((g) => g.count), 1) : 1),
    [geo]
  );

  if (!geo || geo.length === 0) {
    return null;
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
            viewBox="0 0 500 160"
            className="w-full h-auto"
            role="img"
            aria-label={t("connectionMap.title")}
          >
            {/* World outline */}
            <path
              d={WORLD_PATH}
              fill="none"
              stroke="hsl(var(--muted-foreground))"
              strokeWidth="0.5"
              opacity="0.3"
            />

            {/* Grid lines for reference */}
            {[40, 80, 120].map((y) => (
              <line
                key={`h-${y}`}
                x1="20"
                y1={y}
                x2="480"
                y2={y}
                stroke="hsl(var(--muted-foreground))"
                strokeWidth="0.2"
                opacity="0.15"
              />
            ))}
            {[100, 200, 300, 400].map((x) => (
              <line
                key={`v-${x}`}
                x1={x}
                y1="10"
                x2={x}
                y2="150"
                stroke="hsl(var(--muted-foreground))"
                strokeWidth="0.2"
                opacity="0.15"
              />
            ))}

            {/* Connection circles */}
            {geo.map((entry, idx) => {
              const pos = COUNTRY_POSITIONS[entry.country];
              if (!pos) return null;

              const minRadius = 3;
              const maxRadius = 14;
              const radius =
                minRadius + (entry.count / maxCount) * (maxRadius - minRadius);
              const color = CIRCLE_COLORS[idx % CIRCLE_COLORS.length];

              return (
                <g key={entry.country}>
                  {/* Glow effect */}
                  <circle
                    cx={pos[0]}
                    cy={pos[1]}
                    r={radius + 2}
                    fill={color}
                    opacity={0.15}
                  />
                  {/* Main circle */}
                  <circle
                    cx={pos[0]}
                    cy={pos[1]}
                    r={radius}
                    fill={color}
                    opacity={0.7}
                    stroke={color}
                    strokeWidth="1"
                    className="cursor-pointer transition-opacity hover:opacity-100"
                    onMouseEnter={() =>
                      setHoveredCountry({
                        country: entry.country,
                        count: entry.count,
                        x: pos[0],
                        y: pos[1],
                      })
                    }
                    onMouseLeave={() => setHoveredCountry(null)}
                  />
                  {/* Country label for larger circles */}
                  {radius > 6 && (
                    <text
                      x={pos[0]}
                      y={pos[1] + 1}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      className="fill-background text-[5px] font-bold pointer-events-none select-none"
                    >
                      {entry.country}
                    </text>
                  )}
                </g>
              );
            })}

            {/* Tooltip */}
            {hoveredCountry && (
              <g>
                <rect
                  x={hoveredCountry.x + 10}
                  y={hoveredCountry.y - 18}
                  width={Math.max(
                    hoveredCountry.country.length * 5 +
                      String(hoveredCountry.count).length * 5 +
                      50,
                    80
                  )}
                  height="20"
                  rx="3"
                  fill="hsl(var(--card))"
                  stroke="hsl(var(--border))"
                  strokeWidth="0.5"
                />
                <text
                  x={hoveredCountry.x + 15}
                  y={hoveredCountry.y - 5}
                  className="fill-foreground text-[6px]"
                >
                  {t("connectionMap.tooltip", {
                    country: hoveredCountry.country,
                    count: hoveredCountry.count,
                  })}
                </text>
              </g>
            )}
          </svg>
        </div>
      </CardContent>
    </Card>
  );
}
