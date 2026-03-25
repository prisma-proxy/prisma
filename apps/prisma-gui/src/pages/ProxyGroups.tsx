import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  Layers,
  Signal,
  RefreshCw,
  Loader2,
  Check,
  Shuffle,
  ShieldAlert,
  Zap,
  ArrowDownUp,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/commands";
import { notify } from "@/store/notifications";
import type {
  ProxyGroupInfo,
  LatencyResult,
  GroupType,
} from "@/lib/types";

function groupTypeIcon(gt: GroupType) {
  switch (gt) {
    case "select":
      return <Check size={14} />;
    case "auto_url":
      return <Zap size={14} />;
    case "fallback":
      return <ShieldAlert size={14} />;
    case "load_balance":
      return <Shuffle size={14} />;
  }
}

function groupTypeLabel(gt: GroupType, t: (key: string) => string): string {
  switch (gt) {
    case "select":
      return t("proxyGroups.typeSelect");
    case "auto_url":
      return t("proxyGroups.typeAutoUrl");
    case "fallback":
      return t("proxyGroups.typeFallback");
    case "load_balance":
      return t("proxyGroups.typeLoadBalance");
  }
}

function groupTypeBadgeColor(gt: GroupType): string {
  switch (gt) {
    case "select":
      return "text-blue-400 border-blue-400/30";
    case "auto_url":
      return "text-green-400 border-green-400/30";
    case "fallback":
      return "text-yellow-400 border-yellow-400/30";
    case "load_balance":
      return "text-purple-400 border-purple-400/30";
  }
}

function latencyBgColor(ms: number | null): string {
  if (ms == null) return "bg-gray-100 dark:bg-gray-800";
  if (ms < 100)
    return "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400";
  if (ms < 300)
    return "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400";
  return "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400";
}

export default function ProxyGroups() {
  const { t } = useTranslation();
  const [groups, setGroups] = useState<ProxyGroupInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [testingGroup, setTestingGroup] = useState<string | null>(null);
  const [latencyResults, setLatencyResults] = useState<
    Record<string, LatencyResult[]>
  >({});
  const [selecting, setSelecting] = useState<string | null>(null);

  const fetchGroups = useCallback(async () => {
    try {
      const result = await api.proxyGroupsList();
      setGroups(result);
    } catch {
      // Groups might not be initialized — that's OK
      setGroups([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  async function handleTestGroup(groupName: string) {
    setTestingGroup(groupName);
    try {
      const results = await api.proxyGroupTest(groupName);
      setLatencyResults((prev) => ({ ...prev, [groupName]: results }));
      // Refresh groups to get updated selections
      await fetchGroups();
    } catch (e) {
      notify.error(String(e));
    } finally {
      setTestingGroup(null);
    }
  }

  async function handleSelect(groupName: string, server: string) {
    setSelecting(`${groupName}:${server}`);
    try {
      await api.proxyGroupSelect(groupName, server);
      await fetchGroups();
      notify.success(
        t("proxyGroups.selected", { group: groupName, server })
      );
    } catch (e) {
      notify.error(String(e));
    } finally {
      setSelecting(null);
    }
  }

  async function handleTestAll() {
    for (const group of groups) {
      await handleTestGroup(group.name);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="animate-spin text-muted-foreground" size={24} />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 flex flex-col h-full gap-3">
      <div className="flex items-center justify-between">
        <h1 className="font-bold text-lg">
          {t("proxyGroups.title")}
        </h1>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={handleTestAll}
            disabled={testingGroup !== null}
            title={t("proxyGroups.testAll")}
          >
            {testingGroup ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Signal size={14} />
            )}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={fetchGroups}
            title={t("proxyGroups.refresh")}
          >
            <RefreshCw size={14} />
          </Button>
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center">
          <Layers
            size={40}
            className="text-muted-foreground mb-3 opacity-50"
          />
          <p className="text-sm text-muted-foreground">
            {t("proxyGroups.noGroups")}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {t("proxyGroups.noGroupsDesc")}
          </p>
        </div>
      ) : (
        <ScrollArea className="flex-1 h-0">
          <div className="space-y-3 pr-2">
            {groups.map((group) => {
              const isTesting = testingGroup === group.name;
              const results = latencyResults[group.name] ?? [];
              const resultMap = new Map(
                results.map((r) => [r.server, r])
              );

              return (
                <Card key={group.name}>
                  <CardHeader className="pb-2 pt-3 px-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {groupTypeIcon(group.group_type)}
                        <CardTitle className="text-sm">
                          {group.name}
                        </CardTitle>
                        <Badge
                          variant="outline"
                          className={`text-[10px] px-1.5 py-0 ${groupTypeBadgeColor(
                            group.group_type
                          )}`}
                        >
                          {groupTypeLabel(group.group_type, t)}
                        </Badge>
                        {group.group_type === "load_balance" && (
                          <Badge
                            variant="outline"
                            className="text-[10px] px-1.5 py-0"
                          >
                            <ArrowDownUp size={8} className="mr-0.5" />
                            {group.lb_strategy === "round_robin"
                              ? t("proxyGroups.roundRobin")
                              : t("proxyGroups.random")}
                          </Badge>
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={isTesting}
                        onClick={() => handleTestGroup(group.name)}
                      >
                        {isTesting ? (
                          <Loader2
                            size={12}
                            className="animate-spin mr-1"
                          />
                        ) : (
                          <Signal size={12} className="mr-1" />
                        )}
                        {t("proxyGroups.test")}
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="px-4 pb-3">
                    <div className="space-y-1">
                      {group.servers.map((server) => {
                        const isSelected =
                          group.selected === server;
                        const lr = resultMap.get(server);
                        const isSelecting =
                          selecting === `${group.name}:${server}`;
                        const canSelect =
                          group.group_type === "select";

                        return (
                          <div
                            key={server}
                            className={`flex items-center justify-between rounded-md px-3 py-2 text-sm transition-colors ${
                              isSelected
                                ? "bg-accent border border-green-500/30"
                                : "hover:bg-muted/50"
                            } ${canSelect ? "cursor-pointer" : ""}`}
                            onClick={() =>
                              canSelect &&
                              !isSelecting &&
                              handleSelect(group.name, server)
                            }
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              {isSelected && (
                                <Check
                                  size={14}
                                  className="text-green-500 shrink-0"
                                />
                              )}
                              {isSelecting && (
                                <Loader2
                                  size={14}
                                  className="animate-spin shrink-0"
                                />
                              )}
                              <span className="truncate font-mono text-xs">
                                {server}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {lr && (
                                <>
                                  {lr.latency_ms != null ? (
                                    <Badge
                                      variant="outline"
                                      className={`text-[10px] px-1.5 py-0 border-0 ${latencyBgColor(
                                        lr.latency_ms
                                      )}`}
                                    >
                                      {lr.latency_ms}ms
                                    </Badge>
                                  ) : (
                                    <Badge
                                      variant="outline"
                                      className="text-[10px] px-1.5 py-0 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400"
                                    >
                                      {lr.error ?? t("proxyGroups.timeout")}
                                    </Badge>
                                  )}
                                  <span
                                    className={`inline-block w-2 h-2 rounded-full ${
                                      lr.available
                                        ? "bg-green-400"
                                        : "bg-red-400"
                                    }`}
                                  />
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {group.test_url && (
                      <p className="text-[10px] text-muted-foreground mt-2 flex items-center gap-1">
                        <ExternalLink size={8} />
                        {group.test_url} &middot;{" "}
                        {group.test_interval_secs}s
                      </p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
