import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { useStore } from "@/store";

export default function StatusBadge() {
  const { t } = useTranslation();
  const connected = useStore((s) => s.connected);
  const connecting = useStore((s) => s.connecting);

  if (connecting) return <Badge variant="warning">{t("status.connecting")}</Badge>;
  if (connected)  return <Badge variant="success">{t("status.connected")}</Badge>;
  return <Badge variant="secondary">{t("status.disconnected")}</Badge>;
}
