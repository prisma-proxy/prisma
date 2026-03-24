use moka::future::Cache;
use std::net::IpAddr;
use std::time::Duration;

/// DNS resolution cache backed by Moka.
#[derive(Clone)]
pub struct DnsCache {
    inner: Cache<String, Vec<IpAddr>>,
}

impl DnsCache {
    pub fn new(max_capacity: u64, ttl_secs: u64) -> Self {
        let cache = Cache::builder()
            .max_capacity(max_capacity)
            .time_to_live(Duration::from_secs(ttl_secs))
            .build();
        Self { inner: cache }
    }

    pub async fn get(&self, hostname: &str) -> Option<Vec<IpAddr>> {
        self.inner.get(hostname).await
    }

    pub async fn insert(&self, hostname: String, addrs: Vec<IpAddr>) {
        self.inner.insert(hostname, addrs).await;
    }

    /// Resolve a hostname, using the cache if available.
    /// Falls back to tokio's DNS resolution.
    pub async fn resolve(&self, hostname: &str) -> std::io::Result<Vec<IpAddr>> {
        if let Some(cached) = self.get(hostname).await {
            return Ok(cached);
        }

        let addrs: Vec<IpAddr> = tokio::net::lookup_host(format!("{}:0", hostname))
            .await?
            .map(|sa| sa.ip())
            .collect();

        if !addrs.is_empty() {
            self.insert(hostname.to_string(), addrs.clone()).await;
        }

        Ok(addrs)
    }
}

impl Default for DnsCache {
    fn default() -> Self {
        Self::new(10_000, 300) // 10k entries, 5 min TTL
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_cache_insert_and_get() {
        let cache = DnsCache::new(100, 60);
        let addrs = vec![IpAddr::V4(std::net::Ipv4Addr::new(1, 2, 3, 4))];
        cache.insert("example.com".into(), addrs.clone()).await;
        let result = cache.get("example.com").await;
        assert_eq!(result, Some(addrs));
    }

    #[tokio::test]
    async fn test_cache_miss() {
        let cache = DnsCache::new(100, 60);
        assert!(cache.get("missing.example.com").await.is_none());
    }

    #[tokio::test]
    async fn test_cache_ttl_expiry() {
        // Use 1-second TTL
        let cache = DnsCache::new(100, 1);
        let addrs = vec![IpAddr::V4(std::net::Ipv4Addr::new(10, 0, 0, 1))];
        cache.insert("short-lived.test".into(), addrs).await;
        assert!(cache.get("short-lived.test").await.is_some());

        // Wait for TTL to expire
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        assert!(
            cache.get("short-lived.test").await.is_none(),
            "Cache entry should expire after TTL"
        );
    }

    #[tokio::test]
    async fn test_cache_resolve_localhost() {
        let cache = DnsCache::default();
        let result = cache.resolve("localhost").await;
        assert!(result.is_ok());
        let addrs = result.unwrap();
        assert!(
            !addrs.is_empty(),
            "localhost should resolve to at least one address"
        );
    }

    #[tokio::test]
    async fn test_cache_resolve_caches_result() {
        let cache = DnsCache::default();
        // First call resolves and caches
        let _ = cache.resolve("localhost").await;
        // Second call should hit cache
        let cached = cache.get("localhost").await;
        assert!(cached.is_some(), "Result should be cached after resolve");
    }

    #[tokio::test]
    async fn test_cache_default() {
        let cache = DnsCache::default();
        // Should be usable immediately
        assert!(cache.get("nonexistent").await.is_none());
    }

    #[tokio::test]
    async fn test_cache_ipv6_addresses() {
        let cache = DnsCache::new(100, 60);
        let addrs = vec![IpAddr::V6(std::net::Ipv6Addr::LOCALHOST)];
        cache.insert("ipv6.test".into(), addrs.clone()).await;
        assert_eq!(cache.get("ipv6.test").await, Some(addrs));
    }
}
