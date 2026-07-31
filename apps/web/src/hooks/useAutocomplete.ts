import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/api/client";

export function useClientAutocomplete(search: string) {
  return useQuery({
    queryKey: ["clients", search],
    queryFn: async () => {
      const res = await apiFetch<{ clients: string[] }>(`/clients?q=${encodeURIComponent(search)}`);
      return res.clients;
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

export function useMediaAutocomplete(search: string) {
  return useQuery({
    queryKey: ["media", search],
    queryFn: async () => {
      const res = await apiFetch<{ media: string[] }>(`/media?q=${encodeURIComponent(search)}`);
      return res.media;
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}
