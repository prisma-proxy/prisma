import { useState, useMemo, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import ConfirmDialog from "@/components/ConfirmDialog";
import ConnectionMap from "@/components/ConnectionMap";
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

export default function Connections() {
  const { t } = useTranslation();
  const connections = useConnections((s) => s.connections);
  const clearAll = useConnections((s) => s.clearAll);
  const clearClosed = useConnections((s) => s.clearClosed);
  const closeConnectionById = useConnections((s) => s.closeConnectionById);

  // Force re-render every second for live duration updates
  const [, setTick] = useState(0);
  useEffect(() => {
    const hasActive = connections.some((c) => c.status === "active");
    if (!hasActive) return;
    const timer = setInterval(() => setTick((t) => t + 1), 3000);
    return () => clearInterval(timer);
  }, [connections]);

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
          cmp = a.destination.localeCompare(b.destination);
          break;
        case "action":
          cmp = a.action.localeCompare(b.action);
          break;
        case "status":
          cmp = a.status.localeCompare(b.status);
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

      {/* Table */}
      <ScrollArea className="flex-1 h-0 rounded-md border">
        {filtered.length === 0 ? (
          <p className="text-center text-muted-foreground py-8 text-sm">
            {t("connections.noConnections")}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[60px]">
                  <button
                    type="button"
                    className="flex items-center gap-1"
                    onClick={() => toggleSort("status")}
                  >
                    {t("connections.status")}
                    <SortIcon field="status" />
                  </button>
                </TableHead>
                <TableHead>
                  <button
                    type="button"
                    className="flex items-center gap-1"
                    onClick={() => toggleSort("destination")}
                  >
                    {t("connections.destination")}
                    <SortIcon field="destination" />
                  </button>
                </TableHead>
                <TableHead className="w-[100px]">
                  <button
                    type="button"
                    className="flex items-center gap-1"
                    onClick={() => toggleSort("action")}
                  >
                    {t("connections.action")}
                    <SortIcon field="action" />
                  </button>
                </TableHead>
                <TableHead className="w-[100px] hidden sm:table-cell">
                  {t("connections.rule")}
                </TableHead>
                <TableHead className="w-[80px] hidden sm:table-cell">
                  {t("connections.transport")}
                </TableHead>
                <TableHead className="w-[80px] text-right">
                  <button
                    type="button"
                    className="flex items-center gap-1 ml-auto"
                    onClick={() => toggleSort("bytesDown")}
                  >
                    <SortIcon field="bytesDown" />
                    {t("connections.download")}
                  </button>
                </TableHead>
                <TableHead className="w-[80px] text-right hidden sm:table-cell">
                  <button
                    type="button"
                    className="flex items-center gap-1 ml-auto"
                    onClick={() => toggleSort("bytesUp")}
                  >
                    <SortIcon field="bytesUp" />
                    {t("connections.upload")}
                  </button>
                </TableHead>
                <TableHead className="w-[80px] text-right">
                  <button
                    type="button"
                    className="flex items-center gap-1 ml-auto"
                    onClick={() => toggleSort("duration")}
                  >
                    <SortIcon field="duration" />
                    {t("connections.duration")}
                  </button>
                </TableHead>
                <TableHead className="w-[40px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((conn) => (
                <TableRow key={conn.id} className="text-xs">
                  <TableCell className="py-1.5">
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
                  </TableCell>
                  <TableCell className="py-1.5 font-mono text-xs max-w-[300px] truncate">
                    {conn.destination}
                  </TableCell>
                  <TableCell className="py-1.5">
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
                  </TableCell>
                  <TableCell className="py-1.5 text-muted-foreground hidden sm:table-cell">
                    {conn.rule}
                  </TableCell>
                  <TableCell className="py-1.5 text-muted-foreground hidden sm:table-cell">
                    {conn.transport}
                  </TableCell>
                  <TableCell className="py-1.5 text-right font-mono">
                    {fmtBytes(conn.bytesDown)}
                  </TableCell>
                  <TableCell className="py-1.5 text-right font-mono hidden sm:table-cell">
                    {fmtBytes(conn.bytesUp)}
                  </TableCell>
                  <TableCell className="py-1.5 text-right font-mono text-muted-foreground">
                    {fmtDuration(connDuration(conn))}
                  </TableCell>
                  <TableCell className="py-1.5">
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
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </ScrollArea>

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

      {/* Connection geo map */}
      <ConnectionMap />

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
