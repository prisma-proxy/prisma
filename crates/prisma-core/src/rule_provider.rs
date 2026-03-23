//! Rule providers: fetch and parse rules from remote URLs.
//!
//! Supports remote rule lists for domain-based, IP CIDR-based, and classical
//! routing rules. Compatible with Clash-style rule-provider format.
//!
//! Rule providers periodically update their rules and integrate with the
//! routing engine to add dynamic rules.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;

use crate::router::{RouteAction, Rule, RuleCondition};

/// Format of the rule provider data.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RuleFormat {
    /// One rule per line (domain or IP/CIDR).
    Text,
    /// Clash-compatible YAML format.
    Yaml,
}

/// Behavior/type of rules in the provider.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RuleBehavior {
    /// Each line is a domain (suffix match).
    Domain,
    /// Each line is an IP CIDR.
    IpCidr,
    /// Classical rules with type prefix (e.g., "DOMAIN-SUFFIX,google.com").
    Classical,
}

/// Configuration for a single rule provider.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuleProviderConfig {
    /// Unique name for this provider.
    pub name: String,
    /// URL to fetch rules from.
    pub url: String,
    /// Data format.
    #[serde(default = "default_format")]
    pub format: RuleFormat,
    /// Rule behavior type.
    pub behavior: RuleBehavior,
    /// Update interval in seconds (0 = no auto-update).
    #[serde(default = "default_update_interval")]
    pub update_interval_secs: u64,
    /// Local cache file path (auto-generated if not set).
    #[serde(default)]
    pub cache_path: Option<String>,
    /// Action to apply for matched rules.
    #[serde(default = "default_action")]
    pub action: RouteAction,
}

fn default_format() -> RuleFormat {
    RuleFormat::Text
}

fn default_update_interval() -> u64 {
    86400 // 24 hours
}

fn default_action() -> RouteAction {
    RouteAction::Proxy
}

/// Runtime state for a rule provider, including parsed rules.
#[derive(Debug, Clone)]
pub struct RuleProviderState {
    pub config: RuleProviderConfig,
    /// Parsed rules from this provider.
    pub rules: Vec<Rule>,
    /// Last successful update timestamp (Unix epoch seconds).
    pub last_updated: Option<u64>,
    /// Last update error, if any.
    pub last_error: Option<String>,
    /// Number of rules currently loaded.
    pub rule_count: usize,
}

/// Summary info for API responses.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuleProviderInfo {
    pub name: String,
    pub url: String,
    pub format: RuleFormat,
    pub behavior: RuleBehavior,
    pub action: RouteAction,
    pub update_interval_secs: u64,
    pub rule_count: usize,
    pub last_updated: Option<u64>,
    pub last_error: Option<String>,
}

impl From<&RuleProviderState> for RuleProviderInfo {
    fn from(state: &RuleProviderState) -> Self {
        Self {
            name: state.config.name.clone(),
            url: state.config.url.clone(),
            format: state.config.format,
            behavior: state.config.behavior,
            action: state.config.action,
            update_interval_secs: state.config.update_interval_secs,
            rule_count: state.rule_count,
            last_updated: state.last_updated,
            last_error: state.last_error.clone(),
        }
    }
}

/// Manages all rule providers, fetching and parsing rules.
pub struct RuleProviderManager {
    providers: Arc<RwLock<HashMap<String, RuleProviderState>>>,
    cache_dir: PathBuf,
}

impl RuleProviderManager {
    /// Create a new manager from provider configs.
    pub fn new(configs: Vec<RuleProviderConfig>, cache_dir: PathBuf) -> Self {
        let mut providers = HashMap::new();
        for config in configs {
            let name = config.name.clone();
            providers.insert(
                name,
                RuleProviderState {
                    config,
                    rules: Vec::new(),
                    last_updated: None,
                    last_error: None,
                    rule_count: 0,
                },
            );
        }
        Self {
            providers: Arc::new(RwLock::new(providers)),
            cache_dir,
        }
    }

