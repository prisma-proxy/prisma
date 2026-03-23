"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useInbounds() {
  return useQuery({
    queryKey: ["inbounds"],
    queryFn: api.getInbounds,
    refetchInterval: 30000,
  });
}

export function useInbound(tag: string) {
  return useQuery({
    queryKey: ["inbounds", tag],
    queryFn: () => api.getInbound(tag),
    enabled: !!tag,
  });
}

export function useUpdateInboundClients(tag: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      add?: { id?: string; email?: string; flow?: string; alter_id?: number; password?: string }[];
      remove?: string[];
    }) => api.updateInboundClients(tag, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inbounds"] });
      queryClient.invalidateQueries({ queryKey: ["inbounds", tag] });
    },
  });
}
