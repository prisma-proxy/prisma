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
import { Loader2, Copy, Check, Download } from "lucide-react";
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
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTab("toml");
    setData(null);
    setCopied(false);
    setLoading(true);

    api
      .shareClient(clientId)
      .then((res) => setData(res))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [open, clientId]);

  const tomlLines = useMemo(() => {
    if (!data?.toml) return [];
    return data.toml.split("\n");
  }, [data?.toml]);

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t("clients.shareTitle")} &mdash; {clientName}
          </DialogTitle>
        </DialogHeader>

        {/* Tab buttons */}
        <div className="flex gap-1 rounded-lg bg-muted p-1">
          {(["toml", "uri", "qr"] as const).map((key) => {
            const labels: Record<ShareTab, string> = {
              toml: t("clients.shareToml"),
              uri: t("clients.shareUri"),
              qr: t("clients.shareQr"),
            };
            return (
              <button
                key={key}
                type="button"
                onClick={() => { setTab(key); setCopied(false); }}
                className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  tab === key
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {labels[key]}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="min-h-[160px]">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("clients.shareLoading")}
            </div>
          ) : !data ? (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              {t("common.error")}
            </div>
          ) : tab === "toml" ? (
            <div className="space-y-2">
              <div className="overflow-y-auto max-h-[50vh] rounded-lg border bg-muted/20 p-3 font-mono text-xs leading-5">
                {tomlLines.map((line, idx) => (
                  <div key={idx} className="whitespace-pre">
                    {highlightToml(line)}
                    {idx < tomlLines.length - 1 ? "\n" : null}
                  </div>
                ))}
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
            <div className="space-y-3">
              <div className="flex items-center justify-center py-4">
                <div
                  className="mx-auto max-w-[240px]"
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
