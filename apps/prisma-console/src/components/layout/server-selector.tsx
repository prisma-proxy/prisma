"use client";

import { useState } from "react";
import { Server, Plus, Check, Trash2 } from "lucide-react";
import { useServerStore, type ServerConfig } from "@/lib/server-store";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ServerSelectorProps {
  collapsed?: boolean;
}

export function ServerSelector({ collapsed }: ServerSelectorProps) {
  const { t } = useI18n();
  const servers = useServerStore((s) => s.servers);
  const activeServerId = useServerStore((s) => s.activeServerId);
  const addServer = useServerStore((s) => s.addServer);
  const removeServer = useServerStore((s) => s.removeServer);
  const setActive = useServerStore((s) => s.setActive);

  const activeServer = servers.find((s) => s.id === activeServerId) ?? null;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");

  function handleAdd() {
    if (!name.trim() || !url.trim()) return;
    addServer({ name: name.trim(), url: url.trim(), token: token.trim() });
    setName("");
    setUrl("");
    setToken("");
    setDialogOpen(false);
  }

  function handleSwitch(server: ServerConfig) {
    setActive(server.id);
    // Force reload to reconnect API + WebSocket with new base URL and token
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  }

  function handleRemove(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    removeServer(id);
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-sidebar-accent/50 w-full ${
            collapsed ? "justify-center" : ""
          }`}
        >
          <Server className="h-4 w-4 shrink-0 text-muted-foreground" />
          {!collapsed && (
            <span className="truncate text-left flex-1 text-xs font-medium">
              {activeServer?.name ?? t("server.select")}
            </span>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" sideOffset={8} align="start">
          <DropdownMenuLabel>{t("server.select")}</DropdownMenuLabel>
          {servers.map((server) => (
            <DropdownMenuItem
              key={server.id}
              onClick={() => handleSwitch(server)}
              className="flex items-center justify-between gap-2"
            >
              <span className="flex items-center gap-2 flex-1 truncate">
                {server.id === activeServerId && (
                  <Check className="h-3 w-3 text-primary shrink-0" />
                )}
                <span className="truncate">{server.name}</span>
              </span>
              <button
                type="button"
                className="ml-2 rounded p-0.5 text-muted-foreground hover:text-destructive"
                onClick={(e) => handleRemove(server.id, e)}
                aria-label={t("server.remove")}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </DropdownMenuItem>
          ))}
          {servers.length > 0 && <DropdownMenuSeparator />}
          <DropdownMenuItem onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4" />
            <span>{t("server.add")}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("server.add")}</DialogTitle>
            <DialogDescription>{t("server.switch")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="server-name">{t("server.name")}</Label>
              <Input
                id="server-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("server.namePlaceholder")}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="server-url">{t("server.url")}</Label>
              <Input
                id="server-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={t("server.urlPlaceholder")}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="server-token">{t("server.token")}</Label>
              <Input
                id="server-token"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={t("server.tokenPlaceholder")}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={handleAdd} disabled={!name.trim() || !url.trim()}>
              {t("server.add")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
