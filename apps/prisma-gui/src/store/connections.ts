import { create } from "zustand";
import { useAnalytics } from "./analytics";

export type ConnectionAction = "proxy" | "direct" | "blocked";
export type ConnectionStatus = "active" | "closed";

export interface TrackedConnection {
  id: string;
  destination: string;
  action: ConnectionAction;
  rule: string;
  transport: string;
  status: ConnectionStatus;
  startedAt: number;
  closedAt: number | null;
  bytesDown: number;
  bytesUp: number;
}

interface ConnectionsStore {
  connections: TrackedConnection[];
  activeCount: number;
  nextId: number;

  addConnection: (conn: Omit<TrackedConnection, "id">) => void;
  closeConnection: (destination: string) => void;
  closeConnectionById: (id: string) => void;
  closeAllActive: () => void;
  clearAll: () => void;
  clearClosed: () => void;
}

const MAX_CONNECTIONS = 1000;

export const useConnections = create<ConnectionsStore>((set) => ({
  connections: [],
  activeCount: 0,
  nextId: 1,

  addConnection: (conn) =>
    set((state) => {
      const id = `conn-${state.nextId}`;
      const newConn = { ...conn, id };
      const updated = [...state.connections, newConn];
      const delta = conn.status === "active" ? 1 : 0;
      // Trim old closed connections if over limit
      if (updated.length > MAX_CONNECTIONS) {
        const closedToRemove = updated.length - MAX_CONNECTIONS;
        let removed = 0;
        const filtered = updated.filter((c) => {
          if (removed >= closedToRemove) return true;
          if (c.status === "closed") {
            removed++;
            return false;
          }
          return true;
        });
        return { connections: filtered, activeCount: state.activeCount + delta, nextId: state.nextId + 1 };
      }
      return { connections: updated, activeCount: state.activeCount + delta, nextId: state.nextId + 1 };
    }),

  closeConnection: (destination) =>
    set((state) => {
      let closed = 0;
      const connections = state.connections.map((c) => {
        if (c.status === "active" && c.destination === destination) {
          closed++;
          return { ...c, status: "closed" as const, closedAt: Date.now() };
        }
        return c;
      });
      return { connections, activeCount: state.activeCount - closed };
    }),

  closeConnectionById: (id) =>
    set((state) => {
      let closed = 0;
      const connections = state.connections.map((c) => {
        if (c.id === id && c.status === "active") {
          closed++;
          return { ...c, status: "closed" as const, closedAt: Date.now() };
        }
        return c;
      });
      return { connections, activeCount: state.activeCount - closed };
    }),

  closeAllActive: () =>
    set((state) => ({
      connections: state.connections.map((c) =>
        c.status === "active"
          ? { ...c, status: "closed" as const, closedAt: Date.now() }
          : c
      ),
      activeCount: 0,
    })),

  clearAll: () => set({ connections: [], activeCount: 0 }),

  clearClosed: () =>
    set((state) => ({
      connections: state.connections.filter((c) => c.status === "active"),
    })),
}));

// --- Log message parser ---
//
// Rust's tracing crate with BroadcastLayer (crates/prisma-core/src/logging.rs) formats
// log messages as: message first, then structured key=value fields.
//
// The `message` field from string literals passes through `record_debug` which
// wraps it in quotes via `format!("{:?}", value)`.  Fields using `%` (Display)
// go through `record_str` and appear unquoted.
//
// Examples of actual log messages reaching the frontend:
//   "SOCKS5 CONNECT" dest=example.com:443
//   "SOCKS5 CONNECT direct (bypassing proxy)" dest=1.2.3.4:80
//   "SOCKS5 CONNECT blocked by routing rule" dest=ads.example.com:443
//   "HTTP CONNECT" dest=example.com:443
//   "TUN tunnel established" dest=example.com:443
//   "Relay session ended"
//   "Direct relay session ended"
//   "TUN TCP relay session ended"
//   "Connected to server" server=1.2.3.4:8443 transport=QUIC

// Matches the text part (after stripping quotes)
const CONNECT_RE = /^(SOCKS5|HTTP) CONNECT$/;
const DIRECT_RE = /^(SOCKS5|HTTP) CONNECT direct \(bypassing proxy\)$/;
const BLOCKED_RE = /^(SOCKS5|HTTP) CONNECT blocked by routing rule$/;
const TUN_CONNECT_RE = /^TUN tunnel established$/;
const RELAY_END_RE = /^(Relay|Direct relay|TUN TCP relay) session ended$/;

