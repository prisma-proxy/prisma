import { useMemo } from "react";
import type { SpeedTestEntry } from "@/store/speedTestHistory";

interface Props {
  entries: SpeedTestEntry[];
}

export default function SpeedTestChart({ entries }: Props) {
  const last20 = useMemo(() => entries.slice(-20), [entries]);
  const maxVal = useMemo(
    () => Math.max(1, ...last20.map((e) => Math.max(e.downloadMbps, e.uploadMbps))),
    [last20],
  );

  if (last20.length === 0) return null;

  return (
    <div className="space-y-1">
      <div className="flex items-end gap-1 h-32">
        {last20.map((entry) => {
          const dlH = (entry.downloadMbps / maxVal) * 100;
          const ulH = (entry.uploadMbps / maxVal) * 100;
          return (
            <div key={entry.id} className="flex-1 flex items-end gap-[1px] min-w-0">
              <div
                className="flex-1 bg-green-500/70 rounded-t-sm transition-all"
                style={{ height: `${Math.max(2, dlH)}%` }}
                title={`↓ ${entry.downloadMbps.toFixed(1)} Mbps`}
              />
              <div
                className="flex-1 bg-blue-500/70 rounded-t-sm transition-all"
                style={{ height: `${Math.max(2, ulH)}%` }}
                title={`↑ ${entry.uploadMbps.toFixed(1)} Mbps`}
              />
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>0</span>
        <div className="flex gap-3">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-green-500/70" /> DL
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-blue-500/70" /> UL
          </span>
        </div>
        <span>{maxVal.toFixed(0)} Mbps</span>
      </div>
    </div>
  );
}
