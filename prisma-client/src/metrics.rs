use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

/// Shared client-side traffic metrics for the GUI/FFI layer.
#[derive(Clone)]
pub struct ClientMetrics {
    pub bytes_up: Arc<AtomicU64>,
    pub bytes_down: Arc<AtomicU64>,
}

impl ClientMetrics {
    pub fn new() -> Self {
        Self {
            bytes_up: Arc::new(AtomicU64::new(0)),
            bytes_down: Arc::new(AtomicU64::new(0)),
        }
    }

    pub fn add_up(&self, n: u64) {
        self.bytes_up.fetch_add(n, Ordering::Relaxed);
    }

    pub fn add_down(&self, n: u64) {
        self.bytes_down.fetch_add(n, Ordering::Relaxed);
    }

    pub fn get_up(&self) -> u64 {
        self.bytes_up.load(Ordering::Relaxed)
    }

    pub fn get_down(&self) -> u64 {
        self.bytes_down.load(Ordering::Relaxed)
    }

    pub fn reset(&self) {
        self.bytes_up.store(0, Ordering::Relaxed);
        self.bytes_down.store(0, Ordering::Relaxed);
    }
}

impl Default for ClientMetrics {
    fn default() -> Self {
        Self::new()
    }
}
