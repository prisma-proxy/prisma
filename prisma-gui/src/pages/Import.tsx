import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  FileUp,
  ClipboardPaste,
  Link,
  Loader2,
  Check,
  AlertTriangle,
  Plus,
  Trash2,
} from "lucide-react";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent } from "@/components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { useStore } from "@/store";
import { notify } from "@/store/notifications";
import { api } from "@/lib/commands";
import { pickJsonFile } from "@/lib/utils";
import type { ImportedServer, Profile } from "@/lib/types";

interface ParsedEntry {
  server: ImportedServer | null;
  error: string | null;
  raw: string;
  selected: boolean;
}

function protocolColor(protocol: string): string {
  switch (protocol) {
    case "shadowsocks":
      return "text-blue-400 border-blue-400/30";
    case "vmess":
      return "text-purple-400 border-purple-400/30";
    case "trojan":
      return "text-red-400 border-red-400/30";
    case "vless":
      return "text-green-400 border-green-400/30";
    default:
      return "text-muted-foreground";
  }
}

export default function Import() {
  const { t } = useTranslation();
  const setProfiles = useStore((s) => s.setProfiles);

  const [uriInput, setUriInput] = useState("");
  const [batchInput, setBatchInput] = useState("");
  const [parsedEntries, setParsedEntries] = useState<ParsedEntry[]>([]);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState("uri");

  const reload = useCallback(
    () =>
      api
        .listProfiles()
        .then(setProfiles)
        .catch(() => {}),
    [setProfiles]
  );

  // Parse a single URI
  async function handleParseUri() {
    if (!uriInput.trim()) return;
    setParsing(true);
    try {
      const result = await api.importUri(uriInput.trim());
      if (result.error) {
        setParsedEntries([
          {
            server: null,
            error: result.error,
            raw: uriInput.trim(),
            selected: false,
          },
        ]);
      } else {
        setParsedEntries([
          {
            server: result,
            error: null,
            raw: uriInput.trim(),
            selected: true,
          },
        ]);
      }
    } catch (e) {
      setParsedEntries([
        {
          server: null,
          error: String(e),
          raw: uriInput.trim(),
          selected: false,
        },
      ]);
    } finally {
      setParsing(false);
    }
  }

  // Parse batch URIs
  async function handleParseBatch() {
    if (!batchInput.trim()) return;
    setParsing(true);
    try {
      const results = await api.importBatch(batchInput.trim());
      const lines = batchInput
        .trim()
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      setParsedEntries(
        results.map((r: ImportedServer, i: number) => ({
          server: r.error ? null : r,
          error: r.error ?? null,
          raw: lines[i] ?? "",
          selected: !r.error,
        }))
      );
    } catch (e) {
      notify.error(String(e));
    } finally {
      setParsing(false);
    }
  }

  // Paste from clipboard
  async function handlePasteClipboard() {
    try {
      const text = await readText();
      if (!text) {
        notify.error(t("import.clipboardEmpty"));
        return;
      }
      // Check if it contains multiple lines
      const lines = text
        .trim()
        .split("\n")
        .filter((l) => l.trim());
      if (lines.length > 1) {
        setBatchInput(text);
        setActiveTab("batch");
      } else {
        setUriInput(text.trim());
        setActiveTab("uri");
      }
    } catch {
      notify.error(t("import.clipboardError"));
    }
  }

  // Import from file
  async function handleImportFile() {
    try {
      const data = await pickJsonFile();
      if (Array.isArray(data)) {
        // Array of profiles — save directly
        let count = 0;
        for (const item of data) {
          const p: Profile = {
            id: (item as Record<string, unknown>).id as string ?? crypto.randomUUID(),
            name: (item as Record<string, unknown>).name as string ?? "Imported",
            tags: ((item as Record<string, unknown>).tags as string[]) ?? [],
            config: (item as Record<string, unknown>).config ?? item,
            created_at:
              ((item as Record<string, unknown>).created_at as string) ??
              new Date().toISOString(),
          };
          await api.saveProfile(JSON.stringify(p));
          count++;
        }
        await reload();
        await api.refreshTrayProfiles().catch(() => {});
        notify.success(t("import.fileSuccess", { count }));
      } else {
        notify.error(t("import.fileInvalid"));
      }
    } catch (e) {
      if (e instanceof Error && e.message === "No file selected") return;
      notify.error(String(e));
    }
  }

  // Toggle selection
  function toggleEntry(idx: number) {
    setParsedEntries((prev) =>
      prev.map((e, i) =>
        i === idx ? { ...e, selected: !e.selected } : e
      )
    );
  }

  // Select / deselect all
  function selectAll(selected: boolean) {
    setParsedEntries((prev) =>
      prev.map((e) => (e.server ? { ...e, selected } : e))
    );
  }

  // Save selected entries as profiles
  async function handleSaveSelected() {
    const toSave = parsedEntries.filter((e) => e.selected && e.server);
    if (toSave.length === 0) return;
    setSaving(true);
    try {
      for (const entry of toSave) {
        const s = entry.server!;
        const profile: Profile = {
          id: crypto.randomUUID(),
          name: s.server_name || `${s.original_protocol}@${s.host}:${s.port}`,
          tags: [s.original_protocol],
          config: s.config,
          created_at: new Date().toISOString(),
        };
        await api.saveProfile(JSON.stringify(profile));
      }
      await reload();
      await api.refreshTrayProfiles().catch(() => {});
      notify.success(t("import.savedCount", { count: toSave.length }));
      // Clear after saving
      setParsedEntries([]);
      setUriInput("");
      setBatchInput("");
    } catch (e) {
      notify.error(String(e));
    } finally {
      setSaving(false);
    }
  }

  const selectedCount = parsedEntries.filter(
    (e) => e.selected && e.server
  ).length;
  const totalParsed = parsedEntries.length;
  const errorCount = parsedEntries.filter((e) => e.error).length;

  return (
    <div className="p-4 sm:p-6 flex flex-col h-full gap-3">
      <div className="flex items-center justify-between">
        <h1 className="font-bold text-lg">{t("import.title")}</h1>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="outline"
            onClick={handlePasteClipboard}
          >
            <ClipboardPaste size={14} /> {t("import.clipboard")}
          </Button>
          <Button size="sm" variant="outline" onClick={handleImportFile}>
            <FileUp size={14} /> {t("import.file")}
          </Button>
        </div>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="flex flex-col flex-1 min-h-0"
      >
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="uri">
            <Link size={14} className="mr-1.5" />
            {t("import.singleUri")}
          </TabsTrigger>
          <TabsTrigger value="batch">
            <FileUp size={14} className="mr-1.5" />
            {t("import.batchImport")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="uri" className="flex-1 flex flex-col gap-3 mt-3">
          <div className="space-y-2">
            <Label>{t("import.uriLabel")}</Label>
            <div className="flex gap-2">
              <Input
                value={uriInput}
                onChange={(e) => setUriInput(e.target.value)}
                placeholder="ss://, vmess://, trojan://, vless://"
                className="font-mono text-xs flex-1"
                onKeyDown={(e) => e.key === "Enter" && handleParseUri()}
              />
              <Button
                onClick={handleParseUri}
                disabled={!uriInput.trim() || parsing}
                className="shrink-0"
              >
                {parsing ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  t("import.parse")
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("import.uriHint")}
            </p>
          </div>
        </TabsContent>

        <TabsContent
          value="batch"
          className="flex-1 flex flex-col gap-3 mt-3"
        >
          <div className="space-y-2">
            <Label>{t("import.batchLabel")}</Label>
            <Textarea
              value={batchInput}
              onChange={(e) => setBatchInput(e.target.value)}
              rows={5}
              placeholder={t("import.batchPlaceholder")}
              className="font-mono text-xs"
            />
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {t("import.batchHint")}
              </p>
              <Button
                onClick={handleParseBatch}
                disabled={!batchInput.trim() || parsing}
                size="sm"
              >
                {parsing ? (
                  <Loader2 size={14} className="animate-spin mr-1" />
                ) : null}
                {t("import.parseAll")}
              </Button>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* Parsed results */}
      {parsedEntries.length > 0 && (
        <div className="flex flex-col flex-1 min-h-0 gap-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium">
                {t("import.results")}
              </p>
              <Badge variant="secondary" className="text-[10px]">
                {totalParsed} {t("import.parsed")}
              </Badge>
              {errorCount > 0 && (
                <Badge
                  variant="outline"
                  className="text-[10px] text-red-400 border-red-400/30"
                >
                  {errorCount} {t("import.errors")}
                </Badge>
              )}
            </div>
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => selectAll(true)}
              >
                {t("import.selectAll")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => selectAll(false)}
              >
                {t("import.deselectAll")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setParsedEntries([])}
              >
                <Trash2 size={12} />
              </Button>
            </div>
          </div>

          <ScrollArea className="flex-1 h-0">
            <div className="space-y-1.5 pr-2">
              {parsedEntries.map((entry, idx) => (
                <Card
                  key={idx}
                  className={`cursor-pointer transition-colors ${
                    entry.selected && entry.server
                      ? "border-green-500/30 bg-green-500/5"
                      : entry.error
                      ? "border-red-500/20 bg-red-500/5"
                      : ""
                  }`}
                  onClick={() => entry.server && toggleEntry(idx)}
                >
                  <CardContent className="py-2 px-3">
                    {entry.server ? (
                      <div className="flex items-center justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={entry.selected}
                              onChange={() => toggleEntry(idx)}
                              onClick={(e) => e.stopPropagation()}
                              className="h-4 w-4 rounded border-input accent-primary shrink-0"
                            />
                            <p className="text-sm font-medium truncate">
                              {entry.server.server_name ||
                                `${entry.server.host}:${entry.server.port}`}
                            </p>
                            <Badge
                              variant="outline"
                              className={`text-[10px] px-1.5 py-0 ${protocolColor(
                                entry.server.original_protocol
                              )}`}
                            >
                              {entry.server.original_protocol}
                            </Badge>
                          </div>
                          <p className="text-[10px] text-muted-foreground font-mono ml-6 truncate">
                            {entry.server.host}:{entry.server.port}
                          </p>
                        </div>
                        {entry.selected && (
                          <Check
                            size={16}
                            className="text-green-500 shrink-0"
                          />
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <AlertTriangle
                          size={14}
                          className="text-red-400 shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs text-destructive truncate">
                            {entry.error}
                          </p>
                          <p className="text-[10px] text-muted-foreground font-mono truncate">
                            {entry.raw}
                          </p>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </ScrollArea>

          {/* Save button */}
          {selectedCount > 0 && (
            <Button
              onClick={handleSaveSelected}
              disabled={saving}
              className="w-full"
            >
              {saving ? (
                <Loader2 size={14} className="animate-spin mr-1.5" />
              ) : (
                <Plus size={14} className="mr-1.5" />
              )}
              {t("import.saveSelected", { count: selectedCount })}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
