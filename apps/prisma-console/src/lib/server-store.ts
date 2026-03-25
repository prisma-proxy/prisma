import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface ServerConfig {
  id: string;
  name: string;
  url: string;
  token: string;
}

interface ServerStore {
  servers: ServerConfig[];
  activeServerId: string | null;
  addServer: (server: Omit<ServerConfig, "id">) => void;
  removeServer: (id: string) => void;
  updateServer: (id: string, data: Partial<Omit<ServerConfig, "id">>) => void;
  setActive: (id: string) => void;
  getActiveServer: () => ServerConfig | null;
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export const useServerStore = create<ServerStore>()(
  persist(
    (set, get) => ({
      servers: [],
      activeServerId: null,
      addServer: (server) => {
        const id = generateId();
        set((state) => ({
          servers: [...state.servers, { ...server, id }],
          activeServerId: state.activeServerId ?? id,
        }));
      },
      removeServer: (id) =>
        set((state) => {
          const servers = state.servers.filter((s) => s.id !== id);
          const activeServerId =
            state.activeServerId === id
              ? (servers[0]?.id ?? null)
              : state.activeServerId;
          return { servers, activeServerId };
        }),
      updateServer: (id, data) =>
        set((state) => ({
          servers: state.servers.map((s) =>
            s.id === id ? { ...s, ...data } : s,
          ),
        })),
      setActive: (id) => set({ activeServerId: id }),
      getActiveServer: () => {
        const state = get();
        return (
          state.servers.find((s) => s.id === state.activeServerId) ?? null
        );
      },
    }),
    {
      name: "prisma-servers",
    },
  ),
);
