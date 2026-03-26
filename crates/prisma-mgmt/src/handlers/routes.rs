use std::net::{IpAddr, Ipv4Addr};

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use prisma_core::config::server::{RoutingRule, RuleAction, RuleCondition};

use crate::db;
use crate::handlers::connections;
use crate::MgmtState;

#[derive(Deserialize)]
pub struct CreateRouteRequest {
    pub name: String,
    pub priority: u32,
    pub condition: RuleCondition,
    pub action: RuleAction,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

fn default_true() -> bool {
    true
}

pub async fn list(State(state): State<MgmtState>) -> Json<Vec<RoutingRule>> {
    let rules = state.routing_rules.read().await;
    Json(rules.clone())
}

pub async fn create(
    State(state): State<MgmtState>,
    Json(req): Json<CreateRouteRequest>,
) -> Result<Json<RoutingRule>, StatusCode> {
    let rule = RoutingRule {
        id: Uuid::new_v4(),
        name: req.name,
        priority: req.priority,
        condition: req.condition,
        action: req.action,
        enabled: req.enabled,
    };

    // Persist to SQLite
    if let Some(ref database) = state.db {
        db::insert_routing_rule(database, &rule).ok();
    }

    let json = Json(rule.clone());
    state.routing_rules.write().await.push(rule);
    state.sync_rules_to_config().await;
    state.persist_config().await;
    Ok(json)
}

pub async fn update(
    State(state): State<MgmtState>,
    Path(id): Path<Uuid>,
    Json(req): Json<CreateRouteRequest>,
) -> StatusCode {
    let rule = RoutingRule {
        id,
        name: req.name.clone(),
        priority: req.priority,
        condition: req.condition.clone(),
        action: req.action,
        enabled: req.enabled,
    };

    let found = {
        let mut rules = state.routing_rules.write().await;
        if let Some(r) = rules.iter_mut().find(|r| r.id == id) {
            r.name = req.name;
            r.priority = req.priority;
            r.condition = req.condition;
            r.action = req.action;
            r.enabled = req.enabled;
            true
        } else {
            false
        }
    };
    if found {
        // Sync to SQLite
        if let Some(ref database) = state.db {
            db::update_routing_rule(database, &rule);
        }
        state.sync_rules_to_config().await;
        state.persist_config().await;
        StatusCode::OK
    } else {
        StatusCode::NOT_FOUND
    }
}

pub async fn remove(State(state): State<MgmtState>, Path(id): Path<Uuid>) -> StatusCode {
    let removed = {
        let mut rules = state.routing_rules.write().await;
        let len_before = rules.len();
        rules.retain(|r| r.id != id);
        rules.len() < len_before
    };
    if removed {
        // Remove from SQLite
        if let Some(ref database) = state.db {
            db::delete_routing_rule(database, &id);
        }
        state.sync_rules_to_config().await;
        state.persist_config().await;
        StatusCode::OK
    } else {
        StatusCode::NOT_FOUND
    }
}

// -- POST /api/routes/test — test a domain/IP against routing rules ──

#[derive(Deserialize)]
pub struct TestRequest {
    pub query: String,
}

#[derive(Serialize)]
pub struct TestResponse {
    pub matched: bool,
    pub rule_id: Option<Uuid>,
    pub rule_name: Option<String>,
    pub action: Option<String>,
    pub condition_type: Option<String>,
}

pub async fn test_rules(
    State(state): State<MgmtState>,
    Json(req): Json<TestRequest>,
) -> Json<TestResponse> {
    let query = req.query.trim().to_lowercase();
    if query.is_empty() {
        return Json(TestResponse {
            matched: false,
            rule_id: None,
            rule_name: None,
            action: None,
            condition_type: None,
        });
    }

    let rules = state.routing_rules.read().await;
    let mut sorted: Vec<_> = rules.iter().filter(|r| r.enabled).collect();
    sorted.sort_by_key(|r| r.priority);

    // Determine if query is an IP address
    let ip: Option<Ipv4Addr> = query.parse().ok();

    for rule in sorted {
        let matches = match &rule.condition {
            RuleCondition::All => true,
            RuleCondition::DomainExact(domain) => query == domain.to_ascii_lowercase(),
            RuleCondition::DomainMatch(pattern) => {
                let pattern_lc = pattern.to_ascii_lowercase();
                if let Some(suffix) = pattern_lc.strip_prefix("*.") {
                    query == suffix || query.ends_with(&format!(".{suffix}"))
                } else if pattern_lc.starts_with('*')
                    && pattern_lc.ends_with('*')
                    && pattern_lc.len() > 2
                {
                    query.contains(&pattern_lc[1..pattern_lc.len() - 1])
                } else {
                    query == pattern_lc
                }
            }
            RuleCondition::IpCidr(cidr) => {
                if let Some(target_country) = cidr.strip_prefix("geoip:") {
                    // GeoIP: look up the query IP in MMDB and compare country code
                    if let Some(ip) = ip {
                        let cfg = state.config.read().await;
                        if let Some(reader) = connections::open_mmdb(&cfg) {
                            let (country, _, _, _) =
                                connections::lookup_geo(&reader, IpAddr::V4(ip));
                            country
                                .as_deref()
                                .is_some_and(|c| c.eq_ignore_ascii_case(target_country))
                        } else {
                            false
                        }
                    } else {
                        false
                    }
                } else if cidr.starts_with("geosite:") {
                    // GeoSite: domain-based matching — requires runtime evaluation
                    // Cannot be tested locally without loading the full geosite database
                    false
                } else if let Some(ip) = ip {
                    if let Some((network, mask)) = prisma_core::router::parse_cidr_v4(cidr) {
                        (u32::from(ip) & mask) == network
                    } else {
                        false
                    }
                } else {
                    false
                }
            }
            RuleCondition::PortRange(start, end) => {
                if let Ok(port) = query.parse::<u16>() {
                    port >= *start && port <= *end
                } else {
                    false
                }
            }
            RuleCondition::Unknown => false, // Unknown conditions never match
        };

        if matches {
            let action_str = match rule.action {
                RuleAction::Allow | RuleAction::Unknown => "PROXY",
                RuleAction::Direct => "DIRECT",
                RuleAction::Block => "REJECT",
            };
            let cond_type = match &rule.condition {
                RuleCondition::DomainExact(_) => "DOMAIN",
                RuleCondition::DomainMatch(p) => {
                    if p.starts_with("*.") {
                        "DOMAIN-SUFFIX"
                    } else if p.starts_with('*') && p.ends_with('*') {
                        "DOMAIN-KEYWORD"
                    } else {
                        "DOMAIN"
                    }
                }
                RuleCondition::IpCidr(c) => {
                    if c.starts_with("geoip:") {
                        "GEOIP"
                    } else if c.starts_with("geosite:") {
                        "GEOSITE"
                    } else {
                        "IP-CIDR"
                    }
                }
                RuleCondition::PortRange(..) => "PORT-RANGE",
                RuleCondition::All => "FINAL",
                RuleCondition::Unknown => "UNKNOWN",
            };
            return Json(TestResponse {
                matched: true,
                rule_id: Some(rule.id),
                rule_name: Some(rule.name.clone()),
                action: Some(action_str.to_string()),
                condition_type: Some(cond_type.to_string()),
            });
        }
    }

    Json(TestResponse {
        matched: false,
        rule_id: None,
        rule_name: None,
        action: None,
        condition_type: None,
    })
}
