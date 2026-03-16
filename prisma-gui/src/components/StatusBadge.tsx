import { Badge } from "@/components/ui/badge";
import { useStore } from "@/store";

export default function StatusBadge() {
  const connected = useStore((s) => s.connected);
  const connecting = useStore((s) => s.connecting);

  if (connecting) return <Badge variant="warning">Connecting…</Badge>;
  if (connected)  return <Badge variant="success">Connected</Badge>;
  return <Badge variant="secondary">Disconnected</Badge>;
}
