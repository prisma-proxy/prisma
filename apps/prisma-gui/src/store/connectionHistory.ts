import { create } from "zustand";
import { persist } from "zustand/middleware";

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

export const useConnectionHistory = create<ConnectionHistoryStore>()(
  persist(
    (set) => ({
      events: [],

      add: (event) =>
        set((state) => ({
          events: [...state.events.slice(-(MAX_EVENTS - 1)), event],
        })),

      clear: () => set({ events: [] }),
    }),
    { name: "prisma-connection-history" }
  )
);
