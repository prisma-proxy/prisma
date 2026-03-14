//! RTT normalization -- delay transport ACKs to mask the proxy hop.
//!
//! The server measures RTT to mask servers and delays responses to normalize
//! the overall RTT, making the proxy hop invisible to timing analysis.

use std::time::Duration;

/// RTT normalization configuration.
///
/// Given a target RTT and a measured RTT to the mask server, computes the
/// additional delay to insert before forwarding a response so that the
/// overall round-trip time observed by the censor matches the target.
#[derive(Debug, Clone)]
pub struct RttNormalizer {
    /// Target RTT in milliseconds.
    target_ms: u32,
    /// Measured RTT to mask servers (set by PrismaMask health checks).
    mask_rtt_ms: u32,
}

impl RttNormalizer {
    /// Create a new normalizer with the given target RTT.
    ///
    /// The measured mask RTT starts at zero and should be updated via
    /// [`update_mask_rtt`](Self::update_mask_rtt) once health-check data
    /// is available.
    pub fn new(target_ms: u32) -> Self {
        Self {
            target_ms,
            mask_rtt_ms: 0,
        }
    }

    /// Update the measured mask server RTT.
    pub fn update_mask_rtt(&mut self, rtt_ms: u32) {
        self.mask_rtt_ms = rtt_ms;
    }

    /// Return the current target RTT in milliseconds.
    pub fn target_ms(&self) -> u32 {
        self.target_ms
    }

    /// Return the current measured mask server RTT in milliseconds.
    pub fn mask_rtt_ms(&self) -> u32 {
        self.mask_rtt_ms
    }

    /// Compute the delay to apply before sending a response.
    ///
    /// If the target is zero or the measured RTT already exceeds the target,
    /// returns [`Duration::ZERO`].
    pub fn compute_delay(&self) -> Duration {
        if self.target_ms == 0 || self.mask_rtt_ms >= self.target_ms {
            return Duration::ZERO;
        }
        Duration::from_millis((self.target_ms - self.mask_rtt_ms) as u64)
    }

    /// Apply a random jitter to the delay (+/-20%).
    ///
    /// This prevents the normalized RTT from being perfectly constant,
    /// which would itself be a detectable fingerprint.
    pub fn compute_delay_with_jitter(&self) -> Duration {
        let base = self.compute_delay();
        if base.is_zero() {
            return base;
        }
        let base_ms = base.as_millis() as f64;
        let jitter = rand::Rng::gen_range(&mut rand::thread_rng(), -0.2..=0.2);
        let adjusted = (base_ms * (1.0 + jitter)).max(0.0) as u64;
        Duration::from_millis(adjusted)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---- Basic construction ----

    #[test]
    fn test_new_defaults() {
        let n = RttNormalizer::new(200);
        assert_eq!(n.target_ms(), 200);
        assert_eq!(n.mask_rtt_ms(), 0);
    }

    #[test]
    fn test_update_mask_rtt() {
        let mut n = RttNormalizer::new(200);
        n.update_mask_rtt(50);
        assert_eq!(n.mask_rtt_ms(), 50);
    }

    // ---- Delay computation ----

    #[test]
    fn test_compute_delay_basic() {
        let mut n = RttNormalizer::new(200);
        n.update_mask_rtt(50);
        assert_eq!(n.compute_delay(), Duration::from_millis(150));
    }

    #[test]
    fn test_compute_delay_zero_target() {
        let n = RttNormalizer::new(0);
        assert_eq!(n.compute_delay(), Duration::ZERO);
    }

    #[test]
    fn test_compute_delay_mask_exceeds_target() {
        let mut n = RttNormalizer::new(100);
        n.update_mask_rtt(150);
        assert_eq!(n.compute_delay(), Duration::ZERO);
    }

    #[test]
    fn test_compute_delay_mask_equals_target() {
        let mut n = RttNormalizer::new(100);
        n.update_mask_rtt(100);
        assert_eq!(n.compute_delay(), Duration::ZERO);
    }

    #[test]
    fn test_compute_delay_no_mask_rtt_set() {
        // mask_rtt_ms defaults to 0, so full target is the delay.
        let n = RttNormalizer::new(200);
        assert_eq!(n.compute_delay(), Duration::from_millis(200));
    }

    #[test]
    fn test_compute_delay_small_difference() {
        let mut n = RttNormalizer::new(100);
        n.update_mask_rtt(99);
        assert_eq!(n.compute_delay(), Duration::from_millis(1));
    }

    // ---- Jitter tests ----

    #[test]
    fn test_jitter_returns_zero_when_base_is_zero() {
        let mut n = RttNormalizer::new(100);
        n.update_mask_rtt(100);
        // Base delay is zero, jitter should also be zero.
        let d = n.compute_delay_with_jitter();
        assert_eq!(d, Duration::ZERO);
    }

    #[test]
    fn test_jitter_returns_zero_when_target_is_zero() {
        let n = RttNormalizer::new(0);
        let d = n.compute_delay_with_jitter();
        assert_eq!(d, Duration::ZERO);
    }

    #[test]
    fn test_jitter_range() {
        // With target=1000 and mask_rtt=0, base delay = 1000ms.
        // Jitter is +/-20%, so result should be in [800, 1200].
        let n = RttNormalizer::new(1000);
        let base = n.compute_delay();
        assert_eq!(base, Duration::from_millis(1000));

        // Run multiple iterations to validate range statistically.
        for _ in 0..200 {
            let d = n.compute_delay_with_jitter();
            let ms = d.as_millis() as u64;
            assert!(
                ms >= 800 && ms <= 1200,
                "jitter out of +/-20% range: got {}ms, expected 800..=1200",
                ms
            );
        }
    }

    #[test]
    fn test_jitter_is_not_constant() {
        // Run enough iterations that we should see variation if jitter works.
        let n = RttNormalizer::new(1000);
        let mut values = std::collections::HashSet::new();
        for _ in 0..100 {
            let ms = n.compute_delay_with_jitter().as_millis();
            values.insert(ms);
        }
        // With 100 samples from a continuous distribution over 400ms range,
        // we should see many distinct values.
        assert!(
            values.len() > 5,
            "expected jitter to produce varied values, got only {} distinct",
            values.len()
        );
    }

    #[test]
    fn test_jitter_with_small_base() {
        // Base delay of 10ms, jitter should be in [8, 12].
        let mut n = RttNormalizer::new(110);
        n.update_mask_rtt(100);
        assert_eq!(n.compute_delay(), Duration::from_millis(10));

        for _ in 0..100 {
            let d = n.compute_delay_with_jitter();
            let ms = d.as_millis() as u64;
            assert!(
                ms >= 8 && ms <= 12,
                "jitter out of range for small base: got {}ms",
                ms
            );
        }
    }
}
