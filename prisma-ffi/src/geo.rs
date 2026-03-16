//! Country / CIDR lookup using a compact embedded data format.
//!
//! For a real deployment, replace stubs with ip2location-lite data.
//! This module provides the API surface for GUI consumers.

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct CountryInfo {
    pub code: String,
    pub name: String,
    pub cidrs: Vec<String>,
}

#[allow(dead_code)]
pub fn lookup_country(ip: &str) -> Option<String> {
    let _ = ip;
    None
}

#[allow(dead_code)]
pub fn country_cidrs(country_code: &str) -> Vec<String> {
    let _ = country_code;
    Vec::new()
}
