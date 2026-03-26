import { create } from "zustand";

const MAX_NOTIFICATIONS = 100;

export interface Notification {
  id: string;
  message: string;
  type: "success" | "error" | "info";
  timestamp: string;
  read: boolean;
}

export interface NotificationStore {
  notifications: Notification[];
  unreadCount: number;
  add: (message: string, type: "success" | "error" | "info") => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  clear: () => void;
}

let notificationCounter = 0;

export const useNotificationStore = create<NotificationStore>((set) => ({
  notifications: [],
  unreadCount: 0,
  add: (message, type) =>
    set((state) => {
      const notification: Notification = {
        id: String(++notificationCounter),
        message,
        type,
        timestamp: new Date().toISOString(),
        read: false,
      };
      const notifications = [notification, ...state.notifications].slice(
        0,
        MAX_NOTIFICATIONS,
      );
      return {
        notifications,
        unreadCount: notifications.filter((n) => !n.read).length,
      };
    }),
  markRead: (id) =>
    set((state) => {
      const notifications = state.notifications.map((n) =>
        n.id === id ? { ...n, read: true } : n,
      );
      return {
        notifications,
        unreadCount: notifications.filter((n) => !n.read).length,
      };
    }),
  markAllRead: () =>
    set((state) => ({
      notifications: state.notifications.map((n) => ({ ...n, read: true })),
      unreadCount: 0,
    })),
  clear: () =>
    set(() => ({
      notifications: [],
      unreadCount: 0,
    })),
}));
