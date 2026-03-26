import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowUpDown,
  Search,
  Trash2,
  XCircle,
  ArrowDown,
  ArrowUp,
  X,
  Radio,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import ConfirmDialog from "@/components/ConfirmDialog";
import { useConnections, type TrackedConnection, type ConnectionAction } from "@/store/connections";
import { fmtBytes, fmtDuration } from "@/lib/format";
import { cn } from "@/lib/utils";

type SortField =
  | "destination"
  | "action"
  | "status"
  | "startedAt"
  | "bytesDown"
  | "bytesUp"
  | "duration";
type SortDir = "asc" | "desc";
type ActionFilter = "ALL" | "proxy" | "direct" | "blocked";
type StatusFilter = "ALL" | "active" | "closed";

function actionColor(action: ConnectionAction): string {
  switch (action) {
    case "proxy":
      return "text-blue-400 border-blue-400/30";
    case "direct":
      return "text-green-400 border-green-400/30";
    case "blocked":
      return "text-red-400 border-red-400/30";
  }
}

function actionDot(action: ConnectionAction): string {
  switch (action) {
    case "proxy":
      return "bg-blue-400";
    case "direct":
      return "bg-green-400";
    case "blocked":
      return "bg-red-400";
  }
}

function connDuration(conn: TrackedConnection): number {
  const end = conn.closedAt ?? Date.now();
  return Math.max(0, Math.floor((end - conn.startedAt) / 1000));
}

/** Single shared tick drives all duration displays — avoids N timers for N rows. */
function LiveDuration({ startedAt, closedAt, tick }: { startedAt: number; closedAt: number | null; tick: number }) {
  void tick; // used only to trigger re-render
  const end = closedAt ?? Date.now();
  const elapsed = Math.max(0, Math.floor((end - startedAt) / 1000));
  return <span>{fmtDuration(elapsed)}</span>;
}

const GRID_COLS = "grid-cols-[40px_1fr_80px_100px_80px_80px_80px_80px_36px]";
const GRID_COLS_MOBILE = "grid-cols-[32px_1fr_72px_72px_72px_28px]";

