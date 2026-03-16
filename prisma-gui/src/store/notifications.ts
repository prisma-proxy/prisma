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
  push: (type: Notification["type"], message: string) => void;
  dismiss: (id: string) => void;
  clearAll: () => void;
}

const MAX_ITEMS = 50;

export const useNotifications = create<NotificationStore>((set) => ({
  items: [],
  current: null,

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

  clearAll: () => set({ items: [], current: null }),
}));

export const notify = {
  info:    (message: string) => useNotifications.getState().push("info", message),
  success: (message: string) => useNotifications.getState().push("success", message),
  error:   (message: string) => useNotifications.getState().push("error", message),
  warning: (message: string) => useNotifications.getState().push("warning", message),
};
