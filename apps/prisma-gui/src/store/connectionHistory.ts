import { create } from "zustand";

export interface ConnectionEvent {
  profileId: string;
  profileName: string;
  action: "connect" | "disconnect";
  timestamp: number;
  latencyMs?: number;
  sessionBytes?: { up: number; down: number };
}

interface ConnectionHistoryStore {
  events: ConnectionEvent[];
  add: (event: ConnectionEvent) => void;
  clear: () => void;
}

const MAX_EVENTS = 200;
const STORAGE_KEY = "prisma-connection-history";

// --- Debounced manual persist ---
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function schedulePersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const { events } = useConnectionHistory.getState();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: { events }, version: 0 }));
    } catch { /* quota exceeded */ }
  }, 5_000);
}

function hydrateEvents(): ConnectionEvent[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.state?.events)) return parsed.state.events;
    }
  } catch { /* corrupt data */ }
  return [];
}

export const useConnectionHistory = create<ConnectionHistoryStore>()(
  (set) => ({
    events: hydrateEvents(),

    add: (event) => {
      set((state) => ({
        events: [...state.events.slice(-(MAX_EVENTS - 1)), event],
      }));
      schedulePersist();
    },

    clear: () => {
      set({ events: [] });
      schedulePersist();
    },
  })
);
