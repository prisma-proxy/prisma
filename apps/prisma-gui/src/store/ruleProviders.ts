import { create } from "zustand";
import { persist } from "zustand/middleware";

export type DownloadMode = "auto" | "direct" | "proxy";

export interface RuleProvider {
  id: string;
  name: string;
  url: string;
  behavior: "domain" | "ipcidr" | "classical";
  action: "PROXY" | "DIRECT" | "REJECT";
  enabled: boolean;
  lastUpdated: string | null;
  ruleCount: number;
  downloadMode?: DownloadMode;
}

/** Pre-configured community provider suggestions */
export const SUGGESTED_PROVIDERS: Omit<RuleProvider, "id" | "enabled" | "lastUpdated" | "ruleCount">[] = [
  {
    name: "AdBlock Domain List",
    url: "https://raw.githubusercontent.com/privacy-protection-tools/anti-AD/master/anti-ad-domains.txt",
    behavior: "domain",
    action: "REJECT",
  },
  {
    name: "China Domains",
    url: "https://raw.githubusercontent.com/felixonmars/dnsmasq-china-list/master/accelerated-domains.china.conf",
    behavior: "domain",
    action: "DIRECT",
  },
  {
    name: "China IP CIDR",
    url: "https://raw.githubusercontent.com/17mon/china_ip_list/master/china_ip_list.txt",
    behavior: "ipcidr",
    action: "DIRECT",
  },
  {
    name: "GFW List Domains",
    url: "https://raw.githubusercontent.com/gfwlist/gfwlist/master/gfwlist.txt",
    behavior: "domain",
    action: "PROXY",
  },
];

interface RuleProvidersStore {
  providers: RuleProvider[];
  add: (provider: Omit<RuleProvider, "id" | "lastUpdated" | "ruleCount">) => void;
  remove: (id: string) => void;
  toggle: (id: string) => void;
  updateProviderStatus: (id: string, ruleCount: number, lastUpdated: string) => void;
  setDownloadMode: (id: string, mode: DownloadMode) => void;
  setProviders: (providers: RuleProvider[]) => void;
}

export const useRuleProviders = create<RuleProvidersStore>()(
  persist(
    (set) => ({
      providers: [],

      add: (provider) =>
        set((state) => ({
          providers: [
            ...state.providers,
            {
              ...provider,
              id: crypto.randomUUID(),
              lastUpdated: null,
              ruleCount: 0,
            },
          ],
        })),

      remove: (id) =>
        set((state) => ({
          providers: state.providers.filter((p) => p.id !== id),
        })),

      toggle: (id) =>
        set((state) => ({
          providers: state.providers.map((p) =>
            p.id === id ? { ...p, enabled: !p.enabled } : p
          ),
        })),

      updateProviderStatus: (id, ruleCount, lastUpdated) =>
        set((state) => ({
          providers: state.providers.map((p) =>
            p.id === id ? { ...p, ruleCount, lastUpdated } : p
          ),
        })),

      setDownloadMode: (id, mode) =>
        set((state) => ({
          providers: state.providers.map((p) =>
            p.id === id ? { ...p, downloadMode: mode } : p
          ),
        })),

      setProviders: (providers) => set({ providers }),
    }),
    { name: "prisma-rule-providers" }
  )
);