/**
 * Parse structured fields from a tracing log message.
 *
 * Tracing BroadcastLayer format: `"message text" key=value key2=value2`
 * - The message part may be wrapped in double quotes (from record_debug)
 *   or appear bare (from record_str).
 * - Structured fields follow as `key=value` or `key="quoted value"` pairs.
 *
 * Returns { text, fields } where text is the unquoted message text and
 * fields is a map of key-value pairs.
 */
function parseTracingMessage(msg: string): { text: string; fields: Record<string, string> } {
  const fields: Record<string, string> = {};
  let rest = msg;
  let text = "";

  // Try to extract a leading quoted message: "some text"
  const quotedMsgRe = /^"([^"]*)"(.*)$/;
  const qm = rest.match(quotedMsgRe);
  if (qm) {
    text = qm[1];
    rest = qm[2].trimStart();
  } else {
    // No leading quoted message — the entire string might be bare text with
    // fields appended.  Try to split at the first key=value boundary.
    // Look for ` word=` pattern to find where fields start.
    const fieldStart = rest.search(/\s\w+=/);
    if (fieldStart > 0) {
      text = rest.slice(0, fieldStart);
      rest = rest.slice(fieldStart).trimStart();
    } else {
      text = rest;
      rest = "";
    }
  }

  // Parse remaining key=value pairs
  const fieldRe = /^(\w+)=((?:"[^"]*")|(?:\S+))\s*/;
  let match: RegExpMatchArray | null;
  while ((match = rest.match(fieldRe))) {
    let val = match[2];
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    fields[match[1]] = val;
    rest = rest.slice(match[0].length);
  }

  return { text, fields };
}

/**
 * Parse a log message and update the connections store if applicable.
 */
export function parseLogForConnection(msg: string): void {
  // Cheap pre-check: skip the vast majority of log messages that aren't connection-related
  if (!msg.includes("CONNECT") && !msg.includes("session ended") && !msg.includes("TUN tunnel")) return;

  const store = useConnections.getState();
  const { text, fields } = parseTracingMessage(msg);

  const dest = fields["dest"] || "";
  const transport = fields["transport"] || "";

  // Proxy connection (routed through tunnel)
  if (CONNECT_RE.test(text) && dest) {
    const source = text.startsWith("SOCKS5") ? "SOCKS5" : "HTTP";
    const rule = source;
    store.addConnection({
      destination: dest,
      action: "proxy",
      rule,
      transport: transport || source,
      status: "active",
      startedAt: Date.now(),
      closedAt: null,
      bytesDown: 0,
      bytesUp: 0,
    });
    const domain = dest.replace(/:\d+$/, "");
    useAnalytics.getState().addTraffic(domain, 0, 0, rule);
    return;
  }

  // Direct connection (bypassing proxy)
  if (DIRECT_RE.test(text) && dest) {
    const source = text.startsWith("SOCKS5") ? "SOCKS5" : "HTTP";
    const rule = `${source} / Direct`;
    store.addConnection({
      destination: dest,
      action: "direct",
      rule,
      transport: "Direct",
      status: "active",
      startedAt: Date.now(),
      closedAt: null,
      bytesDown: 0,
      bytesUp: 0,
    });
    const domain = dest.replace(/:\d+$/, "");
    useAnalytics.getState().addTraffic(domain, 0, 0, rule);
    return;
  }

  // Blocked connection
  if (BLOCKED_RE.test(text) && dest) {
    const source = text.startsWith("SOCKS5") ? "SOCKS5" : "HTTP";
    const rule = `${source} / Block`;
    store.addConnection({
      destination: dest,
      action: "blocked",
      rule,
      transport: "Blocked",
      status: "closed",
      startedAt: Date.now(),
      closedAt: Date.now(),
      bytesDown: 0,
      bytesUp: 0,
    });
    const domain = dest.replace(/:\d+$/, "");
    useAnalytics.getState().addTraffic(domain, 0, 0, rule);
    return;
  }

  // TUN tunnel established (tracked like proxy connections)
  if (TUN_CONNECT_RE.test(text) && dest) {
    const rule = "TUN";
    store.addConnection({
      destination: dest,
      action: "proxy",
      rule,
      transport: transport || "TUN",
      status: "active",
      startedAt: Date.now(),
      closedAt: null,
      bytesDown: 0,
      bytesUp: 0,
    });
    const domain = dest.replace(/:\d+$/, "");
    useAnalytics.getState().addTraffic(domain, 0, 0, rule);
    return;
  }

  // Relay session ended — close the oldest active connection (FIFO)
  if (RELAY_END_RE.test(text)) {
    const conns = store.connections;
    const active = conns.find((c) => c.status === "active");
    if (active) {
      store.closeConnection(active.destination);
    }
  }
}
