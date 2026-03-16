import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import HelpTip from "@/components/wizard/HelpTip";
import type { WizardState } from "@/lib/buildConfig";

interface Props {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
}

export default function Step1Connection({ state, onChange }: Props) {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="w-name">{t("wizard.profileName")} *</Label>
        <Input
          id="w-name"
          value={state.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="My Server"
        />
      </div>

      <div className="flex gap-2">
        <div className="flex-1 space-y-1">
          <Label htmlFor="w-host">{t("wizard.serverHost")} *</Label>
          <Input
            id="w-host"
            value={state.serverHost}
            onChange={(e) => onChange({ serverHost: e.target.value })}
            placeholder="proxy.example.com"
          />
        </div>
        <div className="w-28 space-y-1">
          <Label htmlFor="w-port">{t("wizard.port")} *</Label>
          <Input
            id="w-port"
            type="number"
            min={1}
            max={65535}
            value={state.serverPort}
            onChange={(e) => onChange({ serverPort: parseInt(e.target.value, 10) || 443 })}
          />
        </div>
      </div>

      {/* TLS / Security */}
      <div className="space-y-3 p-3 rounded-lg bg-muted/40 border">
        <p className="text-sm font-medium">{t("wizard.tlsSettings")}</p>
        <div className="space-y-1">
          <Label htmlFor="w-tls-sni">{t("wizard.tlsServerName")} <span className="text-muted-foreground text-xs">({t("wizard.tlsServerNameHint")})</span></Label>
          <Input
            id="w-tls-sni"
            value={state.tlsServerName}
            onChange={(e) => onChange({ tlsServerName: e.target.value })}
            placeholder={t("wizard.tlsServerNamePlaceholder")}
          />
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-1">
            <Label htmlFor="w-alpn">{t("wizard.alpnProtocols")} <span className="text-muted-foreground text-xs">({t("wizard.alpnHint")})</span></Label>
            <HelpTip content={t("wizard.help.alpn")} />
          </div>
          <Input
            id="w-alpn"
            value={state.alpnProtocols}
            onChange={(e) => onChange({ alpnProtocols: e.target.value })}
            placeholder="h2,http/1.1"
          />
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <div>
              <Label>{t("wizard.tlsOnTcp")}</Label>
              <p className="text-xs text-muted-foreground">{t("wizard.tlsOnTcpDesc")}</p>
            </div>
            <HelpTip content={t("wizard.help.tlsOnTcp")} />
          </div>
          <Switch checked={state.tlsOnTcp} onCheckedChange={(v) => onChange({ tlsOnTcp: v })} />
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <div>
              <Label>{t("wizard.skipCertVerify")}</Label>
              <p className="text-xs text-destructive/70">{t("wizard.skipCertVerifyDesc")}</p>
            </div>
            <HelpTip content={t("wizard.help.skipCertVerify")} />
          </div>
          <Switch checked={state.skipCertVerify} onCheckedChange={(v) => onChange({ skipCertVerify: v })} />
        </div>
      </div>
    </div>
  );
}
