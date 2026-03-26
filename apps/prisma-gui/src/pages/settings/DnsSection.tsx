import { useTranslation } from "react-i18next";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useSettings } from "@/store/settings";

export default function DnsSection() {
  const { t } = useTranslation();
  const { dnsMode, dnsUpstream, fakeIpRange, patch } = useSettings();

  return (
    <div className="space-y-4">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t("settings.dns")}</p>
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label>{t("settings.dnsMode")}</Label>
          <Select value={dnsMode} onValueChange={(v) => patch({ dnsMode: v as typeof dnsMode })}>
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
          <Label htmlFor="s-dns">{t("settings.dnsUpstream")}</Label>
          <Input
            id="s-dns"
            value={dnsUpstream}
            onChange={(e) => patch({ dnsUpstream: e.target.value })}
            placeholder="8.8.8.8:53"
          />
        </div>
        {dnsMode === "fake" && (
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="s-fakeip">{t("settings.fakeIpRange")}</Label>
            <Input
              id="s-fakeip"
              value={fakeIpRange}
              onChange={(e) => patch({ fakeIpRange: e.target.value })}
              placeholder="198.18.0.0/15"
            />
          </div>
        )}
      </div>
    </div>
  );
}
