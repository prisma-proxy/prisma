import { useServerStore } from "./server-store";

const TOKEN_KEY = "prisma_auth_token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  const serverToken = useServerStore.getState().getActiveServer()?.token;
  if (serverToken) return serverToken;
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  sessionStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  sessionStorage.removeItem(TOKEN_KEY);
}

export function isAuthenticated(): boolean {
  return !!getToken();
}
