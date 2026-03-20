"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatBytes } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import type { ForwardInfo } from "@/lib/types";

interface ForwardsTableProps {
  forwards: ForwardInfo[];
}

function formatTimestamp(ts: string): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function ForwardsTable({ forwards }: ForwardsTableProps) {
  const { t } = useI18n();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("server.portForwards")}</CardTitle>
      </CardHeader>
      <CardContent>
        {forwards.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {t("server.noForwards")}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("server.fwdPort")}</TableHead>
                <TableHead>{t("common.name")}</TableHead>
                <TableHead>{t("server.fwdProtocol")}</TableHead>
                <TableHead>{t("server.fwdBindAddr")}</TableHead>
                <TableHead>{t("server.fwdActiveConns")}</TableHead>
                <TableHead>{t("connections.bytesUp")}</TableHead>
                <TableHead>{t("connections.bytesDown")}</TableHead>
                <TableHead>{t("server.fwdRegistered")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {forwards.map((fwd) => (
                <TableRow key={fwd.remote_port}>
                  <TableCell className="font-mono text-xs">
                    {fwd.remote_port}
                  </TableCell>
                  <TableCell>{fwd.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{fwd.protocol}</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {fwd.bind_addr}
                  </TableCell>
                  <TableCell>{fwd.active_connections}</TableCell>
                  <TableCell>{formatBytes(fwd.bytes_up)}</TableCell>
                  <TableCell>{formatBytes(fwd.bytes_down)}</TableCell>
                  <TableCell>{formatTimestamp(fwd.registered_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
