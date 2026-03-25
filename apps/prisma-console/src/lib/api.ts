import { getToken, clearToken } from "./auth";

function getApiBase(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("prisma-api-base") || "";
}

async function apiRequest(path: string, init?: RequestInit): Promise<Response> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string>),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const base = getApiBase();
  const res = await fetch(`${base}${path}`, { ...init, headers });
  if (res.status === 401) {
    clearToken();
    if (typeof window !== "undefined") {
      window.location.href = "/login/";
    }
    throw new Error("Unauthorized");
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const json = await res.json();
      detail = json.error || json.message || detail;
    } catch { /* response body not JSON */ }
    throw new Error(detail);
  }
  return res;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiRequest(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers as Record<string, string>) },
  });
  const text = await res.text();
  if (!text) return undefined as unknown as T;
  return JSON.parse(text) as T;
}

async function apiFetchText(path: string, init?: RequestInit): Promise<string> {
  const res = await apiRequest(path, init);
  return res.text();
}

export const api = {
  getHealth: () => apiFetch<import("./types").HealthResponse>("/api/health"),
  getMetrics: () => apiFetch<import("./types").MetricsSnapshot>("/api/metrics"),
  getMetricsHistory: (period?: string, resolution?: string) => {
    const params = new URLSearchParams();
    if (period) params.set("period", period);
    if (resolution) params.set("resolution", resolution);
    const qs = params.toString();
    return apiFetch<import("./types").MetricsSnapshot[]>(`/api/metrics/history${qs ? `?${qs}` : ""}`);
  },
  getConnections: () => apiFetch<import("./types").ConnectionInfo[]>("/api/connections"),
  disconnectConnection: (id: string) =>
    apiFetch<void>(`/api/connections/${id}`, { method: "DELETE" }),
  getClients: () => apiFetch<import("./types").ClientInfo[]>("/api/clients"),
  createClient: (name?: string) =>
    apiFetch<import("./types").CreateClientResponse>("/api/clients", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  updateClient: (id: string, data: { name?: string; enabled?: boolean }) =>
    apiFetch<void>(`/api/clients/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteClient: (id: string) =>
    apiFetch<void>(`/api/clients/${id}`, { method: "DELETE" }),
  getConfig: () => apiFetch<import("./types").ConfigResponse>("/api/config"),
  patchConfig: (data: Record<string, unknown>) =>
    apiFetch<void>("/api/config", {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  getTlsInfo: () => apiFetch<import("./types").TlsInfoResponse>("/api/config/tls"),
  getForwards: () =>
    apiFetch<import("./types").ForwardListResponse>("/api/forwards").then(
      (res) => res.forwards
    ),
  getRoutes: () => apiFetch<import("./types").RoutingRule[]>("/api/routes"),
  createRoute: (data: Omit<import("./types").RoutingRule, "id">) =>
    apiFetch<import("./types").RoutingRule>("/api/routes", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateRoute: (id: string, data: Omit<import("./types").RoutingRule, "id">) =>
    apiFetch<void>(`/api/routes/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteRoute: (id: string) =>
    apiFetch<void>(`/api/routes/${id}`, { method: "DELETE" }),

  // Reload
  reloadConfig: () =>
    apiFetch<{ success: boolean; message: string; changes: string[] }>("/api/reload", { method: "POST" }),

  // System
  getSystemInfo: () =>
    apiFetch<import("./types").SystemInfoResponse>("/api/system/info"),

  // Permissions
  getClientPermissions: (id: string) =>
    apiFetch<import("./types").ClientPermissions>(`/api/clients/${id}/permissions`),
  updateClientPermissions: (id: string, data: import("./types").ClientPermissions) =>
    apiFetch<void>(`/api/clients/${id}/permissions`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  // Bandwidth
  getClientBandwidth: (id: string) =>
    apiFetch<import("./types").ClientBandwidthInfo>(`/api/clients/${id}/bandwidth`),
  updateClientBandwidth: (id: string, data: { upload_bps?: number; download_bps?: number }) =>
    apiFetch<import("./types").ClientBandwidthInfo>(`/api/clients/${id}/bandwidth`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  getClientQuota: (id: string) =>
    apiFetch<import("./types").ClientQuotaInfo>(`/api/clients/${id}/quota`),
  updateClientQuota: (id: string, data: { quota_bytes?: number }) =>
    apiFetch<void>(`/api/clients/${id}/quota`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  getBandwidthSummary: () =>
    apiFetch<import("./types").BandwidthSummary>("/api/bandwidth/summary"),

  // Backups
  listBackups: () =>
    apiFetch<import("./types").BackupInfo[]>("/api/config/backups"),
  createBackup: () =>
    apiFetch<import("./types").BackupInfo>("/api/config/backup", { method: "POST" }),
  getBackup: (name: string) =>
    apiFetchText(`/api/config/backups/${encodeURIComponent(name)}`),
  restoreBackup: (name: string) =>
    apiFetch<void>(`/api/config/backups/${encodeURIComponent(name)}/restore`, { method: "POST" }),
  deleteBackup: (name: string) =>
    apiFetch<void>(`/api/config/backups/${encodeURIComponent(name)}`, { method: "DELETE" }),
  diffBackup: (name: string) =>
    apiFetch<import("./types").BackupDiff>(`/api/config/backups/${encodeURIComponent(name)}/diff`),

  // Alerts
  getAlertConfig: () =>
    apiFetch<import("./types").AlertConfig>("/api/alerts/config"),
  updateAlertConfig: (data: import("./types").AlertConfig) =>
    apiFetch<import("./types").AlertConfig>("/api/alerts/config", {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  // GeoIP / connection origins
  getConnectionGeo: () =>
    apiFetch<import("./types").GeoEntry[]>("/api/connections/geo"),

  // Per-client metrics
  getClientMetrics: () =>
    apiFetch<import("./types").ClientMetricsEntry[]>("/api/metrics/clients"),
  getSingleClientMetrics: (id: string) =>
    apiFetch<import("./types").ClientMetricsEntry>(`/api/metrics/clients/${id}`),
  getClientMetricsHistory: (id: string, period?: string) => {
    const qs = period ? `?period=${period}` : "";
    return apiFetch<import("./types").ClientMetricsHistoryEntry[]>(
      `/api/metrics/clients/${id}/history${qs}`
    );
  },

  // Client sharing
  getClientSecret: (id: string) =>
    apiFetch<{ client_id: string; auth_secret: string }>(`/api/clients/${id}/secret`),
  shareClient: (id: string) =>
    apiFetch<import("./types").ShareClientResponse>(`/api/clients/share`, {
      method: "POST",
      body: JSON.stringify({ client_id: id }),
    }),
};
