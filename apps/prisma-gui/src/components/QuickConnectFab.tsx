import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Play, Square, Loader2 } from "lucide-react";
import { usePlatform } from "@/hooks/usePlatform";
import { useConnection } from "@/hooks/useConnection";
import { useStore } from "@/store";
import { fmtDuration } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function QuickConnectFab() {
  const { t } = useTranslation();
  const { isMobile } = usePlatform();
  const { toggle } = useConnection();
  const connected = useStore((s) => s.connected);
  const connecting = useStore((s) => s.connecting);
  const connectStartTime = useStore((s) => s.connectStartTime);

  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  // Update elapsed duration every second when connected
  useEffect(() => {
    if (!connected || !connectStartTime) {
      setElapsed(0);
      return;
    }

    setElapsed(Math.floor((Date.now() - connectStartTime) / 1000));
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - connectStartTime) / 1000));
    }, 1000);

    return () => clearInterval(interval);
  }, [connected, connectStartTime]);

  // Only render on mobile
  if (!isMobile) return null;

  const handlePress = async () => {
    setBusy(true);
    try {
      await toggle();
    } finally {
      setBusy(false);
    }
  };

  const isDisabled = busy || connecting;

  return (
    <div className="fixed bottom-20 right-4 z-50 flex flex-col items-center gap-1">
      {/* Connection duration badge */}
      {connected && elapsed > 0 && (
        <span className="rounded-full bg-card/90 border border-border px-2 py-0.5 text-[10px] font-mono text-foreground shadow-sm backdrop-blur-sm">
          {fmtDuration(elapsed)}
        </span>
      )}

      {/* FAB button */}
      <button
        type="button"
        disabled={isDisabled}
        onClick={handlePress}
        aria-label={
          connecting
            ? t("home.connecting")
            : connected
              ? t("home.disconnect")
              : t("home.connect")
        }
        className={cn(
          "flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition-all active:scale-95",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          "min-h-[44px] min-w-[44px]",
          connecting && "bg-yellow-500 text-white animate-pulse",
          connected && !connecting && "bg-red-500 text-white hover:bg-red-600",
          !connected && !connecting && "bg-green-500 text-white hover:bg-green-600",
          isDisabled && "opacity-70",
        )}
      >
        {connecting ? (
          <Loader2 size={24} className="animate-spin" />
        ) : connected ? (
          <Square size={20} />
        ) : (
          <Play size={22} className="ml-0.5" />
        )}
      </button>
    </div>
  );
}
