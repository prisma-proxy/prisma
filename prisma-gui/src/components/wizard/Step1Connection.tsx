import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { WizardState } from "@/lib/buildConfig";

interface Props {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
}

export default function Step1Connection({ state, onChange }: Props) {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="w-name">Profile name *</Label>
        <Input
          id="w-name"
          value={state.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="My Server"
        />
      </div>

      <div className="flex gap-2">
        <div className="flex-1 space-y-1">
          <Label htmlFor="w-host">Server host *</Label>
          <Input
            id="w-host"
            value={state.serverHost}
            onChange={(e) => onChange({ serverHost: e.target.value })}
            placeholder="proxy.example.com"
          />
        </div>
        <div className="w-28 space-y-1">
          <Label htmlFor="w-port">Port *</Label>
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

      <div className="flex gap-2">
        <div className="flex-1 space-y-1">
          <Label htmlFor="w-socks5">SOCKS5 listen port</Label>
          <Input
            id="w-socks5"
            type="number"
            min={1}
            max={65535}
            value={state.socks5Port}
            onChange={(e) => onChange({ socks5Port: parseInt(e.target.value, 10) || 1080 })}
          />
        </div>
        <div className="flex-1 space-y-1">
          <Label htmlFor="w-http">HTTP listen port <span className="text-muted-foreground">(optional)</span></Label>
          <Input
            id="w-http"
            type="number"
            min={1}
            max={65535}
            value={state.httpPort}
            onChange={(e) => onChange({ httpPort: e.target.value })}
            placeholder="8080"
          />
        </div>
      </div>
    </div>
  );
}
