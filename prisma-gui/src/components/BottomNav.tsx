import { NavLink } from "react-router-dom";
import { Home, List, GitBranch, ScrollText, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

const links = [
  { to: "/",         icon: Home,       label: "Home" },
  { to: "/profiles", icon: List,       label: "Profiles" },
  { to: "/rules",    icon: GitBranch,  label: "Rules" },
  { to: "/logs",     icon: ScrollText, label: "Logs" },
  { to: "/settings", icon: Settings,   label: "Settings" },
];

export default function BottomNav() {
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
