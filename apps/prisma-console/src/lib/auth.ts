import { useServerStore } from "./server-store";

const TOKEN_KEY = "prisma_auth_token";
const JWT_KEY = "prisma_jwt";
const JWT_PERSIST_KEY = "prisma_jwt_persist";
const USER_KEY = "prisma_user";

export interface AuthUser {
  username: string;
  role: string;
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  // 1. Active server token from server selector (highest priority)
  const serverToken = useServerStore.getState().getActiveServer()?.token;
  if (serverToken) return serverToken;
  // 2. JWT from localStorage (remember me) or sessionStorage
  const jwt =
    localStorage.getItem(JWT_KEY) || sessionStorage.getItem(JWT_KEY);
  if (jwt) return jwt;
  // 3. Legacy session token
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  sessionStorage.setItem(TOKEN_KEY, token);
}

export function setJwt(token: string, persist: boolean) {
  if (persist) {
    localStorage.setItem(JWT_KEY, token);
    localStorage.setItem(JWT_PERSIST_KEY, "1");
    sessionStorage.removeItem(JWT_KEY);
  } else {
    sessionStorage.setItem(JWT_KEY, token);
    localStorage.removeItem(JWT_KEY);
    localStorage.removeItem(JWT_PERSIST_KEY);
  }
}

export function setUser(user: AuthUser) {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function getUser(): AuthUser | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export function clearToken() {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(JWT_KEY);
  localStorage.removeItem(JWT_KEY);
  localStorage.removeItem(JWT_PERSIST_KEY);
  localStorage.removeItem(USER_KEY);
}

export function isAuthenticated(): boolean {
  return !!getToken();
}
