"use client";

import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { getToken, setToken as storeToken, clearToken } from "./auth";

interface AuthContextType {
  token: string | null;
  login: (token: string) => void;
  logout: () => void;
  authenticated: boolean;
}

const AuthContext = createContext<AuthContextType>({
  token: null,
  login: () => {},
  logout: () => {},
  authenticated: false,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [token, setTokenState] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return getToken();
  });

  useEffect(() => {
    if (pathname?.startsWith("/dashboard") && !token) {
      router.replace("/login/");
    }
  }, [pathname, token, router]);

  const login = useCallback((newToken: string) => {
    storeToken(newToken);
    setTokenState(newToken);
    router.push("/dashboard/");
  }, [router]);

  const logout = useCallback(() => {
    clearToken();
    setTokenState(null);
    router.push("/login/");
  }, [router]);

  return (
    <AuthContext.Provider value={{ token, login, logout, authenticated: !!token }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
