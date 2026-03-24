"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Server,
  Users,
  Route,
  ScrollText,
  Settings,
  Monitor,
  Activity,
  Archive,
  PanelLeftClose,
  PanelLeftOpen,
  Gauge,
  BarChart3,
  Network,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";

interface NavItem {
  labelKey: string;
  href: string;
  icon: typeof LayoutDashboard;
  exact?: boolean;
  group: "main" | "monitoring" | "config";
}

const navItems: NavItem[] = [
  { labelKey: "sidebar.overview", href: "/dashboard/", icon: LayoutDashboard, exact: true, group: "main" },
  { labelKey: "sidebar.connections", href: "/dashboard/connections/", icon: Network, group: "main" },
  { labelKey: "sidebar.server", href: "/dashboard/servers/", icon: Server, group: "main" },
  { labelKey: "sidebar.clients", href: "/dashboard/clients/", icon: Users, group: "main" },
  { labelKey: "sidebar.logs", href: "/dashboard/logs/", icon: ScrollText, group: "monitoring" },
  { labelKey: "sidebar.bandwidth", href: "/dashboard/bandwidth/", icon: BarChart3, group: "monitoring" },
  { labelKey: "sidebar.speedTest", href: "/dashboard/speed-test/", icon: Gauge, group: "monitoring" },
  { labelKey: "sidebar.routing", href: "/dashboard/routing/", icon: Route, group: "config" },
  { labelKey: "sidebar.trafficShaping", href: "/dashboard/traffic-shaping/", icon: Activity, group: "config" },
  { labelKey: "sidebar.system", href: "/dashboard/system/", icon: Monitor, group: "config" },
  { labelKey: "sidebar.settings", href: "/dashboard/settings/", icon: Settings, group: "config" },
  { labelKey: "sidebar.backups", href: "/dashboard/backups/", icon: Archive, group: "config" },
];

const GROUP_LABELS: Record<string, string> = {
  main: "sidebar.overview",
  monitoring: "sidebar.monitoring",
  config: "sidebar.configuration",
};

interface SidebarProps {
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}

export function Sidebar({ collapsed: controlledCollapsed, onCollapsedChange }: SidebarProps) {
  const pathname = usePathname();
  const { t } = useI18n();

  const [internalCollapsed, setInternalCollapsed] = useState(() => {
    if (typeof window === "undefined" || controlledCollapsed !== undefined) return false;
    return localStorage.getItem("prisma-sidebar-collapsed") === "true";
  });

  // Use controlled value if provided, otherwise internal state
  const collapsed = controlledCollapsed ?? internalCollapsed;

  const toggleCollapsed = useCallback(() => {
    const next = !collapsed;
    if (onCollapsedChange) {
      onCollapsedChange(next);
    } else {
      setInternalCollapsed(next);
    }
    localStorage.setItem("prisma-sidebar-collapsed", String(next));
  }, [collapsed, onCollapsedChange]);

  const groups = ["main", "monitoring", "config"] as const;

  return (
    <TooltipProvider>
      <aside
        className={`flex h-screen flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-all duration-200 ease-in-out ${
          collapsed ? "w-16" : "w-60"
        }`}
      >
        {/* Logo / Brand */}
        <div className="flex h-14 items-center border-b border-sidebar-border px-4">
          {!collapsed && (
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary">
                <span className="text-xs font-bold text-primary-foreground">P</span>
              </div>
              <span className="text-base font-semibold tracking-tight">Prisma</span>
            </div>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            className={`text-muted-foreground hover:text-foreground ${
              collapsed ? "mx-auto" : "ml-auto"
            }`}
            onClick={toggleCollapsed}
          >
            {collapsed ? (
              <PanelLeftOpen className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
          </Button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-3">
          {groups.map((group, gi) => {
            const items = navItems.filter((n) => n.group === group);
            return (
              <div key={group}>
                {gi > 0 && <div className="my-2 mx-2 h-px bg-sidebar-border" />}
                {!collapsed && GROUP_LABELS[group] && (
                  <p className="mb-1 px-3 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {group === "main" ? "" : group === "monitoring" ? t("sidebar.monitoring") : t("sidebar.configuration")}
                  </p>
                )}
                {items.map(({ labelKey, href, icon: Icon, exact }) => {
                  const base = href.replace(/\/$/, "");
                  const isActive = exact
                    ? pathname === base || pathname === base + "/"
                    : pathname === base || pathname.startsWith(base + "/");

                  const label = t(labelKey);

                  const linkContent = (
                    <Link
                      key={href}
                      href={href}
                      className={`group/nav-item relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150 ${
                        collapsed ? "justify-center px-2" : ""
                      } ${
                        isActive
                          ? "bg-sidebar-accent text-sidebar-accent-foreground"
                          : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
                      }`}
                    >
                      {isActive && (
                        <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-primary" />
                      )}
                      <Icon className={`h-4 w-4 shrink-0 transition-colors ${isActive ? "text-primary" : ""}`} />
                      {!collapsed && <span className="truncate">{label}</span>}
                    </Link>
                  );

                  if (collapsed) {
                    return (
                      <Tooltip key={href}>
                        <TooltipTrigger render={<div />}>
                          {linkContent}
                        </TooltipTrigger>
                        <TooltipContent side="right" sideOffset={8}>
                          {label}
                        </TooltipContent>
                      </Tooltip>
                    );
                  }

                  return <div key={href}>{linkContent}</div>;
                })}
              </div>
            );
          })}
        </nav>

        {/* Footer */}
        {!collapsed && (
          <div className="border-t border-sidebar-border px-4 py-3">
            <p className="text-[10px] text-muted-foreground">Prisma Console v{process.env.NEXT_PUBLIC_APP_VERSION || "2.0.0"}</p>
          </div>
        )}
      </aside>
    </TooltipProvider>
  );
}

/** Mobile sidebar content (used inside Sheet) */
export function MobileSidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { t } = useI18n();

  return (
    <nav className="flex-1 space-y-1 px-3 py-4">
      {navItems.map(({ labelKey, href, icon: Icon, exact }) => {
        const base = href.replace(/\/$/, "");
        const isActive = exact
          ? pathname === base || pathname === base + "/"
          : pathname === base || pathname.startsWith(base + "/");

        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            className={`relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              isActive
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
            }`}
          >
            {isActive && (
              <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-primary" />
            )}
            <Icon className={`h-4 w-4 ${isActive ? "text-primary" : ""}`} />
            {t(labelKey)}
          </Link>
        );
      })}
    </nav>
  );
}
