import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface PerAppState {
  enabled: boolean;
  mode: "include" | "exclude";
  apps: string[];

  setEnabled: (v: boolean) => void;
  setMode: (v: "include" | "exclude") => void;
  setApps: (apps: string[]) => void;
  toggleApp: (app: string) => void;
  reset: () => void;
}

export const usePerApp = create<PerAppState>()(
  persist(
    (set) => ({
      enabled: false,
      mode: "include" as const,
      apps: [],

      setEnabled: (v) => set({ enabled: v }),
      setMode: (v) => set({ mode: v }),
      setApps: (apps) => set({ apps }),
      toggleApp: (app) =>
        set((state) => ({
          apps: state.apps.includes(app)
            ? state.apps.filter((a) => a !== app)
            : [...state.apps, app],
        })),
      reset: () => set({ enabled: false, mode: "include", apps: [] }),
    }),
    { name: "prisma-perapp" }
  )
);
