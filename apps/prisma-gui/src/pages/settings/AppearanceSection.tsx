import { useTranslation } from "react-i18next";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useSettings } from "@/store/settings";

export default function AppearanceSection() {
  const { t, i18n } = useTranslation();
  const { language, theme, patch } = useSettings();

  return (
    <div className="space-y-4">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t("settings.appearance")}</p>
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label>{t("settings.language")}</Label>
          <Select value={language} onValueChange={(v) => { patch({ language: v as "en" | "zh-CN" }); i18n.changeLanguage(v); }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="en">{t("language.english")}</SelectItem>
              <SelectItem value="zh-CN">{t("language.chineseCN")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>{t("settings.theme")}</Label>
          <Select value={theme} onValueChange={(v) => patch({ theme: v as "system" | "light" | "dark" })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="system">{t("settings.themeSystem")}</SelectItem>
              <SelectItem value="light">{t("settings.themeLight")}</SelectItem>
              <SelectItem value="dark">{t("settings.themeDark")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
