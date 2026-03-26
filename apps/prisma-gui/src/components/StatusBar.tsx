import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "@/store";
import { useNotifications } from "@/store/notifications";
import { fmtBytes, fmtUptime, fmtSpeed } from "@/lib/format";
import NotificationHistory from "./NotificationHistory";

export default function StatusBar() {
  const { t } = useTranslation();
  const connected = useStore((s) => s.connected);
  const connecting = useStore((s) => s.connecting);
  const stats = useStore((s) => s.stats);
  const current = useNotifications((s) => s.current);
  const dismiss = useNotifications((s) => s.dismiss);

  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (!current) { setVisible(false); return; }
    setVisible(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setVisible(false);
      dismiss(current.id);
    }, current.autoDismissMs);
    return () => clearTimeout(timerRef.current);
  }, [current, dismiss]);

  const dotColor = connected
    ? "bg-green-500"
    : connecting
    ? "bg-yellow-500 animate-pulse"
    : "bg-gray-500";

  const statusText = connected
    ? t("status.connected")
    : connecting
    ? t("status.connecting")
    : t("status.disconnected");

  const notifColor =
    current?.type === "error" ? "text-destructive"
    : current?.type === "warning" ? "text-yellow-500"
    : current?.type === "success" ? "text-green-500"
    : "text-muted-foreground";

  return (
    <div className="h-8 shrink-0 flex items-center gap-3 px-3 border-t border-border bg-card text-[11px] text-muted-foreground select-none overflow-hidden">
      {/* Status dot + label */}
      <div className="flex items-center gap-1.5 shrink-0">
        <div className={`w-2 h-2 rounded-full ${dotColor}`} />
        <span>{statusText}</span>
      </div>

      {/* Live stats */}
      {connected && stats ? (
        <div className="flex items-center gap-3 shrink-0">
          <span>↑{fmtSpeed(stats.speed_up_bps)}</span>
          <span>↓{fmtSpeed(stats.speed_down_bps)}</span>
          <span>{fmtBytes(stats.bytes_up)}/{fmtBytes(stats.bytes_down)}</span>
          <span className="font-mono">{fmtUptime(stats.uptime_secs)}</span>
        </div>
      ) : (
        <div className="flex items-center gap-3 shrink-0">
          <span>↑—</span>
          <span>↓—</span>
          <span>—/—</span>
          <span className="font-mono">—</span>
        </div>
      )}

      {/* Notification */}
      <div className="flex-1 text-right truncate">
        {visible && current && (
          <span className={`transition-opacity duration-300 ${notifColor}`}>
            {current.message}
          </span>
        )}
      </div>

      {/* Notification history bell */}
      <NotificationHistory />
    </div>
  );
}
