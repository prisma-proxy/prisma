import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface Rule {
  id: string;
  type: "DOMAIN" | "DOMAIN-SUFFIX" | "DOMAIN-KEYWORD" | "IP-CIDR" | "GEOIP" | "FINAL";
  match: string;
  action: "PROXY" | "DIRECT" | "REJECT";
}

interface RulesStore {
  rules: Rule[];
  add: (rule: Rule) => void;
  remove: (id: string) => void;
  clear: () => void;
}

export const useRules = create<RulesStore>()(
  persist(
    (set) => ({
      rules: [],

      add: (rule) =>
        set((state) => ({ rules: [...state.rules, rule] })),

      remove: (id) =>
        set((state) => ({ rules: state.rules.filter((r) => r.id !== id) })),

      clear: () => set({ rules: [] }),
    }),
    { name: "prisma-rules" }
  )
);
