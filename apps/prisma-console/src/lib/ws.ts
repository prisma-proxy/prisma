import { getToken } from "./auth";

export type WSCallback<T> = (data: T) => void;
export type WSStatus = "connecting" | "connected" | "reconnecting" | "disconnected";

export function createWebSocket<T>(
  path: string,
  onMessage: WSCallback<T>,
  onError?: (error: Event) => void,
  onStatusChange?: (status: WSStatus) => void,
): { close: () => void; send: (data: unknown) => void } {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  let ws: WebSocket | null = null;
  let shouldReconnect = true;
  let reconnectDelay = 1000;
  let isFirstConnect = true;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;

  function connect() {
    const token = getToken();
    const tokenParam = token ? `?token=${encodeURIComponent(token)}` : "";
    const base = localStorage.getItem("prisma-api-base") || "";
    onStatusChange?.(isFirstConnect ? "connecting" : "reconnecting");
    isFirstConnect = false;
    ws = new WebSocket(`${protocol}//${window.location.host}${base}${path}${tokenParam}`);

    ws.onopen = () => {
      reconnectDelay = 1000;
      onStatusChange?.("connected");
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as T;
        onMessage(data);
      } catch {
        // ignore parse errors
      }
    };

    ws.onerror = (event) => {
      onError?.(event);
    };

    ws.onclose = (event) => {
      // 4001/4003 = auth failure — don't reconnect with a bad token
      if (event.code === 4001 || event.code === 4003 || event.code === 1008) {
        shouldReconnect = false;
      }
      if (shouldReconnect) {
        onStatusChange?.("reconnecting");
        pendingTimer = setTimeout(connect, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, 30000);
      } else {
        onStatusChange?.("disconnected");
      }
    };
  }

  connect();

  return {
    close: () => {
      shouldReconnect = false;
      if (pendingTimer) clearTimeout(pendingTimer);
      ws?.close();
    },
    send: (data: unknown) => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
      }
    },
  };
}
