"use client";

import React, { useState, useMemo } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { CopyButton } from "@/components/ui/copy-button";
import { ArrowUp, ArrowDown, ChevronRight, ChevronDown, Layers } from "lucide-react";
import type { ConnectionInfo } from "@/lib/types";
import { formatBytes } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

/** Extract IP from "IP:port" or "[IPv6]:port" address strings. */
function stripPort(addr: string): string {
  if (addr.startsWith("[")) {
    const end = addr.indexOf("]");
    return end > 0 ? addr.slice(1, end) : addr;
  }
  const last = addr.lastIndexOf(":");
  return last > 0 ? addr.slice(0, last) : addr;
}

interface ConnectionTableProps {
  connections: ConnectionInfo[];
  onDisconnect: (sessionId: string) => void;
}

function SortIndicator({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (sortKey !== col) return null;
  return sortDir === "asc" ? (
    <ArrowUp className="inline h-3 w-3 ml-1" />
  ) : (
    <ArrowDown className="inline h-3 w-3 ml-1" />
  );
}

function formatConnectedAt(connectedAt: string): string {
  const date = new Date(connectedAt);
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

type SortKey = "peer_addr" | "transport" | "mode" | "connected_at" | "bytes_up" | "bytes_down";
type SortDir = "asc" | "desc";

interface IPGroup {
  ip: string;
  connections: ConnectionInfo[];
  totalBytesUp: number;
  totalBytesDown: number;
  firstConnected: string;
}

export function ConnectionTable({
  connections,
  onDisconnect,
}: ConnectionTableProps) {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [transportFilter, setTransportFilter] = useState("all");
  const [modeFilter, setModeFilter] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("connected_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [groupByIp] = useState(true);
  const [expandedIPs, setExpandedIPs] = useState<Set<string>>(new Set());

  // Unique transports and modes for filter dropdowns
  const transports = useMemo(
    () => [...new Set(connections.map((c) => c.transport))],
    [connections]
  );
  const modes = useMemo(
    () => [...new Set(connections.map((c) => c.mode))],
    [connections]
  );

  // Filter
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return connections.filter((c) => {
      if (q && !c.peer_addr.toLowerCase().includes(q) && !(c.client_name ?? "").toLowerCase().includes(q)) {
        return false;
      }
      if (transportFilter !== "all" && c.transport !== transportFilter) return false;
      if (modeFilter !== "all" && c.mode !== modeFilter) return false;
      return true;
    });
  }, [connections, search, transportFilter, modeFilter]);

  // Sort
  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "peer_addr":
          cmp = a.peer_addr.localeCompare(b.peer_addr);
          break;
        case "transport":
          cmp = a.transport.localeCompare(b.transport);
          break;
        case "mode":
          cmp = a.mode.localeCompare(b.mode);
          break;
        case "connected_at":
          cmp = new Date(a.connected_at).getTime() - new Date(b.connected_at).getTime();
          break;
        case "bytes_up":
          cmp = a.bytes_up - b.bytes_up;
          break;
        case "bytes_down":
          cmp = a.bytes_down - b.bytes_down;
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  // IP Groups
  const ipGroups = useMemo<IPGroup[]>(() => {
    if (!groupByIp) return [];
    const map = new Map<string, ConnectionInfo[]>();
    for (const conn of sorted) {
      const ip = stripPort(conn.peer_addr);
      const arr = map.get(ip) ?? [];
      arr.push(conn);
      map.set(ip, arr);
    }
    return [...map.entries()].map(([ip, conns]) => ({
      ip,
      connections: conns,
      totalBytesUp: conns.reduce((s, c) => s + c.bytes_up, 0),
      totalBytesDown: conns.reduce((s, c) => s + c.bytes_down, 0),
      firstConnected: conns.reduce(
        (min, c) => (c.connected_at < min ? c.connected_at : min),
        conns[0].connected_at
      ),
    }));
  }, [sorted, groupByIp]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === sorted.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(sorted.map((c) => c.session_id)));
    }
  }

  function toggleGroupSelect(group: IPGroup) {
    setSelected((prev) => {
      const next = new Set(prev);
      const ids = group.connections.map((c) => c.session_id);
      const allSelected = ids.every((id) => next.has(id));
      if (allSelected) {
        ids.forEach((id) => next.delete(id));
      } else {
        ids.forEach((id) => next.add(id));
      }
      return next;
    });
  }

  function toggleExpand(ip: string) {
    setExpandedIPs((prev) => {
      const next = new Set(prev);
      if (next.has(ip)) next.delete(ip);
      else next.add(ip);
      return next;
    });
  }

  function disconnectSelected() {
    selected.forEach((id) => onDisconnect(id));
    setSelected(new Set());
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle>{t("dashboard.activeConnections")}</CardTitle>
          <div className="flex items-center gap-2">
            {selected.size > 0 && (
              <Button variant="destructive" size="sm" onClick={disconnectSelected}>
                {t("connections.disconnectSelected")} ({selected.size})
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Filters */}
        <div className="flex gap-2 mb-4 flex-wrap">
          <Input
            placeholder={t("connections.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs"
          />
          <Select value={transportFilter} onValueChange={(v) => v && setTransportFilter(v)}>
            <SelectTrigger className="w-[140px]">
              <span className="flex flex-1 text-left">
                {transportFilter === "all" ? t("connections.allTransports") : transportFilter}
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("connections.allTransports")}</SelectItem>
              {transports.map((tr) => (
                <SelectItem key={tr} value={tr}>{tr}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={modeFilter} onValueChange={(v) => v && setModeFilter(v)}>
            <SelectTrigger className="w-[140px]">
              <span className="flex flex-1 text-left">
                {modeFilter === "all" ? t("connections.allModes") : modeFilter}
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("connections.allModes")}</SelectItem>
              {modes.map((m) => (
                <SelectItem key={m} value={m}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {sorted.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {t("connections.noConnections")}
          </p>
        ) : groupByIp ? (
          /* Grouped view */
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead className="w-10">
                  <input
                    type="checkbox"
                    checked={selected.size === sorted.length && sorted.length > 0}
                    onChange={toggleSelectAll}
                    className="rounded"
                  />
                </TableHead>
                <TableHead>{t("connections.peer")}</TableHead>
                <TableHead>Count</TableHead>
                <TableHead>{t("connections.bytesUp")}</TableHead>
                <TableHead>{t("connections.bytesDown")}</TableHead>
                <TableHead className="text-right">{t("connections.action")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ipGroups.map((group) => {
                const expanded = expandedIPs.has(group.ip);
                const groupAllSelected = group.connections.every((c) => selected.has(c.session_id));
                return (
                  <React.Fragment key={group.ip}>
                    <TableRow className="bg-muted/30">
                      <TableCell className="w-8 px-2">
                        <button
                          type="button"
                          onClick={() => toggleExpand(group.ip)}
                          className="p-0.5 rounded hover:bg-accent"
                        >
                          {expanded
                            ? <ChevronDown className="h-4 w-4" />
                            : <ChevronRight className="h-4 w-4" />
                          }
                        </button>
                      </TableCell>
                      <TableCell>
                        <input
                          type="checkbox"
                          checked={groupAllSelected}
                          onChange={() => toggleGroupSelect(group)}
                          className="rounded"
                        />
                      </TableCell>
                      <TableCell className="font-mono text-xs font-medium">
                        <span className="flex items-center gap-1">
                          {group.ip}
                          <CopyButton value={group.ip} />
                        </span>
                      </TableCell>
                      <TableCell className="text-sm font-medium">
                        {group.connections.length}
                      </TableCell>
                      <TableCell className="font-medium">{formatBytes(group.totalBytesUp)}</TableCell>
                      <TableCell className="font-medium">{formatBytes(group.totalBytesDown)}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => group.connections.forEach((c) => onDisconnect(c.session_id))}
                        >
                          {t("connections.disconnect")} ({group.connections.length})
                        </Button>
                      </TableCell>
                    </TableRow>
                    {expanded && group.connections.map((conn) => (
                      <TableRow key={conn.session_id} className="bg-muted/10">
                        <TableCell />
                        <TableCell>
                          <input
                            type="checkbox"
                            checked={selected.has(conn.session_id)}
                            onChange={() => toggleSelect(conn.session_id)}
                            className="rounded"
                          />
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground pl-8">
                          :{conn.peer_addr.split(":").pop()}
                          {conn.client_name && <span className="ml-2 text-foreground">{conn.client_name}</span>}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{conn.transport} / {conn.mode}</TableCell>
                        <TableCell className="text-xs">{formatBytes(conn.bytes_up)}</TableCell>
                        <TableCell className="text-xs">{formatBytes(conn.bytes_down)}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => onDisconnect(conn.session_id)}
                          >
                            {t("connections.disconnect")}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </React.Fragment>
                );
              })}
            </TableBody>
          </Table>
        ) : (
          /* Flat view */
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <input
                    type="checkbox"
                    checked={selected.size === sorted.length && sorted.length > 0}
                    onChange={toggleSelectAll}
                    className="rounded"
                  />
                </TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => handleSort("peer_addr")}>
                  {t("connections.peer")}<SortIndicator sortKey={sortKey} sortDir={sortDir} col="peer_addr" />
                </TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => handleSort("transport")}>
                  {t("connections.transport")}<SortIndicator sortKey={sortKey} sortDir={sortDir} col="transport" />
                </TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => handleSort("mode")}>
                  {t("connections.mode")}<SortIndicator sortKey={sortKey} sortDir={sortDir} col="mode" />
                </TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => handleSort("connected_at")}>
                  {t("connections.connected")}<SortIndicator sortKey={sortKey} sortDir={sortDir} col="connected_at" />
                </TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => handleSort("bytes_up")}>
                  {t("connections.bytesUp")}<SortIndicator sortKey={sortKey} sortDir={sortDir} col="bytes_up" />
                </TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => handleSort("bytes_down")}>
                  {t("connections.bytesDown")}<SortIndicator sortKey={sortKey} sortDir={sortDir} col="bytes_down" />
                </TableHead>
                <TableHead className="text-right">{t("connections.action")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((conn) => (
                <TableRow key={conn.session_id}>
                  <TableCell>
                    <input
                      type="checkbox"
                      checked={selected.has(conn.session_id)}
                      onChange={() => toggleSelect(conn.session_id)}
                      className="rounded"
                    />
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    <span className="flex items-center gap-1">
                      {stripPort(conn.peer_addr)}
                      <CopyButton value={stripPort(conn.peer_addr)} />
                    </span>
                  </TableCell>
                  <TableCell>{conn.transport}</TableCell>
                  <TableCell>{conn.mode}</TableCell>
                  <TableCell>{formatConnectedAt(conn.connected_at)}</TableCell>
                  <TableCell>{formatBytes(conn.bytes_up)}</TableCell>
                  <TableCell>{formatBytes(conn.bytes_down)}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => onDisconnect(conn.session_id)}
                    >
                      {t("connections.disconnect")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
