"use client";

import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/lib/toast-context";
import { useClientPermissions, useUpdateClientPermissions } from "@/hooks/use-client-permissions";
import type { ClientPermissions } from "@/lib/types";

interface ClientPermissionsFormProps {
  clientId: string;
}

const DEFAULT_PERMISSIONS: ClientPermissions = {
  allow_port_forwarding: true,
  allow_udp: true,
  allowed_destinations: [],
  blocked_destinations: [],
  max_connections: 0,
  bandwidth_limit: null,
  allowed_ports: [],
  blocked_ports: [],
};

export function ClientPermissionsForm({ clientId }: ClientPermissionsFormProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const { data: perms, isLoading } = useClientPermissions(clientId);
  const updatePerms = useUpdateClientPermissions();

  const [allowPortForwarding, setAllowPortForwarding] = useState(true);
  const [allowUdp, setAllowUdp] = useState(true);
  const [maxConnections, setMaxConnections] = useState(0);
  const [bandwidthLimit, setBandwidthLimit] = useState<string>("");
  const [allowedDestinations, setAllowedDestinations] = useState("");
  const [blockedDestinations, setBlockedDestinations] = useState("");
  const [allowedPorts, setAllowedPorts] = useState("");
  const [blockedPorts, setBlockedPorts] = useState("");

  useEffect(() => {
    const p = perms ?? DEFAULT_PERMISSIONS;
    setAllowPortForwarding(p.allow_port_forwarding);
    setAllowUdp(p.allow_udp);
    setMaxConnections(p.max_connections);
    setBandwidthLimit(p.bandwidth_limit ? String(p.bandwidth_limit) : "");
    setAllowedDestinations(p.allowed_destinations.join("\n"));
    setBlockedDestinations(p.blocked_destinations.join("\n"));
    setAllowedPorts(p.allowed_ports.join(", "));
    setBlockedPorts(p.blocked_ports.join(", "));
  }, [perms]);

  function handleSave() {
    const data: ClientPermissions = {
      allow_port_forwarding: allowPortForwarding,
      allow_udp: allowUdp,
      max_connections: maxConnections,
      bandwidth_limit: bandwidthLimit ? parseInt(bandwidthLimit, 10) || null : null,
      allowed_destinations: allowedDestinations.split("\n").map((s) => s.trim()).filter(Boolean),
      blocked_destinations: blockedDestinations.split("\n").map((s) => s.trim()).filter(Boolean),
      allowed_ports: allowedPorts.split(",").map((s) => s.trim()).filter(Boolean),
      blocked_ports: blockedPorts.split(",").map((s) => s.trim()).filter(Boolean).map(Number).filter((n) => n > 0),
    };
    updatePerms.mutate(
      { id: clientId, data },
      {
        onSuccess: () => toast(t("toast.permissionsSaved"), "success"),
        onError: (err) => toast(String(err), "error"),
      }
    );
  }

  if (isLoading) {
    return <p className="text-sm text-muted-foreground py-4">{t("common.loading")}</p>;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <Label>{t("permissions.allowPortForwarding")}</Label>
          <p className="text-xs text-muted-foreground">{t("permissions.allowPortForwardingDesc")}</p>
        </div>
        <Switch checked={allowPortForwarding} onCheckedChange={setAllowPortForwarding} />
      </div>

      <div className="flex items-center justify-between">
        <div>
          <Label>{t("permissions.allowUdp")}</Label>
          <p className="text-xs text-muted-foreground">{t("permissions.allowUdpDesc")}</p>
        </div>
        <Switch checked={allowUdp} onCheckedChange={setAllowUdp} />
      </div>

      <div className="grid gap-1.5">
        <Label>{t("permissions.maxConnections")}</Label>
        <p className="text-xs text-muted-foreground">{t("permissions.maxConnectionsDesc")}</p>
        <Input
          type="number"
          min={0}
          value={maxConnections}
          onChange={(e) => setMaxConnections(parseInt(e.target.value, 10) || 0)}
        />
      </div>

      <div className="grid gap-1.5">
        <Label>{t("permissions.bandwidthLimit")}</Label>
        <p className="text-xs text-muted-foreground">{t("permissions.bandwidthLimitDesc")}</p>
        <Input
          type="number"
          min={0}
          value={bandwidthLimit}
          onChange={(e) => setBandwidthLimit(e.target.value)}
          placeholder={t("permissions.unlimited")}
        />
      </div>

      <div className="grid gap-1.5">
        <Label>{t("permissions.allowedDestinations")}</Label>
        <p className="text-xs text-muted-foreground">{t("permissions.allowedDestinationsDesc")}</p>
        <Textarea
          rows={3}
          value={allowedDestinations}
          onChange={(e) => setAllowedDestinations(e.target.value)}
          placeholder={"*.example.com\n10.0.0.0/8"}
          className="font-mono text-xs"
        />
      </div>

      <div className="grid gap-1.5">
        <Label>{t("permissions.blockedDestinations")}</Label>
        <p className="text-xs text-muted-foreground">{t("permissions.blockedDestinationsDesc")}</p>
        <Textarea
          rows={3}
          value={blockedDestinations}
          onChange={(e) => setBlockedDestinations(e.target.value)}
          placeholder={"*.banned.com"}
          className="font-mono text-xs"
        />
      </div>

      <div className="grid gap-1.5">
        <Label>{t("permissions.allowedPorts")}</Label>
        <p className="text-xs text-muted-foreground">{t("permissions.allowedPortsDesc")}</p>
        <Input
          value={allowedPorts}
          onChange={(e) => setAllowedPorts(e.target.value)}
          placeholder="80, 443, 8080-8090"
          className="font-mono text-xs"
        />
      </div>

      <div className="grid gap-1.5">
        <Label>{t("permissions.blockedPorts")}</Label>
        <p className="text-xs text-muted-foreground">{t("permissions.blockedPortsDesc")}</p>
        <Input
          value={blockedPorts}
          onChange={(e) => setBlockedPorts(e.target.value)}
          placeholder="25, 465, 587"
          className="font-mono text-xs"
        />
      </div>

      <Button onClick={handleSave} disabled={updatePerms.isPending}>
        {updatePerms.isPending ? t("common.saving") : t("common.save")}
      </Button>
    </div>
  );
}