    /// Load all providers: try cache first, then fetch from URL.
    pub async fn load_all(&self) {
        let names: Vec<String> = {
            let providers = self.providers.read().await;
            providers.keys().cloned().collect()
        };

        for name in names {
            if let Err(e) = self.load_provider(&name).await {
                tracing::warn!(provider = %name, error = %e, "Failed to load rule provider");
            }
        }
    }

    /// Load a single provider: try cache, then fetch.
    async fn load_provider(&self, name: &str) -> anyhow::Result<()> {
        // Try loading from cache first
        if let Ok(content) = self.read_cache(name).await {
            let rules = {
                let providers = self.providers.read().await;
                let state = providers
                    .get(name)
                    .ok_or_else(|| anyhow::anyhow!("Provider not found: {}", name))?;
                parse_rules(
                    &content,
                    state.config.format,
                    state.config.behavior,
                    state.config.action,
                )?
            };
            let rule_count = rules.len();
            let mut providers = self.providers.write().await;
            if let Some(state) = providers.get_mut(name) {
                state.rules = rules;
                state.rule_count = rule_count;
                tracing::info!(provider = %name, rules = rule_count, "Loaded rules from cache");
            }
            return Ok(());
        }

        // Cache miss: fetch from URL
        self.update_provider(name).await
    }

    /// Fetch and update rules for a specific provider.
    pub async fn update_provider(&self, name: &str) -> anyhow::Result<()> {
        let (url, format, behavior, action) = {
            let providers = self.providers.read().await;
            let state = providers
                .get(name)
                .ok_or_else(|| anyhow::anyhow!("Provider not found: {}", name))?;
            (
                state.config.url.clone(),
                state.config.format,
                state.config.behavior,
                state.config.action,
            )
        };

        tracing::info!(provider = %name, url = %url, "Fetching rule provider");

        let content = fetch_url(&url).await?;
        let rules = parse_rules(&content, format, behavior, action)?;
        let rule_count = rules.len();

        // Save to cache
        if let Err(e) = self.write_cache(name, &content).await {
            tracing::warn!(provider = %name, error = %e, "Failed to write rule cache");
        }

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        let mut providers = self.providers.write().await;
        if let Some(state) = providers.get_mut(name) {
            state.rules = rules;
            state.rule_count = rule_count;
            state.last_updated = Some(now);
            state.last_error = None;
        }

        tracing::info!(provider = %name, rules = rule_count, "Updated rule provider");
        Ok(())
    }

    /// Get all parsed rules from all providers (for integration with the router).
    pub async fn all_rules(&self) -> Vec<Rule> {
        let providers = self.providers.read().await;
        providers
            .values()
            .flat_map(|state| state.rules.iter().cloned())
            .collect()
    }

    /// Get rules from a specific provider.
    pub async fn rules_for(&self, name: &str) -> Option<Vec<Rule>> {
        let providers = self.providers.read().await;
        providers.get(name).map(|s| s.rules.clone())
    }

    /// List all providers with their current status.
    pub async fn list(&self) -> Vec<RuleProviderInfo> {
        let providers = self.providers.read().await;
        providers.values().map(RuleProviderInfo::from).collect()
    }

    /// Spawn periodic update tasks for all providers.
    pub fn spawn_periodic_updates(self: &Arc<Self>) {
        let manager = Arc::clone(self);
        tokio::spawn(async move {
            manager.run_periodic_updates().await;
        });
    }

