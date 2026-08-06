/**
 * Same-origin proxy: /api/* on the Pages domain -> the Express API on Render.
 *
 * This exists so the browser never makes a cross-site request. The auth cookie
 * is set with sameSite: "strict"; if the SPA and the API were on different
 * sites (*.pages.dev vs *.onrender.com are different sites), the browser would
 * store that cookie and never send it again, and every request after login
 * would 401.
 *
 * Requires the API_ORIGIN environment variable on the Pages project, e.g.
 * https://sb-oms-api.onrender.com
 */
interface Env {
  API_ORIGIN: string;
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.API_ORIGIN) {
    return new Response("API_ORIGIN is not configured", { status: 500 });
  }

  const incoming = new URL(request.url);
  const target = new URL(env.API_ORIGIN);
  target.pathname = incoming.pathname;
  target.search = incoming.search;

  const headers = new Headers(request.headers);
  // Preserve the real client address for rate limiting (see utils/rate-limit.ts).
  const clientIp = request.headers.get("CF-Connecting-IP");
  if (clientIp) headers.set("x-real-client-ip", clientIp);
  headers.set("x-forwarded-proto", "https");
  headers.set("x-forwarded-host", incoming.host);

  const hasBody = request.method !== "GET" && request.method !== "HEAD";

  const upstream = await fetch(target.toString(), {
    method: request.method,
    headers,
    body: hasBody ? request.body : undefined,
    redirect: "manual",
  });

  // Constructing from the upstream response preserves multiple Set-Cookie headers.
  return new Response(upstream.body, upstream);
};
