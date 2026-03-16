import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Trash2, Pause, Play, Download } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ConfirmDialog from "@/components/ConfirmDialog";
import { useStore } from "@/store";
import type { LogEntry } from "@/lib/types";
import { cn } from "@/lib/utils";

type LevelFilter = "ALL" | "ERROR" | "WARN" | "INFO" | "DEBUG";

function levelBadge(level: LogEntry["level"]) {
  switch (level) {
    case "ERROR": return <Badge variant="destructive" className="text-[10px] px-1 py-0">ERR</Badge>;
    case "WARN":  return <Badge variant="warning"     className="text-[10px] px-1 py-0">WRN</Badge>;
    case "DEBUG": return <Badge variant="secondary"   className="text-[10px] px-1 py-0">DBG</Badge>;
    default:      return <Badge variant="outline"     className="text-[10px] px-1 py-0">INF</Badge>;
  }
}

export default function Logs() {
  const { t } = useTranslation();
  const logs = useStore((s) => s.logs);
  const clearLogs = useStore((s) => s.clearLogs);
  const [search,      setSearch]      = useState("");
  const [levelFilter, setLevelFilter] = useState<LevelFilter>("ALL");
  const [paused,      setPaused]      = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const parentRef = useRef<HTMLDivElement>(null);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const filtered = useMemo(
    () =>
      logs.filter((l) => {
        if (levelFilter !== "ALL" && l.level !== levelFilter) return false;
        if (search && !l.msg.toLowerCase().includes(search.toLowerCase())) return false;
        return true;
      }),
    [logs, search, levelFilter],
  );

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 28,
    overscan: 20,
  });

  // Debounced auto-scroll
  useEffect(() => {
    if (paused || filtered.length === 0) return;
    clearTimeout(scrollTimerRef.current);
    scrollTimerRef.current = setTimeout(() => {
      virtualizer.scrollToIndex(filtered.length - 1, { align: "end" });
    }, 100);
    return () => clearTimeout(scrollTimerRef.current);
  }, [filtered.length, paused, virtualizer]);

  const handleExport = useCallback(() => {
    const lines = filtered.map(
      (l) => `[${new Date(l.time).toISOString()}] [${l.level}] ${l.msg}`
    );
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `prisma-logs-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filtered]);

  return (
    <div className="p-4 flex flex-col h-full gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Input
          placeholder={t("logs.search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 text-sm flex-1 min-w-[140px]"
        />
        <Select value={levelFilter} onValueChange={(v) => setLevelFilter(v as LevelFilter)}>
          <SelectTrigger className="w-28 h-8 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(["ALL", "ERROR", "WARN", "INFO", "DEBUG"] as LevelFilter[]).map((l) => (
              <SelectItem key={l} value={l}>{l}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 shrink-0"
          onClick={() => setPaused((v) => !v)}
          title={paused ? t("logs.resume") : t("logs.pause")}
        >
          {paused ? <Play size={14} /> : <Pause size={14} />}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 shrink-0"
          onClick={handleExport}
          title={t("logs.export")}
        >
          <Download size={14} />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 shrink-0"
          onClick={() => setConfirmOpen(true)}
          title={t("logs.clear")}
        >
          <Trash2 size={14} />
        </Button>
      </div>

      <div
        ref={parentRef}
        className="flex-1 h-0 rounded-md border overflow-auto logs-scroll-container font-mono text-[11px]"
      >
        {filtered.length === 0 ? (
          <p className="text-center text-muted-foreground py-8 font-sans text-sm">{t("logs.noLogs")}</p>
        ) : (
          <div
            style={{ height: `${virtualizer.getTotalSize()}px`, width: "100%", position: "relative" }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const l = filtered[virtualRow.index];
              return (
                <div
                  key={`${l.time}-${virtualRow.index}`}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                  className={cn(
                    "flex items-start gap-2 py-0.5 px-2",
                    l.level === "ERROR" && "text-destructive",
                  )}
                >
                  {levelBadge(l.level)}
                  <span className="text-muted-foreground shrink-0">
                    {new Date(l.time).toLocaleTimeString()}
                  </span>
                  <span className="break-all">{l.msg}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t("logs.clearTitle")}
        message={t("logs.clearMessage")}
        confirmLabel={t("logs.clear")}
        onConfirm={clearLogs}
      />
    </div>
  );
}
