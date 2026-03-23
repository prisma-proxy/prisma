import { useTranslation } from "react-i18next";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useSettings } from "@/store/settings";

export default function LoggingSection() {
  const { t } = useTranslation();
  const { logLevel, logFormat, patch } = useSettings();

  return (
    <div className="space-y-4">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t("settings.logging")}</p>
      <p className="text-xs text-muted-foreground">{t("settings.appliedOnConnect")}</p>
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label>{t("settings.logLevel")}</Label>
          <Select value={logLevel} onValueChange={(v) => patch({ logLevel: v as typeof logLevel })}>
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
        <div className="space-y-1">
          <Label>{t("settings.logFormat")}</Label>
          <Select value={logFormat} onValueChange={(v) => patch({ logFormat: v as typeof logFormat })}>
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
  );
}
