import type { Rule } from "@/store/rules";

export interface RulePreset {
  id: string;
  nameKey: string;
  descKey: string;
  rules: Omit<Rule, "id">[];
}

export const RULE_PRESETS: RulePreset[] = [
  {
    id: "block-ads",
    nameKey: "rules.presetBlockAds",
    descKey: "rules.presetBlockAdsDesc",
    rules: [
      { type: "DOMAIN-SUFFIX", match: "doubleclick.net", action: "REJECT" },
      { type: "DOMAIN-SUFFIX", match: "googlesyndication.com", action: "REJECT" },
      { type: "DOMAIN-SUFFIX", match: "googleadservices.com", action: "REJECT" },
      { type: "DOMAIN-SUFFIX", match: "adnxs.com", action: "REJECT" },
      { type: "DOMAIN-SUFFIX", match: "ads.yahoo.com", action: "REJECT" },
      { type: "DOMAIN-SUFFIX", match: "analytics.google.com", action: "REJECT" },
      { type: "DOMAIN-SUFFIX", match: "ads.facebook.com", action: "REJECT" },
      { type: "DOMAIN-SUFFIX", match: "ad.doubleclick.net", action: "REJECT" },
      { type: "DOMAIN-KEYWORD", match: "adservice", action: "REJECT" },
      { type: "DOMAIN-KEYWORD", match: "tracker", action: "REJECT" },
    ],
  },
  {
    id: "bypass-lan",
    nameKey: "rules.presetBypassLAN",
    descKey: "rules.presetBypassLANDesc",
    rules: [
      { type: "IP-CIDR", match: "127.0.0.0/8", action: "DIRECT" },
      { type: "IP-CIDR", match: "10.0.0.0/8", action: "DIRECT" },
      { type: "IP-CIDR", match: "172.16.0.0/12", action: "DIRECT" },
      { type: "IP-CIDR", match: "192.168.0.0/16", action: "DIRECT" },
      { type: "IP-CIDR", match: "::1/128", action: "DIRECT" },
      { type: "DOMAIN-SUFFIX", match: "local", action: "DIRECT" },
      { type: "DOMAIN-SUFFIX", match: "localhost", action: "DIRECT" },
    ],
  },
  {
    id: "china-direct",
    nameKey: "rules.presetChinaDirect",
    descKey: "rules.presetChinaDirectDesc",
    rules: [
      { type: "GEOIP", match: "CN", action: "DIRECT" },
      { type: "DOMAIN-SUFFIX", match: "cn", action: "DIRECT" },
      { type: "DOMAIN-SUFFIX", match: "baidu.com", action: "DIRECT" },
      { type: "DOMAIN-SUFFIX", match: "qq.com", action: "DIRECT" },
      { type: "DOMAIN-SUFFIX", match: "taobao.com", action: "DIRECT" },
      { type: "DOMAIN-SUFFIX", match: "jd.com", action: "DIRECT" },
      { type: "DOMAIN-SUFFIX", match: "163.com", action: "DIRECT" },
      { type: "DOMAIN-SUFFIX", match: "bilibili.com", action: "DIRECT" },
      { type: "DOMAIN-SUFFIX", match: "weibo.com", action: "DIRECT" },
      { type: "DOMAIN-SUFFIX", match: "alipay.com", action: "DIRECT" },
      { type: "DOMAIN-SUFFIX", match: "tmall.com", action: "DIRECT" },
      { type: "DOMAIN-SUFFIX", match: "zhihu.com", action: "DIRECT" },
    ],
  },
  {
    id: "global-proxy",
    nameKey: "rules.presetGlobalProxy",
    descKey: "rules.presetGlobalProxyDesc",
    rules: [
      { type: "FINAL", match: "", action: "PROXY" },
    ],
  },
];
