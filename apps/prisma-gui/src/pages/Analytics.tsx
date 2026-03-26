import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Download, Trash2, ArrowDown, ArrowUp, Globe, Network, GitBranch } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import ConfirmDialog from "@/components/ConfirmDialog";
import { useAnalytics } from "@/store/analytics";
import { fmtBytes } from "@/lib/format";
import { downloadText } from "@/lib/utils";

type TrendRange = 7 | 30;

export default function Analytics() {
  const { t } = useTranslation();
  const domains = useAnalytics((s) => s.domains);
  const ruleStats = useAnalytics((s) => s.rule_stats);
  const getTopDomains = useAnalytics((s) => s.getTopDomains);
  const getDailyTrend = useAnalytics((s) => s.getDailyTrend);
  const exportCsv = useAnalytics((s) => s.exportCsv);
  const clear = useAnalytics((s) => s.clear);

  const [trendRange, setTrendRange] = useState<TrendRange>(7);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Summary
  const summary = useMemo(() => {
    let totalUp = 0;
    let totalDown = 0;
    let totalConns = 0;
    const today = new Date().toISOString().slice(0, 10);
    let todayUp = 0;
    let todayDown = 0;

    for (const stats of Object.values(domains)) {
      totalUp += stats.bytes_up;
      totalDown += stats.bytes_down;
      totalConns += stats.connections;
    }

    const trend = getDailyTrend(1);
    const todayEntry = trend.find((d) => d.date === today);
    if (todayEntry) {
      todayUp = todayEntry.bytes_up;
      todayDown = todayEntry.bytes_down;
    }

    return { totalUp, totalDown, totalConns, todayUp, todayDown };
  }, [domains, getDailyTrend]);

  const topDomains = useMemo(() => getTopDomains(10), [getTopDomains, domains]);
  const dailyTrend = useMemo(() => getDailyTrend(trendRange), [getDailyTrend, trendRange, domains]);

  const topDomain = topDomains.length > 0 ? topDomains[0][0] : "-";
  const maxDomainBytes = topDomains.length > 0
    ? topDomains[0][1].bytes_up + topDomains[0][1].bytes_down
    : 1;

  const maxDailyBytes = useMemo(() => {
    let max = 1;
    for (const day of dailyTrend) {
      const total = day.bytes_up + day.bytes_down;
      if (total > max) max = total;
    }
    return max;
  }, [dailyTrend]);

  const sortedRules = useMemo(() => {
    return Object.entries(ruleStats).sort((a, b) => b[1].bytes_total - a[1].bytes_total);
  }, [ruleStats]);

  async function handleExport() {
    const csv = exportCsv();
    try {
      await downloadText(csv, `prisma-analytics-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch { /* user cancelled */ }
  }

  return (
    <div className="p-4 sm:p-6 flex flex-col h-full gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="font-bold text-lg">{t("analytics.title")}</h1>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={handleExport} title={t("analytics.exportCsv")}>
            <Download size={14} />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirmOpen(true)} title={t("analytics.clearAll")}>
            <Trash2 size={14} />
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1 h-0">
        <div className="space-y-4 pr-2">
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Card>
              <CardContent className="py-2 px-3 flex flex-col items-center">
                <ArrowDown size={14} className="text-green-400 mb-0.5" />
                <p className="text-sm font-bold">{fmtBytes(summary.todayDown)}</p>
                <p className="text-[10px] text-muted-foreground">{t("analytics.todayDown")}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-2 px-3 flex flex-col items-center">
                <ArrowUp size={14} className="text-blue-400 mb-0.5" />
                <p className="text-sm font-bold">{fmtBytes(summary.todayUp)}</p>
                <p className="text-[10px] text-muted-foreground">{t("analytics.todayUp")}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-2 px-3 flex flex-col items-center">
                <Network size={14} className="text-purple-400 mb-0.5" />
                <p className="text-sm font-bold">{summary.totalConns}</p>
                <p className="text-[10px] text-muted-foreground">{t("analytics.totalConnections")}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-2 px-3 flex flex-col items-center">
                <Globe size={14} className="text-yellow-400 mb-0.5" />
                <p className="text-sm font-bold truncate max-w-full text-xs">{topDomain}</p>
                <p className="text-[10px] text-muted-foreground">{t("analytics.topDomain")}</p>
              </CardContent>
            </Card>
          </div>

          {/* Top 10 domains */}
          <Card>
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-medium">{t("analytics.topDomains")}</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {topDomains.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">{t("analytics.noData")}</p>
              ) : (
                <div className="space-y-2">
                  {topDomains.map(([domain, stats]) => {
                    const total = stats.bytes_up + stats.bytes_down;
                    return (
                      <div key={domain} className="space-y-0.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-mono truncate max-w-[60%]">{domain}</span>
                          <span className="text-muted-foreground shrink-0 ml-2">
                            {fmtBytes(total)} &middot; {stats.connections} {t("analytics.conns")}
                          </span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className="h-full rounded-full flex">
                            <div
                              className="bg-green-400"
                              style={{ width: `${(stats.bytes_down / maxDomainBytes) * 100}%` }}
                            />
                            <div
                              className="bg-blue-400"
                              style={{ width: `${(stats.bytes_up / maxDomainBytes) * 100}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground pt-1">
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-green-400 inline-block" />
                      {t("analytics.bytesDown")}
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-blue-400 inline-block" />
                      {t("analytics.bytesUp")}
                    </span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Daily trend */}
          <Card>
            <CardHeader className="pb-2 pt-4 px-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium">{t("analytics.dailyTrend")}</CardTitle>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant={trendRange === 7 ? "default" : "ghost"}
                    className="h-6 px-2 text-xs"
                    onClick={() => setTrendRange(7)}
                  >
                    7d
                  </Button>
                  <Button
                    size="sm"
                    variant={trendRange === 30 ? "default" : "ghost"}
                    className="h-6 px-2 text-xs"
                    onClick={() => setTrendRange(30)}
                  >
                    30d
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {dailyTrend.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">{t("analytics.noData")}</p>
              ) : (
                <div className="space-y-1.5">
                  {dailyTrend.map((day) => {
                    const total = day.bytes_up + day.bytes_down;
                    return (
                      <div key={day.date} className="flex items-center gap-2 text-xs">
                        <span className="w-20 text-muted-foreground font-mono shrink-0">
                          {day.date.slice(5)}
                        </span>
                        <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className="h-full rounded-full flex">
                            <div
                              className="bg-green-400"
                              style={{ width: `${(day.bytes_down / maxDailyBytes) * 100}%` }}
                            />
                            <div
                              className="bg-blue-400"
                              style={{ width: `${(day.bytes_up / maxDailyBytes) * 100}%` }}
                            />
                          </div>
                        </div>
                        <span className="w-20 text-right text-muted-foreground shrink-0">
                          {fmtBytes(total)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Rule breakdown */}
          <Card>
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-medium flex items-center gap-1.5">
                <GitBranch size={14} />
                {t("analytics.ruleBreakdown")}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {sortedRules.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">{t("analytics.noData")}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("analytics.rule")}</TableHead>
                      <TableHead className="w-[80px] text-right">{t("analytics.matches")}</TableHead>
                      <TableHead className="w-[100px] text-right">{t("analytics.totalTraffic")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedRules.map(([rule, stats]) => (
                      <TableRow key={rule} className="text-xs">
                        <TableCell className="py-1.5 font-mono">{rule}</TableCell>
                        <TableCell className="py-1.5 text-right">{stats.match_count}</TableCell>
                        <TableCell className="py-1.5 text-right font-mono">{fmtBytes(stats.bytes_total)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Footer summary */}
          <div className="flex items-center gap-3 text-xs text-muted-foreground pb-4">
            <span>
              {t("analytics.allTime")}: {"\u2193"}{fmtBytes(summary.totalDown)} {"\u2191"}{fmtBytes(summary.totalUp)}
            </span>
            <span>
              {Object.keys(domains).length} {t("analytics.domainCount")}
            </span>
          </div>
        </div>
      </ScrollArea>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t("analytics.clearAllTitle")}
        message={t("analytics.clearAllMessage")}
        confirmLabel={t("analytics.clearAll")}
        onConfirm={clear}
      />
    </div>
  );
}
