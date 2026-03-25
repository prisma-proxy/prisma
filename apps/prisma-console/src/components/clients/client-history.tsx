"use client";

import { useMemo } from "react";
import { useClientMetricsHistory } from "@/hooks/use-client-metrics";
import { useI18n } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatBytes } from "@/lib/utils";
import { Activity } from "lucide-react";

interface HistoryEvent {
  time: string;
  timestamp: string;
  description: string;
  type: "connection" | "traffic";
}

const TRAFFIC_SPIKE_THRESHOLD = 1024 * 1024; // 1 MB change considered significant

export function ClientHistory({ clientId }: { clientId: string }) {
  const { t } = useI18n();
  const { data: history } = useClientMetricsHistory(clientId, "24h");

  const events = useMemo<HistoryEvent[]>(() => {
    if (!history || history.length < 2) return [];

    const result: HistoryEvent[] = [];

    for (let i = 1; i < history.length; i++) {
      const prev = history[i - 1];
      const curr = history[i];
      const time = new Date(curr.timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });

      // Detect connection count changes
      if (curr.active_connections !== prev.active_connections) {
        result.push({
          time,
          timestamp: curr.timestamp,
          description: t("clientHistory.activeConnections", {
            count: curr.active_connections,
          }),
          type: "connection",
        });
      }

      // Detect traffic spikes
      const deltaUp = curr.bytes_up - prev.bytes_up;
      const deltaDown = curr.bytes_down - prev.bytes_down;
      const totalDelta = deltaUp + deltaDown;

      if (totalDelta >= TRAFFIC_SPIKE_THRESHOLD) {
        result.push({
          time,
          timestamp: curr.timestamp,
          description: t("clientHistory.trafficSpike", {
            amount: formatBytes(totalDelta),
          }),
          type: "traffic",
        });
      }
    }

    return result.slice(-50).reverse();
  }, [history, t]);

  if (!history || history.length < 2) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Activity className="h-4 w-4" />
          {t("clientHistory.title")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            {t("clientHistory.noEvents")}
          </p>
        ) : (
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {events.map((event, idx) => (
              <div
                key={`${event.timestamp}-${idx}`}
                className="flex items-start gap-3 rounded-lg border px-3 py-2"
              >
                <span className="mt-0.5 text-xs font-mono text-muted-foreground whitespace-nowrap">
                  {event.time}
                </span>
                <span className="text-sm flex-1">{event.description}</span>
                <Badge
                  className={
                    event.type === "connection"
                      ? "bg-blue-500/15 text-blue-700 dark:text-blue-400"
                      : "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                  }
                >
                  {event.type === "connection"
                    ? t("clientHistory.typeConnection")
                    : t("clientHistory.typeTraffic")}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
