import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { WizardState } from "@/lib/buildConfig";

interface Props {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
}

const TRANSPORTS: { value: WizardState["transport"]; label: string }[] = [
  { value: "quic",   label: "QUIC" },
  { value: "ws",     label: "WebSocket" },
  { value: "grpc",   label: "gRPC" },
  { value: "xhttp",  label: "XHTTP" },
  { value: "xporta", label: "XPorta" },
  { value: "tcp",    label: "TCP" },
];

export default function Step3Transport({ state, onChange }: Props) {
  return (
    <div className="space-y-4">
      {/* Transport selector */}
      <div className="space-y-1">
        <Label>Transport protocol</Label>
        <div className="flex flex-wrap gap-2">
          {TRANSPORTS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => onChange({ transport: value })}
              className={`px-3 py-1.5 rounded-md border text-sm transition-colors ${
                state.transport === value
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border hover:bg-accent"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* QUIC sub-fields */}
      {state.transport === "quic" && (
        <div className="space-y-3 p-3 rounded-lg bg-muted/40 border">
          <div className="flex gap-2">
            <div className="flex-1 space-y-1">
              <Label>Cipher</Label>
              <Select value={state.cipher} onValueChange={(v) => onChange({ cipher: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="chacha20-poly1305">ChaCha20-Poly1305</SelectItem>
                  <SelectItem value="aes-128-gcm">AES-128-GCM</SelectItem>
                  <SelectItem value="aes-256-gcm">AES-256-GCM</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 space-y-1">
              <Label>QUIC version</Label>
              <Select value={state.quicVersion} onValueChange={(v) => onChange({ quicVersion: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="v1">v1</SelectItem>
                  <SelectItem value="v2">v2</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label>TLS fingerprint <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Input value={state.fingerprint} onChange={(e) => onChange({ fingerprint: e.target.value })} placeholder="chrome" />
          </div>
          <div className="flex items-center justify-between">
            <Label>SNI slicing</Label>
            <Switch checked={state.sniSlicing} onCheckedChange={(v) => onChange({ sniSlicing: v })} />
          </div>
        </div>
      )}

      {/* WS sub-fields */}
      {state.transport === "ws" && (
        <div className="space-y-3 p-3 rounded-lg bg-muted/40 border">
          <div className="space-y-1">
            <Label>Path</Label>
            <Input value={state.wsUrl} onChange={(e) => onChange({ wsUrl: e.target.value })} placeholder="/ws" />
          </div>
          <div className="space-y-1">
            <Label>Host header <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Input value={state.wsHost} onChange={(e) => onChange({ wsHost: e.target.value })} />
          </div>
        </div>
      )}

      {/* gRPC sub-fields */}
      {state.transport === "grpc" && (
        <div className="space-y-3 p-3 rounded-lg bg-muted/40 border">
          <div className="space-y-1">
            <Label>Service path</Label>
            <Input value={state.grpcUrl} onChange={(e) => onChange({ grpcUrl: e.target.value })} placeholder="/prisma.Proxy/Relay" />
          </div>
        </div>
      )}

      {/* XHTTP sub-fields */}
      {state.transport === "xhttp" && (
        <div className="space-y-3 p-3 rounded-lg bg-muted/40 border">
          <div className="space-y-1">
            <Label>Mode</Label>
            <Select value={state.xhttpMode} onValueChange={(v) => onChange({ xhttpMode: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto</SelectItem>
                <SelectItem value="upload">Upload only</SelectItem>
                <SelectItem value="download">Download only</SelectItem>
                <SelectItem value="stream">Stream</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label>Upload URL</Label><Input value={state.xhttpUploadUrl} onChange={(e) => onChange({ xhttpUploadUrl: e.target.value })} /></div>
          <div className="space-y-1"><Label>Download URL</Label><Input value={state.xhttpDownloadUrl} onChange={(e) => onChange({ xhttpDownloadUrl: e.target.value })} /></div>
          <div className="space-y-1"><Label>Stream URL</Label><Input value={state.xhttpStreamUrl} onChange={(e) => onChange({ xhttpStreamUrl: e.target.value })} /></div>
        </div>
      )}

      {/* XPorta sub-fields */}
      {state.transport === "xporta" && (
        <div className="space-y-3 p-3 rounded-lg bg-muted/40 border">
          <div className="space-y-1"><Label>Base URL</Label><Input value={state.xportaBaseUrl} onChange={(e) => onChange({ xportaBaseUrl: e.target.value })} placeholder="https://cdn.example.com" /></div>
          <div className="flex gap-2">
            <div className="flex-1 space-y-1">
              <Label>Encoding</Label>
              <Select value={state.xportaEncoding} onValueChange={(v) => onChange({ xportaEncoding: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="base64">Base64</SelectItem>
                  <SelectItem value="hex">Hex</SelectItem>
                  <SelectItem value="none">None</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 space-y-1">
              <Label>Poll timeout (s)</Label>
              <Input type="number" min={1} value={state.xportaPollTimeout} onChange={(e) => onChange({ xportaPollTimeout: parseInt(e.target.value, 10) || 30 })} />
            </div>
          </div>
        </div>
      )}

      {/* Congestion + bandwidth */}
      <div className="space-y-3">
        <div className="flex gap-2">
          <div className="flex-1 space-y-1">
            <Label>Congestion control</Label>
            <Select value={state.congestion} onValueChange={(v) => onChange({ congestion: v as WizardState["congestion"] })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="bbr">BBR</SelectItem>
                <SelectItem value="brutal">Brutal</SelectItem>
                <SelectItem value="adaptive">Adaptive</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 space-y-1">
            <Label>Target bandwidth <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Input value={state.targetBandwidth} onChange={(e) => onChange({ targetBandwidth: e.target.value })} placeholder="100mbps" />
          </div>
        </div>
      </div>

      {/* Port hopping */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label>Port hopping</Label>
          <Switch checked={state.portHopping} onCheckedChange={(v) => onChange({ portHopping: v })} />
        </div>
        {state.portHopping && (
          <div className="flex gap-2 p-3 rounded-lg bg-muted/40 border">
            <div className="flex-1 space-y-1">
              <Label className="text-xs">Base port</Label>
              <Input type="number" value={state.portHopBase} onChange={(e) => onChange({ portHopBase: parseInt(e.target.value, 10) || 40000 })} />
            </div>
            <div className="flex-1 space-y-1">
              <Label className="text-xs">Range</Label>
              <Input type="number" value={state.portHopRange} onChange={(e) => onChange({ portHopRange: parseInt(e.target.value, 10) || 5000 })} />
            </div>
            <div className="flex-1 space-y-1">
              <Label className="text-xs">Interval (s)</Label>
              <Input type="number" value={state.portHopInterval} onChange={(e) => onChange({ portHopInterval: parseInt(e.target.value, 10) || 30 })} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
