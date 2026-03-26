"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/lib/toast-context";
import type { ClientInfo, ConfigResponse } from "@/lib/types";

interface SearchResult {
  id: string;
  type: "page" | "client" | "config" | "action";
  label: string;
  description?: string;
  href?: string;
  action?: () => void | Promise<void>;
}

async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }
}

function generateHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

function generateUuidV4(): string {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  buf[6] = (buf[6] & 0x0f) | 0x40;
  buf[8] = (buf[8] & 0x3f) | 0x80;
  const hex = Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function generateBase64Key(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return btoa(String.fromCharCode(...buf));
}

const PAGES: { label: string; href: string; i18nKey: string }[] = [
  { label: "Overview", href: "/dashboard", i18nKey: "sidebar.overview" },
  { label: "Connections", href: "/dashboard/connections", i18nKey: "sidebar.connections" },
  { label: "Server", href: "/dashboard/servers", i18nKey: "sidebar.server" },
  { label: "Clients", href: "/dashboard/clients", i18nKey: "sidebar.clients" },
  { label: "Routing Rules", href: "/dashboard/routing", i18nKey: "sidebar.routing" },
  { label: "Logs", href: "/dashboard/logs", i18nKey: "sidebar.logs" },
  { label: "Settings", href: "/dashboard/settings", i18nKey: "sidebar.settings" },
  { label: "System", href: "/dashboard/system", i18nKey: "sidebar.system" },
  { label: "Config Backup", href: "/dashboard/backups", i18nKey: "sidebar.backups" },
  { label: "Speed Test", href: "/dashboard/speed-test", i18nKey: "sidebar.speedTest" },
  { label: "Bandwidth", href: "/dashboard/bandwidth", i18nKey: "sidebar.bandwidth" },
];

const CONFIG_KEYS: { key: string; label: string; accessor: (c: ConfigResponse) => string }[] = [
  { key: "listen_addr", label: "Listen Address", accessor: (c) => c.listen_addr },
  { key: "quic_listen_addr", label: "QUIC Listen Address", accessor: (c) => c.quic_listen_addr },
  { key: "max_connections", label: "Max Connections", accessor: (c) => String(c.performance.max_connections) },
  { key: "logging_level", label: "Logging Level", accessor: (c) => c.logging_level },
  { key: "logging_format", label: "Logging Format", accessor: (c) => c.logging_format },
  { key: "port_forwarding", label: "Port Forwarding", accessor: (c) => c.port_forwarding.enabled ? "Enabled" : "Disabled" },
  { key: "camouflage", label: "Camouflage", accessor: (c) => c.camouflage.enabled ? "Enabled" : "Disabled" },
  { key: "tls_enabled", label: "TLS", accessor: (c) => c.tls_enabled ? "Enabled" : "Disabled" },
];

export function CommandPalette() {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    const handleOpen = () => setOpen(true);
    window.addEventListener("keydown", handleKey);
    window.addEventListener("open-command-palette", handleOpen);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("open-command-palette", handleOpen);
    };
  }, []);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) setQuery("");
  }, []);

  const results = useMemo<SearchResult[]>(() => {
    const q = query.toLowerCase().trim();
    const matches: SearchResult[] = [];

    if (q) {
      for (const page of PAGES) {
        const localizedLabel = t(page.i18nKey);
        if (
          page.label.toLowerCase().includes(q) ||
          localizedLabel.toLowerCase().includes(q) ||
          page.href.toLowerCase().includes(q)
        ) {
          matches.push({
            id: `page-${page.href}`,
            type: "page",
            label: localizedLabel,
            description: page.href,
            href: page.href,
          });
        }
      }

      const clients = queryClient.getQueryData<ClientInfo[]>(["clients"]);
      if (clients) {
        for (const client of clients) {
          const name = client.name ?? client.id;
          if (
            name.toLowerCase().includes(q) ||
            client.id.toLowerCase().includes(q)
          ) {
            matches.push({
              id: `client-${client.id}`,
              type: "client",
              label: name,
              description: client.id,
              href: "/dashboard/clients",
            });
          }
        }
      }

      const config = queryClient.getQueryData<ConfigResponse>(["config"]);
      if (config) {
        for (const { key, label, accessor } of CONFIG_KEYS) {
          if (
            key.toLowerCase().includes(q) ||
            label.toLowerCase().includes(q)
          ) {
            matches.push({
              id: `config-${key}`,
              type: "config",
              label: label,
              description: accessor(config),
              href: "/dashboard/settings",
            });
          }
        }
      }
    }

    // Action items: Generator tools
    const actionItems: { id: string; labelKey: string; fallback: string; keywords: string[]; action: () => Promise<void> }[] = [
      {
        id: "action-generate-hex-32",
        labelKey: "tools.generateHex32",
        fallback: "Generate Hex (32 digits / 16 bytes)",
        keywords: ["hex", "generate", "random", "32", "16"],
        action: async () => {
          await copyToClipboard(generateHex(16));
          toast(t("tools.hexCopied"), "success");
        },
      },
      {
        id: "action-generate-hex-64",
        labelKey: "tools.generateHex64",
        fallback: "Generate Hex (64 digits / 32 bytes)",
        keywords: ["hex", "generate", "random", "secret", "64", "32"],
        action: async () => {
          await copyToClipboard(generateHex(32));
          toast(t("tools.hexCopied"), "success");
        },
      },
      {
        id: "action-generate-hex-128",
        labelKey: "tools.generateHex128",
        fallback: "Generate Hex (128 digits / 64 bytes)",
        keywords: ["hex", "generate", "random", "128", "64"],
        action: async () => {
          await copyToClipboard(generateHex(64));
          toast(t("tools.hexCopied"), "success");
        },
      },
      {
        id: "action-generate-uuid",
        labelKey: "tools.generateUuid",
        fallback: "Generate UUID v4",
        keywords: ["uuid", "generate", "random", "id"],
        action: async () => {
          await copyToClipboard(generateUuidV4());
          toast(t("tools.uuidCopied"), "success");
        },
      },
      {
        id: "action-generate-base64",
        labelKey: "tools.generateBase64",
        fallback: "Generate Base64 Key (32 bytes)",
        keywords: ["base64", "generate", "random", "key"],
        action: async () => {
          await copyToClipboard(generateBase64Key(32));
          toast(t("tools.base64Copied"), "success");
        },
      },
    ];

    for (const item of actionItems) {
      const localizedLabel = t(item.labelKey);
      if (
        !q ||
        item.fallback.toLowerCase().includes(q) ||
        localizedLabel.toLowerCase().includes(q) ||
        item.keywords.some((kw) => kw.includes(q))
      ) {
        matches.push({
          id: item.id,
          type: "action",
          label: localizedLabel,
          action: item.action,
        });
      }
    }

    return matches.slice(0, 20);
  }, [query, t, queryClient, toast]);

  const grouped = useMemo(() => {
    const groups: Record<string, SearchResult[]> = {};
    for (const result of results) {
      const key = result.type === "page"
        ? t("search.groupPages")
        : result.type === "client"
          ? t("search.groupClients")
          : result.type === "action"
            ? t("search.groupGenerate")
            : t("search.groupConfig");
      if (!groups[key]) groups[key] = [];
      groups[key].push(result);
    }
    return groups;
  }, [results, t]);

  async function handleSelect(result: SearchResult) {
    if (result.action) {
      await result.action();
    } else if (result.href) {
      router.push(result.href);
    }
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg p-0 gap-0" showCloseButton={false}>
        <DialogTitle className="sr-only">Search</DialogTitle>
        <div className="flex items-center border-b px-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("search.placeholder")}
            className="border-0 focus-visible:ring-0 focus-visible:border-transparent"
            autoFocus
          />
          <kbd className="hidden sm:inline-flex h-5 items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
            ESC
          </kbd>
        </div>
        <div className="max-h-80 overflow-y-auto p-2">
          {query.trim() && results.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t("search.noResults")}
            </p>
          )}
          {Object.entries(grouped).map(([group, items]) => (
            <div key={group}>
              <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                {group}
              </p>
              {items.map((result) => (
                <button
                  key={result.id}
                  type="button"
                  onClick={() => handleSelect(result)}
                  className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground transition-colors text-left"
                >
                  <span className="font-medium">{result.label}</span>
                  {result.description && (
                    <span className="text-xs text-muted-foreground truncate">
                      {result.description}
                    </span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
