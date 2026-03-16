use std::sync::Arc;
use tokio::runtime::Runtime;
use anyhow::Result;

pub struct PrismaRuntime {
    inner: Arc<Runtime>,
}

impl PrismaRuntime {
    pub fn new() -> Result<Self> {
        let rt = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .thread_name("prisma-ffi")
            .build()?;
        Ok(Self { inner: Arc::new(rt) })
    }

    pub fn spawn<F>(&self, fut: F) -> tokio::task::JoinHandle<F::Output>
    where
        F: std::future::Future + Send + 'static,
        F::Output: Send + 'static,
    {
        self.inner.spawn(fut)
    }

    pub fn block_on<F: std::future::Future>(&self, fut: F) -> F::Output {
        self.inner.block_on(fut)
    }

    pub fn handle(&self) -> tokio::runtime::Handle {
        self.inner.handle().clone()
    }
}
