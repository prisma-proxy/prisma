//! DNS-over-HTTPS (DoH) client implementing RFC 8484.
//!
//! Uses the wire format (POST with `application/dns-message` content type)
//! to send standard DNS query packets over HTTPS and parse the responses.

use std::net::Ipv4Addr;
use std::time::Duration;

use anyhow::{Context, Result};
use reqwest::Client;
use tracing::debug;

/// A DNS-over-HTTPS resolver that sends DNS wire-format queries via HTTPS POST.
#[derive(Clone)]
pub struct DohResolver {
    client: Client,
    url: String,
}

impl DohResolver {
    /// Create a new DoH resolver with the given server URL.
    ///
    /// The URL should be a standard DoH endpoint, e.g. `https://cloudflare-dns.com/dns-query`.
    pub fn new(url: &str) -> Result<Self> {
        let client = Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .context("failed to build DoH HTTP client")?;
        Ok(Self {
            client,
            url: url.to_string(),
        })
    }

    /// Create a DoH resolver with a custom reqwest client.
    pub fn with_client(client: Client, url: &str) -> Self {
        Self {
            client,
            url: url.to_string(),
        }
    }

    /// Resolve a domain name to A record IPv4 addresses via DoH.
    pub async fn resolve(&self, domain: &str) -> Result<Vec<Ipv4Addr>> {
        let query = build_dns_query(domain);
        debug!(domain = domain, url = %self.url, "sending DoH query");

        let response = self
            .client
            .post(&self.url)
            .header("Content-Type", "application/dns-message")
            .header("Accept", "application/dns-message")
            .body(query)
            .send()
            .await
            .context("DoH request failed")?;

        let status = response.status();
        if !status.is_success() {
            return Err(anyhow::anyhow!("DoH server returned HTTP {status}"));
        }

        let content_type = response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");

        if !content_type.contains("application/dns-message") {
            return Err(anyhow::anyhow!(
                "DoH server returned unexpected content-type: {content_type}"
            ));
        }

        let body = response
            .bytes()
            .await
            .context("failed to read DoH response body")?;

        parse_dns_a_records(&body)
    }
}

/// Build a minimal DNS A record query in wire format for the given domain.
///
/// Wire format (RFC 1035):
/// - 12-byte header (ID, flags, counts)
/// - Question section (domain name labels + QTYPE + QCLASS)
pub fn build_dns_query(domain: &str) -> Vec<u8> {
    let mut buf = Vec::with_capacity(64);

    // Header
    let id: u16 = rand::random();
    buf.extend_from_slice(&id.to_be_bytes()); // ID
    buf.extend_from_slice(&[0x01, 0x00]); // Flags: standard query, recursion desired
    buf.extend_from_slice(&[0x00, 0x01]); // QDCOUNT: 1
    buf.extend_from_slice(&[0x00, 0x00]); // ANCOUNT: 0
    buf.extend_from_slice(&[0x00, 0x00]); // NSCOUNT: 0
    buf.extend_from_slice(&[0x00, 0x00]); // ARCOUNT: 0

    // Question: domain name in DNS wire format
    for label in domain.trim_end_matches('.').split('.') {
        if label.len() > 63 {
            // DNS label length limit
            buf.push(63);
            buf.extend_from_slice(&label.as_bytes()[..63]);
        } else {
            buf.push(label.len() as u8);
            buf.extend_from_slice(label.as_bytes());
        }
    }
    buf.push(0x00); // root label

    buf.extend_from_slice(&[0x00, 0x01]); // QTYPE: A
    buf.extend_from_slice(&[0x00, 0x01]); // QCLASS: IN

    buf
}

