import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useI18n } from "@/lib/i18n";
import type { TlsInfoResponse } from "@/lib/types";

interface TlsInfoProps {
  tls: TlsInfoResponse;
}

export function TlsInfo({ tls }: TlsInfoProps) {
  const { t } = useI18n();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("server.tlsInfo")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">{t("settings.tlsStatus")}:</span>
          {tls.enabled ? (
            <Badge className="bg-green-500/15 text-green-700 dark:text-green-400">
              {t("common.enabled")}
            </Badge>
          ) : (
            <Badge className="bg-red-500/15 text-red-700 dark:text-red-400">
              {t("common.disabled")}
            </Badge>
          )}
        </div>
        <div>
          <p className="text-sm text-muted-foreground">{t("settings.certPath")}</p>
          <p className="text-sm font-mono">
            {tls.cert_path ?? t("settings.notConfigured")}
          </p>
        </div>
        <div>
          <p className="text-sm text-muted-foreground">{t("settings.keyPath")}</p>
          <p className="text-sm font-mono">
            {tls.key_path ?? t("settings.notConfigured")}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