    async fn run_periodic_updates(&self) {
        let mut interval = tokio::time::interval(Duration::from_secs(60));
        let mut last_update: HashMap<String, std::time::Instant> = HashMap::new();

        loop {
            interval.tick().await;

            let providers = self.providers.read().await;
            let now = std::time::Instant::now();

            for (name, state) in providers.iter() {
                if state.config.update_interval_secs == 0 {
                    continue;
                }

                let interval_dur = Duration::from_secs(state.config.update_interval_secs);
                let should_update = last_update
                    .get(name)
                    .map(|t| now.duration_since(*t) >= interval_dur)
                    .unwrap_or(true);

                if should_update {
                    last_update.insert(name.clone(), now);
                    let name = name.clone();
                    let providers_arc = Arc::clone(&self.providers);
                    let cache_dir = self.cache_dir.clone();

                    tokio::spawn(async move {
                        let (url, format, behavior, action) = {
                            let providers = providers_arc.read().await;
                            match providers.get(&name) {
                                Some(state) => (
                                    state.config.url.clone(),
                                    state.config.format,
                                    state.config.behavior,
                                    state.config.action,
                                ),
                                None => return,
                            }
                        };

                        match fetch_url(&url).await {
                            Ok(content) => match parse_rules(&content, format, behavior, action) {
                                Ok(rules) => {
                                    let rule_count = rules.len();
                                    let now_epoch = std::time::SystemTime::now()
                                        .duration_since(std::time::UNIX_EPOCH)
                                        .unwrap_or_default()
                                        .as_secs();

                                    // Write cache
                                    let cache_path = cache_dir.join(format!("{}.txt", name));
                                    let _ = tokio::fs::write(&cache_path, &content).await;

                                    let mut providers = providers_arc.write().await;
                                    if let Some(state) = providers.get_mut(&name) {
                                        state.rules = rules;
                                        state.rule_count = rule_count;
                                        state.last_updated = Some(now_epoch);
                                        state.last_error = None;
                                    }
                                    tracing::info!(
                                        provider = %name,
                                        rules = rule_count,
                                        "Periodic update completed"
                                    );
                                }
                                Err(e) => {
                                    let mut providers = providers_arc.write().await;
                                    if let Some(state) = providers.get_mut(&name) {
                                        state.last_error = Some(e.to_string());
                                    }
                                    tracing::warn!(
                                        provider = %name,
                                        error = %e,
                                        "Failed to parse rules from periodic update"
                                    );
                                }
                            },
                            Err(e) => {
                                let mut providers = providers_arc.write().await;
                                if let Some(state) = providers.get_mut(&name) {
                                    state.last_error = Some(e.to_string());
                                }
                                tracing::warn!(
                                    provider = %name,
                                    error = %e,
                                    "Failed to fetch rules from periodic update"
                                );
                            }
                        }
                    });
                }
            }
        }
    }

    /// Read cached rules content for a provider.
    async fn read_cache(&self, name: &str) -> anyhow::Result<String> {
        let cache_path = self.cache_path(name);
        let content = tokio::fs::read_to_string(&cache_path).await?;
        Ok(content)
    }

    /// Write rules content to cache.
    async fn write_cache(&self, name: &str, content: &str) -> anyhow::Result<()> {
        tokio::fs::create_dir_all(&self.cache_dir).await?;
        let cache_path = self.cache_path(name);
        tokio::fs::write(&cache_path, content).await?;
        Ok(())
    }

    fn cache_path(&self, name: &str) -> PathBuf {
        self.cache_dir.join(format!("{}.txt", name))
    }
}

/// Fetch content from a URL.
async fn fetch_url(url: &str) -> anyhow::Result<String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()?;
    let resp = client.get(url).send().await?;
    if !resp.status().is_success() {
        anyhow::bail!("HTTP {}: {}", resp.status(), url);
    }
    let text = resp.text().await?;
    Ok(text)
}

/// Parse rule content based on format and behavior.
pub fn parse_rules(
    content: &str,
    format: RuleFormat,
    behavior: RuleBehavior,
    action: RouteAction,
) -> anyhow::Result<Vec<Rule>> {
    match format {
        RuleFormat::Text => parse_text_rules(content, behavior, action),
        RuleFormat::Yaml => parse_yaml_rules(content, behavior, action),
    }
}

