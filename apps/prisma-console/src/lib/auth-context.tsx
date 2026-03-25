"use client";

import { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  getToken,
  setToken as storeToken,
  setJwt,
  setUser as storeUser,
  getUser,
  clearToken,
  type AuthUser,
} from "./auth";
import { getSetupStatus } from "./api";

interface AuthContextType {
  token: string | null;
  user: AuthUser | null;
  login: (token: string, user?: AuthUser, persist?: boolean) => void;
  loginLegacy: (token: string) => void;
  logout: () => void;
  authenticated: boolean;
  role: "admin" | "operator" | "client" | null;
}

const AuthContext = createContext<AuthContextType>({
  token: null,
  user: null,
  login: () => {},
  loginLegacy: () => {},
  logout: () => {},
  authenticated: false,
  role: null,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [token, setTokenState] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return getToken();
  });
  const [user, setUserState] = useState<AuthUser | null>(() => {
    if (typeof window === "undefined") return null;
    return getUser();
  });

  // Redirect unauthenticated users away from dashboard (with setup check).
  // Cache result to avoid repeated API calls on every route change.
  const setupCheckedRef = useRef(false);
  useEffect(() => {
    if (pathname === "/setup" || pathname === "/setup/") return;
    if (token) return;

    if (pathname?.startsWith("/dashboard") || pathname === "/login" || pathname === "/login/") {
      if (setupCheckedRef.current) {
        if (!pathname?.startsWith("/login")) router.replace("/login/");
        return;
      }
      getSetupStatus()
        .then(({ needs_setup }) => {
          if (needs_setup) {
            router.replace("/setup/");
          } else {
            setupCheckedRef.current = true;
            if (!pathname?.startsWith("/login")) router.replace("/login/");
          }
        })
        .catch(() => {
          if (!pathname?.startsWith("/login")) router.replace("/login/");
        });
    }
  }, [pathname, token, router]);

  // On mount: validate JWT by calling /api/auth/me
  useEffect(() => {
    if (!token) return;
    const base = localStorage.getItem("prisma-api-base") || "";
    fetch(`${base}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (!res.ok) {
          // Token expired or invalid — clear and redirect
          clearToken();
          setTokenState(null);
          setUserState(null);
          router.replace("/login/");
        }
        return res.json();
      })
      .then((data) => {
        if (data?.username) {
          const u: AuthUser = { username: data.username, role: data.role ?? "user" };
          storeUser(u);
          setUserState(u);
        }
      })
      .catch(() => {
        // Network error or legacy server — keep existing auth state
      });
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(
    (newToken: string, newUser?: AuthUser, persist = false) => {
      setJwt(newToken, persist);
      setTokenState(newToken);
      if (newUser) {
        storeUser(newUser);
        setUserState(newUser);
      }
      router.push("/dashboard/");
    },
    [router],
  );

  const loginLegacy = useCallback(
    (newToken: string) => {
      storeToken(newToken);
      setTokenState(newToken);
      router.push("/dashboard/");
    },
    [router],
  );

  const logout = useCallback(() => {
    clearToken();
    setTokenState(null);
    setUserState(null);
    router.push("/login/");
  }, [router]);

  return (
    <AuthContext.Provider
      value={{
        token,
        user,
        login,
        loginLegacy,
        logout,
        authenticated: !!token,
        role: (user?.role as "admin" | "operator" | "client") ?? null,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
