import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { TrackedConnection } from "@/store/connections";

interface ConnectionTimelineProps {
  connections: TrackedConnection[];
}

const WINDOW_MS = 5 * 60 * 1000;
const BAR_HEIGHT = 6;
const BAR_GAP = 2;
const PADDING_TOP = 20;
const PADDING_BOTTOM = 20;
const PADDING_LEFT = 2;
const PADDING_RIGHT = 2;

interface TimelineBar {
  conn: TrackedConnection;
  x: number;
  width: number;
  y: number;
  color: string;
}

export default function ConnectionTimeline({ connections }: ConnectionTimelineProps) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState<TrackedConnection | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  // Tick every second so the timeline slides
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const windowStart = now - WINDOW_MS;

  const visibleConns = useMemo(() => {
    return connections.filter((c) => {
      const end = c.closedAt ?? now;
      return end >= windowStart && c.startedAt <= now;
    });
  }, [connections, windowStart, now]);

  const activeCount = visibleConns.filter((c) => c.status === "active").length;

  const { bars, svgHeight } = useMemo(() => {
    const chartWidth = 100;
    const usableWidth = chartWidth - PADDING_LEFT - PADDING_RIGHT;

    const result: TimelineBar[] = visibleConns.map((conn, idx) => {
      const start = Math.max(conn.startedAt, windowStart);
      const end = Math.min(conn.closedAt ?? now, now);

      const xPct = ((start - windowStart) / WINDOW_MS) * usableWidth + PADDING_LEFT;
      const wPct = Math.max(0.5, ((end - start) / WINDOW_MS) * usableWidth);

      const y = PADDING_TOP + idx * (BAR_HEIGHT + BAR_GAP);

      const color = conn.status === "active" ? "#4ade80" : "#9ca3af";

      return { conn, x: xPct, width: wPct, y, color };
    });

    const height = PADDING_TOP + visibleConns.length * (BAR_HEIGHT + BAR_GAP) + PADDING_BOTTOM;
    return { bars: result, svgHeight: Math.max(height, 80) };
  }, [visibleConns, windowStart, now]);

  const timeLabels = useMemo(() => {
    const labels: { x: number; label: string }[] = [];
    const usableWidth = 100 - PADDING_LEFT - PADDING_RIGHT;

    for (let i = 0; i <= 5; i++) {
      const offsetMs = i * 60 * 1000;
      const xPct = (offsetMs / WINDOW_MS) * usableWidth + PADDING_LEFT;
      const minutesAgo = 5 - i;
      labels.push({
        x: xPct,
        label: minutesAgo === 0 ? "now" : `-${minutesAgo}m`,
      });
    }
    return labels;
  }, []);

  if (visibleConns.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">
            {t("connections.timeline")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground text-center py-4">
            {t("connections.timelineEmpty")}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">
            {t("connections.timeline")}
          </CardTitle>
          <span className="text-xs text-muted-foreground">
            {activeCount} {t("connections.active")}
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <div className="relative">
          <svg
            viewBox={`0 0 100 ${svgHeight}`}
            className="w-full"
            style={{ height: Math.min(svgHeight * 1.5, 200) }}
            preserveAspectRatio="xMidYMid meet"
            role="img"
            aria-label={t("connections.timeline")}
            onMouseLeave={() => setHovered(null)}
          >
            {timeLabels.map((tl) => (
              <g key={tl.label}>
                <line
                  x1={tl.x}
                  y1={PADDING_TOP - 4}
                  x2={tl.x}
                  y2={svgHeight - PADDING_BOTTOM}
                  stroke="currentColor"
                  strokeWidth="0.15"
                  opacity="0.15"
                  strokeDasharray="0.5,0.5"
                />
                <text
                  x={tl.x}
                  y={PADDING_TOP - 6}
                  textAnchor="middle"
                  fill="currentColor"
                  opacity="0.5"
                  style={{ fontSize: "3px" }}
                >
                  {tl.label}
                </text>
              </g>
            ))}

            {bars.map((bar) => (
              <rect
                key={bar.conn.id}
                x={bar.x}
                y={bar.y}
                width={bar.width}
                height={BAR_HEIGHT}
                rx={1}
                fill={bar.color}
                opacity={hovered?.id === bar.conn.id ? 1 : 0.7}
                className="cursor-pointer transition-opacity"
                onMouseEnter={(e) => {
                  setHovered(bar.conn);
                  const svg = e.currentTarget.ownerSVGElement;
                  if (svg) {
                    const rect = svg.getBoundingClientRect();
                    setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
                  }
                }}
                onMouseMove={(e) => {
                  const svg = e.currentTarget.ownerSVGElement;
                  if (svg) {
                    const rect = svg.getBoundingClientRect();
                    setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
                  }
                }}
                onMouseLeave={() => setHovered(null)}
              />
            ))}
          </svg>

          {hovered && (
            <div
              className="absolute pointer-events-none z-10 bg-card border border-border rounded px-2 py-1 text-[10px] text-foreground shadow-md whitespace-nowrap"
              style={{ left: mousePos.x + 8, top: mousePos.y - 28 }}
            >
              <span className="font-mono">{hovered.destination}</span>
              <span className="text-muted-foreground mx-1">|</span>
              <span>{hovered.transport}</span>
              <span className="text-muted-foreground mx-1">|</span>
              <span>
                {Math.max(0, Math.floor(((hovered.closedAt ?? Date.now()) - hovered.startedAt) / 1000))}s
              </span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