export default function Connections() {
  const { t } = useTranslation();
  const connections = useConnections((s) => s.connections);
  const clearAll = useConnections((s) => s.clearAll);
  const clearClosed = useConnections((s) => s.clearClosed);
  const closeConnectionById = useConnections((s) => s.closeConnectionById);

  // Single parent timer for all LiveDuration instances
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 3000);
    return () => clearInterval(id);
  }, []);

  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState<ActionFilter>("ALL");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [sortField, setSortField] = useState<SortField>("startedAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const toggleSort = useCallback(
    (field: SortField) => {
      if (sortField === field) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortField(field);
        setSortDir("desc");
      }
    },
    [sortField]
  );

  // Counts
  const counts = useMemo(() => {
    let active = 0;
    let closed = 0;
    let proxy = 0;
    let direct = 0;
    let blocked = 0;
    let totalDown = 0;
    let totalUp = 0;
    for (const c of connections) {
      if (c.status === "active") active++;
      else closed++;
      if (c.action === "proxy") proxy++;
      else if (c.action === "direct") direct++;
      else blocked++;
      totalDown += c.bytesDown;
      totalUp += c.bytesUp;
    }
    return { active, closed, proxy, direct, blocked, total: connections.length, totalDown, totalUp };
  }, [connections]);

  // Filter & sort
  const filtered = useMemo(() => {
    let list = connections;

    if (actionFilter !== "ALL") {
      list = list.filter((c) => c.action === actionFilter);
    }
    if (statusFilter !== "ALL") {
      list = list.filter((c) => c.status === statusFilter);
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (c) =>
          c.destination.toLowerCase().includes(q) ||
          c.rule.toLowerCase().includes(q) ||
          c.transport.toLowerCase().includes(q)
      );
    }

    // Sort
    const sorted = [...list].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "destination":
          cmp = a.destination < b.destination ? -1 : a.destination > b.destination ? 1 : 0;
          break;
        case "action":
          cmp = a.action < b.action ? -1 : a.action > b.action ? 1 : 0;
          break;
        case "status":
          cmp = a.status < b.status ? -1 : a.status > b.status ? 1 : 0;
          break;
        case "startedAt":
          cmp = a.startedAt - b.startedAt;
          break;
        case "bytesDown":
          cmp = a.bytesDown - b.bytesDown;
          break;
        case "bytesUp":
          cmp = a.bytesUp - b.bytesUp;
          break;
        case "duration":
          cmp = connDuration(a) - connDuration(b);
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

    return sorted;
  }, [connections, actionFilter, statusFilter, search, sortField, sortDir]);

  // Virtual scrolling
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 36,
    overscan: 15,
  });

  const SortIcon = useCallback(
    ({ field }: { field: SortField }) => {
      if (sortField !== field)
        return <ArrowUpDown size={12} className="opacity-30" />;
      return sortDir === "asc" ? (
        <ArrowUp size={12} />
      ) : (
        <ArrowDown size={12} />
      );
    },
    [sortField, sortDir]
  );

  return (
    <div className="p-4 flex flex-col h-full gap-3">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <Card>
          <CardContent className="py-2 px-3 text-center">
            <div className="flex items-center justify-center gap-1">
              <p className="text-lg font-bold">{counts.total}</p>
              {counts.active > 0 && (
                <Radio size={10} className="text-green-400 animate-pulse" />
              )}
            </div>
            <p className="text-[10px] text-muted-foreground">
              {t("connections.total")}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-2 px-3 text-center">
            <p className="text-lg font-bold text-green-400">{counts.active}</p>
            <p className="text-[10px] text-muted-foreground">
              {t("connections.active")}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-2 px-3 text-center">
            <p className="text-lg font-bold text-blue-400">{counts.proxy}</p>
            <p className="text-[10px] text-muted-foreground">
              {t("connections.proxy")}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-2 px-3 text-center">
            <p className="text-lg font-bold text-green-400">{counts.direct}</p>
            <p className="text-[10px] text-muted-foreground">
              {t("connections.direct")}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-2 px-3 text-center">
            <p className="text-lg font-bold text-red-400">{counts.blocked}</p>
            <p className="text-[10px] text-muted-foreground">
              {t("connections.blocked")}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[140px]">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            placeholder={t("connections.search")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 text-sm pl-8"
          />
        </div>
        <Select
          value={actionFilter}
          onValueChange={(v) => setActionFilter(v as ActionFilter)}
        >
          <SelectTrigger className="w-28 h-8 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{t("connections.allActions")}</SelectItem>
            <SelectItem value="proxy">{t("connections.proxy")}</SelectItem>
            <SelectItem value="direct">
              {t("connections.direct")}
            </SelectItem>
            <SelectItem value="blocked">{t("connections.blocked")}</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as StatusFilter)}
        >
          <SelectTrigger className="w-28 h-8 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{t("connections.allStatus")}</SelectItem>
            <SelectItem value="active">{t("connections.active")}</SelectItem>
            <SelectItem value="closed">{t("connections.closed")}</SelectItem>
          </SelectContent>
        </Select>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 shrink-0"
          onClick={clearClosed}
          title={t("connections.clearClosed")}
        >
          <XCircle size={14} />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 shrink-0"
          onClick={() => setConfirmOpen(true)}
          title={t("connections.clearAll")}
        >
          <Trash2 size={14} />
        </Button>
      </div>

      {/* Connections list - virtualized */}
      <div className="flex-1 h-0 rounded-md border flex flex-col overflow-hidden">
        {/* Sticky header - desktop */}
        <div
          className={cn(
            "hidden sm:grid gap-0 text-xs font-medium text-muted-foreground border-b bg-card px-2 py-1.5 shrink-0",
            GRID_COLS
          )}
        >
          <div>
            <button
              type="button"
              className="flex items-center gap-1"
              onClick={() => toggleSort("status")}
            >
              {t("connections.status")}
              <SortIcon field="status" />
            </button>
          </div>
          <div>
            <button
              type="button"
              className="flex items-center gap-1"
              onClick={() => toggleSort("destination")}
            >
              {t("connections.destination")}
              <SortIcon field="destination" />
            </button>
          </div>
          <div>
            <button
              type="button"
              className="flex items-center gap-1"
              onClick={() => toggleSort("action")}
            >
              {t("connections.action")}
              <SortIcon field="action" />
            </button>
          </div>
          <div>{t("connections.rule")}</div>
          <div>{t("connections.transport")}</div>
          <div className="text-right">
            <button
              type="button"
              className="flex items-center gap-1 ml-auto"
              onClick={() => toggleSort("bytesDown")}
            >
              <SortIcon field="bytesDown" />
              {t("connections.download")}
            </button>
          </div>
          <div className="text-right">
            <button
              type="button"
              className="flex items-center gap-1 ml-auto"
              onClick={() => toggleSort("bytesUp")}
            >
              <SortIcon field="bytesUp" />
              {t("connections.upload")}
            </button>
          </div>
          <div className="text-right">
            <button
              type="button"
              className="flex items-center gap-1 ml-auto"
              onClick={() => toggleSort("duration")}
            >
              <SortIcon field="duration" />
              {t("connections.duration")}
            </button>
          </div>
          <div />
        </div>

        {/* Sticky header - mobile */}
        <div
          className={cn(
            "grid sm:hidden gap-0 text-xs font-medium text-muted-foreground border-b bg-card px-2 py-1.5 shrink-0",
            GRID_COLS_MOBILE
          )}
        >
          <div>
            <button
              type="button"
              className="flex items-center gap-1"
              onClick={() => toggleSort("status")}
            >
              <SortIcon field="status" />
            </button>
          </div>
          <div>
            <button
              type="button"
              className="flex items-center gap-1"
              onClick={() => toggleSort("destination")}
            >
              {t("connections.destination")}
              <SortIcon field="destination" />
            </button>
          </div>
          <div>
            <button
              type="button"
              className="flex items-center gap-1"
              onClick={() => toggleSort("action")}
            >
              {t("connections.action")}
              <SortIcon field="action" />
            </button>
          </div>
          <div className="text-right">
            <button
              type="button"
              className="flex items-center gap-1 ml-auto"
              onClick={() => toggleSort("bytesDown")}
            >
              <SortIcon field="bytesDown" />
              {"\u2193"}
            </button>
          </div>
          <div className="text-right">
            <button
              type="button"
              className="flex items-center gap-1 ml-auto"
              onClick={() => toggleSort("duration")}
            >
              <SortIcon field="duration" />
              {t("connections.duration")}
            </button>
          </div>
          <div />
        </div>

        {/* Virtual scroll body */}
        <div ref={parentRef} className="flex-1 overflow-auto">
          {filtered.length === 0 ? (
            <p className="text-center text-muted-foreground py-8 text-sm">
              {t("connections.noConnections")}
            </p>
          ) : (
            <div
              style={{
                height: `${virtualizer.getTotalSize()}px`,
                width: "100%",
                position: "relative",
              }}
            >
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const conn = filtered[virtualRow.index];
                return (
                  <div
                    key={conn.id}
                    data-index={virtualRow.index}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      height: `${virtualRow.size}px`,
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    {/* Desktop row */}
                    <div
                      className={cn(
                        "hidden sm:grid gap-0 items-center text-xs px-2 h-full border-b border-border/30 hover:bg-muted/30",
                        GRID_COLS
                      )}
                    >
                      <div className="flex items-center">
                        <span
                          className={cn(
                            "inline-block w-2 h-2 rounded-full",
                            conn.status === "active"
                              ? "bg-green-400 animate-pulse"
                              : "bg-gray-400"
                          )}
                          title={
                            conn.status === "active"
                              ? t("connections.active")
                              : t("connections.closed")
                          }
                        />
                      </div>
                      <div className="font-mono text-xs truncate pr-1">
                        {conn.destination}
                      </div>
                      <div>
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[10px] px-1.5 py-0",
                            actionColor(conn.action)
                          )}
                        >
                          <span
                            className={cn(
                              "inline-block w-1.5 h-1.5 rounded-full mr-1",
                              actionDot(conn.action)
                            )}
                          />
                          {t(`connections.${conn.action}`)}
                        </Badge>
                      </div>
                      <div className="text-muted-foreground truncate">
                        {conn.rule}
                      </div>
                      <div className="text-muted-foreground truncate">
                        {conn.transport}
                      </div>
                      <div className="text-right font-mono">
                        {fmtBytes(conn.bytesDown)}
                      </div>
                      <div className="text-right font-mono">
                        {fmtBytes(conn.bytesUp)}
                      </div>
                      <div className="text-right font-mono text-muted-foreground">
                        <LiveDuration startedAt={conn.startedAt} closedAt={conn.closedAt} tick={tick} />
                      </div>
                      <div className="flex items-center justify-center">
                        {conn.status === "active" && (
                          <button
                            type="button"
                            className="p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                            onClick={() => closeConnectionById(conn.id)}
                            title={t("connections.close")}
                          >
                            <X size={12} />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Mobile row */}
                    <div
                      className={cn(
                        "grid sm:hidden gap-0 items-center text-xs px-2 h-full border-b border-border/30 hover:bg-muted/30",
                        GRID_COLS_MOBILE
                      )}
                    >
                      <div className="flex items-center">
                        <span
                          className={cn(
                            "inline-block w-2 h-2 rounded-full",
                            conn.status === "active"
                              ? "bg-green-400 animate-pulse"
                              : "bg-gray-400"
                          )}
                        />
                      </div>
                      <div className="font-mono text-xs truncate pr-1">
                        {conn.destination}
                      </div>
                      <div>
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[10px] px-1.5 py-0",
                            actionColor(conn.action)
                          )}
                        >
                          <span
                            className={cn(
                              "inline-block w-1.5 h-1.5 rounded-full mr-1",
                              actionDot(conn.action)
                            )}
                          />
                          {t(`connections.${conn.action}`)}
                        </Badge>
                      </div>
                      <div className="text-right font-mono">
                        {fmtBytes(conn.bytesDown)}
                      </div>
                      <div className="text-right font-mono text-muted-foreground">
                        <LiveDuration startedAt={conn.startedAt} closedAt={conn.closedAt} tick={tick} />
                      </div>
                      <div className="flex items-center justify-center">
                        {conn.status === "active" && (
                          <button
                            type="button"
                            className="p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                            onClick={() => closeConnectionById(conn.id)}
                            title={t("connections.close")}
                          >
                            <X size={12} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Footer summary */}
      {connections.length > 0 && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>
            {t("connections.showing", {
              count: filtered.length,
              total: connections.length,
            })}
          </span>
          {(counts.totalDown > 0 || counts.totalUp > 0) && (
            <span>
              {t("connections.totalTraffic")}: {"\u2193"}
              {fmtBytes(counts.totalDown)} {"\u2191"}
              {fmtBytes(counts.totalUp)}
            </span>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t("connections.clearAllTitle")}
        message={t("connections.clearAllMessage")}
        confirmLabel={t("connections.clearAll")}
        onConfirm={clearAll}
      />
    </div>
  );
}
