import { useState, useEffect } from "react";
import { NavLink } from "react-router-dom";
import { Home, List, GitBranch, ScrollText, Gauge, Settings, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const links = [
  { to: "/",          icon: Home,       label: "Home" },
  { to: "/profiles",  icon: List,       label: "Profiles" },
  { to: "/rules",     icon: GitBranch,  label: "Rules" },
  { to: "/logs",      icon: ScrollText, label: "Logs" },
  { to: "/speedtest", icon: Gauge,      label: "Speed" },
  { to: "/settings",  icon: Settings,   label: "Settings" },
];

const STORAGE_KEY = "prisma-sidebar-collapsed";

export default function Sidebar() {
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
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {collapsed ? <ChevronRight size={16} /> : <><ChevronLeft size={16} /><span>Collapse</span></>}
      </button>
    </nav>
  );
}
