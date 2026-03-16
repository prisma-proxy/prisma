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
pub fn lookup_country(_ip: &str) -> Option<String> {
    None
}

#[allow(dead_code)]
pub fn country_cidrs(_country_code: &str) -> Vec<String> {
    Vec::new()
}
