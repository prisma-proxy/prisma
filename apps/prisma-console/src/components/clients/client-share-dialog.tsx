"use client";

import { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n";
import { api } from "@/lib/api";
import { highlightToml } from "@/lib/toml-highlight";
import { Loader2, Copy, Check, Download, FileText, Link2, QrCode, AlertCircle } from "lucide-react";
import type { ShareClientResponse } from "@/lib/types";

type ShareTab = "toml" | "uri" | "qr";

interface ClientShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  clientName: string;
}

export function ClientShareDialog({
  open,
  onOpenChange,
  clientId,
  clientName,
}: ClientShareDialogProps) {
  const { t } = useI18n();
  const [tab, setTab] = useState<ShareTab>("toml");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ShareClientResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTab("toml");
    setData(null);
    setError(null);
    setCopied(false);
    setLoading(true);

    api
      .shareClient(clientId)
      .then((res) => {
        setData(res);
        setError(null);
      })
      .catch((err) => {
        setData(null);
        setError(err instanceof Error ? err.message : t("common.error"));
      })
      .finally(() => setLoading(false));
  }, [open, clientId, t]);

  const tomlText = data?.toml ?? "";
  const tomlLines = useMemo(() => {
    if (!tomlText) return [];
    return tomlText.split("\n");
  }, [tomlText]);

  async function handleCopy() {
    if (!data) return;
    const text = tab === "toml" ? data.toml : data.uri;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard not available
    }
  }

  function handleDownloadQR() {
    if (!data?.qr_svg) return;
    const blob = new Blob([data.qr_svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `prisma-client-${clientName}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const tabConfig: Array<{ key: ShareTab; icon: typeof FileText; label: string }> = [
    { key: "toml", icon: FileText, label: t("clients.shareToml") },
    { key: "uri", icon: Link2, label: t("clients.shareUri") },
    { key: "qr", icon: QrCode, label: t("clients.shareQr") },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t("clients.shareTitle")} &mdash; {clientName}
          </DialogTitle>
        </DialogHeader>

        {/* Tab buttons with icons and text labels */}
        <div className="flex gap-1 rounded-lg bg-muted p-1">
          {tabConfig.map(({ key, icon: Icon, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => { setTab(key); setCopied(false); }}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                tab === key
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        {/* Content area */}
        <div className="min-h-[160px]">
          {/* Loading state */}
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("clients.shareLoading")}
            </div>
          ) : error ? (
            /* Error state */
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-sm text-destructive">
              <AlertCircle className="h-5 w-5" />
              <p>{error}</p>
            </div>
          ) : !data ? (
            /* Fallback empty state */
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              {t("common.error")}
            </div>
          ) : tab === "toml" ? (
            /* TOML tab with line numbers */
            <div className="space-y-2">
              <div className="overflow-auto max-h-[50vh] rounded-lg border bg-muted font-mono text-xs leading-5">
                <table className="w-full border-collapse">
                  <tbody>
                    {tomlLines.map((line, idx) => (
                      <tr key={idx}>
                        <td className="select-none border-r border-border/40 px-2 py-0 text-right text-[10px] text-muted-foreground/60 align-top w-8">
                          {idx + 1}
                        </td>
                        <td className="px-3 py-0 whitespace-pre">
                          {highlightToml(line)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={handleCopy}
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5" data-icon="inline-start" />
                ) : (
                  <Copy className="h-3.5 w-3.5" data-icon="inline-start" />
                )}
                {copied ? t("clients.shareCopySuccess") : t("common.copy")}
              </Button>
            </div>
          ) : tab === "uri" ? (
            /* URI tab */
            <div className="space-y-2">
              <Textarea
                readOnly
                value={data.uri}
                className="min-h-[80px] break-all font-mono text-xs"
                rows={4}
                onFocus={(e) => e.target.select()}
              />
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={handleCopy}
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5" data-icon="inline-start" />
                ) : (
                  <Copy className="h-3.5 w-3.5" data-icon="inline-start" />
                )}
                {copied ? t("clients.shareCopySuccess") : t("common.copy")}
              </Button>
            </div>
          ) : (
            /* QR Code tab */
            <div className="space-y-3">
              <div className="flex items-center justify-center py-4">
                <div
                  className="mx-auto max-w-[240px] rounded-lg bg-white p-3"
                  dangerouslySetInnerHTML={{ __html: data.qr_svg }}
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={handleDownloadQR}
              >
                <Download className="h-3.5 w-3.5" data-icon="inline-start" />
                {t("clients.shareDownloadQr")}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
