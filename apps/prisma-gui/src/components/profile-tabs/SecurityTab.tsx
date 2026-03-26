import { useTranslation } from "react-i18next";
import { Dices } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import HelpTip from "@/components/wizard/HelpTip";
import type { WizardState } from "@/lib/buildConfig";
import { generateHexSecret } from "@/lib/crypto";

interface Props {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
}

export default function SecurityTab({ state, onChange }: Props) {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      {/* TLS section */}
      <div className="space-y-3 p-3 rounded-lg bg-muted/40 border">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {t("wizard.tlsSettings")}
        </p>
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
        <div className="space-y-1">
          <div className="flex items-center gap-1">
            <Label>{t("wizard.alpnProtocols")} <span className="text-muted-foreground text-xs">({t("wizard.alpnHint")})</span></Label>
            <HelpTip content={t("wizard.help.alpn")} />
          </div>
          <Input
            value={state.alpnProtocols}
            onChange={(e) => onChange({ alpnProtocols: e.target.value })}
            placeholder="h2,http/1.1"
          />
        </div>
        <div className="space-y-1">
          <Label>{t("wizard.tlsFingerprint")}</Label>
          <Select value={state.fingerprint} onValueChange={(v) => onChange({ fingerprint: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="chrome">Chrome</SelectItem>
              <SelectItem value="firefox">Firefox</SelectItem>
              <SelectItem value="safari">Safari</SelectItem>
              <SelectItem value="random">Random</SelectItem>
              <SelectItem value="none">{t("common.none")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* QUIC Security section — only shown for QUIC transport */}
      {state.transport === "quic" && (
        <div className="space-y-3 p-3 rounded-lg bg-muted/40 border">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {t("wizard.quicSecurity")}
          </p>
          <div className="space-y-1">
            <div className="flex items-center gap-1">
              <Label>{t("wizard.salamanderPassword")} <span className="text-muted-foreground text-xs">({t("wizard.salamanderHint")})</span></Label>
              <HelpTip content={t("wizard.help.salamander")} />
            </div>
            <Input type="password" value={state.salamanderPassword} onChange={(e) => onChange({ salamanderPassword: e.target.value })} />
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <Label>{t("wizard.sniSlicing")}</Label>
              <HelpTip content={t("wizard.help.sniSlicing")} />
            </div>
            <Switch checked={state.sniSlicing} onCheckedChange={(v) => onChange({ sniSlicing: v })} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label>{t("wizard.entropyCamouflage")}</Label>
              <p className="text-xs text-muted-foreground">{t("wizard.entropyCamouflageDesc")}</p>
            </div>
            <Switch checked={state.entropyCamouflage} onCheckedChange={(v) => onChange({ entropyCamouflage: v })} />
          </div>
        </div>
      )}

      {/* Obfuscation section */}
      <div className="space-y-3 p-3 rounded-lg bg-muted/40 border">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {t("wizard.headerObfuscation")}
        </p>
        <div className="flex gap-2">
          <div className="flex-1 space-y-1">
            <Label>{t("wizard.userAgent")} <span className="text-muted-foreground text-xs">({t("wizard.optional")})</span></Label>
            <Input value={state.userAgent} onChange={(e) => onChange({ userAgent: e.target.value })} placeholder="Mozilla/5.0 ..." />
          </div>
          <div className="flex-1 space-y-1">
            <Label>{t("wizard.referer")} <span className="text-muted-foreground text-xs">({t("wizard.optional")})</span></Label>
            <Input value={state.referer} onChange={(e) => onChange({ referer: e.target.value })} placeholder="https://example.com" />
          </div>
        </div>
      </div>

      {/* Cipher mode */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <div>
            <Label>{t("wizard.transportOnlyCipher")}</Label>
            <p className="text-xs text-muted-foreground">{t("wizard.transportOnlyCipherDesc")}</p>
          </div>
          <HelpTip content={t("wizard.help.cipher")} />
        </div>
        <Switch checked={state.transportOnlyCipher} onCheckedChange={(v) => onChange({ transportOnlyCipher: v })} />
      </div>

      {/* Prisma auth secret */}
      <div className="space-y-1">
        <Label>{t("wizard.prismaAuthSecret")} <span className="text-muted-foreground text-xs">({t("wizard.prismaAuthHint")})</span></Label>
        <div className="flex gap-2">
          <Input
            type="password"
            value={state.prismaAuthSecret}
            onChange={(e) => onChange({ prismaAuthSecret: e.target.value })}
            className="flex-1"
          />
          <Button type="button" variant="outline" size="icon" onClick={() => onChange({ prismaAuthSecret: generateHexSecret() })} title={t("wizard.generate")}>
            <Dices className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Traffic shaping */}
      <div className="space-y-3 p-3 rounded-lg bg-muted/40 border">
        <div className="flex items-center gap-1">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("wizard.trafficShaping")}</p>
          <HelpTip content={t("wizard.help.trafficShaping")} />
        </div>
        <div className="flex gap-2">
          <div className="flex-1 space-y-1">
            <Label>{t("wizard.paddingMode")}</Label>
            <Select value={state.trafficPaddingMode} onValueChange={(v) => onChange({ trafficPaddingMode: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("common.none")}</SelectItem>
                <SelectItem value="random">Random</SelectItem>
                <SelectItem value="bucket">Bucket</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 space-y-1">
            <Label>{t("wizard.timingJitter")}</Label>
            <Input type="number" min={0} value={state.trafficTimingJitter} onChange={(e) => onChange({ trafficTimingJitter: parseInt(e.target.value, 10) || 0 })} />
          </div>
        </div>
        <div className="flex gap-2">
          <div className="flex-1 space-y-1">
            <Label>{t("wizard.chaffInterval")} <span className="text-muted-foreground text-xs">{t("wizard.chaffOff")}</span></Label>
            <Input type="number" min={0} value={state.trafficChaffInterval} onChange={(e) => onChange({ trafficChaffInterval: parseInt(e.target.value, 10) || 0 })} />
          </div>
          <div className="flex-1 space-y-1">
            <Label>{t("wizard.coalesceWindow")} <span className="text-muted-foreground text-xs">{t("wizard.chaffOff")}</span></Label>
            <Input type="number" min={0} value={state.trafficCoalesceWindow} onChange={(e) => onChange({ trafficCoalesceWindow: parseInt(e.target.value, 10) || 0 })} />
          </div>
        </div>
      </div>
    </div>
  );
}
