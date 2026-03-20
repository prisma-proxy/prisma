"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Sidebar, MobileSidebarContent } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { Breadcrumb } from "@/components/layout/breadcrumb";
import { CommandPalette } from "@/components/layout/command-palette";
import { ToastProvider } from "@/lib/toast-context";
import { MetricsProvider } from "@/contexts/metrics-context";
import { useI18n } from "@/lib/i18n";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";

const PAGE_TITLE_KEYS: Record<string, string> = {
  "/dashboard": "sidebar.overview",
  "/dashboard/connections": "sidebar.connections",
  "/dashboard/servers": "sidebar.server",
  "/dashboard/clients": "sidebar.clients",
  "/dashboard/routing": "sidebar.routing",
  "/dashboard/logs": "sidebar.logs",
  "/dashboard/settings": "sidebar.settings",
  "/dashboard/system": "sidebar.system",
  "/dashboard/traffic-shaping": "sidebar.trafficShaping",
  "/dashboard/backups": "sidebar.backups",
  "/dashboard/speed-test": "sidebar.speedTest",
  "/dashboard/bandwidth": "sidebar.bandwidth",
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { t } = useI18n();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("prisma-sidebar-collapsed") === "true";
  });
  const [mobileOpen, setMobileOpen] = useState(false);

  // Resolve page title using i18n
  const titleKey =
    Object.entries(PAGE_TITLE_KEYS)
      .sort(([a], [b]) => b.length - a.length)
      .find(([path]) => pathname.startsWith(path))?.[1] ?? "sidebar.overview";

  const title = t(titleKey);

  // Show breadcrumb on sub-pages (not the overview root)
  const showBreadcrumb = pathname !== "/dashboard" && pathname !== "/dashboard/";

  return (
    <MetricsProvider>
    <ToastProvider>
      <div className="flex h-screen">
        {/* Desktop sidebar */}
        <div className="hidden md:block">
          <Sidebar
            collapsed={sidebarCollapsed}
            onCollapsedChange={(v) => {
              setSidebarCollapsed(v);
              localStorage.setItem("prisma-sidebar-collapsed", String(v));
            }}
          />
        </div>

        {/* Mobile sidebar (Sheet drawer) */}
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent
            side="left"
            showCloseButton
            className="w-64 bg-sidebar p-0"
          >
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <div className="flex h-14 items-center border-b border-sidebar-border px-6">
              <span className="text-lg font-semibold tracking-tight text-sidebar-foreground">
                Prisma
              </span>
            </div>
            <MobileSidebarContent onNavigate={() => setMobileOpen(false)} />
          </SheetContent>
        </Sheet>

        {/* Main content area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <Header
            title={title}
            onMobileMenuToggle={() => setMobileOpen(true)}
          />
          <main className="flex-1 overflow-y-auto bg-background">
            <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
              {showBreadcrumb && (
                <div className="mb-4">
                  <Breadcrumb />
                </div>
              )}
              <div key={pathname} className="animate-in-page">
                {children}
              </div>
            </div>
          </main>
        </div>

        <CommandPalette />
      </div>
    </ToastProvider>
    </MetricsProvider>
  );
}
