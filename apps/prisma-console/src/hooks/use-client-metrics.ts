"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useAllClientMetrics() {
  return useQuery({
    queryKey: ["client-metrics"],
    queryFn: () => api.getClientMetrics(),
    refetchInterval: 10000,
  });
}

export function useClientMetrics(id: string) {
  return useQuery({
    queryKey: ["client-metrics", id],
    queryFn: () => api.getSingleClientMetrics(id),
    refetchInterval: 10000,
    enabled: !!id,
  });
}

export function useClientMetricsHistory(id: string, period?: string) {
  return useQuery({
    queryKey: ["client-metrics-history", id, period],
    queryFn: () => api.getClientMetricsHistory(id, period),
    refetchInterval: 30000,
    enabled: !!id,
  });
}
