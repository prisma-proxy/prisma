import { useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw, Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import HelpTip from "@/components/wizard/HelpTip";
import type { WizardState } from "@/lib/buildConfig";

interface Props {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
}

function generateHex64(): string {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default function Step2Auth({ state, onChange }: Props) {
  const { t } = useTranslation();
  const [showSecret, setShowSecret] = useState(false);

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="w-clientid">{t("wizard.clientId")}</Label>
        <Input
          id="w-clientid"
          value={state.clientId}
          onChange={(e) => onChange({ clientId: e.target.value })}
          placeholder="your-client-id"
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="w-auth">{t("wizard.authSecret")} * <span className="text-xs text-muted-foreground">({t("wizard.authSecretHint")})</span></Label>
        <div className="flex gap-1">
          <div className="relative flex-1">
            <Input
              id="w-auth"
              type={showSecret ? "text" : "password"}
              value={state.authSecret}
              onChange={(e) => onChange({ authSecret: e.target.value.toLowerCase() })}
              className="font-mono pr-8"
              placeholder="0000…0000"
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
        <Label htmlFor="w-prisma-auth">{t("wizard.prismaAuthSecret")} <span className="text-muted-foreground text-xs">({t("wizard.prismaAuthHint")})</span></Label>
        <Input
          id="w-prisma-auth"
          type="password"
          value={state.prismaAuthSecret}
          onChange={(e) => onChange({ prismaAuthSecret: e.target.value })}
        />
      </div>

      <div className="space-y-1">
        <Label>{t("wizard.protocolVersion")}</Label>
        <Select
          value={state.protocolVersion}
          onValueChange={(v) => onChange({ protocolVersion: v as "v4" | "v3" })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="v4">{t("wizard.protocolV4")}</SelectItem>
            <SelectItem value="v3">{t("wizard.protocolV3")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

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
    </div>
  );
}
