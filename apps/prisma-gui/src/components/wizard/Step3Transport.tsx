import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import HelpTip from "@/components/wizard/HelpTip";
import type { WizardState } from "@/lib/buildConfig";

interface Props {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
}

const TRANSPORTS: { value: WizardState["transport"]; label: string }[] = [
  { value: "quic",       label: "QUIC" },
  { value: "ws",         label: "WebSocket" },
  { value: "grpc",       label: "gRPC" },
  { value: "xhttp",      label: "XHTTP" },
  { value: "xporta",     label: "XPorta" },
  { value: "tcp",        label: "TCP" },
  { value: "shadow-tls", label: "ShadowTLS v3" },
  { value: "wireguard",  label: "WireGuard" },
];

export default function Step3Transport({ state, onChange }: Props) {
  const { t } = useTranslation();
  const [advancedOpen, setAdvancedOpen] = useState(false);

  return (
    <div className="space-y-4">
      {/* Transport selector */}
      <div className="space-y-1">
        <div className="flex items-center gap-1">
          <Label>{t("wizard.transportProtocol")}</Label>
          <HelpTip content={t("wizard.help.transport")} />
        </div>
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
              <SelectItem value="tcp">TCP only</SelectItem>
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

      {/* QUIC sub-fields */}
      {state.transport === "quic" && (
        <div className="space-y-3 p-3 rounded-lg bg-muted/40 border">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("wizard.quicSettings")}</p>
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
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <Label>{t("wizard.sniSlicing")}</Label>
              <HelpTip content={t("wizard.help.sniSlicing")} />
            </div>
            <Switch checked={state.sniSlicing} onCheckedChange={(v) => onChange({ sniSlicing: v })} />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1">
              <Label>{t("wizard.salamanderPassword")} <span className="text-muted-foreground text-xs">({t("wizard.salamanderHint")})</span></Label>
              <HelpTip content={t("wizard.help.salamander")} />
            </div>
            <Input type="password" value={state.salamanderPassword} onChange={(e) => onChange({ salamanderPassword: e.target.value })} />
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

      {/* XPorta sub-fields */}
      {state.transport === "xporta" && (
        <div className="space-y-3 p-3 rounded-lg bg-muted/40 border">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("wizard.xportaSettings")}</p>
          <div className="space-y-1"><Label>{t("wizard.xportaBaseUrl")}</Label><Input value={state.xportaBaseUrl} onChange={(e) => onChange({ xportaBaseUrl: e.target.value })} placeholder="https://cdn.example.com" /></div>
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
        </div>
      )}

      {/* TCP sub-fields */}
      {state.transport === "tcp" && (
        <div className="space-y-3 p-3 rounded-lg bg-muted/40 border">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("wizard.tcpSettings")}</p>
          <div className="space-y-1">
            <Label>{t("wizard.cipher")}</Label>
            <Select value={state.cipher} onValueChange={(v) => onChange({ cipher: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="chacha20-poly1305">ChaCha20-Poly1305</SelectItem>
                <SelectItem value="aes-128-gcm">AES-128-GCM</SelectItem>
                <SelectItem value="aes-256-gcm">AES-256-GCM</SelectItem>
              </SelectContent>
            </Select>
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
      )}

      {/* ShadowTLS v3 sub-fields */}
      {state.transport === "shadow-tls" && (
        <div className="space-y-3 p-3 rounded-lg bg-muted/40 border">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("wizard.shadowTlsSettings")}</p>
          <div className="space-y-1">
            <Label>{t("wizard.shadowTlsServerAddr")}</Label>
            <Input value={state.shadowTlsServerAddr} onChange={(e) => onChange({ shadowTlsServerAddr: e.target.value })} placeholder="1.2.3.4:443" />
          </div>
          <div className="space-y-1">
            <Label>{t("wizard.shadowTlsPassword")}</Label>
            <Input type="password" value={state.shadowTlsPassword} onChange={(e) => onChange({ shadowTlsPassword: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label>{t("wizard.shadowTlsSni")}</Label>
            <Input value={state.shadowTlsSni} onChange={(e) => onChange({ shadowTlsSni: e.target.value })} placeholder="www.example.com" />
          </div>
        </div>
      )}

      {/* WireGuard sub-fields */}
      {state.transport === "wireguard" && (
        <div className="space-y-3 p-3 rounded-lg bg-muted/40 border">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("wizard.wireguardSettings")}</p>
          <div className="space-y-1">
            <Label>{t("wizard.wireguardEndpoint")}</Label>
            <Input value={state.wireguardEndpoint} onChange={(e) => onChange({ wireguardEndpoint: e.target.value })} placeholder="1.2.3.4:51820" />
          </div>
          <div className="space-y-1">
            <Label>{t("wizard.wireguardKeepalive")}</Label>
            <Input type="number" min={0} value={state.wireguardKeepalive} onChange={(e) => onChange({ wireguardKeepalive: parseInt(e.target.value, 10) || 25 })} />
          </div>
        </div>
      )}

      {/* Header obfuscation */}
      <div className="space-y-3 p-3 rounded-lg bg-muted/40 border">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("wizard.headerObfuscation")}</p>
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

      {/* Congestion + bandwidth */}
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

      {/* Port hopping */}
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

      {/* Advanced: Client Fallback Strategy */}
      <div className="space-y-3">
        <button
          type="button"
          className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide hover:text-foreground transition-colors"
          onClick={() => setAdvancedOpen((v) => !v)}
        >
          {advancedOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {t("wizard.advancedFallback")}
        </button>
        {advancedOpen && (
          <div className="space-y-3 p-3 rounded-lg bg-muted/40 border">
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
        )}
      </div>
    </div>
  );
}
