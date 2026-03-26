"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";

type Theme = "light" | "dark" | "system";

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  resolvedTheme: "light" | "dark";
}

const ThemeContext = createContext<ThemeContextType | null>(null);

function resolveTheme(t: Theme): "light" | "dark" {
  if (typeof window === "undefined") return "dark";
  if (t === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return t;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("system");
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">("dark");

  // Sync from localStorage after mount
  useEffect(() => {
    const saved = localStorage.getItem("prisma-theme") as Theme | null;
    if (saved && (saved === "light" || saved === "dark" || saved === "system")) {
      setThemeState(saved);
      setResolvedTheme(resolveTheme(saved));
    } else {
      setResolvedTheme(resolveTheme("system"));
    }
  }, []);

  // Sync DOM class on mount and when theme changes
  useEffect(() => {
    const resolved = resolveTheme(theme);
    document.documentElement.classList.toggle("dark", resolved === "dark");
  }, [theme]);

  // Listen for system preference changes
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      const currentTheme = (localStorage.getItem("prisma-theme") as Theme | null) ?? "system";
      if (currentTheme === "system") {
        const resolved = resolveTheme("system");
        setResolvedTheme(resolved);
        document.documentElement.classList.toggle("dark", resolved === "dark");
      }
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    const resolved = resolveTheme(t);
    setResolvedTheme(resolved);
    localStorage.setItem("prisma-theme", t);
    document.documentElement.classList.toggle("dark", resolved === "dark");
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, resolvedTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
