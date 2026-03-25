"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Server,
  Users,
  UserCog,
  Route,
  Settings,
  Monitor,
  Activity,
  Archive,
  PanelLeftClose,
  PanelLeftOpen,
  Gauge,
  BarChart3,
  Network,
  Sun,
  Moon,
  Globe,
  Radio,
  LogOut,
  User,
  KeyRound,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/theme-context";
import { useAuth } from "@/lib/auth-context";
import { useRole } from "@/components/auth/role-guard";
import { Button } from "@/components/ui/button";
import { NotificationDrawer } from "@/components/layout/notification-drawer";
import { ServerSelector } from "@/components/layout/server-selector";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";

type Role = "admin" | "operator" | "client";

interface NavItem {
  labelKey: string;
  href: string;
  icon: typeof LayoutDashboard;
  exact?: boolean;
  group: "main" | "monitoring" | "config";
  /** Minimum role required to see this item. Defaults to "client" (visible to all). */
  minRole?: Role;
}

const ROLE_LEVEL: Record<Role, number> = { admin: 3, operator: 2, client: 1 };

const ROLE_BADGE_CLASS: Record<Role, string> = {
  admin: "border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-400",
  operator: "border-yellow-500/50 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400",
  client: "border-green-500/50 bg-green-500/10 text-green-700 dark:text-green-400",
};

const navItems: NavItem[] = [
  { labelKey: "sidebar.overview", href: "/dashboard/", icon: LayoutDashboard, exact: true, group: "main" },
  { labelKey: "sidebar.connections", href: "/dashboard/connections/", icon: Network, group: "main", minRole: "operator" },
  { labelKey: "sidebar.server", href: "/dashboard/servers/", icon: Server, group: "main", minRole: "operator" },
  { labelKey: "sidebar.clients", href: "/dashboard/clients/", icon: Users, group: "main", minRole: "operator" },
  { labelKey: "sidebar.events", href: "/dashboard/events/", icon: Radio, group: "monitoring", minRole: "operator" },
  { labelKey: "sidebar.speedTest", href: "/dashboard/speed-test/", icon: Gauge, group: "monitoring" },
  { labelKey: "sidebar.analytics", href: "/dashboard/analytics/", icon: BarChart3, group: "monitoring", minRole: "operator" },
  { labelKey: "sidebar.routing", href: "/dashboard/routing/", icon: Route, group: "config", minRole: "operator" },
  { labelKey: "sidebar.trafficShaping", href: "/dashboard/traffic-shaping/", icon: Activity, group: "config", minRole: "operator" },
  { labelKey: "sidebar.system", href: "/dashboard/system/", icon: Monitor, group: "config", minRole: "operator" },
  { labelKey: "sidebar.users", href: "/dashboard/users/", icon: UserCog, group: "config", minRole: "admin" },
  { labelKey: "sidebar.settings", href: "/dashboard/settings/", icon: Settings, group: "config", minRole: "admin" },
  { labelKey: "sidebar.backups", href: "/dashboard/backups/", icon: Archive, group: "config", minRole: "admin" },
];

function filterNavByRole(items: NavItem[], role: Role): NavItem[] {
  const userLevel = ROLE_LEVEL[role] ?? ROLE_LEVEL.client;
  return items.filter((item) => {
    const requiredLevel = ROLE_LEVEL[item.minRole ?? "client"];
    return userLevel >= requiredLevel;
  });
}

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
  const router = useRouter();
  const { t, locale, setLocale } = useI18n();
  const { theme, setTheme } = useTheme();
  const { user, logout } = useAuth();
  const { role } = useRole();

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

  const filteredNavItems = filterNavByRole(navItems, role);
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
              <div className="flex h-7 w-7 items-center justify-center rounded-lg overflow-hidden bg-primary">
                <img src="/favicon.ico" alt="Prisma" className="h-6 w-6" />
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
            aria-label={collapsed ? t("aria.expandButton") : t("aria.collapseButton")}
          >
            {collapsed ? (
              <PanelLeftOpen className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
          </Button>
        </div>

        {/* Server Selector */}
        <div className="border-b border-sidebar-border px-2 py-2">
          <ServerSelector collapsed={collapsed} />
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-3">
          {groups.map((group, gi) => {
            const items = filteredNavItems.filter((n) => n.group === group);
            if (items.length === 0) return null;
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

        {/* Footer — user menu, theme, locale, alerts */}
        <div className="border-t border-sidebar-border px-2 py-2">
          {/* User menu */}
          {user && (
            <DropdownMenu>
              <DropdownMenuTrigger
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-sidebar-accent/50 mb-1 ${
                  collapsed ? "justify-center" : ""
                }`}
              >
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                  {(user.username ?? "U").charAt(0).toUpperCase()}
                </div>
                {!collapsed && (
                  <div className="flex flex-1 items-center gap-2 overflow-hidden">
                    <span className="truncate text-sm font-medium text-foreground">
                      {user.username}
                    </span>
                    <span
                      className={`inline-block shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium capitalize leading-none ${ROLE_BADGE_CLASS[role] ?? ROLE_BADGE_CLASS.client}`}
                    >
                      {role}
                    </span>
                  </div>
                )}
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" sideOffset={8} align="start" className="min-w-[180px]">
                <DropdownMenuItem onClick={() => router.push("/dashboard/profile/")}>
                  <User className="h-4 w-4" />
                  {t("auth.profile")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => router.push("/dashboard/profile/")}>
                  <KeyRound className="h-4 w-4" />
                  {t("auth.changePassword")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={logout}>
                  <LogOut className="h-4 w-4" />
                  {t("auth.logout")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <div className={`flex items-center ${collapsed ? "flex-col gap-1" : "gap-1"}`}>
            <NotificationDrawer />
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setTheme(theme === "dark" ? "light" : theme === "light" ? "system" : "dark")}
              title={t("theme.title")}
              aria-label={t("aria.toggleTheme")}
            >
              {theme === "dark" ? <Moon className="h-4 w-4" /> : theme === "light" ? <Sun className="h-4 w-4" /> : <Monitor className="h-4 w-4" />}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setLocale(locale === "en" ? "zh" : "en")}
              title={locale === "en" ? "中文" : "English"}
              aria-label={t("aria.toggleLocale")}
            >
              <Globe className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </aside>
    </TooltipProvider>
  );
}

/** Mobile sidebar content (used inside Sheet) */
export function MobileSidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { t } = useI18n();
  const { role } = useRole();
  const filteredItems = filterNavByRole(navItems, role);

  return (
    <nav className="flex-1 space-y-1 px-3 py-4">
      {filteredItems.map(({ labelKey, href, icon: Icon, exact }) => {
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
