use std::collections::VecDeque;
use std::net::IpAddr;
use std::time::{Duration, Instant};

use dashmap::DashMap;

/// Per-IP TLS handshake failure rate limiter.
///
/// Tracks recent TLS handshake failures per IP address and blocks IPs that
/// exceed the configured threshold within a sliding window. Designed for
/// mitigating active probing (GFW) and scanner bots that generate repeated
/// TLS handshake failures from the same IP with varying source ports.
pub struct TlsProbeGuard {
    /// Recent failure timestamps per IP (sliding window).
    failures: DashMap<IpAddr, VecDeque<Instant>>,
    /// Blocked IPs with block expiry time.
    blocked: DashMap<IpAddr, Instant>,
    /// Max failures allowed within the window before blocking.
    max_failures: u32,
    /// Sliding window duration for counting failures.
    window: Duration,
    /// How long to block an IP after exceeding the threshold.
    block_duration: Duration,
}

impl TlsProbeGuard {
    pub fn new(max_failures: u32, window_secs: u64, block_duration_secs: u64) -> Self {
        Self {
            failures: DashMap::new(),
            blocked: DashMap::new(),
            max_failures,
            window: Duration::from_secs(window_secs),
            block_duration: Duration::from_secs(block_duration_secs),
        }
    }

    /// Check if an IP is currently blocked. Lazily evicts expired blocks.
    pub fn is_blocked(&self, ip: &IpAddr) -> bool {
        if let Some(entry) = self.blocked.get(ip) {
            if Instant::now() < *entry.value() {
                return true;
            }
            // Block expired — remove it
            drop(entry);
            self.blocked.remove(ip);
        }
        false
    }

    /// Record a TLS handshake failure for the given IP.
    /// Returns the current failure count within the sliding window.
    /// Automatically blocks the IP if the threshold is exceeded.
    pub fn record_failure(&self, ip: &IpAddr) -> u32 {
        let now = Instant::now();
        let cutoff = now - self.window;

        let count = {
            let mut entry = self.failures.entry(*ip).or_default();
            let queue = entry.value_mut();
            // Evict timestamps outside the window
            while queue.front().is_some_and(|&t| t < cutoff) {
                queue.pop_front();
            }
            queue.push_back(now);
            queue.len() as u32
        };

        if count >= self.max_failures {
            self.blocked
                .insert(*ip, Instant::now() + self.block_duration);
        }

        count
    }

    /// Sweep stale entries from both maps. Called periodically by background task.
    pub fn cleanup(&self) {
        let now = Instant::now();
        let cutoff = now - self.window;

        // Remove expired blocks
        self.blocked.retain(|_, expiry| *expiry > now);

        // Remove IPs with no recent failures
        self.failures.retain(|_, queue| {
            while queue.front().is_some_and(|&t| t < cutoff) {
                queue.pop_front();
            }
            !queue.is_empty()
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::Ipv4Addr;

    fn test_ip(last: u8) -> IpAddr {
        IpAddr::V4(Ipv4Addr::new(192, 168, 1, last))
    }

    #[test]
    fn not_blocked_initially() {
        let guard = TlsProbeGuard::new(3, 60, 300);
        assert!(!guard.is_blocked(&test_ip(1)));
    }

    #[test]
    fn blocks_after_threshold() {
        let guard = TlsProbeGuard::new(3, 60, 300);
        let ip = test_ip(1);

        assert_eq!(guard.record_failure(&ip), 1);
        assert!(!guard.is_blocked(&ip));

        assert_eq!(guard.record_failure(&ip), 2);
        assert!(!guard.is_blocked(&ip));

        assert_eq!(guard.record_failure(&ip), 3);
        // Now blocked (count >= max_failures)
        assert!(guard.is_blocked(&ip));
    }

    #[test]
    fn different_ips_tracked_independently() {
        let guard = TlsProbeGuard::new(3, 60, 300);
        let ip_a = test_ip(1);
        let ip_b = test_ip(2);

        for _ in 0..3 {
            guard.record_failure(&ip_a);
        }
        assert!(guard.is_blocked(&ip_a));
        assert!(!guard.is_blocked(&ip_b));
    }

    #[test]
    fn window_expiry_resets_count() {
        // Use a very short window so we can test expiry
        let guard = TlsProbeGuard::new(3, 0, 300);
        let ip = test_ip(1);

        // Record 2 failures — they'll immediately be outside the 0s window
        guard.record_failure(&ip);
        guard.record_failure(&ip);

        // Next failure starts fresh (previous ones are outside the 0s window)
        let count = guard.record_failure(&ip);
        assert_eq!(count, 1);
        assert!(!guard.is_blocked(&ip));
    }

    #[test]
    fn block_expiry() {
        // Use 0s block duration so blocks expire immediately
        let guard = TlsProbeGuard::new(1, 60, 0);
        let ip = test_ip(1);

        guard.record_failure(&ip);
        // Block was inserted with 0s duration — already expired
        assert!(!guard.is_blocked(&ip));
    }

    #[test]
    fn cleanup_removes_stale_entries() {
        let guard = TlsProbeGuard::new(100, 0, 0);
        let ip = test_ip(1);

        guard.record_failure(&ip);
        // With 0s window and 0s block, everything is stale immediately
        guard.cleanup();

        assert!(guard.failures.is_empty());
        assert!(guard.blocked.is_empty());
    }
}
