import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import HelpTip from "@/components/wizard/HelpTip";
import type { WizardState } from "@/lib/buildConfig";

interface Props {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
}

export default function Step4RoutingTun({ state, onChange }: Props) {
  const { t } = useTranslation();

  return (
    <div className="space-y-5">
      {/* TUN */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <div>
              <p className="text-sm font-medium">{t("wizard.tunMode")}</p>
              <p className="text-xs text-muted-foreground">{t("wizard.tunModeDesc")}</p>
            </div>
            <HelpTip content={t("wizard.help.tun")} />
          </div>
          <Switch checked={state.tunEnabled} onCheckedChange={(v) => onChange({ tunEnabled: v })} />
        </div>

        {state.tunEnabled && (
          <div className="space-y-3 p-3 rounded-lg bg-muted/40 border">
            <div className="flex gap-2">
              <div className="flex-1 space-y-1">
                <Label>{t("wizard.tunDevice")}</Label>
                <Input
                  value={state.tunDevice}
                  onChange={(e) => onChange({ tunDevice: e.target.value })}
                  placeholder="prisma-tun"
                />
              </div>
              <div className="w-28 space-y-1">
                <Label>{t("wizard.tunMtu")}</Label>
                <Input
                  type="number"
                  value={state.tunMtu}
                  onChange={(e) => onChange({ tunMtu: parseInt(e.target.value, 10) || 1500 })}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>{t("wizard.tunIncludeRoutes")} <span className="text-muted-foreground text-xs">({t("wizard.onePerLine")})</span></Label>
              <Textarea
                rows={3}
                className="font-mono text-xs"
                value={state.tunIncludeRoutes.join("\n")}
                onChange={(e) =>
                  onChange({ tunIncludeRoutes: e.target.value.split("\n").filter(Boolean) })
                }
                placeholder="0.0.0.0/0"
              />
            </div>
            <div className="space-y-1">
              <Label>{t("wizard.tunExcludeRoutes")} <span className="text-muted-foreground text-xs">({t("wizard.onePerLine")})</span></Label>
              <Textarea
                rows={2}
                className="font-mono text-xs"
                value={state.tunExcludeRoutes.join("\n")}
                onChange={(e) =>
                  onChange({ tunExcludeRoutes: e.target.value.split("\n").filter(Boolean) })
                }
                placeholder="192.168.0.0/16"
              />
            </div>
          </div>
        )}
      </div>

      {/* DNS */}
      <div className="space-y-3">
        <div className="flex items-center gap-1">
          <p className="text-sm font-medium">{t("wizard.dnsSettings")}</p>
          <HelpTip content={t("wizard.help.dnsMode")} />
        </div>
        <div className="space-y-1">
          <Label>{t("wizard.dnsMode")}</Label>
          <Select
            value={state.dnsMode}
            onValueChange={(v) => onChange({ dnsMode: v as WizardState["dnsMode"] })}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="direct">{t("settings.dnsDirect")}</SelectItem>
              <SelectItem value="tunnel">{t("settings.dnsTunnel")}</SelectItem>
              <SelectItem value="fake">{t("settings.dnsFake")}</SelectItem>
              <SelectItem value="smart">{t("settings.dnsSmart")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>{t("wizard.dnsUpstream")}</Label>
          <Input
            value={state.dnsUpstream}
            onChange={(e) => onChange({ dnsUpstream: e.target.value })}
            placeholder="8.8.8.8:53"
          />
        </div>
        {state.dnsMode === "fake" && (
          <div className="space-y-1">
            <Label>{t("wizard.fakeIpRange")}</Label>
            <Input
              value={state.fakeIpRange}
              onChange={(e) => onChange({ fakeIpRange: e.target.value })}
              placeholder="198.18.0.0/15"
            />
          </div>
        )}
      </div>

      {/* Routing */}
      <div className="space-y-3">
        <div className="flex items-center gap-1">
          <p className="text-sm font-medium">{t("wizard.routing")}</p>
          <HelpTip content={t("wizard.help.routingRules")} />
        </div>
        <div className="space-y-1">
          <Label>{t("wizard.geoipPath")} <span className="text-muted-foreground text-xs">({t("wizard.optional")})</span></Label>
          <Input
            value={state.routingGeoipPath}
            onChange={(e) => onChange({ routingGeoipPath: e.target.value })}
            placeholder="/path/to/geoip.dat"
          />
        </div>
        <div className="space-y-1">
          <Label>{t("wizard.routingRules")} <span className="text-muted-foreground text-xs">({t("wizard.routingRulesHint")})</span></Label>
          <Textarea
            rows={4}
            className="font-mono text-xs"
            value={state.routingRules}
            onChange={(e) => onChange({ routingRules: e.target.value })}
            placeholder={`[{"condition":{"type":"DomainMatch","value":"*.example.com"},"action":"Direct"}]`}
          />
        </div>
      </div>

      {/* Port forwards */}
      <div className="space-y-3">
        <p className="text-sm font-medium">{t("wizard.portForwarding")}</p>
        <div className="space-y-1">
          <Label>{t("wizard.portForwardRules")} <span className="text-muted-foreground text-xs">({t("wizard.portForwardHint")})</span></Label>
          <Textarea
            rows={3}
            className="font-mono text-xs"
            value={state.portForwards}
            onChange={(e) => onChange({ portForwards: e.target.value })}
            placeholder="ssh,127.0.0.1:22,2222&#10;web,127.0.0.1:8080,8080"
          />
        </div>
      </div>

      {/* Logging */}
      <div className="space-y-3">
        <p className="text-sm font-medium">{t("wizard.logging")}</p>
        <div className="flex gap-2">
          <div className="flex-1 space-y-1">
            <Label>{t("wizard.logLevel")}</Label>
            <Select value={state.logLevel} onValueChange={(v) => onChange({ logLevel: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="trace">Trace</SelectItem>
                <SelectItem value="debug">Debug</SelectItem>
                <SelectItem value="info">Info</SelectItem>
                <SelectItem value="warn">Warn</SelectItem>
                <SelectItem value="error">Error</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 space-y-1">
            <Label>{t("wizard.logFormat")}</Label>
            <Select value={state.logFormat} onValueChange={(v) => onChange({ logFormat: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pretty">Pretty</SelectItem>
                <SelectItem value="json">JSON</SelectItem>
                <SelectItem value="compact">Compact</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
    </div>
  );
}
