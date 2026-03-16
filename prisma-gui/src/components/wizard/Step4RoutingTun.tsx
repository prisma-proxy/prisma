import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { WizardState } from "@/lib/buildConfig";

interface Props {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
}

export default function Step4RoutingTun({ state, onChange }: Props) {
  return (
    <div className="space-y-5">
      {/* TUN */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">TUN mode</p>
            <p className="text-xs text-muted-foreground">Capture all traffic via virtual network adapter</p>
          </div>
          <Switch checked={state.tunEnabled} onCheckedChange={(v) => onChange({ tunEnabled: v })} />
        </div>

        {state.tunEnabled && (
          <div className="space-y-3 p-3 rounded-lg bg-muted/40 border">
            <div className="flex gap-2">
              <div className="flex-1 space-y-1">
                <Label>Device name</Label>
                <Input
                  value={state.tunDevice}
                  onChange={(e) => onChange({ tunDevice: e.target.value })}
                  placeholder="prisma-tun"
                />
              </div>
              <div className="w-28 space-y-1">
                <Label>MTU</Label>
                <Input
                  type="number"
                  value={state.tunMtu}
                  onChange={(e) => onChange({ tunMtu: parseInt(e.target.value, 10) || 1500 })}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Include routes <span className="text-muted-foreground text-xs">(one per line, optional)</span></Label>
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
              <Label>Exclude routes <span className="text-muted-foreground text-xs">(one per line, optional)</span></Label>
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
        <p className="text-sm font-medium">DNS settings</p>
        <div className="space-y-1">
          <Label>DNS mode</Label>
          <Select
            value={state.dnsMode}
            onValueChange={(v) => onChange({ dnsMode: v as WizardState["dnsMode"] })}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="direct">Direct (system DNS)</SelectItem>
              <SelectItem value="tunnel">Tunnel (forward via proxy)</SelectItem>
              <SelectItem value="fake">Fake-IP</SelectItem>
              <SelectItem value="smart">Smart (geo-split)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Upstream DNS server</Label>
          <Input
            value={state.dnsUpstream}
            onChange={(e) => onChange({ dnsUpstream: e.target.value })}
            placeholder="8.8.8.8:53"
          />
        </div>
        {state.dnsMode === "fake" && (
          <div className="space-y-1">
            <Label>Fake-IP range</Label>
            <Input
              value={state.fakeIpRange}
              onChange={(e) => onChange({ fakeIpRange: e.target.value })}
              placeholder="198.18.0.0/15"
            />
          </div>
        )}
      </div>
    </div>
  );
}
