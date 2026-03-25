"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { ClientPermissions } from "@/lib/types";

export function useClientPermissions(clientId: string | null) {
  return useQuery({
    queryKey: ["client-permissions", clientId],
    queryFn: () => api.getClientPermissions(clientId!),
    enabled: !!clientId,
    refetchInterval: 30000,
  });
}

export function useUpdateClientPermissions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: ClientPermissions }) =>
      api.updateClientPermissions(id, data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["client-permissions", variables.id] });
    },
  });
}
