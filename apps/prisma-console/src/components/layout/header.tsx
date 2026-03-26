"use client";

import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/theme-context";
import { Menu, Search, LogOut, Sun, Moon, Monitor, Globe } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { NotificationDrawer } from "@/components/layout/notification-drawer";
import { cn } from "@/lib/utils";

interface HeaderProps {
  title: string;
  onMobileMenuToggle?: () => void;
}

export function Header({ title, onMobileMenuToggle }: HeaderProps) {
  const { logout } = useAuth();
  const { t, locale, setLocale } = useI18n();
  const { theme, setTheme } = useTheme();

  return (
    <header className="flex h-14 items-center justify-between border-b bg-card/50 backdrop-blur-sm px-4 sm:px-6">
      <div className="flex items-center gap-3">
        {onMobileMenuToggle && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="md:hidden"
            onClick={onMobileMenuToggle}
            aria-label={t("aria.mobileMenu")}
          >
            <Menu className="h-4 w-4" />
          </Button>
        )}
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
      </div>

      <div className="flex items-center gap-1.5">
        {/* Notification bell */}
        <NotificationDrawer />

        {/* Theme toggle */}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setTheme(theme === "dark" ? "light" : theme === "light" ? "system" : "dark")}
          title={t("theme.title")}
          aria-label={t("aria.toggleTheme")}
        >
          {theme === "dark" ? <Moon className="h-4 w-4" /> : theme === "light" ? <Sun className="h-4 w-4" /> : <Monitor className="h-4 w-4" />}
        </Button>

        {/* Language toggle */}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setLocale(locale === "en" ? "zh" : "en")}
          title={locale === "en" ? "中文" : "English"}
          aria-label={t("aria.toggleLocale")}
        >
          <Globe className="h-4 w-4" />
        </Button>

        {/* Search */}
        <button
          type="button"
          onClick={() => {
            window.dispatchEvent(new Event("open-command-palette"));
          }}
          className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }))}
          title={`${t("common.search")} (⌘K)`}
          aria-label={t("aria.searchPages")}
        >
          <Search className="h-4 w-4" />
        </button>

        <div className="h-5 w-px bg-border" />

        <Button variant="ghost" size="icon-sm" onClick={logout} title={t("auth.logout")} aria-label={t("auth.logout")}>
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}
