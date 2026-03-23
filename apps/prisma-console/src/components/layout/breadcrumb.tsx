"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, Home } from "lucide-react";
import { useI18n } from "@/lib/i18n";

const SEGMENT_LABELS: Record<string, string> = {
  dashboard: "sidebar.overview",
  connections: "sidebar.connections",
  servers: "sidebar.server",
  clients: "sidebar.clients",
  routing: "sidebar.routing",
  logs: "sidebar.logs",
  settings: "sidebar.settings",
  system: "sidebar.system",
  "traffic-shaping": "sidebar.trafficShaping",
  backups: "sidebar.backups",
  "speed-test": "sidebar.speedTest",
  bandwidth: "sidebar.bandwidth",
  new: "common.create",
  detail: "clients.clientDetails",
  edit: "common.edit",
};

export function Breadcrumb() {
  const pathname = usePathname();
  const { t } = useI18n();

  const segments = pathname
    .split("/")
    .filter(Boolean)
    .filter((s) => s !== "dashboard");

  if (segments.length === 0) return null;

  const crumbs = segments.map((segment, index) => {
    const href = "/dashboard/" + segments.slice(0, index + 1).join("/") + "/";
    const labelKey = SEGMENT_LABELS[segment];
    const label = labelKey ? t(labelKey) : segment;
    const isLast = index === segments.length - 1;
    return { href, label, isLast };
  });

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm text-muted-foreground">
      <Link
        href="/dashboard/"
        className="flex items-center gap-1 transition-colors hover:text-foreground"
      >
        <Home className="h-3.5 w-3.5" />
      </Link>
      {crumbs.map((crumb) => (
        <span key={crumb.href} className="flex items-center gap-1">
          <ChevronRight className="h-3.5 w-3.5" />
          {crumb.isLast ? (
            <span className="font-medium text-foreground">{crumb.label}</span>
          ) : (
            <Link
              href={crumb.href}
              className="transition-colors hover:text-foreground"
            >
              {crumb.label}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}
