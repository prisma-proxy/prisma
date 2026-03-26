---
sidebar_position: 10
---

# Plugin System Architecture (RFC)

> **Status:** Design draft. Not yet implemented. This document outlines the architecture for a future plugin system.

## Motivation

Prisma's core is intentionally opinionated — PrismaVeil v5 protocol, specific transports, built-in routing. However, advanced deployments benefit from extensibility:

- **Custom transports** — proprietary or experimental transport protocols
- **Custom auth providers** — LDAP, OAuth2, hardware token integration
- **Custom route resolvers** — dynamic routing based on external services (GeoIP APIs, threat feeds)
- **Custom metrics exporters** — integration with Datadog, New Relic, custom dashboards

## Plugin Interface

Plugins implement one or more **traits** defined in `prisma-core`:

```rust
/// A transport plugin handles the wire-level connection.
#[async_trait]
pub trait TransportPlugin: Send + Sync {
    fn name(&self) -> &str;
    fn protocol_id(&self) -> u8;
    async fn accept(&self, stream: TcpStream) -> Result<Box<dyn AsyncReadWrite>>;
    async fn connect(&self, addr: &str) -> Result<Box<dyn AsyncReadWrite>>;
}

/// An auth plugin validates client credentials.
#[async_trait]
pub trait AuthPlugin: Send + Sync {
    fn name(&self) -> &str;
    async fn authenticate(&self, client_id: &str, secret: &[u8]) -> Result<AuthDecision>;
}

/// A route resolver plugin determines the action for a connection.
#[async_trait]
pub trait RoutePlugin: Send + Sync {
    fn name(&self) -> &str;
    async fn resolve(&self, destination: &str, client_id: &str) -> Result<RouteAction>;
}
```

## Loading Mechanism

Plugins are loaded as **dynamic shared libraries** (`.so` on Linux, `.dll` on Windows, `.dylib` on macOS) using the `libloading` crate:

```rust
use libloading::{Library, Symbol};

unsafe fn load_plugin(path: &Path) -> Result<Box<dyn TransportPlugin>> {
    let lib = Library::new(path)?;
    let create: Symbol<fn() -> Box<dyn TransportPlugin>> = lib.get(b"create_transport")?;
    Ok(create())
}
```

Each plugin shared library exports a C-compatible creation function:

```rust
#[no_mangle]
pub extern "C" fn create_transport() -> Box<dyn TransportPlugin> {
    Box::new(MyCustomTransport::new())
}
```

## Configuration

Plugins are configured in `server.toml`:

```toml
[[plugins]]
name = "my-transport"
path = "/opt/prisma/plugins/libmy_transport.so"
type = "transport"

[plugins.config]
custom_key = "custom_value"
```

The `[plugins.config]` section is passed as a `toml::Value` to the plugin's `init()` method.

## Plugin Lifecycle

1. **Load** — Server reads `[[plugins]]` from config, loads each `.so`
2. **Init** — Calls `plugin.init(config)` with the plugin's config section
3. **Register** — Plugin registers itself with the appropriate subsystem (transport registry, auth chain, route resolver chain)
4. **Run** — Plugin is called during normal operation (accept connections, authenticate clients, resolve routes)
5. **Shutdown** — Server calls `plugin.shutdown()` before unloading

## Security Considerations

- **Sandboxing**: Plugins run in the same process. A malicious plugin can access all memory. Only load trusted plugins.
- **API stability**: Plugin trait interfaces must be versioned. Breaking changes require a major version bump.
- **Resource limits**: Consider adding resource quotas (max memory, max connections) per plugin.
- **Audit logging**: All plugin loads/unloads should be logged with the plugin path and hash.

## Implementation Phases

1. **Phase 1**: Define trait interfaces in `prisma-core` (no dynamic loading)
2. **Phase 2**: Add `libloading` integration and `[[plugins]]` config parsing
3. **Phase 3**: Example plugins (echo transport, file-based auth)
4. **Phase 4**: Plugin SDK with build tooling and documentation

## Alternatives Considered

- **WASM plugins**: More secure (sandboxed), but slower and limited async support
- **gRPC plugin protocol**: Like HashiCorp's go-plugin. Process isolation but high latency.
- **Lua scripting**: Lightweight but limited Rust interop and no async support.

The dynamic library approach was chosen for maximum performance and full Rust ecosystem access, at the cost of requiring trust in plugin authors.
