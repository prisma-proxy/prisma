"use client";

import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme-context";
import { useI18n } from "@/lib/i18n";
import { Sun, Moon, Monitor, Globe, Menu, Search, LogOut } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { AlertBadge } from "@/components/alerts/alert-badge";

interface HeaderProps {
  title: string;
  onMobileMenuToggle?: () => void;
}

export function Header({ title, onMobileMenuToggle }: HeaderProps) {
  const { logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const { locale, setLocale, t } = useI18n();

  const themeIcon =
    theme === "light" ? (
      <Sun className="h-4 w-4" />
    ) : theme === "dark" ? (
      <Moon className="h-4 w-4" />
    ) : (
      <Monitor className="h-4 w-4" />
    );

  return (
    <header className="flex h-14 items-center justify-between border-b bg-card/50 backdrop-blur-sm px-4 sm:px-6">
      <div className="flex items-center gap-3">
        {onMobileMenuToggle && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="md:hidden"
            onClick={onMobileMenuToggle}
          >
            <Menu className="h-4 w-4" />
          </Button>
        )}
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
      </div>

      <div className="flex items-center gap-1.5">
        {/* Command palette hint */}
        <button
          type="button"
          onClick={() => {
            window.dispatchEvent(
              new KeyboardEvent("keydown", { key: "k", metaKey: true })
            );
          }}
          className="hidden sm:flex items-center gap-2 rounded-lg border bg-muted/50 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Search className="h-3.5 w-3.5" />
          <span>{t("common.search")}</span>
          <kbd className="ml-2 inline-flex h-5 items-center gap-0.5 rounded border bg-background px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
            <span className="text-xs">&#8984;</span>K
          </kbd>
        </button>

        {/* Alerts indicator */}
        <AlertBadge />

        {/* Theme Toggle */}
        <DropdownMenu>
          <DropdownMenuTrigger className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }))}>
            {themeIcon}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={8}>
            <DropdownMenuLabel>{t("theme.title")}</DropdownMenuLabel>
            <DropdownMenuItem
              onClick={() => setTheme("light")}
              className={theme === "light" ? "bg-accent" : ""}
            >
              <Sun className="h-4 w-4" />
              {t("theme.light")}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setTheme("dark")}
              className={theme === "dark" ? "bg-accent" : ""}
            >
              <Moon className="h-4 w-4" />
              {t("theme.dark")}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setTheme("system")}
              className={theme === "system" ? "bg-accent" : ""}
            >
              <Monitor className="h-4 w-4" />
              {t("theme.system")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Locale Switcher */}
        <DropdownMenu>
          <DropdownMenuTrigger className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }))}>
            <Globe className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={8}>
            <DropdownMenuItem
              onClick={() => setLocale("en")}
              className={locale === "en" ? "bg-accent" : ""}
            >
              English
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setLocale("zh")}
              className={locale === "zh" ? "bg-accent" : ""}
            >
              中文
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="h-5 w-px bg-border" />

        {/* Sign Out */}
        <Button variant="ghost" size="icon-sm" onClick={logout} title={t("auth.logout")}>
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}