/// Parse A records from a DNS wire-format response.
///
/// Returns all IPv4 addresses found in A record answers.
pub fn parse_dns_a_records(data: &[u8]) -> Result<Vec<Ipv4Addr>> {
    if data.len() < 12 {
        return Err(anyhow::anyhow!(
            "DNS response too short ({} bytes)",
            data.len()
        ));
    }

    // Check RCODE in flags (bits 0-3 of the second flags byte)
    let rcode = data[3] & 0x0F;
    if rcode != 0 {
        return Err(anyhow::anyhow!("DNS server returned error RCODE={rcode}"));
    }

    let ancount = u16::from_be_bytes([data[6], data[7]]) as usize;
    let mut addrs = Vec::new();

    // Skip header (12 bytes) and question section
    let mut pos = 12;

    // Skip question section: read the QNAME
    pos = skip_dns_name(data, pos)?;
    if pos + 4 > data.len() {
        return Err(anyhow::anyhow!(
            "DNS response truncated in question section"
        ));
    }
    pos += 4; // QTYPE + QCLASS

    // Parse answer records
    for _ in 0..ancount {
        if pos >= data.len() {
            break;
        }

        // Skip name (handle compression pointers)
        pos = skip_dns_name(data, pos)?;

        if pos + 10 > data.len() {
            break;
        }

        let rtype = u16::from_be_bytes([data[pos], data[pos + 1]]);
        let rdlength = u16::from_be_bytes([data[pos + 8], data[pos + 9]]) as usize;
        pos += 10; // TYPE(2) + CLASS(2) + TTL(4) + RDLENGTH(2)

        if rtype == 1 && rdlength == 4 && pos + 4 <= data.len() {
            // A record: 4 bytes of IPv4 address
            addrs.push(Ipv4Addr::new(
                data[pos],
                data[pos + 1],
                data[pos + 2],
                data[pos + 3],
            ));
        }

        pos += rdlength;
    }

    Ok(addrs)
}

