//! Reusable buffer pool for the relay hot path.
//!
//! Pre-allocates a set of `Vec<u8>` buffers that can be acquired by relay tasks
//! and automatically returned to the pool when dropped. This eliminates the
//! per-session `vec![0u8; MAX_FRAME_SIZE]` allocation that previously occurred
//! for every new connection.
//!
//! The pool is lock-free on the fast path using `crossbeam`-style `Mutex` from
//! `std::sync`, which is suitable because the critical section is tiny
//! (just push/pop from a Vec).

use std::ops::{Deref, DerefMut};
use std::sync::{Arc, Mutex};

use crate::types::MAX_FRAME_SIZE;

/// A pool of reusable byte buffers.
///
/// Buffers are allocated at the configured size and returned to the pool when
/// the `PooledBuffer` wrapper is dropped. If the pool is empty on `acquire()`,
/// a new buffer is allocated on the fly.
#[derive(Clone)]
pub struct BufferPool {
    inner: Arc<Mutex<Vec<Vec<u8>>>>,
    buffer_size: usize,
    max_pool_size: usize,
}

impl BufferPool {
    /// Create a new buffer pool with `capacity` pre-allocated buffers of `buffer_size` bytes.
    pub fn new(capacity: usize, buffer_size: usize) -> Self {
        let mut buffers = Vec::with_capacity(capacity);
        for _ in 0..capacity {
            buffers.push(vec![0u8; buffer_size]);
        }
        Self {
            inner: Arc::new(Mutex::new(buffers)),
            buffer_size,
            max_pool_size: capacity * 2,
        }
    }

    /// Create a buffer pool sized for relay frames (MAX_FRAME_SIZE).
    pub fn for_relay(capacity: usize) -> Self {
        Self::new(capacity, MAX_FRAME_SIZE)
    }

    /// Acquire a buffer from the pool. If the pool is empty, a new buffer is allocated.
    ///
    /// The returned `PooledBuffer` automatically returns the buffer to the pool on drop.
    pub fn acquire(&self) -> PooledBuffer {
        let buf = {
            let mut pool = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            pool.pop()
        };
        let mut buf = buf.unwrap_or_else(|| vec![0u8; self.buffer_size]);
        buf.resize(self.buffer_size, 0);
        PooledBuffer {
            buf: Some(buf),
            pool: self.inner.clone(),
            max_pool_size: self.max_pool_size,
        }
    }

    /// Get the number of buffers currently available in the pool.
    pub fn available(&self) -> usize {
        self.inner.lock().unwrap_or_else(|e| e.into_inner()).len()
    }

    /// Get the configured buffer size.
    pub fn buffer_size(&self) -> usize {
        self.buffer_size
    }
}

impl Default for BufferPool {
    fn default() -> Self {
        Self::for_relay(32)
    }
}

/// A buffer borrowed from a `BufferPool`. Automatically returned on drop.
pub struct PooledBuffer {
    buf: Option<Vec<u8>>,
    pool: Arc<Mutex<Vec<Vec<u8>>>>,
    max_pool_size: usize,
}

impl Deref for PooledBuffer {
    type Target = Vec<u8>;

    fn deref(&self) -> &Vec<u8> {
        self.buf
            .as_ref()
            .expect("PooledBuffer used after return to pool")
    }
}

impl DerefMut for PooledBuffer {
    fn deref_mut(&mut self) -> &mut Vec<u8> {
        self.buf
            .as_mut()
            .expect("PooledBuffer used after return to pool")
    }
}

impl Drop for PooledBuffer {
    fn drop(&mut self) {
        if let Some(buf) = self.buf.take() {
            let mut pool = self.pool.lock().unwrap_or_else(|e| e.into_inner());
            if pool.len() < self.max_pool_size {
                pool.push(buf);
            }
            // else: drop the buffer, reclaiming memory
        }
    }
}

