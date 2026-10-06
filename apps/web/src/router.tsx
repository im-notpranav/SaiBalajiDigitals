import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = (queryClient: QueryClient) => {

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    // Render unknown URLs at the root. In the default "fuzzy" mode the pathless
    // _portal layout claims them, and its auth guard bounces the visitor to /login
    // before the 404 page can show.
    notFoundMode: "root",
  });

  return router;
};
