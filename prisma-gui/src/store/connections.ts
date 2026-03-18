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
  nextId: number;

  addConnection: (conn: Omit<TrackedConnection, "id">) => void;
  closeConnection: (destination: string) => void;
  clearAll: () => void;
  clearClosed: () => void;
}

const MAX_CONNECTIONS = 1000;

export const useConnections = create<ConnectionsStore>((set) => ({
  connections: [],
  nextId: 1,

  addConnection: (conn) =>
    set((state) => {
      const id = `conn-${state.nextId}`;
      const newConn = { ...conn, id };
      const updated = [...state.connections, newConn];
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
        return { connections: filtered, nextId: state.nextId + 1 };
      }
      return { connections: updated, nextId: state.nextId + 1 };
    }),

  closeConnection: (destination) =>
    set((state) => ({
      connections: state.connections.map((c) =>
        c.status === "active" && c.destination === destination
          ? { ...c, status: "closed" as const, closedAt: Date.now() }
          : c
      ),
    })),

  clearAll: () => set({ connections: [] }),

  clearClosed: () =>
    set((state) => ({
      connections: state.connections.filter((c) => c.status === "active"),
    })),
}));

// --- Log message parser ---

// Matches: SOCKS5 CONNECT <dest>, HTTP CONNECT <dest>
const CONNECT_RE = /^(SOCKS5|HTTP) CONNECT$/;
// Matches: ... CONNECT direct (bypassing proxy) — dest in structured field
const DIRECT_RE = /^(SOCKS5|HTTP) CONNECT direct \(bypassing proxy\)$/;
// Matches: ... CONNECT blocked by routing rule
const BLOCKED_RE = /^(SOCKS5|HTTP) CONNECT blocked by routing rule$/;
// Relay ended
const RELAY_END_RE = /^(Relay|Direct relay|TUN TCP relay) session ended$/;

/**
 * Parse a log message and update the connections store if applicable.
 * Log messages from prisma-client contain structured tracing fields
 * formatted as key=value pairs at the start, e.g.: `dest=example.com:443 SOCKS5 CONNECT`
 */
export function parseLogForConnection(msg: string): void {
  // Cheap pre-check: skip the vast majority of log messages that aren't connection-related
  if (!msg.includes("CONNECT") && !msg.includes("session ended")) return;

  const store = useConnections.getState();

  // Extract structured fields from the log message
  // Format: "key=value key2=value2 actual message text"
  const fields: Record<string, string> = {};
  let textPart = msg;

  // Parse key=value or key="quoted value" fields at the start
  const fieldRe = /^(\w+)=((?:"[^"]*")|(?:\S+))\s*/;
  let match: RegExpMatchArray | null;
  while ((match = textPart.match(fieldRe))) {
    let val = match[2];
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    fields[match[1]] = val;
    textPart = textPart.slice(match[0].length);
  }

  const dest = fields["dest"] || "";
  const transport = fields["transport"] || "";

  // Proxy connection (routed through tunnel)
  if (CONNECT_RE.test(textPart) && dest) {
    const source = textPart.startsWith("SOCKS5") ? "SOCKS5" : "HTTP";
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
    // Extract domain (strip port)
    const domain = dest.replace(/:\d+$/, "");
    useAnalytics.getState().addTraffic(domain, 0, 0, rule);
    return;
  }

  // Direct connection (bypassing proxy)
  if (DIRECT_RE.test(textPart) && dest) {
    const source = textPart.startsWith("SOCKS5") ? "SOCKS5" : "HTTP";
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
  if (BLOCKED_RE.test(textPart) && dest) {
    const source = textPart.startsWith("SOCKS5") ? "SOCKS5" : "HTTP";
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

  // Relay session ended — close the most recent active connection
  if (RELAY_END_RE.test(textPart)) {
    const conns = store.connections;
    // Close the oldest active connection (FIFO)
    const active = conns.find((c) => c.status === "active");
    if (active) {
      store.closeConnection(active.destination);
    }
  }
}
