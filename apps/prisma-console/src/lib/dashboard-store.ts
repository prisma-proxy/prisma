import { create } from "zustand";
import { persist } from "zustand/middleware";

const DEFAULT_WIDGET_ORDER = [
  "health",
  "metrics",
  "traffic-chart",
  "top-connections",
  "transport-pie",
  "geoip",
  "connection-map",
  "prometheus",
  "connections",
];

interface DashboardStore {
  widgetOrder: string[];
  hiddenWidgets: string[];
  editMode: boolean;
  setEditMode: (v: boolean) => void;
  moveWidget: (from: number, to: number) => void;
  toggleWidget: (id: string) => void;
  resetLayout: () => void;
}

export const useDashboardStore = create<DashboardStore>()(
  persist(
    (set) => ({
      widgetOrder: [...DEFAULT_WIDGET_ORDER],
      hiddenWidgets: [],
      editMode: false,
      setEditMode: (v) => set({ editMode: v }),
      moveWidget: (from, to) =>
        set((state) => {
          const order = [...state.widgetOrder];
          const [item] = order.splice(from, 1);
          order.splice(to, 0, item);
          return { widgetOrder: order };
        }),
      toggleWidget: (id) =>
        set((state) => {
          const hidden = state.hiddenWidgets.includes(id)
            ? state.hiddenWidgets.filter((w) => w !== id)
            : [...state.hiddenWidgets, id];
          return { hiddenWidgets: hidden };
        }),
      resetLayout: () =>
        set({
          widgetOrder: [...DEFAULT_WIDGET_ORDER],
          hiddenWidgets: [],
        }),
    }),
    {
      name: "prisma-dashboard-layout",
    },
  ),
);
