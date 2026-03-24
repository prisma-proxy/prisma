import { ShieldBan, Wifi, Lock, type LucideIcon } from "lucide-react";

export interface RuleTemplate {
  id: string;
  nameKey: string;
  descKey: string;
  icon: LucideIcon;
  rules: Array<{
    name: string;
    condition_type: string;
    condition_value: string;
    action: string;
    priority: number;
    enabled: boolean;
  }>;
}

export const RULE_TEMPLATES: RuleTemplate[] = [
  {
    id: "block-ads",
    nameKey: "templates.blockAds",
    descKey: "templates.blockAdsDesc",
    icon: ShieldBan,
    rules: [
      { name: "Block Ads", condition_type: "DomainKeyword", condition_value: "ads.", action: "Block", priority: 100, enabled: true },
      { name: "Block Trackers", condition_type: "DomainKeyword", condition_value: "tracker", action: "Block", priority: 100, enabled: true },
      { name: "Block Analytics", condition_type: "DomainSuffix", condition_value: "analytics.com", action: "Block", priority: 100, enabled: true },
      { name: "Block DoubleClick", condition_type: "DomainSuffix", condition_value: "doubleclick.net", action: "Block", priority: 100, enabled: true },
    ],
  },
  {
    id: "direct-local",
    nameKey: "templates.directLocal",
    descKey: "templates.directLocalDesc",
    icon: Wifi,
    rules: [
      { name: "Local 192.168.x.x", condition_type: "IpCidr", condition_value: "192.168.0.0/16", action: "Direct", priority: 200, enabled: true },
      { name: "Local 10.x.x.x", condition_type: "IpCidr", condition_value: "10.0.0.0/8", action: "Direct", priority: 200, enabled: true },
      { name: "Localhost", condition_type: "IpCidr", condition_value: "127.0.0.0/8", action: "Direct", priority: 200, enabled: true },
    ],
  },
  {
    id: "privacy",
    nameKey: "templates.privacy",
    descKey: "templates.privacyDesc",
    icon: Lock,
    rules: [
      { name: "Block MS Telemetry", condition_type: "DomainSuffix", condition_value: "telemetry.microsoft.com", action: "Block", priority: 90, enabled: true },
      { name: "Block Telemetry KW", condition_type: "DomainKeyword", condition_value: "telemetry", action: "Block", priority: 90, enabled: true },
      { name: "Block Metrics KW", condition_type: "DomainKeyword", condition_value: "metrics.apple", action: "Block", priority: 90, enabled: true },
    ],
  },
];
