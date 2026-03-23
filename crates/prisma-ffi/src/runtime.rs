use anyhow::Result;
use tokio::runtime::Runtime;

pub struct PrismaRuntime {
    inner: Runtime,
}

impl PrismaRuntime {
    pub fn new() -> Result<Self> {
        let inner = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .thread_name("prisma-ffi")
            .build()?;
        Ok(Self { inner })
    }

    pub fn spawn<F>(&self, fut: F) -> tokio::task::JoinHandle<F::Output>
    where
        F: std::future::Future + Send + 'static,
        F::Output: Send + 'static,
    {
        self.inner.spawn(fut)
    }

    #[allow(dead_code)]
    pub fn block_on<F: std::future::Future>(&self, fut: F) -> F::Output {
        self.inner.block_on(fut)
    }

    #[allow(dead_code)]
    pub fn handle(&self) -> tokio::runtime::Handle {
        self.inner.handle().clone()
    }
}
