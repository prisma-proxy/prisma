import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface Rule {
  id: string;
  type: "DOMAIN" | "DOMAIN-SUFFIX" | "DOMAIN-KEYWORD" | "IP-CIDR" | "GEOIP" | "GEOSITE" | "FINAL";
  match: string;
  action: "PROXY" | "DIRECT" | "REJECT";
}

interface RulesStore {
  rules: Rule[];
  add: (rule: Rule) => void;
  addMany: (newRules: Omit<Rule, "id">[]) => number;
  replaceCategory: (categoryRuleKeys: Set<string>, newRules: Omit<Rule, "id">[]) => number;
  remove: (id: string) => void;
  clear: () => void;
}

export const useRules = create<RulesStore>()(
  persist(
    (set) => ({
      rules: [],

      add: (rule) =>
        set((state) => ({ rules: [...state.rules, rule] })),

      addMany: (newRules) => {
        let added = 0;
        set((state) => {
          const existing = new Set(state.rules.map((r) => `${r.type}|${r.match}|${r.action}`));
          const toAdd = newRules
            .filter((r) => !existing.has(`${r.type}|${r.match}|${r.action}`))
            .map((r) => ({ ...r, id: crypto.randomUUID() }));
          added = toAdd.length;
          return { rules: [...state.rules, ...toAdd] };
        });
        return added;
      },

      replaceCategory: (categoryRuleKeys, newRules) => {
        let added = 0;
        set((state) => {
          const kept = state.rules.filter(
            (r) => !categoryRuleKeys.has(`${r.type}|${r.match}|${r.action}`)
          );
          const toAdd = newRules.map((r) => ({ ...r, id: crypto.randomUUID() }));
          added = toAdd.length;
          return { rules: [...kept, ...toAdd] };
        });
        return added;
      },

      remove: (id) =>
        set((state) => ({ rules: state.rules.filter((r) => r.id !== id) })),

      clear: () => set({ rules: [] }),
    }),
    { name: "prisma-rules" }
  )
);
