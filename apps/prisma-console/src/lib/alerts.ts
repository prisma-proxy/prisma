export interface Alert {
  id: string;
  type: "cert-expiry" | "quota-threshold" | "handshake-spike";
  severity: "warning" | "critical";
  message: string;
}
