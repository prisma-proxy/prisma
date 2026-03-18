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
import { CopyButton } from "@/components/ui/copy-button";
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
                <TableHead>{t("connections.peer")}</TableHead>
                <TableHead>{t("connections.connected")}</TableHead>
                <TableHead>{t("connections.bytesUp")}</TableHead>
                <TableHead>{t("connections.bytesDown")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {forwards.map((fwd) => (
                <TableRow key={fwd.session_id}>
                  <TableCell className="font-mono text-xs">
                    <span className="flex items-center gap-1">
                      {fwd.peer_addr}
                      <CopyButton value={fwd.peer_addr} />
                    </span>
                  </TableCell>
                  <TableCell>{formatTimestamp(fwd.connected_at)}</TableCell>
                  <TableCell>{formatBytes(fwd.bytes_up)}</TableCell>
                  <TableCell>{formatBytes(fwd.bytes_down)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
