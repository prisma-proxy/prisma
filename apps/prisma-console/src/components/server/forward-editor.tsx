"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { useI18n } from "@/lib/i18n";

export interface ForwardFormData {
  name: string;
  bind_addr: string;
  remote_port: number;
  protocol: string;
  allowed_ips: string[];
}

interface ForwardEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: ForwardFormData) => void;
  isPending?: boolean;
  initialData?: ForwardFormData | null;
  mode: "add" | "edit";
}

export function ForwardEditor({
  open,
  onOpenChange,
  onSubmit,
  isPending,
  initialData,
  mode,
}: ForwardEditorProps) {
  const { t } = useI18n();

  const [name, setName] = useState("");
  const [bindAddr, setBindAddr] = useState("");
  const [remotePort, setRemotePort] = useState<number | "">("");
  const [protocol, setProtocol] = useState("tcp");
  const [allowedIps, setAllowedIps] = useState("");

  // Reset form when dialog opens or initialData changes
  useEffect(() => {
    if (open) {
      if (initialData) {
        setName(initialData.name);
        setBindAddr(initialData.bind_addr);
        setRemotePort(initialData.remote_port);
        setProtocol(initialData.protocol);
        setAllowedIps(initialData.allowed_ips.join("\n"));
      } else {
        setName("");
        setBindAddr("");
        setRemotePort("");
        setProtocol("tcp");
        setAllowedIps("");
      }
    }
  }, [open, initialData]);

  function handleSubmit() {
    if (!name.trim() || !bindAddr.trim() || remotePort === "") return;
    onSubmit({
      name: name.trim(),
      bind_addr: bindAddr.trim(),
      remote_port: Number(remotePort),
      protocol,
      allowed_ips: allowedIps
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
    });
  }

  const isValid = name.trim() && bindAddr.trim() && remotePort !== "" && Number(remotePort) > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {mode === "add" ? t("forwards.add") : t("forwards.edit")}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium">{t("forwards.name")}</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("forwards.namePlaceholder")}
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">
              {t("forwards.localAddr")}
            </label>
            <Input
              value={bindAddr}
              onChange={(e) => setBindAddr(e.target.value)}
              placeholder={t("forwards.localAddrPlaceholder")}
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">
              {t("forwards.remotePort")}
            </label>
            <Input
              type="number"
              min={1}
              max={65535}
              value={remotePort}
              onChange={(e) =>
                setRemotePort(e.target.value ? Number(e.target.value) : "")
              }
              placeholder="8080"
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">
              {t("forwards.protocol")}
            </label>
            <Select
              value={protocol}
              onValueChange={(v) => v && setProtocol(v)}
            >
              <SelectTrigger className="w-full">
                <span className="flex flex-1 text-left">{protocol.toUpperCase()}</span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tcp">TCP</SelectItem>
                <SelectItem value="udp">UDP</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">
              {t("forwards.allowedIps")}
            </label>
            <Textarea
              value={allowedIps}
              onChange={(e) => setAllowedIps(e.target.value)}
              placeholder={t("forwards.allowedIpsPlaceholder")}
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            {t("common.cancel")}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isPending || !isValid}
          >
            {isPending
              ? t("common.saving")
              : mode === "add"
                ? t("common.create")
                : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
