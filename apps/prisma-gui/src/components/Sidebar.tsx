import { useState, useEffect } from "react";
import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Home, List, GitBranch, Network, ScrollText, Gauge, BarChart3, Activity, AppWindow, Settings, ChevronLeft, ChevronRight, Globe } from "lucide-react";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "prisma-sidebar-collapsed";

export default function Sidebar() {
  const { t } = useTranslation();

  const links = [
    { to: "/",          icon: Home,       label: t("nav.home") },
    { to: "/profiles",  icon: List,       label: t("nav.profiles") },
    { to: "/subscriptions", icon: Globe,  label: t("nav.subscriptions") },
    { to: "/rules",     icon: GitBranch,  label: t("nav.rules") },
    { to: "/connections", icon: Network,  label: t("nav.connections") },
    { to: "/logs",      icon: ScrollText, label: t("nav.logs") },
    { to: "/speedtest", icon: Gauge,      label: t("nav.speed") },
    { to: "/diagnostics", icon: Activity, label: t("nav.diagnostics") },
    { to: "/analytics", icon: BarChart3,  label: t("nav.analytics") },
    { to: "/per-app",   icon: AppWindow,  label: t("nav.perApp") },
    { to: "/settings",  icon: Settings,   label: t("nav.settings") },
  ];

  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(STORAGE_KEY) === "true"
  );

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(collapsed));
  }, [collapsed]);

  return (
    <nav
      className={cn(
        "flex flex-col border-r border-border bg-card py-4 gap-1 shrink-0 transition-all duration-200",
        collapsed ? "w-[52px]" : "w-[180px]"
      )}
    >
      <div className="flex-1 flex flex-col gap-1">
        {links.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 py-2.5 px-3 rounded-lg mx-2 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors text-sm",
                isActive && "bg-accent text-foreground",
                collapsed && "justify-center px-2"
              )
            }
            title={collapsed ? label : undefined}
          >
            <Icon size={18} className="shrink-0" />
            {!collapsed && <span className="truncate">{label}</span>}
          </NavLink>
        ))}
      </div>

      {/* Collapse toggle */}
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className={cn(
          "flex items-center gap-2 py-2 px-3 mx-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors text-xs",
          collapsed && "justify-center px-2"
        )}
        title={collapsed ? t("nav.collapse") : t("nav.collapse")}
      >
        {collapsed ? <ChevronRight size={16} /> : <><ChevronLeft size={16} /><span>{t("nav.collapse")}</span></>}
      </button>
    </nav>
  );
}
