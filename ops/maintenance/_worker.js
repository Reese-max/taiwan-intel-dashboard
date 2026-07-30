export default {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(new URL("/", request.url));
    return new Response(response.body, {
      status: 503,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store, max-age=0",
        "Retry-After": "86400",
        "X-Robots-Tag": "noindex, nofollow, noarchive",
      },
    });
  },
};
