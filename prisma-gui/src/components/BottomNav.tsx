import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Home, List, GitBranch, Network, ScrollText, BarChart3, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

export default function BottomNav() {
  const { t } = useTranslation();

  const links = [
    { to: "/",         icon: Home,       label: t("nav.home") },
    { to: "/profiles", icon: List,       label: t("nav.profiles") },
    { to: "/rules",    icon: GitBranch,  label: t("nav.rules") },
    { to: "/connections", icon: Network, label: t("nav.connections") },
    { to: "/logs",     icon: ScrollText, label: t("nav.logs") },
    { to: "/analytics", icon: BarChart3, label: t("nav.analytics") },
    { to: "/settings", icon: Settings,   label: t("nav.settings") },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 flex border-t border-border bg-card pb-[env(safe-area-inset-bottom)]">
      {links.map(({ to, icon: Icon, label }) => (
        <NavLink
          key={to}
          to={to}
          end={to === "/"}
          className={({ isActive }) =>
            cn(
              "flex flex-1 flex-col items-center gap-1 py-2 text-muted-foreground hover:text-foreground transition-colors text-[10px]",
              isActive && "text-foreground",
            )
          }
        >
          <Icon size={22} />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
