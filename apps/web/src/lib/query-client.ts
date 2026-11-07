import { QueryClient } from "@tanstack/react-query";

/**
 * The app's one query cache. Going back to a page seen moments ago shows it at once and asks the
 * API nothing; after 30 seconds it shows at once and refreshes behind the scenes. Saving something
 * still refreshes it straight away, through invalidateQueries.
 */
export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, gcTime: 30 * 60_000, retry: 1 } },
});
