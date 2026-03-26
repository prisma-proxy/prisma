import { useState } from "react";
import { useTranslation } from "react-i18next";
import { X, ArrowRight, ArrowLeft } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useSettings } from "@/store/settings";

export default function SplitTunnelingSection() {
  const { t } = useTranslation();
  const { splitTunnelProxy, splitTunnelDirect, patch } = useSettings();
  const [proxyInput, setProxyInput] = useState("");
  const [directInput, setDirectInput] = useState("");
  const [selectedProxy, setSelectedProxy] = useState<Set<string>>(new Set());
  const [selectedDirect, setSelectedDirect] = useState<Set<string>>(new Set());

  function addToProxy() {
    const value = proxyInput.trim();
    if (!value || splitTunnelProxy.includes(value)) return;
    patch({ splitTunnelProxy: [...splitTunnelProxy, value] });
    setProxyInput("");
  }

  function addToDirect() {
    const value = directInput.trim();
    if (!value || splitTunnelDirect.includes(value)) return;
    patch({ splitTunnelDirect: [...splitTunnelDirect, value] });
    setDirectInput("");
  }

  function removeFromProxy(item: string) {
    patch({ splitTunnelProxy: splitTunnelProxy.filter((v) => v !== item) });
    setSelectedProxy((prev) => {
      const next = new Set(prev);
      next.delete(item);
      return next;
    });
  }

  function removeFromDirect(item: string) {
    patch({ splitTunnelDirect: splitTunnelDirect.filter((v) => v !== item) });
    setSelectedDirect((prev) => {
      const next = new Set(prev);
      next.delete(item);
      return next;
    });
  }

  function toggleProxySelection(item: string) {
    setSelectedProxy((prev) => {
      const next = new Set(prev);
      if (next.has(item)) next.delete(item);
      else next.add(item);
      return next;
    });
  }

  function toggleDirectSelection(item: string) {
    setSelectedDirect((prev) => {
      const next = new Set(prev);
      if (next.has(item)) next.delete(item);
      else next.add(item);
      return next;
    });
  }

  function moveProxyToDirect() {
    if (selectedProxy.size === 0) return;
    const toMove = Array.from(selectedProxy);
    const newProxy = splitTunnelProxy.filter((v) => !selectedProxy.has(v));
    const newDirect = [...splitTunnelDirect, ...toMove.filter((v) => !splitTunnelDirect.includes(v))];
    patch({ splitTunnelProxy: newProxy, splitTunnelDirect: newDirect });
    setSelectedProxy(new Set());
  }

  function moveDirectToProxy() {
    if (selectedDirect.size === 0) return;
    const toMove = Array.from(selectedDirect);
    const newDirect = splitTunnelDirect.filter((v) => !selectedDirect.has(v));
    const newProxy = [...splitTunnelProxy, ...toMove.filter((v) => !splitTunnelProxy.includes(v))];
    patch({ splitTunnelProxy: newProxy, splitTunnelDirect: newDirect });
    setSelectedDirect(new Set());
  }

  return (
    <div className="space-y-4">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        {t("settings.splitTunneling")}
      </p>
      <p className="text-xs text-muted-foreground">
        {t("settings.splitTunnelingDesc")}
      </p>

      <div className="grid grid-cols-[1fr_auto_1fr] gap-3">
        {/* Proxy column */}
        <div className="space-y-2">
          <Label>{t("settings.proxyColumn")}</Label>
          <ScrollArea className="h-48 rounded-md border p-2">
            <div className="space-y-1">
              {splitTunnelProxy.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2 text-center">
                  {t("settings.splitTunnelingEmpty", "No entries")}
                </p>
              ) : (
                splitTunnelProxy.map((item) => (
                  <div
                    key={item}
                    className={`flex items-center justify-between rounded px-2 py-1 text-sm cursor-pointer hover:bg-muted ${
                      selectedProxy.has(item) ? "bg-accent" : ""
                    }`}
                    onClick={() => toggleProxySelection(item)}
                    role="option"
                    aria-selected={selectedProxy.has(item)}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggleProxySelection(item);
                      }
                    }}
                  >
                    <span className="truncate font-mono text-xs">{item}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 w-5 p-0 shrink-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFromProxy(item);
                      }}
                      aria-label={`Remove ${item}`}
                    >
                      <X size={12} />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
          <div className="flex gap-1.5">
            <Input
              value={proxyInput}
              onChange={(e) => setProxyInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addToProxy(); }}
              placeholder={t("settings.domainPlaceholder")}
              className="font-mono text-xs"
            />
            <Button variant="outline" size="sm" onClick={addToProxy} disabled={!proxyInput.trim()} className="shrink-0">
              {t("settings.addDomain")}
            </Button>
          </div>
        </div>

        {/* Move buttons */}
        <div className="flex flex-col items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={moveProxyToDirect}
            disabled={selectedProxy.size === 0}
            aria-label="Move selected to direct"
          >
            <ArrowRight size={14} />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={moveDirectToProxy}
            disabled={selectedDirect.size === 0}
            aria-label="Move selected to proxy"
          >
            <ArrowLeft size={14} />
          </Button>
        </div>

        {/* Direct column */}
        <div className="space-y-2">
          <Label>{t("settings.directColumn")}</Label>
          <ScrollArea className="h-48 rounded-md border p-2">
            <div className="space-y-1">
              {splitTunnelDirect.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2 text-center">
                  {t("settings.splitTunnelingEmpty", "No entries")}
                </p>
              ) : (
                splitTunnelDirect.map((item) => (
                  <div
                    key={item}
                    className={`flex items-center justify-between rounded px-2 py-1 text-sm cursor-pointer hover:bg-muted ${
                      selectedDirect.has(item) ? "bg-accent" : ""
                    }`}
                    onClick={() => toggleDirectSelection(item)}
                    role="option"
                    aria-selected={selectedDirect.has(item)}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggleDirectSelection(item);
                      }
                    }}
                  >
                    <span className="truncate font-mono text-xs">{item}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 w-5 p-0 shrink-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFromDirect(item);
                      }}
                      aria-label={`Remove ${item}`}
                    >
                      <X size={12} />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
          <div className="flex gap-1.5">
            <Input
              value={directInput}
              onChange={(e) => setDirectInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addToDirect(); }}
              placeholder={t("settings.domainPlaceholder")}
              className="font-mono text-xs"
            />
            <Button variant="outline" size="sm" onClick={addToDirect} disabled={!directInput.trim()} className="shrink-0">
              {t("settings.addDomain")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
