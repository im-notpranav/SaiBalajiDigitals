import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { getRouter } from "./router";
import { queryClient } from "./lib/query-client";
import "./styles.css";

const router = getRouter(queryClient);

/**
 * The index.html splash stays up until the sign-in check has answered (it can take a while
 * when the API is waking up), and at least until the logo has finished putting itself
 * together, then fades out over the page. A page that never checks sign-in (404) lets it go
 * after a short wait.
 */
declare global {
  interface Window {
    __sbSplashStart?: number;
    __sbSplashShown?: boolean;
  }
}
const ASSEMBLE_MS = 1600;
function releaseSplash() {
  const splash = document.getElementById("sb-splash");
  if (!splash) return;
  window.__sbSplashShown = true;
  const started = window.__sbSplashStart ?? performance.now();
  const wait = Math.max(0, ASSEMBLE_MS - (performance.now() - started));
  setTimeout(() => {
    splash.classList.add("sb-gone");
    setTimeout(() => splash.remove(), 400);
  }, wait);
  unsubscribe();
}
const authSettled = () => {
  const state = queryClient.getQueryState(["auth", "me"]);
  return !!state && state.status !== "pending";
};
const unsubscribe = queryClient.getQueryCache().subscribe(() => {
  if (authSettled()) releaseSplash();
});
setTimeout(() => {
  if (!queryClient.getQueryState(["auth", "me"])) releaseSplash();
}, 2500);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>
);