/// Parse text-format rules (one entry per line).
fn parse_text_rules(
    content: &str,
    behavior: RuleBehavior,
    action: RouteAction,
) -> anyhow::Result<Vec<Rule>> {
    let mut rules = Vec::new();

    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with("//") {
            continue;
        }

        match behavior {
            RuleBehavior::Domain => {
                // Each line is a domain (interpreted as domain-suffix)
                let domain = line.trim_start_matches('.').trim_start_matches('+');
                if !domain.is_empty() {
                    rules.push(Rule {
                        condition: RuleCondition::DomainSuffix(domain.to_string()),
                        action,
                    });
                }
            }
            RuleBehavior::IpCidr => {
                // Each line is an IP CIDR
                if line.contains('/') {
                    rules.push(Rule {
                        condition: RuleCondition::IpCidr(line.to_string()),
                        action,
                    });
                }
            }
            RuleBehavior::Classical => {
                // Classical format: TYPE,VALUE
                if let Some(rule) = parse_classical_rule(line, action) {
                    rules.push(rule);
                }
            }
        }
    }

    Ok(rules)
}

/// Parse YAML-format rules (Clash-compatible rule-provider payload).
fn parse_yaml_rules(
    content: &str,
    behavior: RuleBehavior,
    action: RouteAction,
) -> anyhow::Result<Vec<Rule>> {
    // Simple YAML parsing for the `payload:` key
    // Clash rule-provider YAML looks like:
    // payload:
    //   - '.google.com'
    //   - '.youtube.com'
    let mut rules = Vec::new();
    let mut in_payload = false;

    for line in content.lines() {
        let trimmed = line.trim();

        if trimmed == "payload:" {
            in_payload = true;
            continue;
        }

        if in_payload {
            if !trimmed.starts_with('-') && !trimmed.starts_with("- ") {
                // End of payload section
                if !trimmed.is_empty() {
                    in_payload = false;
                }
                continue;
            }

            let value = trimmed
                .trim_start_matches('-')
                .trim()
                .trim_matches('\'')
                .trim_matches('"');

            if value.is_empty() {
                continue;
            }

            match behavior {
                RuleBehavior::Domain => {
                    let domain = value.trim_start_matches('.').trim_start_matches('+');
                    if !domain.is_empty() {
                        rules.push(Rule {
                            condition: RuleCondition::DomainSuffix(domain.to_string()),
                            action,
                        });
                    }
                }
                RuleBehavior::IpCidr => {
                    if value.contains('/') {
                        rules.push(Rule {
                            condition: RuleCondition::IpCidr(value.to_string()),
                            action,
                        });
                    }
                }
                RuleBehavior::Classical => {
                    if let Some(rule) = parse_classical_rule(value, action) {
                        rules.push(rule);
                    }
                }
            }
        }
    }

    Ok(rules)
}

