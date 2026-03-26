import { ShieldBan, Wifi, Globe, ArrowRightLeft, Lock, Bug, Ban, type LucideIcon } from "lucide-react";

export type TemplateCategory = "privacy" | "network" | "regional" | "catchall";

export interface RuleTemplate {
  id: string;
  category: TemplateCategory;
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

export const TEMPLATE_CATEGORY_ORDER: TemplateCategory[] = [
  "privacy",
  "network",
  "regional",
  "catchall",
];

export const TEMPLATE_CATEGORY_KEYS: Record<TemplateCategory, string> = {
  privacy: "templates.categoryPrivacy",
  network: "templates.categoryNetwork",
  regional: "templates.categoryRegional",
  catchall: "templates.categoryCatchall",
};

export const RULE_TEMPLATES: RuleTemplate[] = [
  // -- Privacy & Blocking --
  {
    id: "block-ads",
    category: "privacy",
    nameKey: "templates.blockAds",
    descKey: "templates.blockAdsDesc",
    icon: ShieldBan,
    rules: [
      { name: "Block DoubleClick", condition_type: "DomainSuffix", condition_value: "doubleclick.net", action: "Block", priority: 100, enabled: true },
      { name: "Block GoogleSyndication", condition_type: "DomainSuffix", condition_value: "googlesyndication.com", action: "Block", priority: 100, enabled: true },
      { name: "Block GoogleAdServices", condition_type: "DomainSuffix", condition_value: "googleadservices.com", action: "Block", priority: 100, enabled: true },
      { name: "Block AppNexus", condition_type: "DomainSuffix", condition_value: "adnxs.com", action: "Block", priority: 100, enabled: true },
      { name: "Block Yahoo Ads", condition_type: "DomainSuffix", condition_value: "ads.yahoo.com", action: "Block", priority: 100, enabled: true },
      { name: "Block Facebook Ads", condition_type: "DomainSuffix", condition_value: "ads.facebook.com", action: "Block", priority: 100, enabled: true },
      { name: "Block Moat Ads", condition_type: "DomainSuffix", condition_value: "moatads.com", action: "Block", priority: 100, enabled: true },
      { name: "Block AdColony", condition_type: "DomainSuffix", condition_value: "adcolony.com", action: "Block", priority: 100, enabled: true },
      { name: "Block AppsFlyer", condition_type: "DomainSuffix", condition_value: "appsflyer.com", action: "Block", priority: 100, enabled: true },
      { name: "Block MoPub", condition_type: "DomainSuffix", condition_value: "mopub.com", action: "Block", priority: 100, enabled: true },
      { name: "Block Rubicon", condition_type: "DomainSuffix", condition_value: "rubiconproject.com", action: "Block", priority: 100, enabled: true },
      { name: "Block PubMatic", condition_type: "DomainSuffix", condition_value: "pubmatic.com", action: "Block", priority: 100, enabled: true },
      { name: "Block OpenX", condition_type: "DomainSuffix", condition_value: "openx.net", action: "Block", priority: 100, enabled: true },
      { name: "Block Criteo", condition_type: "DomainSuffix", condition_value: "criteo.com", action: "Block", priority: 100, enabled: true },
      { name: "Block Taboola", condition_type: "DomainSuffix", condition_value: "taboola.com", action: "Block", priority: 100, enabled: true },
      { name: "Block Outbrain", condition_type: "DomainSuffix", condition_value: "outbrain.com", action: "Block", priority: 100, enabled: true },
      { name: "Block adservice KW", condition_type: "DomainKeyword", condition_value: "adservice", action: "Block", priority: 100, enabled: true },
      { name: "Block pagead KW", condition_type: "DomainKeyword", condition_value: "pagead", action: "Block", priority: 100, enabled: true },
      { name: "Block adsystem KW", condition_type: "DomainKeyword", condition_value: "adsystem", action: "Block", priority: 100, enabled: true },
    ],
  },
  {
    id: "block-trackers",
    category: "privacy",
    nameKey: "templates.blockTrackers",
    descKey: "templates.blockTrackersDesc",
    icon: Lock,
    rules: [
      { name: "Block Google Analytics", condition_type: "DomainSuffix", condition_value: "analytics.google.com", action: "Block", priority: 100, enabled: true },
      { name: "Block GA", condition_type: "DomainSuffix", condition_value: "google-analytics.com", action: "Block", priority: 100, enabled: true },
      { name: "Block GTM", condition_type: "DomainSuffix", condition_value: "googletagmanager.com", action: "Block", priority: 100, enabled: true },
      { name: "Block Hotjar", condition_type: "DomainSuffix", condition_value: "hotjar.com", action: "Block", priority: 100, enabled: true },
      { name: "Block Mixpanel", condition_type: "DomainSuffix", condition_value: "mixpanel.com", action: "Block", priority: 100, enabled: true },
      { name: "Block Segment", condition_type: "DomainSuffix", condition_value: "segment.io", action: "Block", priority: 100, enabled: true },
      { name: "Block Amplitude", condition_type: "DomainSuffix", condition_value: "amplitude.com", action: "Block", priority: 100, enabled: true },
      { name: "Block FullStory", condition_type: "DomainSuffix", condition_value: "fullstory.com", action: "Block", priority: 100, enabled: true },
      { name: "Block NewRelic", condition_type: "DomainSuffix", condition_value: "newrelic.com", action: "Block", priority: 100, enabled: true },
      { name: "Block Sentry", condition_type: "DomainSuffix", condition_value: "sentry.io", action: "Block", priority: 100, enabled: true },
      { name: "Block App Measurement", condition_type: "DomainSuffix", condition_value: "app-measurement.com", action: "Block", priority: 100, enabled: true },
      { name: "Block Adjust", condition_type: "DomainSuffix", condition_value: "adjust.com", action: "Block", priority: 100, enabled: true },
      { name: "Block Branch", condition_type: "DomainSuffix", condition_value: "branch.io", action: "Block", priority: 100, enabled: true },
      { name: "Block Facebook Tracker", condition_type: "DomainSuffix", condition_value: "facebook.net", action: "Block", priority: 100, enabled: true },
      { name: "Block tracker KW", condition_type: "DomainKeyword", condition_value: "tracker", action: "Block", priority: 100, enabled: true },
      { name: "Block telemetry KW", condition_type: "DomainKeyword", condition_value: "telemetry", action: "Block", priority: 100, enabled: true },
    ],
  },
  {
    id: "block-malware",
    category: "privacy",
    nameKey: "templates.blockMalware",
    descKey: "templates.blockMalwareDesc",
    icon: Bug,
    rules: [
      { name: "Block Malware Domains", condition_type: "DomainSuffix", condition_value: "malwaredomainlist.com", action: "Block", priority: 90, enabled: true },
      { name: "Block Phishing Army", condition_type: "DomainSuffix", condition_value: "phishing.army", action: "Block", priority: 90, enabled: true },
      { name: "Block Abuse.ch Ransomware", condition_type: "DomainSuffix", condition_value: "ransomwaretracker.abuse.ch", action: "Block", priority: 90, enabled: true },
      { name: "Block Abuse.ch Feodo", condition_type: "DomainSuffix", condition_value: "feodotracker.abuse.ch", action: "Block", priority: 90, enabled: true },
      { name: "Block Abuse.ch SSL", condition_type: "DomainSuffix", condition_value: "sslbl.abuse.ch", action: "Block", priority: 90, enabled: true },
      { name: "Block Abuse.ch URLhaus", condition_type: "DomainSuffix", condition_value: "urlhaus.abuse.ch", action: "Block", priority: 90, enabled: true },
      { name: "Block malware KW", condition_type: "DomainKeyword", condition_value: "malware", action: "Block", priority: 90, enabled: true },
      { name: "Block phishing KW", condition_type: "DomainKeyword", condition_value: "phishing", action: "Block", priority: 90, enabled: true },
      { name: "Block cryptominer KW", condition_type: "DomainKeyword", condition_value: "cryptominer", action: "Block", priority: 90, enabled: true },
    ],
  },

  {
    id: "block-torrent",
    category: "privacy",
    nameKey: "templates.blockTorrent",
    descKey: "templates.blockTorrentDesc",
    icon: Ban,
    rules: [
      { name: "Block torrent keyword", condition_type: "DomainKeyword", condition_value: "torrent", action: "Block", priority: 100, enabled: true },
      { name: "Block tracker keyword", condition_type: "DomainKeyword", condition_value: "tracker", action: "Block", priority: 100, enabled: true },
      { name: "Block announce keyword", condition_type: "DomainKeyword", condition_value: "announce", action: "Block", priority: 100, enabled: true },
      { name: "Block BitTorrent ports", condition_type: "PortRange", condition_value: "6881-6889", action: "Block", priority: 100, enabled: true },
    ],
  },
  {
    id: "block-gambling",
    category: "privacy",
    nameKey: "templates.blockGambling",
    descKey: "templates.blockGamblingDesc",
    icon: Ban,
    rules: [
      { name: "Block bet365", condition_type: "DomainSuffix", condition_value: "bet365.com", action: "Block", priority: 100, enabled: true },
      { name: "Block pokerstars", condition_type: "DomainSuffix", condition_value: "pokerstars.com", action: "Block", priority: 100, enabled: true },
      { name: "Block gambling keyword", condition_type: "DomainKeyword", condition_value: "gambling", action: "Block", priority: 100, enabled: true },
      { name: "Block casino keyword", condition_type: "DomainKeyword", condition_value: "casino", action: "Block", priority: 100, enabled: true },
      { name: "Block betting keyword", condition_type: "DomainKeyword", condition_value: "betting", action: "Block", priority: 100, enabled: true },
    ],
  },
  {
    id: "block-social",
    category: "privacy",
    nameKey: "templates.blockSocial",
    descKey: "templates.blockSocialDesc",
    icon: Ban,
    rules: [
      { name: "Block Facebook", condition_type: "DomainSuffix", condition_value: "facebook.com", action: "Block", priority: 100, enabled: true },
      { name: "Block Instagram", condition_type: "DomainSuffix", condition_value: "instagram.com", action: "Block", priority: 100, enabled: true },
      { name: "Block TikTok", condition_type: "DomainSuffix", condition_value: "tiktok.com", action: "Block", priority: 100, enabled: true },
      { name: "Block Twitter/X", condition_type: "DomainSuffix", condition_value: "x.com", action: "Block", priority: 100, enabled: true },
      { name: "Block Snapchat", condition_type: "DomainSuffix", condition_value: "snapchat.com", action: "Block", priority: 100, enabled: true },
      { name: "Block Reddit", condition_type: "DomainSuffix", condition_value: "reddit.com", action: "Block", priority: 100, enabled: true },
    ],
  },

  // -- Network --
  {
    id: "bypass-lan",
    category: "network",
    nameKey: "templates.directLocal",
    descKey: "templates.directLocalDesc",
    icon: Wifi,
    rules: [
      { name: "Direct Loopback", condition_type: "IpCidr", condition_value: "127.0.0.0/8", action: "Direct", priority: 200, enabled: true },
      { name: "Direct 10.x.x.x", condition_type: "IpCidr", condition_value: "10.0.0.0/8", action: "Direct", priority: 200, enabled: true },
      { name: "Direct 172.16.x.x", condition_type: "IpCidr", condition_value: "172.16.0.0/12", action: "Direct", priority: 200, enabled: true },
      { name: "Direct 192.168.x.x", condition_type: "IpCidr", condition_value: "192.168.0.0/16", action: "Direct", priority: 200, enabled: true },
      { name: "Direct IPv6 Loopback", condition_type: "IpCidr", condition_value: "::1/128", action: "Direct", priority: 200, enabled: true },
      { name: "Direct .local", condition_type: "DomainSuffix", condition_value: "local", action: "Direct", priority: 200, enabled: true },
      { name: "Direct localhost", condition_type: "DomainSuffix", condition_value: "localhost", action: "Direct", priority: 200, enabled: true },
    ],
  },
  {
    id: "bypass-apple",
    category: "network",
    nameKey: "templates.bypassApple",
    descKey: "templates.bypassAppleDesc",
    icon: Wifi,
    rules: [
      { name: "Direct apple.com", condition_type: "DomainSuffix", condition_value: "apple.com", action: "Direct", priority: 150, enabled: true },
      { name: "Direct iCloud", condition_type: "DomainSuffix", condition_value: "icloud.com", action: "Direct", priority: 150, enabled: true },
      { name: "Direct iCloud CDN", condition_type: "DomainSuffix", condition_value: "icloud-content.com", action: "Direct", priority: 150, enabled: true },
      { name: "Direct mzstatic", condition_type: "DomainSuffix", condition_value: "mzstatic.com", action: "Direct", priority: 150, enabled: true },
      { name: "Direct Apple CDN", condition_type: "DomainSuffix", condition_value: "cdn-apple.com", action: "Direct", priority: 150, enabled: true },
      { name: "Direct Apple CloudKit", condition_type: "DomainSuffix", condition_value: "apple-cloudkit.com", action: "Direct", priority: 150, enabled: true },
      { name: "Direct Apple Push", condition_type: "DomainSuffix", condition_value: "push.apple.com", action: "Direct", priority: 150, enabled: true },
      { name: "Direct Apple IP Range", condition_type: "IpCidr", condition_value: "17.0.0.0/8", action: "Direct", priority: 150, enabled: true },
    ],
  },

  // -- Regional --
  {
    id: "china-direct",
    category: "regional",
    nameKey: "templates.chinaDirect",
    descKey: "templates.chinaDirectDesc",
    icon: Globe,
    rules: [
      { name: "Direct GEOIP CN", condition_type: "GeoIp", condition_value: "CN", action: "Direct", priority: 120, enabled: true },
      { name: "Direct .cn", condition_type: "DomainSuffix", condition_value: "cn", action: "Direct", priority: 120, enabled: true },
      { name: "Direct Baidu", condition_type: "DomainSuffix", condition_value: "baidu.com", action: "Direct", priority: 120, enabled: true },
      { name: "Direct QQ", condition_type: "DomainSuffix", condition_value: "qq.com", action: "Direct", priority: 120, enabled: true },
      { name: "Direct Taobao", condition_type: "DomainSuffix", condition_value: "taobao.com", action: "Direct", priority: 120, enabled: true },
      { name: "Direct JD", condition_type: "DomainSuffix", condition_value: "jd.com", action: "Direct", priority: 120, enabled: true },
      { name: "Direct 163", condition_type: "DomainSuffix", condition_value: "163.com", action: "Direct", priority: 120, enabled: true },
      { name: "Direct Bilibili", condition_type: "DomainSuffix", condition_value: "bilibili.com", action: "Direct", priority: 120, enabled: true },
      { name: "Direct Weibo", condition_type: "DomainSuffix", condition_value: "weibo.com", action: "Direct", priority: 120, enabled: true },
      { name: "Direct Alipay", condition_type: "DomainSuffix", condition_value: "alipay.com", action: "Direct", priority: 120, enabled: true },
      { name: "Direct Zhihu", condition_type: "DomainSuffix", condition_value: "zhihu.com", action: "Direct", priority: 120, enabled: true },
      { name: "Direct Douyin", condition_type: "DomainSuffix", condition_value: "douyin.com", action: "Direct", priority: 120, enabled: true },
      { name: "Direct Xiaomi", condition_type: "DomainSuffix", condition_value: "xiaomi.com", action: "Direct", priority: 120, enabled: true },
      { name: "Direct AliDNS", condition_type: "IpCidr", condition_value: "223.5.5.5/32", action: "Direct", priority: 120, enabled: true },
      { name: "Direct DNSPod", condition_type: "IpCidr", condition_value: "119.29.29.29/32", action: "Direct", priority: 120, enabled: true },
    ],
  },
  {
    id: "streaming-direct",
    category: "regional",
    nameKey: "templates.streamingDirect",
    descKey: "templates.streamingDirectDesc",
    icon: Globe,
    rules: [
      { name: "Direct Netflix", condition_type: "DomainSuffix", condition_value: "netflix.com", action: "Direct", priority: 130, enabled: true },
      { name: "Direct Netflix Video", condition_type: "DomainSuffix", condition_value: "nflxvideo.net", action: "Direct", priority: 130, enabled: true },
      { name: "Direct YouTube", condition_type: "DomainSuffix", condition_value: "youtube.com", action: "Direct", priority: 130, enabled: true },
      { name: "Direct Google Video", condition_type: "DomainSuffix", condition_value: "googlevideo.com", action: "Direct", priority: 130, enabled: true },
      { name: "Direct Spotify", condition_type: "DomainSuffix", condition_value: "spotify.com", action: "Direct", priority: 130, enabled: true },
      { name: "Direct Spotify CDN", condition_type: "DomainSuffix", condition_value: "scdn.co", action: "Direct", priority: 130, enabled: true },
      { name: "Direct Disney+", condition_type: "DomainSuffix", condition_value: "disneyplus.com", action: "Direct", priority: 130, enabled: true },
      { name: "Direct Hulu", condition_type: "DomainSuffix", condition_value: "hulu.com", action: "Direct", priority: 130, enabled: true },
      { name: "Direct HBO Max", condition_type: "DomainSuffix", condition_value: "hbomax.com", action: "Direct", priority: 130, enabled: true },
      { name: "Direct Twitch", condition_type: "DomainSuffix", condition_value: "twitch.tv", action: "Direct", priority: 130, enabled: true },
      { name: "Direct Prime Video", condition_type: "DomainSuffix", condition_value: "primevideo.com", action: "Direct", priority: 130, enabled: true },
    ],
  },

  // -- Catch-all --
  {
    id: "global-proxy",
    category: "catchall",
    nameKey: "templates.globalProxy",
    descKey: "templates.globalProxyDesc",
    icon: ArrowRightLeft,
    rules: [
      { name: "Proxy All Traffic", condition_type: "All", condition_value: "", action: "Allow", priority: 999, enabled: true },
    ],
  },
];
