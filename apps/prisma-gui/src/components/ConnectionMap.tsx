import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useConnections } from "@/store/connections";

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

// Approximate [x, y] positions on the SVG viewport (500x160) for common destination hosts.
// Since we lack GeoIP on the client, we scatter unique destinations deterministically
// across the map to give a visual sense of connection distribution.
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

/** Simple string hash for deterministic placement */
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** Derive a deterministic SVG position from a destination string */
function positionForDest(dest: string): [number, number] {
  const h = hashStr(dest);
  // Keep within the map area: x in [40, 460], y in [20, 140]
  const x = 40 + (h % 421);
  const y = 20 + ((h >> 10) % 121);
  return [x, y];
}

interface DestEntry {
  destination: string;
  count: number;
  x: number;
  y: number;
}

export default function ConnectionMap() {
  const { t } = useTranslation();
  const connections = useConnections((s) => s.connections);

  const [hovered, setHovered] = useState<DestEntry | null>(null);

  // Aggregate active connections by unique destination host (strip port)
  const entries: DestEntry[] = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of connections) {
      if (c.status !== "active") continue;
      const host = c.destination.replace(/:\d+$/, "");
      map.set(host, (map.get(host) ?? 0) + 1);
    }
    const result: DestEntry[] = [];
    for (const [dest, count] of map) {
      const [x, y] = positionForDest(dest);
      result.push({ destination: dest, count, x, y });
    }
    return result;
  }, [connections]);

  const maxCount = useMemo(
    () => (entries.length > 0 ? Math.max(...entries.map((e) => e.count), 1) : 1),
    [entries]
  );

  if (entries.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">
          {t("connections.mapTitle")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="relative">
          <svg
            viewBox="0 0 500 160"
            className="w-full h-auto"
            role="img"
            aria-label={t("connections.mapTitle")}
          >
            {/* World outline */}
            <path
              d={WORLD_PATH}
              fill="none"
              stroke="hsl(var(--muted-foreground))"
              strokeWidth="0.5"
              opacity="0.3"
            />

            {/* Grid lines */}
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
            {entries.map((entry, idx) => {
              const minRadius = 3;
              const maxRadius = 14;
              const radius =
                minRadius + (entry.count / maxCount) * (maxRadius - minRadius);
              const color = CIRCLE_COLORS[idx % CIRCLE_COLORS.length];

              return (
                <g key={entry.destination}>
                  {/* Glow effect */}
                  <circle
                    cx={entry.x}
                    cy={entry.y}
                    r={radius + 2}
                    fill={color}
                    opacity={0.15}
                  />
                  {/* Main circle */}
                  <circle
                    cx={entry.x}
                    cy={entry.y}
                    r={radius}
                    fill={color}
                    opacity={0.7}
                    stroke={color}
                    strokeWidth="1"
                    className="cursor-pointer transition-opacity hover:opacity-100"
                    onMouseEnter={() => setHovered(entry)}
                    onMouseLeave={() => setHovered(null)}
                  />
                  {/* Label for larger circles */}
                  {radius > 6 && (
                    <text
                      x={entry.x}
                      y={entry.y + 1}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      className="fill-background text-[4px] font-bold pointer-events-none select-none"
                    >
                      {entry.count}
                    </text>
                  )}
                </g>
              );
            })}

            {/* Tooltip */}
            {hovered && (
              <g>
                <rect
                  x={Math.min(hovered.x + 10, 380)}
                  y={hovered.y - 18}
                  width={Math.max(hovered.destination.length * 4.5 + 40, 80)}
                  height="20"
                  rx="3"
                  fill="hsl(var(--card))"
                  stroke="hsl(var(--border))"
                  strokeWidth="0.5"
                />
                <text
                  x={Math.min(hovered.x + 15, 385)}
                  y={hovered.y - 5}
                  className="fill-foreground text-[6px]"
                >
                  {t("connections.mapTooltip", {
                    dest: hovered.destination,
                    count: hovered.count,
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
