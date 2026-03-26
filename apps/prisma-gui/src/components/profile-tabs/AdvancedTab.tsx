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

export default function AdvancedTab({ state, onChange }: Props) {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      {/* XMUX connection pool */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <div>
              <Label>{t("wizard.xmux")}</Label>
              <p className="text-xs text-muted-foreground">{t("wizard.xmuxDesc")}</p>
            </div>
            <HelpTip content={t("wizard.help.xmux")} />
          </div>
          <Switch checked={state.xmuxEnabled} onCheckedChange={(v) => onChange({ xmuxEnabled: v })} />
        </div>
        {state.xmuxEnabled && (
          <div className="space-y-2 p-3 rounded-lg bg-muted/40 border">
            <div className="flex gap-2">
              <div className="flex-1 space-y-1"><Label className="text-xs">{t("wizard.xmuxConnsMin")}</Label><Input type="number" min={1} value={state.xmuxMaxConnsMin} onChange={(e) => onChange({ xmuxMaxConnsMin: parseInt(e.target.value, 10) || 1 })} /></div>
              <div className="flex-1 space-y-1"><Label className="text-xs">{t("wizard.xmuxConnsMax")}</Label><Input type="number" min={1} value={state.xmuxMaxConnsMax} onChange={(e) => onChange({ xmuxMaxConnsMax: parseInt(e.target.value, 10) || 4 })} /></div>
            </div>
            <div className="flex gap-2">
              <div className="flex-1 space-y-1"><Label className="text-xs">{t("wizard.xmuxConcurrencyMin")}</Label><Input type="number" min={1} value={state.xmuxMaxConcurrencyMin} onChange={(e) => onChange({ xmuxMaxConcurrencyMin: parseInt(e.target.value, 10) || 8 })} /></div>
              <div className="flex-1 space-y-1"><Label className="text-xs">{t("wizard.xmuxConcurrencyMax")}</Label><Input type="number" min={1} value={state.xmuxMaxConcurrencyMax} onChange={(e) => onChange({ xmuxMaxConcurrencyMax: parseInt(e.target.value, 10) || 16 })} /></div>
            </div>
            <div className="flex gap-2">
              <div className="flex-1 space-y-1"><Label className="text-xs">{t("wizard.xmuxLifetimeMin")}</Label><Input type="number" min={1} value={state.xmuxMaxLifetimeMin} onChange={(e) => onChange({ xmuxMaxLifetimeMin: parseInt(e.target.value, 10) || 300 })} /></div>
              <div className="flex-1 space-y-1"><Label className="text-xs">{t("wizard.xmuxLifetimeMax")}</Label><Input type="number" min={1} value={state.xmuxMaxLifetimeMax} onChange={(e) => onChange({ xmuxMaxLifetimeMax: parseInt(e.target.value, 10) || 600 })} /></div>
            </div>
            <div className="flex gap-2">
              <div className="flex-1 space-y-1"><Label className="text-xs">{t("wizard.xmuxRequestsMin")}</Label><Input type="number" min={1} value={state.xmuxMaxRequestsMin} onChange={(e) => onChange({ xmuxMaxRequestsMin: parseInt(e.target.value, 10) || 100 })} /></div>
              <div className="flex-1 space-y-1"><Label className="text-xs">{t("wizard.xmuxRequestsMax")}</Label><Input type="number" min={1} value={state.xmuxMaxRequestsMax} onChange={(e) => onChange({ xmuxMaxRequestsMax: parseInt(e.target.value, 10) || 200 })} /></div>
            </div>
          </div>
        )}
      </div>

      {/* Port hopping — QUIC only */}
      {state.transport === "quic" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <Label>{t("wizard.portHopping")}</Label>
              <HelpTip content={t("wizard.help.portHopping")} />
            </div>
            <Switch checked={state.portHopping} onCheckedChange={(v) => onChange({ portHopping: v })} />
          </div>
          {state.portHopping && (
            <div className="flex gap-2 p-3 rounded-lg bg-muted/40 border flex-wrap">
              <div className="flex-1 min-w-[80px] space-y-1">
                <Label className="text-xs">{t("wizard.portHopBase")}</Label>
                <Input type="number" value={state.portHopBase} onChange={(e) => onChange({ portHopBase: parseInt(e.target.value, 10) || 40000 })} />
              </div>
              <div className="flex-1 min-w-[80px] space-y-1">
                <Label className="text-xs">{t("wizard.portHopRange")}</Label>
                <Input type="number" value={state.portHopRange} onChange={(e) => onChange({ portHopRange: parseInt(e.target.value, 10) || 5000 })} />
              </div>
              <div className="flex-1 min-w-[80px] space-y-1">
                <Label className="text-xs">{t("wizard.portHopInterval")}</Label>
                <Input type="number" value={state.portHopInterval} onChange={(e) => onChange({ portHopInterval: parseInt(e.target.value, 10) || 30 })} />
              </div>
              <div className="flex-1 min-w-[80px] space-y-1">
                <Label className="text-xs">{t("wizard.portHopGrace")}</Label>
                <Input type="number" value={state.portHopGracePeriod} onChange={(e) => onChange({ portHopGracePeriod: parseInt(e.target.value, 10) || 5 })} />
              </div>
            </div>
          )}
        </div>
      )}

      {/* UDP FEC */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <div>
              <Label>{t("wizard.fec")}</Label>
              <p className="text-xs text-muted-foreground">{t("wizard.fecDesc")}</p>
            </div>
            <HelpTip content={t("wizard.help.fec")} />
          </div>
          <Switch checked={state.fecEnabled} onCheckedChange={(v) => onChange({ fecEnabled: v })} />
        </div>
        {state.fecEnabled && (
          <div className="flex gap-2 p-3 rounded-lg bg-muted/40 border">
            <div className="flex-1 space-y-1">
              <Label className="text-xs">{t("wizard.fecDataShards")}</Label>
              <Input type="number" min={1} value={state.fecDataShards} onChange={(e) => onChange({ fecDataShards: parseInt(e.target.value, 10) || 10 })} />
            </div>
            <div className="flex-1 space-y-1">
              <Label className="text-xs">{t("wizard.fecParityShards")}</Label>
              <Input type="number" min={1} value={state.fecParityShards} onChange={(e) => onChange({ fecParityShards: parseInt(e.target.value, 10) || 3 })} />
            </div>
          </div>
        )}
      </div>

      {/* Fallback strategy */}
      <div className="space-y-3 p-3 rounded-lg bg-muted/40 border">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {t("wizard.advancedFallback")}
        </p>
        <p className="text-xs text-muted-foreground">{t("wizard.advancedFallbackDesc")}</p>
        <div className="flex items-center justify-between">
          <div>
            <Label>{t("wizard.fallbackUseServer")}</Label>
            <p className="text-xs text-muted-foreground">{t("wizard.fallbackUseServerDesc")}</p>
          </div>
          <Switch checked={state.fallbackUseServerFallback} onCheckedChange={(v) => onChange({ fallbackUseServerFallback: v })} />
        </div>
        <div className="flex gap-2">
          <div className="flex-1 space-y-1">
            <Label className="text-xs">{t("wizard.fallbackMaxAttempts")}</Label>
            <Input type="number" min={1} max={20} value={state.fallbackMaxAttempts} onChange={(e) => onChange({ fallbackMaxAttempts: parseInt(e.target.value, 10) || 3 })} />
          </div>
          <div className="flex-1 space-y-1">
            <Label className="text-xs">{t("wizard.fallbackConnectTimeout")}</Label>
            <Input type="number" min={1} max={120} value={state.fallbackConnectTimeout} onChange={(e) => onChange({ fallbackConnectTimeout: parseInt(e.target.value, 10) || 10 })} />
          </div>
        </div>
      </div>
    </div>
  );
}
