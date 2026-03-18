"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

export type ToastVariant = "success" | "error" | "warning";

export interface ToastItem {
  id: string;
  message: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  toasts: ToastItem[];
  toast: (message: string, variant?: ToastVariant) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let toastId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, variant: ToastVariant = "success") => {
      const id = String(++toastId);
      setToasts((prev) => [...prev, { id, message, variant }]);
      setTimeout(() => dismiss(id), variant === "error" ? 5000 : 3000);
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={{ toasts, toast, dismiss }}>
      {children}
      {/* Toast container */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="alert"
            className={`rounded-lg border px-4 py-3 text-sm font-medium shadow-lg transition-all animate-in slide-in-from-bottom-2 ${
              t.variant === "success"
                ? "border-green-500/50 bg-green-500/10 text-green-700 dark:text-green-400"
                : t.variant === "error"
                ? "border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-400"
                : "border-yellow-500/50 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span>{t.message}</span>
              <button
                onClick={() => dismiss(t.id)}
                className="text-current opacity-70 hover:opacity-100"
              >
                &times;
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
