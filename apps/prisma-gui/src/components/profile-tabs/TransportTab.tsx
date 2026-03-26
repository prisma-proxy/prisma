import { useTranslation } from "react-i18next";
import { Dices } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
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

const TRANSPORTS: { value: WizardState["transport"]; label: string }[] = [
  { value: "quic",        label: "QUIC" },
  { value: "ws",           label: "WebSocket" },
  { value: "grpc",         label: "gRPC" },
  { value: "xhttp",        label: "XHTTP" },
  { value: "xporta",       label: "XPorta" },
  { value: "tcp",          label: "TCP" },
  { value: "wireguard",    label: "WireGuard" },
  { value: "prisma-tls",   label: "PrismaTLS" },
];

export default function TransportTab({ state, onChange }: Props) {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      {/* Transport selector — 8-button grid */}
      <div className="space-y-1">
        <div className="flex items-center gap-1">
          <Label>{t("wizard.transportProtocol")}</Label>
          <HelpTip content={t("wizard.help.transport")} />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
          {TRANSPORTS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => onChange({ transport: value })}
              className={`px-2 py-1.5 rounded-md border text-sm transition-colors ${
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

      {/* Transport mode & fallback */}
      <div className="flex gap-2">
        <div className="flex-1 space-y-1">
          <Label>{t("wizard.transportMode")}</Label>
          <Select value={state.transportMode} onValueChange={(v) => onChange({ transportMode: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">{t("wizard.transportModeAuto")}</SelectItem>
              <SelectItem value="quic">QUIC only</SelectItem>
              <SelectItem value="ws">WebSocket only</SelectItem>
              <SelectItem value="grpc">gRPC only</SelectItem>
              <SelectItem value="xhttp">XHTTP only</SelectItem>
              <SelectItem value="xporta">XPorta only</SelectItem>
              <SelectItem value="tcp">TCP only</SelectItem>
              <SelectItem value="prisma-tls">PrismaTLS only</SelectItem>
              <SelectItem value="wireguard">WireGuard only</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {state.transportMode === "auto" && (
          <div className="flex-1 space-y-1">
            <Label>{t("wizard.fallbackOrder")} <span className="text-muted-foreground text-xs">({t("wizard.fallbackOrderHint")})</span></Label>
            <Input value={state.fallbackOrder} onChange={(e) => onChange({ fallbackOrder: e.target.value })} placeholder="quic-v2,prisma-tls,ws-cdn,xporta" />
          </div>
        )}
      </div>

      {/* Cipher & TLS fingerprint — applies to all transports except WireGuard */}
      {state.transport !== "wireguard" && (
        <div className="flex gap-2">
          <div className="flex-1 space-y-1">
            <div className="flex items-center gap-1">
              <Label>{t("wizard.cipher")}</Label>
              <HelpTip content={t("wizard.help.cipher")} />
            </div>
            <Select value={state.cipher} onValueChange={(v) => onChange({ cipher: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="chacha20-poly1305">ChaCha20-Poly1305</SelectItem>
                <SelectItem value="aes-128-gcm">AES-128-GCM</SelectItem>
                <SelectItem value="aes-256-gcm">AES-256-GCM</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {state.transport !== "prisma-tls" && (
            <div className="flex-1 space-y-1">
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
          )}
        </div>
      )}

      {/* QUIC sub-fields */}
      {state.transport === "quic" && (
        <div className="space-y-3 p-3 rounded-lg bg-muted/40 border">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("wizard.quicSettings")}</p>
          <div className="flex gap-2">
            <div className="flex-1 space-y-1">
              <Label>{t("wizard.quicVersion")}</Label>
              <Select value={state.quicVersion} onValueChange={(v) => onChange({ quicVersion: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">{t("common.auto")}</SelectItem>
                  <SelectItem value="v1">v1</SelectItem>
                  <SelectItem value="v2">v2</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 space-y-1">
              <Label>{t("wizard.congestionControl")}</Label>
              <Select value={state.congestion} onValueChange={(v) => onChange({ congestion: v as WizardState["congestion"] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="bbr">BBR</SelectItem>
                  <SelectItem value="brutal">Brutal</SelectItem>
                  <SelectItem value="adaptive">Adaptive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label>{t("wizard.targetBandwidth")} <span className="text-muted-foreground text-xs">({t("wizard.optional")})</span></Label>
            <Input value={state.targetBandwidth} onChange={(e) => onChange({ targetBandwidth: e.target.value })} placeholder="100mbps" />
          </div>
        </div>
      )}

      {/* Congestion + bandwidth for non-QUIC transports */}
      {state.transport !== "quic" && state.transport !== "wireguard" && (
        <div className="flex gap-2">
          <div className="flex-1 space-y-1">
            <Label>{t("wizard.congestionControl")}</Label>
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
            <Label>{t("wizard.targetBandwidth")} <span className="text-muted-foreground text-xs">({t("wizard.optional")})</span></Label>
            <Input value={state.targetBandwidth} onChange={(e) => onChange({ targetBandwidth: e.target.value })} placeholder="100mbps" />
          </div>
        </div>
      )}

      {/* WS sub-fields */}
      {state.transport === "ws" && (
        <div className="space-y-3 p-3 rounded-lg bg-muted/40 border">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("wizard.wsSettings")}</p>
          <div className="space-y-1">
            <Label>{t("wizard.wsPath")}</Label>
            <Input value={state.wsUrl} onChange={(e) => onChange({ wsUrl: e.target.value })} placeholder="/ws" />
          </div>
          <div className="space-y-1">
            <Label>{t("wizard.wsHostHeader")} <span className="text-muted-foreground text-xs">({t("wizard.optional")})</span></Label>
            <Input value={state.wsHost} onChange={(e) => onChange({ wsHost: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label>{t("wizard.extraHeaders")} <span className="text-muted-foreground text-xs">({t("wizard.extraHeadersHint")})</span></Label>
            <Textarea rows={2} className="font-mono text-xs" value={state.wsExtraHeaders} onChange={(e) => onChange({ wsExtraHeaders: e.target.value })} placeholder="X-Custom: value" />
          </div>
        </div>
      )}

      {/* gRPC sub-fields */}
      {state.transport === "grpc" && (
        <div className="space-y-3 p-3 rounded-lg bg-muted/40 border">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("wizard.grpcSettings")}</p>
          <div className="space-y-1">
            <Label>{t("wizard.grpcServicePath")}</Label>
            <Input value={state.grpcUrl} onChange={(e) => onChange({ grpcUrl: e.target.value })} placeholder="/prisma.Proxy/Relay" />
          </div>
        </div>
      )}

      {/* XHTTP sub-fields */}
      {state.transport === "xhttp" && (
        <div className="space-y-3 p-3 rounded-lg bg-muted/40 border">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("wizard.xhttpSettings")}</p>
          <div className="space-y-1">
            <Label>{t("wizard.xhttpMode")}</Label>
            <Select value={state.xhttpMode} onValueChange={(v) => onChange({ xhttpMode: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">{t("common.auto")}</SelectItem>
                <SelectItem value="upload">Upload only</SelectItem>
                <SelectItem value="download">Download only</SelectItem>
                <SelectItem value="stream">Stream</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label>{t("wizard.uploadUrl")}</Label><Input value={state.xhttpUploadUrl} onChange={(e) => onChange({ xhttpUploadUrl: e.target.value })} /></div>
          <div className="space-y-1"><Label>{t("wizard.downloadUrl")}</Label><Input value={state.xhttpDownloadUrl} onChange={(e) => onChange({ xhttpDownloadUrl: e.target.value })} /></div>
          <div className="space-y-1"><Label>{t("wizard.streamUrl")}</Label><Input value={state.xhttpStreamUrl} onChange={(e) => onChange({ xhttpStreamUrl: e.target.value })} /></div>
          <div className="space-y-1">
            <Label>{t("wizard.extraHeaders")} <span className="text-muted-foreground text-xs">({t("wizard.extraHeadersHint")})</span></Label>
            <Textarea rows={2} className="font-mono text-xs" value={state.xhttpExtraHeaders} onChange={(e) => onChange({ xhttpExtraHeaders: e.target.value })} placeholder="X-Custom: value" />
          </div>
        </div>
      )}

      {/* XPorta sub-fields — full 11 fields */}
      {state.transport === "xporta" && (
        <div className="space-y-3 p-3 rounded-lg bg-muted/40 border">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("wizard.xportaSettings")}</p>
          <div className="space-y-1">
            <Label>{t("wizard.xportaBaseUrl")} *</Label>
            <Input value={state.xportaBaseUrl} onChange={(e) => onChange({ xportaBaseUrl: e.target.value })} placeholder="https://cdn.example.com" />
          </div>
          <div className="flex gap-2">
            <div className="flex-1 space-y-1">
              <Label>{t("wizard.xportaEncoding")}</Label>
              <Select value={state.xportaEncoding} onValueChange={(v) => onChange({ xportaEncoding: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="json">JSON (max stealth)</SelectItem>
                  <SelectItem value="binary">Binary (max throughput)</SelectItem>
                  <SelectItem value="auto">{t("common.auto")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 space-y-1">
              <Label>{t("wizard.xportaPollTimeout")}</Label>
              <Input type="number" min={1} value={state.xportaPollTimeout} onChange={(e) => onChange({ xportaPollTimeout: parseInt(e.target.value, 10) || 55 })} />
            </div>
          </div>
          <div className="space-y-1">
            <Label>{t("wizard.xportaSessionPath")}</Label>
            <Input value={state.xportaSessionPath} onChange={(e) => onChange({ xportaSessionPath: e.target.value })} placeholder="/api/auth" />
          </div>
          <div className="flex gap-2">
            <div className="flex-1 space-y-1">
              <Label>{t("wizard.xportaDataPaths")} <span className="text-muted-foreground text-xs">({t("wizard.onePerLine")})</span></Label>
              <Textarea rows={3} className="font-mono text-xs" value={state.xportaDataPaths} onChange={(e) => onChange({ xportaDataPaths: e.target.value })} placeholder="/api/v1/data&#10;/api/v1/sync" />
            </div>
            <div className="flex-1 space-y-1">
              <Label>{t("wizard.xportaPollPaths")} <span className="text-muted-foreground text-xs">({t("wizard.onePerLine")})</span></Label>
              <Textarea rows={3} className="font-mono text-xs" value={state.xportaPollPaths} onChange={(e) => onChange({ xportaPollPaths: e.target.value })} placeholder="/api/v1/notifications&#10;/api/v1/feed" />
            </div>
          </div>
          <div className="flex gap-2">
            <div className="flex-1 space-y-1">
              <Label>{t("wizard.xportaPollConcurrency")}</Label>
              <Input type="number" min={1} max={10} value={state.xportaPollConcurrency} onChange={(e) => onChange({ xportaPollConcurrency: parseInt(e.target.value, 10) || 3 })} />
            </div>
            <div className="flex-1 space-y-1">
              <Label>{t("wizard.xportaUploadConcurrency")}</Label>
              <Input type="number" min={1} max={16} value={state.xportaUploadConcurrency} onChange={(e) => onChange({ xportaUploadConcurrency: parseInt(e.target.value, 10) || 4 })} />
            </div>
          </div>
          <div className="flex gap-2">
            <div className="flex-1 space-y-1">
              <Label>{t("wizard.xportaMaxPayloadSize")} <span className="text-muted-foreground text-xs">(bytes)</span></Label>
              <Input type="number" min={1024} value={state.xportaMaxPayloadSize} onChange={(e) => onChange({ xportaMaxPayloadSize: parseInt(e.target.value, 10) || 65536 })} />
            </div>
            <div className="flex-1 space-y-1">
              <Label>{t("wizard.xportaCookieName")}</Label>
              <Input value={state.xportaCookieName} onChange={(e) => onChange({ xportaCookieName: e.target.value })} placeholder="_sess" />
            </div>
          </div>
          <div className="space-y-1">
            <Label>{t("wizard.extraHeaders")} <span className="text-muted-foreground text-xs">({t("wizard.extraHeadersHint")})</span></Label>
            <Textarea rows={2} className="font-mono text-xs" value={state.xportaExtraHeaders} onChange={(e) => onChange({ xportaExtraHeaders: e.target.value })} placeholder="X-Custom: value" />
          </div>
        </div>
      )}

      {/* WireGuard sub-fields */}
      {state.transport === "wireguard" && (
        <div className="space-y-3 p-3 rounded-lg bg-muted/40 border">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("wizard.wireguardSettings")}</p>
          <div className="space-y-1">
            <Label>{t("wizard.wireguardEndpoint")} *</Label>
            <Input value={state.wireguardEndpoint} onChange={(e) => onChange({ wireguardEndpoint: e.target.value })} placeholder="1.2.3.4:51820" />
          </div>
          <div className="space-y-1">
            <Label>{t("wizard.wireguardKeepalive")}</Label>
            <Input type="number" min={0} value={state.wireguardKeepalive} onChange={(e) => onChange({ wireguardKeepalive: parseInt(e.target.value, 10) || 25 })} />
          </div>
        </div>
      )}

      {/* PrismaTLS sub-fields */}
      {state.transport === "prisma-tls" && (
        <div className="space-y-3 p-3 rounded-lg bg-muted/40 border">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("wizard.prismaTlsSettings")}</p>
          <div className="space-y-1">
            <Label>{t("wizard.prismaTlsFingerprint")}</Label>
            <Select value={state.prismaTlsFingerprint} onValueChange={(v) => onChange({ prismaTlsFingerprint: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="chrome">Chrome</SelectItem>
                <SelectItem value="firefox">Firefox</SelectItem>
                <SelectItem value="safari">Safari</SelectItem>
                <SelectItem value="random">Random</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>{t("wizard.prismaTlsAuthSecret")} <span className="text-muted-foreground text-xs">({t("wizard.optional")})</span></Label>
            <div className="flex gap-2">
              <Input
                type="password"
                value={state.prismaTlsAuthSecret}
                onChange={(e) => onChange({ prismaTlsAuthSecret: e.target.value })}
                className="flex-1"
              />
              <Button type="button" variant="outline" size="icon" onClick={() => onChange({ prismaTlsAuthSecret: generateHexSecret() })} title={t("wizard.generate")}>
                <Dices className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