/// Skip a DNS name at the given position, handling compression pointers.
/// Returns the position after the name.
fn skip_dns_name(data: &[u8], mut pos: usize) -> Result<usize> {
    let mut jumps = 0;
    loop {
        if pos >= data.len() {
            return Err(anyhow::anyhow!("DNS name extends beyond packet"));
        }
        let b = data[pos];
        if b == 0 {
            // Root label -- end of name
            return Ok(pos + 1);
        } else if b & 0xC0 == 0xC0 {
            // Compression pointer -- 2 bytes, name ends here in the stream
            if pos + 1 >= data.len() {
                return Err(anyhow::anyhow!("DNS compression pointer truncated"));
            }
            return Ok(pos + 2);
        } else {
            // Regular label
            let len = b as usize;
            pos += 1 + len;
            jumps += 1;
            if jumps > 128 {
                return Err(anyhow::anyhow!("DNS name too many labels"));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_dns_query_structure() {
        let query = build_dns_query("example.com");

        // Header is 12 bytes
        assert!(query.len() >= 12);

        // Flags: RD set (0x0100)
        assert_eq!(query[2], 0x01);
        assert_eq!(query[3], 0x00);

        // QDCOUNT: 1
        assert_eq!(query[4], 0x00);
        assert_eq!(query[5], 0x01);

        // Question starts at byte 12
        // "example" = 7 chars
        assert_eq!(query[12], 7);
        assert_eq!(&query[13..20], b"example");
        // "com" = 3 chars
        assert_eq!(query[20], 3);
        assert_eq!(&query[21..24], b"com");
        // Root label
        assert_eq!(query[24], 0);

        // QTYPE: A (1)
        assert_eq!(query[25], 0x00);
        assert_eq!(query[26], 0x01);
        // QCLASS: IN (1)
        assert_eq!(query[27], 0x00);
        assert_eq!(query[28], 0x01);
    }

    #[test]
    fn test_build_dns_query_trailing_dot() {
        let q1 = build_dns_query("example.com.");
        let q2 = build_dns_query("example.com");
        // Should produce same question section (ignoring random ID)
        assert_eq!(q1[2..], q2[2..]);
    }

    #[test]
    fn test_build_dns_query_subdomain() {
        let query = build_dns_query("www.example.com");
        // "www" = 3 chars
        assert_eq!(query[12], 3);
        assert_eq!(&query[13..16], b"www");
        // "example" = 7 chars
        assert_eq!(query[16], 7);
        assert_eq!(&query[17..24], b"example");
        // "com" = 3 chars
        assert_eq!(query[24], 3);
        assert_eq!(&query[25..28], b"com");
        // Root label
        assert_eq!(query[28], 0);
    }

    /// Build a synthetic DNS response for testing.
    fn build_test_response(id: u16, domain: &str, ips: &[Ipv4Addr]) -> Vec<u8> {
        let mut buf = Vec::new();

        // Header
        buf.extend_from_slice(&id.to_be_bytes()); // ID
        buf.extend_from_slice(&[0x81, 0x80]); // Flags: response, RD, RA, no error
        buf.extend_from_slice(&[0x00, 0x01]); // QDCOUNT: 1
        buf.extend_from_slice(&(ips.len() as u16).to_be_bytes()); // ANCOUNT
        buf.extend_from_slice(&[0x00, 0x00]); // NSCOUNT
        buf.extend_from_slice(&[0x00, 0x00]); // ARCOUNT

        // Question section
        for label in domain.trim_end_matches('.').split('.') {
            buf.push(label.len() as u8);
            buf.extend_from_slice(label.as_bytes());
        }
        buf.push(0x00); // root label
        buf.extend_from_slice(&[0x00, 0x01]); // QTYPE: A
        buf.extend_from_slice(&[0x00, 0x01]); // QCLASS: IN

        // Answer section
        for ip in ips {
            // Name: compression pointer to offset 12 (start of question name)
            buf.extend_from_slice(&[0xC0, 0x0C]);
            buf.extend_from_slice(&[0x00, 0x01]); // TYPE: A
            buf.extend_from_slice(&[0x00, 0x01]); // CLASS: IN
            buf.extend_from_slice(&[0x00, 0x00, 0x01, 0x2C]); // TTL: 300
            buf.extend_from_slice(&[0x00, 0x04]); // RDLENGTH: 4
            buf.extend_from_slice(&ip.octets()); // RDATA
        }

        buf
    }

    #[test]
    fn test_parse_single_a_record() {
        let ip = Ipv4Addr::new(1, 2, 3, 4);
        let resp = build_test_response(0x1234, "example.com", &[ip]);

        let addrs = parse_dns_a_records(&resp).unwrap();
        assert_eq!(addrs, vec![ip]);
    }

    #[test]
    fn test_parse_multiple_a_records() {
        let ips = vec![
            Ipv4Addr::new(1, 1, 1, 1),
            Ipv4Addr::new(1, 0, 0, 1),
            Ipv4Addr::new(8, 8, 8, 8),
        ];
        let resp = build_test_response(0xABCD, "dns.example.com", &ips);

        let addrs = parse_dns_a_records(&resp).unwrap();
        assert_eq!(addrs, ips);
    }

    #[test]
    fn test_parse_no_answers() {
        let resp = build_test_response(0x5678, "nxdomain.example.com", &[]);
        let addrs = parse_dns_a_records(&resp).unwrap();
        assert!(addrs.is_empty());
    }

    #[test]
    fn test_parse_too_short() {
        let err = parse_dns_a_records(&[0u8; 6]);
        assert!(err.is_err());
    }

    #[test]
    fn test_parse_rcode_error() {
        let mut resp = build_test_response(0x1234, "fail.com", &[]);
        // Set RCODE to NXDOMAIN (3)
        resp[3] = (resp[3] & 0xF0) | 0x03;

        let err = parse_dns_a_records(&resp);
        assert!(err.is_err());
        let msg = err.unwrap_err().to_string();
        assert!(msg.contains("RCODE=3"), "unexpected error: {msg}");
    }

    #[test]
    fn test_skip_dns_name_regular() {
        // "example.com\0"
        let data = [
            7, b'e', b'x', b'a', b'm', b'p', b'l', b'e', 3, b'c', b'o', b'm', 0,
        ];
        let pos = skip_dns_name(&data, 0).unwrap();
        assert_eq!(pos, 13); // past the null terminator
    }

    #[test]
    fn test_skip_dns_name_compression() {
        // Compression pointer: 0xC0 0x0C (points to offset 12)
        let data = [0xC0, 0x0C];
        let pos = skip_dns_name(&data, 0).unwrap();
        assert_eq!(pos, 2);
    }

    #[test]
    fn test_roundtrip_query_response() {
        // Build a query, then build a matching response, and parse it
        let query = build_dns_query("test.example.org");
        let id = u16::from_be_bytes([query[0], query[1]]);

        let expected_ip = Ipv4Addr::new(93, 184, 216, 34);
        let resp = build_test_response(id, "test.example.org", &[expected_ip]);

        let addrs = parse_dns_a_records(&resp).unwrap();
        assert_eq!(addrs, vec![expected_ip]);
    }

    // test_dns_protocol_serde is in dns/mod.rs (canonical location)

    #[test]
    fn test_dns_config_doh_defaults() {
        use crate::dns::DnsConfig;

        let config = DnsConfig::default();
        assert_eq!(config.protocol, crate::dns::DnsProtocol::Udp);
        assert_eq!(config.doh_url, "https://cloudflare-dns.com/dns-query");
    }

    #[test]
    fn test_dns_config_doh_serde() {
        use crate::dns::DnsConfig;

        let json = r#"{
            "protocol": "doh",
            "doh_url": "https://dns.google/dns-query"
        }"#;
        let config: DnsConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.protocol, crate::dns::DnsProtocol::Doh);
        assert_eq!(config.doh_url, "https://dns.google/dns-query");
    }

    #[test]
    fn test_build_dns_query_long_label() {
        // Label > 63 chars should be truncated
        let long_label = "a".repeat(100);
        let domain = format!("{long_label}.com");
        let query = build_dns_query(&domain);

        // First label should be truncated to 63
        assert_eq!(query[12], 63);
    }

    #[test]
    fn test_parse_response_with_cname_then_a() {
        // Build a response with a CNAME record followed by an A record
        let mut buf = Vec::new();

        // Header
        buf.extend_from_slice(&[0x12, 0x34]); // ID
        buf.extend_from_slice(&[0x81, 0x80]); // Flags: response, no error
        buf.extend_from_slice(&[0x00, 0x01]); // QDCOUNT: 1
        buf.extend_from_slice(&[0x00, 0x02]); // ANCOUNT: 2
        buf.extend_from_slice(&[0x00, 0x00]); // NSCOUNT
        buf.extend_from_slice(&[0x00, 0x00]); // ARCOUNT

        // Question: www.example.com
        buf.push(3);
        buf.extend_from_slice(b"www");
        buf.push(7);
        buf.extend_from_slice(b"example");
        buf.push(3);
        buf.extend_from_slice(b"com");
        buf.push(0);
        buf.extend_from_slice(&[0x00, 0x01]); // QTYPE: A
        buf.extend_from_slice(&[0x00, 0x01]); // QCLASS: IN

        // Answer 1: CNAME record (type 5)
        buf.extend_from_slice(&[0xC0, 0x0C]); // Name pointer
        buf.extend_from_slice(&[0x00, 0x05]); // TYPE: CNAME
        buf.extend_from_slice(&[0x00, 0x01]); // CLASS: IN
        buf.extend_from_slice(&[0x00, 0x00, 0x01, 0x2C]); // TTL
                                                          // RDATA: example.com (pointer to offset 16 which is "example.com" part)
        buf.extend_from_slice(&[0x00, 0x02]); // RDLENGTH: 2
        buf.extend_from_slice(&[0xC0, 0x10]); // pointer to "example"

        // Answer 2: A record
        buf.extend_from_slice(&[0xC0, 0x10]); // Name pointer to "example.com"
        buf.extend_from_slice(&[0x00, 0x01]); // TYPE: A
        buf.extend_from_slice(&[0x00, 0x01]); // CLASS: IN
        buf.extend_from_slice(&[0x00, 0x00, 0x01, 0x2C]); // TTL
        buf.extend_from_slice(&[0x00, 0x04]); // RDLENGTH: 4
        buf.extend_from_slice(&[93, 184, 216, 34]); // IP

        let addrs = parse_dns_a_records(&buf).unwrap();
        assert_eq!(addrs, vec![Ipv4Addr::new(93, 184, 216, 34)]);
    }
}
