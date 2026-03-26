/// Sliding-window anti-replay mechanism.
///
/// Uses a configurable bitmap to track recently seen nonce counter values.
/// v4 uses a 1024-bit window; v5 extends this to 2048 bits for better
/// tolerance of high-latency and out-of-order delivery.
///
/// Any nonce below `base` (i.e. more than WINDOW_SIZE behind the highest seen)
/// is rejected as too old. Any nonce already seen within the window is rejected.
///
/// # Thread Safety
///
/// This type is **not** thread-safe. If shared across tasks, wrap in a `Mutex`.
/// In practice, anti-replay windows are per-connection and only accessed from
/// the upload task, so no locking is needed.
pub struct AntiReplayWindow {
    bitmap: Vec<u64>,
    base: u64,
    window_size: u64,
}

/// v4 default window size (1024 bits).
pub const ANTI_REPLAY_WINDOW_V4: u64 = 1024;
/// v5 extended window size (2048 bits) for high-latency connections.
pub const ANTI_REPLAY_WINDOW_V5: u64 = 2048;

impl AntiReplayWindow {
    /// Create a new anti-replay window with the v4 default size (1024 bits).
    pub fn new() -> Self {
        Self::with_window_size(ANTI_REPLAY_WINDOW_V4)
    }

    /// Create a new anti-replay window with the v5 extended size (2048 bits).
    pub fn new_v5() -> Self {
        Self::with_window_size(ANTI_REPLAY_WINDOW_V5)
    }

    /// Create a new anti-replay window with a custom size (must be a multiple of 64).
    pub fn with_window_size(window_size: u64) -> Self {
        let words = (window_size / 64) as usize;
        Self {
            bitmap: vec![0u64; words],
            base: 0,
            window_size,
        }
    }

    /// Check if a nonce counter value is valid (not replayed) and record it.
    /// Returns Ok(()) if the nonce is fresh, Err if replayed or too old.
    pub fn check_and_update(&mut self, counter: u64) -> Result<(), crate::error::ProtocolError> {
        if counter < self.base {
            return Err(crate::error::ProtocolError::ReplayDetected(counter));
        }

        let offset = counter - self.base;

        if offset >= self.window_size {
            // Advance the window
            let shift = offset - self.window_size + 1;
            self.advance(shift);
        }

        let idx = ((counter - self.base) / 64) as usize;
        let bit = (counter - self.base) % 64;

        if idx >= self.bitmap.len() {
            return Err(crate::error::ProtocolError::ReplayDetected(counter));
        }

        if self.bitmap[idx] & (1u64 << bit) != 0 {
            return Err(crate::error::ProtocolError::ReplayDetected(counter));
        }

        self.bitmap[idx] |= 1u64 << bit;
        Ok(())
    }

    /// Returns the window size in bits.
    pub fn window_size(&self) -> u64 {
        self.window_size
    }

    fn advance(&mut self, shift: u64) {
        let bitmap_words = self.bitmap.len();
        if shift >= self.window_size {
            // Entire window is invalidated
            self.bitmap.fill(0);
            self.base += shift;
            return;
        }

        let word_shift = (shift / 64) as usize;
        let bit_shift = (shift % 64) as u32;

        if word_shift > 0 {
            self.bitmap.rotate_left(word_shift);
            for w in &mut self.bitmap[bitmap_words - word_shift..] {
                *w = 0;
            }
        }

        if bit_shift > 0 {
            let mut carry = 0u64;
            for w in self.bitmap.iter_mut().rev() {
                let new_carry = *w << (64 - bit_shift);
                *w = (*w >> bit_shift) | carry;
                carry = new_carry;
            }
        }

        self.base += shift;
    }
}

impl Default for AntiReplayWindow {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sequential_nonces() {
        let mut window = AntiReplayWindow::new();
        for i in 0..100 {
            assert!(window.check_and_update(i).is_ok(), "nonce {} rejected", i);
        }
    }

    #[test]
    fn test_replay_detected() {
        let mut window = AntiReplayWindow::new();
        assert!(window.check_and_update(5).is_ok());
        assert!(window.check_and_update(5).is_err()); // replay
    }

    #[test]
    fn test_old_nonce_rejected() {
        let mut window = AntiReplayWindow::new();
        // Advance past the window
        assert!(window.check_and_update(2000).is_ok());
        // Old nonce should be rejected
        assert!(window.check_and_update(0).is_err());
    }

    #[test]
    fn test_out_of_order_within_window() {
        let mut window = AntiReplayWindow::new();
        assert!(window.check_and_update(10).is_ok());
        assert!(window.check_and_update(5).is_ok()); // within window, not seen
        assert!(window.check_and_update(8).is_ok());
        assert!(window.check_and_update(5).is_err()); // already seen
    }

    #[test]
    fn test_window_advance() {
        let mut window = AntiReplayWindow::new();
        for i in 0..500 {
            assert!(window.check_and_update(i).is_ok());
        }
        // Jump ahead
        assert!(window.check_and_update(2000).is_ok());
        // Old values should be rejected
        assert!(window.check_and_update(400).is_err());
        // Values near the new high should work
        assert!(window.check_and_update(1999).is_ok());
    }

    #[test]
    fn test_v5_extended_window() {
        let mut window = AntiReplayWindow::new_v5();
        assert_eq!(window.window_size(), 2048);

        // Sequential should work
        for i in 0..200 {
            assert!(window.check_and_update(i).is_ok());
        }

        // Replay should be detected
        assert!(window.check_and_update(100).is_err());

        // Jump ahead and verify the extended window accepts more out-of-order
        assert!(window.check_and_update(3000).is_ok());
        // 3000 - 2048 + 1 = 953, so nonce 953 should be at the edge
        assert!(window.check_and_update(954).is_ok());
        // Nonce 952 should be too old
        assert!(window.check_and_update(952).is_err());
    }

    #[test]
    fn test_custom_window_size() {
        let mut window = AntiReplayWindow::with_window_size(512);
        assert_eq!(window.window_size(), 512);

        for i in 0..100 {
            assert!(window.check_and_update(i).is_ok());
        }
        assert!(window.check_and_update(50).is_err());
    }
}
