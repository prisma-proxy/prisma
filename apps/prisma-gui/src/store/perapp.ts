import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface PerAppPreset {
  id: string;
  name: string;
  mode: "include" | "exclude";
  apps: string[];
}

export interface PerAppState {
  enabled: boolean;
  mode: "include" | "exclude";
  apps: string[];
  presets: PerAppPreset[];
  activePresetId: string | null;

  setEnabled: (v: boolean) => void;
  setMode: (v: "include" | "exclude") => void;
  setApps: (apps: string[]) => void;
  toggleApp: (app: string) => void;
  addPreset: (name: string) => void;
  applyPreset: (id: string) => void;
  deletePreset: (id: string) => void;
  reset: () => void;
}

export const usePerApp = create<PerAppState>()(
  persist(
    (set, get) => ({
      enabled: false,
      mode: "include" as const,
      apps: [],
      presets: [],
      activePresetId: null,

      setEnabled: (v) => set({ enabled: v }),
      setMode: (v) => set({ mode: v, activePresetId: null }),
      setApps: (apps) => set({ apps, activePresetId: null }),
      toggleApp: (app) =>
        set((state) => ({
          apps: state.apps.includes(app)
            ? state.apps.filter((a) => a !== app)
            : [...state.apps, app],
          activePresetId: null,
        })),

      addPreset: (name) => {
        const state = get();
        const preset: PerAppPreset = {
          id: crypto.randomUUID(),
          name,
          mode: state.mode,
          apps: [...state.apps],
        };
        set({ presets: [...state.presets, preset], activePresetId: preset.id });
      },

      applyPreset: (id) => {
        const preset = get().presets.find((p) => p.id === id);
        if (preset) {
          set({
            mode: preset.mode,
            apps: [...preset.apps],
            activePresetId: id,
          });
        }
      },

      deletePreset: (id) =>
        set((state) => ({
          presets: state.presets.filter((p) => p.id !== id),
          activePresetId: state.activePresetId === id ? null : state.activePresetId,
        })),

      reset: () =>
        set({ enabled: false, mode: "include", apps: [], activePresetId: null }),
    }),
    { name: "prisma-perapp" }
  )
);
