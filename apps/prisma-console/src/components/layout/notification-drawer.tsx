"use client";

import { Bell, CheckCheck, Trash2, Info, CircleCheck, CircleX, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  useNotificationStore,
  type Notification,
} from "@/lib/notification-store";
import { useI18n } from "@/lib/i18n";

function formatRelativeTime(timestamp: string): string {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diff = Math.max(0, Math.floor((now - then) / 1000));

  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

function NotificationIcon({ type }: { type: Notification["type"] }) {
  switch (type) {
    case "success":
      return <CircleCheck className="h-4 w-4 shrink-0 text-green-500" />;
    case "error":
      return <CircleX className="h-4 w-4 shrink-0 text-red-500" />;
    case "info":
    default:
      return <Info className="h-4 w-4 shrink-0 text-blue-500" />;
  }
}

function NotificationItem({
  notification,
  onDismiss,
}: {
  notification: Notification;
  onDismiss: (id: string) => void;
}) {
  return (
    <div
      className={`group flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm transition-colors ${
        notification.read
          ? "border-transparent bg-transparent opacity-60"
          : "border-border bg-muted/30"
      }`}
    >
      <NotificationIcon type={notification.type} />
      <div className="flex-1 min-w-0">
        <p className="text-sm leading-snug break-words">{notification.message}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {formatRelativeTime(notification.timestamp)}
        </p>
      </div>
      <button
        onClick={() => onDismiss(notification.id)}
        className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
        aria-label="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function NotificationDrawer() {
  const { t } = useI18n();
  const notifications = useNotificationStore((s) => s.notifications);
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const markRead = useNotificationStore((s) => s.markRead);
  const markAllRead = useNotificationStore((s) => s.markAllRead);
  const clear = useNotificationStore((s) => s.clear);

  const handleDismiss = (id: string) => {
    markRead(id);
  };

  return (
    <Sheet>
      <SheetTrigger
        className="relative inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </SheetTrigger>

      <SheetContent side="right" className="flex flex-col">
        <SheetHeader>
          <SheetTitle>{t("notifications.title")}</SheetTitle>
          <SheetDescription>
            {unreadCount > 0
              ? t("notifications.unreadCount", { count: unreadCount })
              : t("notifications.allRead")}
          </SheetDescription>
        </SheetHeader>

        {/* Actions */}
        {notifications.length > 0 && (
          <div className="flex gap-1 px-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={markAllRead}
              disabled={unreadCount === 0}
            >
              <CheckCheck className="h-3.5 w-3.5 mr-1" />
              {t("notifications.markAllRead")}
            </Button>
            <Button variant="ghost" size="sm" onClick={clear}>
              <Trash2 className="h-3.5 w-3.5 mr-1" />
              {t("notifications.clearAll")}
            </Button>
          </div>
        )}

        {/* Notification list */}
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center text-sm text-muted-foreground">
              <Bell className="h-8 w-8 mb-2 opacity-30" />
              <p>{t("notifications.empty")}</p>
            </div>
          ) : (
            <div className="space-y-1">
              {notifications.map((notification) => (
                <NotificationItem
                  key={notification.id}
                  notification={notification}
                  onDismiss={handleDismiss}
                />
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