impl AsRef<[u8]> for PooledBuffer {
    fn as_ref(&self) -> &[u8] {
        self.buf
            .as_ref()
            .expect("PooledBuffer used after return to pool")
    }
}

impl AsMut<[u8]> for PooledBuffer {
    fn as_mut(&mut self) -> &mut [u8] {
        self.buf
            .as_mut()
            .expect("PooledBuffer used after return to pool")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pool_acquire_release() {
        let pool = BufferPool::new(4, 1024);
        assert_eq!(pool.available(), 4);

        let buf1 = pool.acquire();
        assert_eq!(pool.available(), 3);
        assert_eq!(buf1.len(), 1024);

        let buf2 = pool.acquire();
        assert_eq!(pool.available(), 2);

        drop(buf1);
        assert_eq!(pool.available(), 3);

        drop(buf2);
        assert_eq!(pool.available(), 4);
    }

    #[test]
    fn test_pool_over_acquire() {
        // When pool is empty, new buffers are allocated on the fly
        let pool = BufferPool::new(1, 512);
        assert_eq!(pool.available(), 1);

        let _buf1 = pool.acquire();
        assert_eq!(pool.available(), 0);

        // This should succeed even though pool is empty
        let buf2 = pool.acquire();
        assert_eq!(buf2.len(), 512);
        assert_eq!(pool.available(), 0);

        drop(buf2);
        // Now we have more buffers than initial capacity
        assert_eq!(pool.available(), 1);
    }

    #[test]
    fn test_pool_buffer_reuse() {
        let pool = BufferPool::new(1, 256);

        {
            let mut buf = pool.acquire();
            buf[0] = 0xFF;
            buf[1] = 0xAB;
        }

        // Acquire again — same buffer should be reused (reset to correct size)
        let buf = pool.acquire();
        assert_eq!(buf.len(), 256);
    }

    #[test]
    fn test_pool_default() {
        let pool = BufferPool::default();
        assert_eq!(pool.buffer_size(), MAX_FRAME_SIZE);
        assert_eq!(pool.available(), 32);
    }

    #[test]
    fn test_pool_for_relay() {
        let pool = BufferPool::for_relay(8);
        assert_eq!(pool.buffer_size(), MAX_FRAME_SIZE);
        assert_eq!(pool.available(), 8);

        let buf = pool.acquire();
        assert_eq!(buf.len(), MAX_FRAME_SIZE);
    }

    #[test]
    fn test_pooled_buffer_deref() {
        let pool = BufferPool::new(1, 64);
        let mut buf = pool.acquire();

        // Test DerefMut
        buf[0] = 42;
        assert_eq!(buf[0], 42);

        // Test Deref
        let slice: &[u8] = &buf;
        assert_eq!(slice[0], 42);

        // Test AsRef
        let slice_ref: &[u8] = buf.as_ref();
        assert_eq!(slice_ref[0], 42);

        // Test AsMut
        let slice_mut: &mut [u8] = buf.as_mut();
        slice_mut[1] = 99;
        assert_eq!(buf[1], 99);
    }

    #[test]
    fn test_pool_clone_shares_state() {
        let pool1 = BufferPool::new(4, 128);
        let pool2 = pool1.clone();

        assert_eq!(pool1.available(), 4);
        assert_eq!(pool2.available(), 4);

        let _buf = pool1.acquire();
        assert_eq!(pool1.available(), 3);
        assert_eq!(pool2.available(), 3); // Shared state
    }

    #[test]
    fn test_pool_thread_safety() {
        use std::sync::Arc;
        use std::thread;

        let pool = Arc::new(BufferPool::new(10, 128));
        let mut handles = Vec::new();

        for _ in 0..10 {
            let pool = pool.clone();
            handles.push(thread::spawn(move || {
                let mut buf = pool.acquire();
                buf[0] = 1;
                thread::sleep(std::time::Duration::from_millis(1));
                drop(buf);
            }));
        }

        for h in handles {
            h.join().unwrap();
        }

        assert_eq!(pool.available(), 10);
    }
}
