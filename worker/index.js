export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Proxy /api/* requests to the backend
    if (url.pathname.startsWith("/api/")) {
      const apiOrigin = env.API_ORIGIN;
      if (!apiOrigin) {
        return new Response("API_ORIGIN not configured", { status: 502 });
      }

      const apiUrl = apiOrigin + url.pathname + url.search;

      // Clone headers and add the real client IP
      const headers = new Headers(request.headers);
      headers.set(
        "x-real-client-ip",
        request.headers.get("cf-connecting-ip") || ""
      );
      // Prove to the API that this request really came through the Worker, so it will trust the
      // forwarded client IP above. Strip any client-supplied copy first, then set our own.
      headers.delete("x-proxy-auth");
      if (env.PROXY_SHARED_SECRET) {
        headers.set("x-proxy-auth", env.PROXY_SHARED_SECRET);
      }
      // Remove host header so it matches the API server
      headers.delete("host");

      const apiResponse = await fetch(apiUrl, {
        method: request.method,
        headers,
        body:
          request.method !== "GET" && request.method !== "HEAD"
            ? request.body
            : undefined,
        redirect: "manual",
      });

      // Forward the response back, preserving headers (including Set-Cookie)
      const responseHeaders = new Headers(apiResponse.headers);
      return new Response(apiResponse.body, {
        status: apiResponse.status,
        statusText: apiResponse.statusText,
        headers: responseHeaders,
      });
    }

    // For non-API routes, serve static assets (SPA fallback handled by wrangler.json)
    return env.ASSETS.fetch(request);
  },
};