/// Parse a single classical rule line (e.g., "DOMAIN-SUFFIX,google.com").
fn parse_classical_rule(line: &str, action: RouteAction) -> Option<Rule> {
    let parts: Vec<&str> = line.splitn(2, ',').collect();
    if parts.len() < 2 {
        return None;
    }

    let rule_type = parts[0].trim().to_ascii_uppercase();
    let value = parts[1].trim().to_string();

    let condition = match rule_type.as_str() {
        "DOMAIN" => RuleCondition::Domain(value),
        "DOMAIN-SUFFIX" => RuleCondition::DomainSuffix(value),
        "DOMAIN-KEYWORD" => RuleCondition::DomainKeyword(value),
        "IP-CIDR" | "IP-CIDR6" => RuleCondition::IpCidr(value),
        "GEOIP" => RuleCondition::GeoIp(value),
        "DST-PORT" | "SRC-PORT" => RuleCondition::Port(value),
        _ => return None,
    };

    Some(Rule { condition, action })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_text_domain() {
        let content = r#"
# Comment
google.com
.youtube.com
+facebook.com

twitter.com
"#;
        let rules = parse_text_rules(content, RuleBehavior::Domain, RouteAction::Direct).unwrap();
        assert_eq!(rules.len(), 4);

        assert!(matches!(
            &rules[0].condition,
            RuleCondition::DomainSuffix(d) if d == "google.com"
        ));
        assert!(matches!(
            &rules[1].condition,
            RuleCondition::DomainSuffix(d) if d == "youtube.com"
        ));
        assert_eq!(rules[0].action, RouteAction::Direct);
    }

    #[test]
    fn test_parse_text_ipcidr() {
        let content = r#"
# Private ranges
10.0.0.0/8
172.16.0.0/12
192.168.0.0/16
invalid_line
"#;
        let rules = parse_text_rules(content, RuleBehavior::IpCidr, RouteAction::Direct).unwrap();
        assert_eq!(rules.len(), 3);
        assert!(matches!(
            &rules[0].condition,
            RuleCondition::IpCidr(c) if c == "10.0.0.0/8"
        ));
    }

    #[test]
    fn test_parse_text_classical() {
        let content = r#"
DOMAIN-SUFFIX,google.com
DOMAIN,exact.com
DOMAIN-KEYWORD,ads
IP-CIDR,10.0.0.0/8
GEOIP,CN
DST-PORT,443
"#;
        let rules = parse_text_rules(content, RuleBehavior::Classical, RouteAction::Proxy).unwrap();
        assert_eq!(rules.len(), 6);

        assert!(matches!(&rules[0].condition, RuleCondition::DomainSuffix(d) if d == "google.com"));
        assert!(matches!(&rules[1].condition, RuleCondition::Domain(d) if d == "exact.com"));
        assert!(matches!(&rules[2].condition, RuleCondition::DomainKeyword(d) if d == "ads"));
        assert!(matches!(&rules[3].condition, RuleCondition::IpCidr(c) if c == "10.0.0.0/8"));
        assert!(matches!(&rules[4].condition, RuleCondition::GeoIp(c) if c == "CN"));
        assert!(matches!(&rules[5].condition, RuleCondition::Port(p) if p == "443"));
    }

    #[test]
    fn test_parse_yaml_domain() {
        let content = r#"
payload:
  - '.google.com'
  - '.youtube.com'
  - 'facebook.com'
"#;
        let rules = parse_yaml_rules(content, RuleBehavior::Domain, RouteAction::Direct).unwrap();
        assert_eq!(rules.len(), 3);
        assert!(matches!(
            &rules[0].condition,
            RuleCondition::DomainSuffix(d) if d == "google.com"
        ));
    }

    #[test]
    fn test_parse_yaml_ipcidr() {
        let content = r#"
payload:
  - '10.0.0.0/8'
  - '172.16.0.0/12'
  - '192.168.0.0/16'
"#;
        let rules = parse_yaml_rules(content, RuleBehavior::IpCidr, RouteAction::Direct).unwrap();
        assert_eq!(rules.len(), 3);
    }

    #[test]
    fn test_parse_yaml_classical() {
        let content = r#"
payload:
  - 'DOMAIN-SUFFIX,google.com'
  - 'IP-CIDR,10.0.0.0/8'
"#;
        let rules = parse_yaml_rules(content, RuleBehavior::Classical, RouteAction::Proxy).unwrap();
        assert_eq!(rules.len(), 2);
        assert!(matches!(&rules[0].condition, RuleCondition::DomainSuffix(d) if d == "google.com"));
        assert!(matches!(&rules[1].condition, RuleCondition::IpCidr(c) if c == "10.0.0.0/8"));
    }

    #[test]
    fn test_parse_empty_content() {
        let rules = parse_text_rules("", RuleBehavior::Domain, RouteAction::Direct).unwrap();
        assert!(rules.is_empty());

        let rules = parse_text_rules(
            "# Just a comment\n",
            RuleBehavior::Domain,
            RouteAction::Direct,
        )
        .unwrap();
        assert!(rules.is_empty());
    }

    #[test]
    fn test_classical_rule_unknown_type() {
        assert!(parse_classical_rule("UNKNOWN,value", RouteAction::Proxy).is_none());
        assert!(parse_classical_rule("malformed-no-comma", RouteAction::Proxy).is_none());
    }
}
