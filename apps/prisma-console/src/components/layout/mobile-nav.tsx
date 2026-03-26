"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Network,
  Users,
  Route,
  MoreHorizontal,
  BarChart3,
  Gauge,
  Monitor,
  Settings,
  Archive,
  Radio,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";

interface MobileTab {
  labelKey: string;
  href: string;
  icon: typeof LayoutDashboard;
  exact?: boolean;
}

const primaryTabs: MobileTab[] = [
  { labelKey: "sidebar.overview", href: "/dashboard/", icon: LayoutDashboard, exact: true },
  { labelKey: "sidebar.connections", href: "/dashboard/connections/", icon: Network },
  { labelKey: "sidebar.clients", href: "/dashboard/clients/", icon: Users },
  { labelKey: "sidebar.routing", href: "/dashboard/routing/", icon: Route },
];

const moreTabs: MobileTab[] = [
  { labelKey: "sidebar.events", href: "/dashboard/events/", icon: Radio },
  { labelKey: "sidebar.speedTest", href: "/dashboard/speed-test/", icon: Gauge },
  { labelKey: "sidebar.analytics", href: "/dashboard/analytics/", icon: BarChart3 },
  { labelKey: "sidebar.system", href: "/dashboard/system/", icon: Monitor },
  { labelKey: "sidebar.settings", href: "/dashboard/settings/", icon: Settings },
  { labelKey: "sidebar.backups", href: "/dashboard/backups/", icon: Archive },
];

function isActive(pathname: string, href: string, exact?: boolean): boolean {
  const base = href.replace(/\/$/, "");
  if (exact) return pathname === base || pathname === base + "/";
  return pathname === base || pathname.startsWith(base + "/");
}

export function MobileNav() {
  const pathname = usePathname();
  const { t } = useI18n();
  const [moreOpen, setMoreOpen] = useState(false);

  // Check if any "more" tab is active — if so, highlight the More button
  const moreIsActive = moreTabs.some((tab) => isActive(pathname, tab.href));

  return (
    <>
      <nav
        className="fixed bottom-0 left-0 right-0 z-50 flex border-t border-border bg-card md:hidden pb-[env(safe-area-inset-bottom)]"
        role="navigation"
        aria-label={t("mobileNav.navigation")}
      >
        {primaryTabs.map(({ labelKey, href, icon: Icon, exact }) => {
          const active = isActive(pathname, href, exact);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] font-medium transition-colors min-h-[44px] justify-center",
                active
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-5 w-5" />
              <span className="truncate">{t(labelKey)}</span>
            </Link>
          );
        })}

        {/* More tab */}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          className={cn(
            "flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] font-medium transition-colors min-h-[44px] justify-center",
            moreIsActive
              ? "text-primary"
              : "text-muted-foreground hover:text-foreground",
          )}
          aria-label={t("mobileNav.more")}
        >
          <MoreHorizontal className="h-5 w-5" />
          <span className="truncate">{t("mobileNav.more")}</span>
        </button>
      </nav>

      {/* More sheet */}
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" showCloseButton={false} className="rounded-t-xl pb-[env(safe-area-inset-bottom)]">
          <SheetTitle className="px-4 pt-3 pb-1 text-sm font-semibold">
            {t("mobileNav.more")}
          </SheetTitle>
          <nav className="grid grid-cols-3 gap-1 px-3 pb-4">
            {moreTabs.map(({ labelKey, href, icon: Icon }) => {
              const active = isActive(pathname, href);
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setMoreOpen(false)}
                  className={cn(
                    "flex flex-col items-center gap-1.5 rounded-lg py-3 px-2 text-xs font-medium transition-colors",
                    active
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <Icon className="h-5 w-5" />
                  <span className="text-center leading-tight">{t(labelKey)}</span>
                </Link>
              );
            })}
          </nav>
        </SheetContent>
      </Sheet>
    </>
  );
}
