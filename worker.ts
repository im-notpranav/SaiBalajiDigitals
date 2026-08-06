export default {
  async fetch(request: Request, env: Record<string, string>): Promise<Response> {
    const url = new URL(request.url);

    // Proxy /api/* requests to the backend
    if (url.pathname.startsWith("/api")) {
      const apiOrigin = env.API_ORIGIN;
      if (!apiOrigin) {
        return new Response("API_ORIGIN not configured", { status: 502 });
      }

      const target = new URL(url.pathname + url.search, apiOrigin);

      const headers = new Headers(request.headers);
      headers.set("x-real-client-ip", request.headers.get("cf-connecting-ip") || "unknown");
      // Remove host header so it matches the backend
      headers.delete("host");

      const proxyRequest = new Request(target.toString(), {
        method: request.method,
        headers,
        body: request.method !== "GET" && request.method !== "HEAD" ? request.body : undefined,
        redirect: "manual",
      });

      const response = await fetch(proxyRequest);

      // Forward the response back with CORS-safe headers
      const responseHeaders = new Headers(response.headers);
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
    }

    // All non-API requests are handled by the assets binding (static files)
    return env.ASSETS.fetch(request);
  },
} as ExportedHandler;
