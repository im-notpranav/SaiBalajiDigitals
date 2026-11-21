import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/api/client";

export interface CsmDirectoryEntry {
  id: number;
  name: string;
  username: string;
  code: string | null;
}

/** Everyone who can own an order, with their CSM code. Cached for the session. */
export function useCsmDirectory() {
  const { data } = useQuery({
    queryKey: ["csm-directory"],
    queryFn: () => apiFetch<{ directory: CsmDirectoryEntry[] }>("/users/csm-directory"),
    staleTime: 10 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  });
  const byId = new Map<number, CsmDirectoryEntry>();
  for (const e of data?.directory ?? []) byId.set(e.id, e);
  return byId;
}
