import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Bell, Trash2, AlertCircle, CheckCircle, Info, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useNotifications } from "@/store/notifications";
import { fmtRelativeTime } from "@/lib/format";

const typeIcon = {
  error:   <AlertCircle size={14} className="text-destructive shrink-0" />,
  warning: <AlertTriangle size={14} className="text-yellow-500 shrink-0" />,
  success: <CheckCircle size={14} className="text-green-500 shrink-0" />,
  info:    <Info size={14} className="text-blue-400 shrink-0" />,
};

export default function NotificationHistory() {
  const { t } = useTranslation();
  const items = useNotifications((s) => s.items);
  const lastSeen = useNotifications((s) => s.lastSeenTimestamp);
  const markSeen = useNotifications((s) => s.markSeen);
  const clearAll = useNotifications((s) => s.clearAll);
  const [open, setOpen] = useState(false);

  const unreadCount = useMemo(() => items.filter((n) => n.timestamp > lastSeen).length, [items, lastSeen]);
  const sorted = useMemo(() => open ? [...items].reverse() : [], [items, open]);

  function handleOpen() {
    setOpen(true);
    markSeen();
  }

  return (
    <>
      <button
        type="button"
        className="relative flex items-center justify-center w-5 h-5 shrink-0"
        title={t("notifications.history")}
        onClick={handleOpen}
      >
        <Bell size={13} className="text-muted-foreground" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] rounded-full bg-destructive text-[9px] text-white flex items-center justify-center px-0.5">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md max-h-[70vh] flex flex-col">
          <DialogHeader className="flex-row items-center justify-between">
            <DialogTitle className="text-sm">{t("notifications.history")}</DialogTitle>
            {items.length > 0 && (
              <Button size="sm" variant="ghost" onClick={clearAll} className="h-7 px-2">
                <Trash2 size={12} /> {t("notifications.clearAll")}
              </Button>
            )}
          </DialogHeader>
          <ScrollArea className="flex-1 -mx-2 px-2">
            {sorted.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-8">
                {t("notifications.noNotifications")}
              </p>
            ) : (
              <div className="space-y-1.5 py-2">
                {sorted.map((n) => (
                  <div key={n.id} className="flex items-start gap-2 rounded-md border bg-card px-3 py-2">
                    {typeIcon[n.type]}
                    <div className="min-w-0 flex-1">
                      <p className="text-xs break-words">{n.message}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {fmtRelativeTime(new Date(n.timestamp).toISOString())}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}
