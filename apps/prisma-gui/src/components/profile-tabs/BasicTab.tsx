import { useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw, Eye, EyeOff, Dices } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import HelpTip from "@/components/wizard/HelpTip";
import type { WizardState } from "@/lib/buildConfig";
import { PROFILE_PRESETS, applyPreset } from "@/lib/presets";
import { generateUuid } from "@/lib/crypto";

interface Props {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
  onApplyPreset: (state: WizardState) => void;
}

function generateHex64(): string {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default function BasicTab({ state, onChange, onApplyPreset }: Props) {
  const { t } = useTranslation();
  const [showSecret, setShowSecret] = useState(false);
  const [activePreset, setActivePreset] = useState<string | null>(null);

  function handlePreset(presetId: string) {
    const preset = PROFILE_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setActivePreset(presetId);
    onApplyPreset(applyPreset(state, preset));
  }

  return (
    <div className="space-y-4">
      {/* Preset selector */}
      <div className="space-y-2">
        <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {t("wizard.presets.title")}
        </Label>
        <div className="flex flex-wrap gap-1.5">
          {PROFILE_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => handlePreset(preset.id)}
              className={`px-2.5 py-1 rounded-md border text-xs transition-colors ${
                activePreset === preset.id
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border hover:bg-accent"
              }`}
              title={t(preset.descKey)}
            >
              {t(preset.labelKey)}
            </button>
          ))}
        </div>
      </div>

      {/* Profile name */}
      <div className="space-y-1">
        <Label htmlFor="pd-name">{t("wizard.profileName")} *</Label>
        <Input
          id="pd-name"
          value={state.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="My Server"
        />
      </div>

      {/* Server host + port */}
      <div className="flex gap-2">
        <div className="flex-1 space-y-1">
          <Label htmlFor="pd-host">{t("wizard.serverHost")} *</Label>
          <Input
            id="pd-host"
            value={state.serverHost}
            onChange={(e) => onChange({ serverHost: e.target.value })}
            placeholder="proxy.example.com"
          />
        </div>
        <div className="w-28 space-y-1">
          <Label htmlFor="pd-port">{t("wizard.port")} *</Label>
          <Input
            id="pd-port"
            type="number"
            min={1}
            max={65535}
            value={state.serverPort}
            onChange={(e) => onChange({ serverPort: parseInt(e.target.value, 10) || 443 })}
          />
        </div>
      </div>

      {/* TLS server name */}
      <div className="space-y-1">
        <Label htmlFor="pd-tls-sni">
          {t("wizard.tlsServerName")}{" "}
          <span className="text-muted-foreground text-xs">({t("wizard.tlsServerNameHint")})</span>
        </Label>
        <Input
          id="pd-tls-sni"
          value={state.tlsServerName}
          onChange={(e) => onChange({ tlsServerName: e.target.value })}
          placeholder={t("wizard.tlsServerNamePlaceholder")}
        />
      </div>

      {/* Skip cert verify */}
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

      {/* Auth section */}
      <div className="space-y-3 p-3 rounded-lg bg-muted/40 border">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {t("wizard.auth")}
        </p>

        <div className="space-y-1">
          <Label htmlFor="pd-clientid">{t("wizard.clientId")}</Label>
          <div className="flex gap-2">
            <Input
              id="pd-clientid"
              value={state.clientId}
              onChange={(e) => onChange({ clientId: e.target.value })}
              placeholder="your-client-id"
              className="flex-1"
            />
            <Button type="button" variant="outline" size="icon" onClick={() => onChange({ clientId: generateUuid() })} title={t("wizard.generate")}>
              <Dices className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="space-y-1">
          <Label htmlFor="pd-auth">
            {t("wizard.authSecret")} *{" "}
            <span className="text-xs text-muted-foreground">({t("wizard.authSecretHint")})</span>
          </Label>
          <div className="flex gap-1">
            <div className="relative flex-1">
              <Input
                id="pd-auth"
                type={showSecret ? "text" : "password"}
                value={state.authSecret}
                onChange={(e) => onChange({ authSecret: e.target.value.toLowerCase() })}
                className="font-mono pr-8"
                placeholder="0000...0000"
              />
              <button
                type="button"
                onClick={() => setShowSecret((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showSecret ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => onChange({ authSecret: generateHex64() })}
              title={t("wizard.generateSecret")}
            >
              <RefreshCw size={14} />
            </Button>
          </div>
          {state.authSecret && !/^[0-9a-f]{64}$/.test(state.authSecret) && (
            <p className="text-xs text-destructive">{t("wizard.authSecretError")}</p>
          )}
        </div>

        <div className="space-y-1">
          <div className="flex items-center gap-1">
            <Label htmlFor="pd-keypin">
              {t("wizard.serverKeyPin")}{" "}
              <span className="text-muted-foreground text-xs">({t("wizard.optional")})</span>
            </Label>
            <HelpTip content={t("wizard.help.serverKeyPin")} />
          </div>
          <Input
            id="pd-keypin"
            value={state.serverKeyPin}
            onChange={(e) => onChange({ serverKeyPin: e.target.value.toLowerCase() })}
            className="font-mono text-xs"
            placeholder="hex-encoded public key hash"
          />
          {state.serverKeyPin && !/^[0-9a-f]+$/.test(state.serverKeyPin) && (
            <p className="text-xs text-destructive">{t("wizard.serverKeyPinError")}</p>
          )}
        </div>
      </div>
    </div>
  );
}
