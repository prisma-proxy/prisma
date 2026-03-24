"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider, QueryCache, MutationCache } from "@tanstack/react-query";
import { AuthProvider } from "@/lib/auth-context";
import { ThemeProvider } from "@/lib/theme-context";
import { ToastProvider, useToast } from "@/lib/toast-context";
import { I18nProvider } from "@/lib/i18n";

/** Bridges React Query errors to the toast notification system. */
function QueryLayer({ children }: { children: React.ReactNode }) {
  const { toast } = useToast();

  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5 * 1000,
            refetchOnWindowFocus: false,
          },
        },
        queryCache: new QueryCache({
          onError: (error, query) => {
            // Only toast for queries that previously had data (background refetch failure).
            // Avoids spamming toasts on initial page load when API is unreachable.
            if (query.state.data !== undefined) {
              toast(error.message || "Failed to refresh data", "error");
            }
          },
        }),
        mutationCache: new MutationCache({
          onError: (error) => {
            toast(error.message || "Operation failed", "error");
          },
        }),
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <I18nProvider>
        <AuthProvider>
          <ToastProvider>
            <QueryLayer>
              {children}
            </QueryLayer>
          </ToastProvider>
        </AuthProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}
