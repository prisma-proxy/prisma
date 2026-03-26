//! Protobuf message definitions for v2fly GeoIP/GeoSite .dat files.
//!
//! These match the V2Ray routercommon proto schema and are decoded
//! using prost without requiring a build.rs step.

/// Top-level container in geoip.dat.
#[derive(Clone, prost::Message)]
pub struct GeoIPList {
    #[prost(message, repeated, tag = "1")]
    pub entry: Vec<GeoIP>,
}

/// A single country's IP ranges.
#[derive(Clone, prost::Message)]
pub struct GeoIP {
    #[prost(string, tag = "1")]
    pub country_code: String,
    #[prost(message, repeated, tag = "2")]
    pub cidr: Vec<Cidr>,
}

/// A CIDR range: ip (4 or 16 bytes) + prefix length.
#[derive(Clone, prost::Message)]
pub struct Cidr {
    /// 4 bytes for IPv4, 16 bytes for IPv6.
    #[prost(bytes = "vec", tag = "1")]
    pub ip: Vec<u8>,
    #[prost(uint32, tag = "2")]
    pub prefix: u32,
}
