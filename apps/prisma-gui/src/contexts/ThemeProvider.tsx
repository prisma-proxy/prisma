import { createContext, useContext, useEffect, useMemo } from "react";
import { useSettings } from "@/store/settings";

type ResolvedTheme = "light" | "dark";

interface ThemeCtx {
  theme: "system" | "light" | "dark";
  resolvedTheme: ResolvedTheme;
  setTheme: (t: "system" | "light" | "dark") => void;
}

const ThemeContext = createContext<ThemeCtx>({
  theme: "system",
  resolvedTheme: "dark",
  setTheme: () => {},
});

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useSettings((s) => s.theme);
  const patch = useSettings((s) => s.patch);

  useEffect(() => {
    function apply() {
      const resolved = theme === "system" ? getSystemTheme() : theme;
      document.documentElement.classList.toggle("dark", resolved === "dark");
    }

    apply();

    if (theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
  }, [theme]);

  const ctx = useMemo<ThemeCtx>(() => ({
    theme,
    resolvedTheme: theme === "system" ? getSystemTheme() : theme,
    setTheme: (t) => patch({ theme: t }),
  }), [theme, patch]);

  return <ThemeContext.Provider value={ctx}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
