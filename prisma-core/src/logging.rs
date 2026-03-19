use std::sync::OnceLock;

use tracing_subscriber::layer::Layer as _;
use tracing_subscriber::reload;
use tracing_subscriber::{fmt, EnvFilter};

use crate::state::LogEntry;

/// Global reload handle for swapping the EnvFilter at runtime.
static FILTER_HANDLE: OnceLock<reload::Handle<EnvFilter, tracing_subscriber::Registry>> =
    OnceLock::new();

/// Inner subscriber type layered with the reloadable `EnvFilter`.
type FilteredRegistry = tracing_subscriber::layer::Layered<
    reload::Layer<EnvFilter, tracing_subscriber::Registry>,
    tracing_subscriber::Registry,
>;

/// Global reload handle for swapping the BroadcastLayer at runtime.
static BROADCAST_HANDLE: OnceLock<reload::Handle<BroadcastLayer, FilteredRegistry>> =
    OnceLock::new();

/// Update the log level filter at runtime (safe to call on reconnect).
pub fn update_log_level(level: &str) {
    if let Some(handle) = FILTER_HANDLE.get() {
        let _ = handle.reload(EnvFilter::new(level));
    }
}

/// Update the broadcast sender at runtime (safe to call on reconnect).
pub fn update_broadcast_tx(tx: tokio::sync::broadcast::Sender<LogEntry>) {
    if let Some(handle) = BROADCAST_HANDLE.get() {
        let _ = handle.reload(BroadcastLayer { tx });
    }
}

/// Initialize the logging/tracing system.
///
/// `level` is one of: trace, debug, info, warn, error
/// `format` is one of: pretty, json
pub fn init_logging(level: &str, format: &str) {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(level));

    // Use try_init to avoid panicking if a global subscriber is already set.
    let _ = match format {
        "json" => fmt().with_env_filter(filter).json().try_init(),
        _ => fmt().with_env_filter(filter).pretty().try_init(),
    };
}

/// Initialize logging with a broadcast layer for GUI/FFI.
///
/// On first call: installs the global subscriber with reloadable filter
/// and broadcast layers. On subsequent calls: hot-swaps the filter level
/// and broadcast sender so that reconnections pick up new settings.
pub fn init_logging_with_broadcast(
    level: &str,
    format: &str,
    log_tx: tokio::sync::broadcast::Sender<LogEntry>,
) {
    use tracing_subscriber::layer::SubscriberExt;
    use tracing_subscriber::util::SubscriberInitExt;

    // If already initialized, just hot-swap the filter + broadcast sender.
    if FILTER_HANDLE.get().is_some() {
        update_log_level(level);
        update_broadcast_tx(log_tx);
        return;
    }

    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(level));
    let (filter_layer, filter_handle) = reload::Layer::new(filter);
    let broadcast_layer = BroadcastLayer { tx: log_tx };
    let (broadcast_reload, broadcast_handle) = reload::Layer::new(broadcast_layer);

    let fmt_layer = match format {
        "json" => fmt::layer().json().boxed(),
        _ => fmt::layer().pretty().boxed(),
    };
    let registry = tracing_subscriber::registry()
        .with(filter_layer)
        .with(broadcast_reload)
        .with(fmt_layer);

    if registry.try_init().is_ok() {
        let _ = FILTER_HANDLE.set(filter_handle);
        let _ = BROADCAST_HANDLE.set(broadcast_handle);
    }
}

/// Tracing layer that broadcasts log events.
struct BroadcastLayer {
    tx: tokio::sync::broadcast::Sender<LogEntry>,
}

impl<S> tracing_subscriber::Layer<S> for BroadcastLayer
where
    S: tracing::Subscriber,
{
    fn on_event(
        &self,
        event: &tracing::Event<'_>,
        _ctx: tracing_subscriber::layer::Context<'_, S>,
    ) {
        // Skip all work when nobody is listening
        if self.tx.receiver_count() == 0 {
            return;
        }

        let mut visitor = MessageVisitor(String::new());
        event.record(&mut visitor);

        let entry = LogEntry {
            timestamp: chrono::Utc::now(),
            level: event.metadata().level().to_string(),
            target: event.metadata().target().to_string(),
            message: visitor.0,
        };

        let _ = self.tx.send(entry);
    }
}

struct MessageVisitor(String);

impl tracing::field::Visit for MessageVisitor {
    fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn std::fmt::Debug) {
        if !self.0.is_empty() {
            self.0.push(' ');
        }
        if field.name() == "message" {
            self.0.push_str(&format!("{:?}", value));
        } else {
            self.0.push_str(&format!("{}={:?}", field.name(), value));
        }
    }

    fn record_str(&mut self, field: &tracing::field::Field, value: &str) {
        if !self.0.is_empty() {
            self.0.push(' ');
        }
        if field.name() == "message" {
            self.0.push_str(value);
        } else {
            self.0.push_str(&format!("{}={}", field.name(), value));
        }
    }
}
