//! Country → CIDR lookup using a compact embedded data format.
//!
//! For a real deployment, replace COUNTRY_CIDR_DATA with ip2location-lite data.
//! This stub provides the API surface for GUI consumers.

use anyhow::Result;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct CountryInfo {
    pub code: String,
    pub name: String,
    pub cidrs: Vec<String>,
}

pub fn lookup_country(ip: &str) -> Option<String> {
    // Stub: real impl would binary-search ip2location-lite CIDR table
    let _ = ip;
    None
}

pub fn country_cidrs(country_code: &str) -> Vec<String> {
    // Stub: real impl loads embedded ip2location-lite DB
    let _ = country_code;
    Vec::new()
}
