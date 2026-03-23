import { create } from "zustand";

export interface Notification {
  id: string;
  type: "info" | "success" | "error" | "warning";
  message: string;
  timestamp: number;
  autoDismissMs: number;
}

interface NotificationStore {
  items: Notification[];
  current: Notification | null;
  lastSeenTimestamp: number;
  push: (type: Notification["type"], message: string) => void;
  dismiss: (id: string) => void;
  markSeen: () => void;
  clearAll: () => void;
}

const MAX_ITEMS = 50;

export const useNotifications = create<NotificationStore>((set) => ({
  items: [],
  current: null,
  lastSeenTimestamp: 0,

  push: (type, message) => {
    const n: Notification = {
      id: crypto.randomUUID(),
      type,
      message,
      timestamp: Date.now(),
      autoDismissMs: type === "error" ? 10000 : 5000,
    };
    set((state) => ({
      items: [...state.items.slice(-(MAX_ITEMS - 1)), n],
      current: n,
    }));
  },

  dismiss: (id) =>
    set((state) => ({
      current: state.current?.id === id ? null : state.current,
    })),

  markSeen: () => set({ lastSeenTimestamp: Date.now() }),

  clearAll: () => set({ items: [], current: null, lastSeenTimestamp: Date.now() }),
}));

export const notify = {
  info:    (message: string) => useNotifications.getState().push("info", message),
  success: (message: string) => useNotifications.getState().push("success", message),
  error:   (message: string) => useNotifications.getState().push("error", message),
  warning: (message: string) => useNotifications.getState().push("warning", message),
};
