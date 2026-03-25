"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { Sidebar, MobileSidebarContent } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { Breadcrumb } from "@/components/layout/breadcrumb";
import { CommandPalette } from "@/components/layout/command-palette";
import { MobileNav } from "@/components/layout/mobile-nav";
import { MetricsProvider } from "@/contexts/metrics-context";
import { useI18n } from "@/lib/i18n";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

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
  "/dashboard/analytics": "sidebar.analytics",
  "/dashboard/events": "sidebar.events",
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { t } = useI18n();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("prisma-sidebar-collapsed") === "true";
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);

  // Keyboard shortcuts overlay
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (e.key === "?") {
        setShowShortcuts((v) => !v);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Resolve page title using i18n
  const titleKey =
    Object.entries(PAGE_TITLE_KEYS)
      .sort(([a], [b]) => b.length - a.length)
      .find(([path]) => pathname.startsWith(path))?.[1] ?? "sidebar.overview";

  const title = t(titleKey);

  // Set document title for browser tab
  useEffect(() => {
    document.title = pathname === "/dashboard" || pathname === "/dashboard/"
      ? "Prisma Console"
      : `${title} | Prisma Console`;
  }, [pathname, title]);

  // Show breadcrumb on sub-pages (not the overview root)
  const showBreadcrumb = pathname !== "/dashboard" && pathname !== "/dashboard/";

  return (
    <MetricsProvider>
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
            <div className="mx-auto max-w-7xl px-4 py-6 pb-20 md:pb-6 sm:px-6 lg:px-8">
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

        {/* Mobile bottom navigation */}
        <MobileNav />

        <CommandPalette />

        {/* Keyboard shortcuts overlay */}
        <Dialog open={showShortcuts} onOpenChange={setShowShortcuts}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{t("shortcuts.title")}</DialogTitle>
              <DialogDescription className="sr-only">
                {t("shortcuts.title")}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              {[
                { keys: "Ctrl+K", label: t("shortcuts.openSearch") },
                { keys: "Esc", label: t("shortcuts.closeDialog") },
                { keys: "?", label: t("shortcuts.showShortcuts") },
                { keys: "\u2190 \u2192", label: t("shortcuts.navigate") },
              ].map(({ keys, label }) => (
                <div key={keys} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{label}</span>
                  <kbd className="rounded border border-border bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">
                    {keys}
                  </kbd>
                </div>
              ))}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </MetricsProvider>
  );
}
