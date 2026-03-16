use std::sync::{Arc, Mutex};
use tokio::task::JoinHandle;

use crate::connection::ConnectionManager;

pub struct StatsPoller {
    #[allow(dead_code)]
    handle: JoinHandle<()>,
    stop_tx: tokio::sync::oneshot::Sender<()>,
}

type CallbackHolder = crate::CallbackHolder;

impl StatsPoller {
    pub fn start(
        runtime: Arc<crate::runtime::PrismaRuntime>,
        connection: Arc<Mutex<ConnectionManager>>,
        callback: Arc<Mutex<CallbackHolder>>,
    ) -> Self {
        let (stop_tx, mut stop_rx) = tokio::sync::oneshot::channel::<()>();

        let handle = runtime.spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(1));
            loop {
                tokio::select! {
                    _ = interval.tick() => {
                        let json = match connection.lock() {
                            Ok(mut conn) => conn.get_stats_json(),
                            Err(_) => continue,
                        };
                        let holder = callback.lock().unwrap();
                        if let Some(func) = holder.func {
                            if let Ok(cstr) = std::ffi::CString::new(json) {
                                unsafe { func(cstr.as_ptr(), holder.userdata) };
                            }
                        }
                    }
                    _ = &mut stop_rx => break,
                }
            }
        });

        StatsPoller { handle, stop_tx }
    }

    pub fn stop(self) {
        let _ = self.stop_tx.send(());
    }
}
