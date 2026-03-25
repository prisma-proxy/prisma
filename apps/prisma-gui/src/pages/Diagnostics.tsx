import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Activity, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/commands";

type DiagResult =
  | { status: "idle" }
  | { status: "testing" }
  | { status: "success"; message: string; ms: number }
  | { status: "error"; message: string };

function ResultDisplay({ result }: { result: DiagResult }) {
  const { t } = useTranslation();

  if (result.status === "idle") return null;

  if (result.status === "testing") {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground mt-3">
        <Loader2 className="animate-spin" size={14} />
        <span>{t("diagnostics.testing")}</span>
      </div>
    );
  }

  if (result.status === "success") {
    return (
      <div className="flex items-center gap-2 text-sm text-green-400 mt-3">
        <CheckCircle2 size={14} />
        <span>{result.message}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-sm text-red-400 mt-3">
      <XCircle size={14} />
      <span>{result.message}</span>
    </div>
  );
}

export default function Diagnostics() {
  const { t } = useTranslation();

  // Latency Test state
  const [latencyHost, setLatencyHost] = useState("");
  const [latencyResult, setLatencyResult] = useState<DiagResult>({ status: "idle" });

  // DNS Lookup state
  const [dnsHost, setDnsHost] = useState("");
  const [dnsResult, setDnsResult] = useState<DiagResult>({ status: "idle" });

  // Connection Test state
  const [connHost, setConnHost] = useState("");
  const [connResult, setConnResult] = useState<DiagResult>({ status: "idle" });

  const handleLatencyTest = useCallback(async () => {
    const addr = latencyHost.trim();
    if (!addr) return;

    setLatencyResult({ status: "testing" });
    try {
      const ms = await api.pingServer(addr);
      setLatencyResult({
        status: "success",
        message: t("diagnostics.result") + ": " + ms + "ms",
        ms,
      });
    } catch (e) {
      setLatencyResult({
        status: "error",
        message: t("diagnostics.failed") + ": " + String(e),
      });
    }
  }, [latencyHost, t]);

  const handleDnsLookup = useCallback(async () => {
    const domain = dnsHost.trim();
    if (!domain) return;

    setDnsResult({ status: "testing" });
    try {
      // Use pingServer to resolve + measure round-trip to the domain
      const addr = domain.includes(":") ? domain : domain + ":443";
      const start = performance.now();
      const ms = await api.pingServer(addr);
      const elapsed = Math.round(performance.now() - start);
      setDnsResult({
        status: "success",
        message: t("diagnostics.success") + " (" + ms + "ms ping, " + elapsed + "ms total)",
        ms,
      });
    } catch (e) {
      setDnsResult({
        status: "error",
        message: t("diagnostics.failed") + ": " + String(e),
      });
    }
  }, [dnsHost, t]);

  const handleConnectionTest = useCallback(async () => {
    const addr = connHost.trim();
    if (!addr) return;

    setConnResult({ status: "testing" });
    try {
      const target = addr.includes(":") ? addr : addr + ":443";
      const start = performance.now();
      const ms = await api.pingServer(target);
      const elapsed = Math.round(performance.now() - start);
      setConnResult({
        status: "success",
        message: t("diagnostics.success") + " (" + ms + "ms latency, " + elapsed + "ms total)",
        ms,
      });
    } catch (e) {
      setConnResult({
        status: "error",
        message: t("diagnostics.failed") + ": " + String(e),
      });
    }
  }, [connHost, t]);

  return (
    <ScrollArea className="h-full">
      <div className="p-4 sm:p-6 pb-12 space-y-4">
        <div className="flex items-center gap-2">
          <Activity size={20} />
          <h1 className="font-bold text-lg">{t("diagnostics.title")}</h1>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Latency Test */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">
                {t("diagnostics.latencyTest")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input
                placeholder={t("diagnostics.hostPlaceholder")}
                value={latencyHost}
                onChange={(e) => setLatencyHost(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleLatencyTest();
                }}
                className="h-8 text-sm"
              />
              <Button
                size="sm"
                className="w-full"
                disabled={latencyResult.status === "testing" || !latencyHost.trim()}
                onClick={handleLatencyTest}
              >
                {latencyResult.status === "testing" ? (
                  <><Loader2 className="animate-spin" size={14} /> {t("diagnostics.testing")}</>
                ) : (
                  t("diagnostics.test")
                )}
              </Button>
              <ResultDisplay result={latencyResult} />
            </CardContent>
          </Card>

          {/* DNS Lookup */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">
                {t("diagnostics.dnsLookup")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input
                placeholder="example.com"
                value={dnsHost}
                onChange={(e) => setDnsHost(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleDnsLookup();
                }}
                className="h-8 text-sm"
              />
              <Button
                size="sm"
                className="w-full"
                disabled={dnsResult.status === "testing" || !dnsHost.trim()}
                onClick={handleDnsLookup}
              >
                {dnsResult.status === "testing" ? (
                  <><Loader2 className="animate-spin" size={14} /> {t("diagnostics.testing")}</>
                ) : (
                  t("diagnostics.test")
                )}
              </Button>
              <ResultDisplay result={dnsResult} />
            </CardContent>
          </Card>

          {/* Connection Test */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">
                {t("diagnostics.connectionTest")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input
                placeholder="host:port"
                value={connHost}
                onChange={(e) => setConnHost(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleConnectionTest();
                }}
                className="h-8 text-sm"
              />
              <Button
                size="sm"
                className="w-full"
                disabled={connResult.status === "testing" || !connHost.trim()}
                onClick={handleConnectionTest}
              >
                {connResult.status === "testing" ? (
                  <><Loader2 className="animate-spin" size={14} /> {t("diagnostics.testing")}</>
                ) : (
                  t("diagnostics.test")
                )}
              </Button>
              <ResultDisplay result={connResult} />
            </CardContent>
          </Card>
        </div>
      </div>
    </ScrollArea>
  );
}
