// Link previews for shared outfits. The app is a static GitHub Pages site and its outfit lives in the URL fragment,
// which link crawlers (Discord, X, Slack, iMessage...) never send, so every shared link unfurls as the same generic
// card. This Worker gives a shared outfit its own URL:
//
//   POST /api/share?o=<outfit code>   body: a 1200x630 JPEG rendered in the browser -> { url }
//   GET  /s/<id>?o=<outfit code>      the page crawlers read: og:image + summary_large_image; people are sent on
//                                     to the builder with the outfit loaded
//   GET  /i/<id>.jpg                  the preview image
//
// Abuse limits: uploads need an allowed Origin, are rate limited per IP, must be a baseline/progressive JPEG of exactly
// 1200x630 under MAX_BYTES, and get a random unguessable id (nothing can be overwritten). Entries expire after
// TTL_SECONDS; the outfit code also rides in the link, so an expired link still opens the outfit with the generic card.
// Free-plan quotas (1,000 KV writes a day) are a hard ceiling: past it uploads fail and the app shares a plain link.

import { HEIGHT, jpegSize, MAX_BYTES, newId, previewPage, TTL_SECONDS, validCode, validId, WIDTH, type Env } from "./share";

function cors(env: Env, request: Request): Record<string, string> | null {
  const origin = request.headers.get("Origin");
  const allowed = env.ALLOWED_ORIGINS.split(",").map(s => s.trim()).filter(Boolean);
  if (!origin || !allowed.includes(origin)) return null;
  return { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST",
    "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400", Vary: "Origin" };
}

const json = (body: unknown, status: number, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

async function upload(request: Request, env: Env, url: URL): Promise<Response> {
  const headers = cors(env, request);
  if (!headers) return json({ error: "origin not allowed" }, 403);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405, headers);
  if (env.UPLOADS_DISABLED === "1") return json({ error: "uploads disabled" }, 503, headers);
  const code = url.searchParams.get("o");
  if (!validCode(code)) return json({ error: "bad outfit code" }, 400, headers);
  if (env.UPLOAD_LIMIT) {
    const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
    if (!(await env.UPLOAD_LIMIT.limit({ key: ip })).success) return json({ error: "slow down" }, 429, headers);
  }
  if (Number(request.headers.get("Content-Length") ?? 0) > MAX_BYTES) return json({ error: "too large" }, 413, headers);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length > MAX_BYTES) return json({ error: "too large" }, 413, headers);
  const size = jpegSize(bytes);
  if (!size || size.width !== WIDTH || size.height !== HEIGHT) return json({ error: `need a ${WIDTH}x${HEIGHT} JPEG` }, 415, headers);
  const id = newId();
  try {
    await env.SHARES.put(`s:${id}`, bytes, { expirationTtl: TTL_SECONDS, metadata: { o: code } });
  } catch {
    return json({ error: "storage unavailable" }, 503, headers); // e.g. the daily write quota
  }
  return json({ url: `${url.origin}/s/${id}?o=${code}` }, 201, headers);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const security = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
    if (url.pathname === "/api/share") return upload(request, env, url);
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("method not allowed", { status: 405 });

    const image = /^\/i\/([0-9A-Za-z]{12})\.jpg$/.exec(url.pathname);
    if (image) {
      const bytes = await env.SHARES.get(`s:${image[1]}`, { type: "arrayBuffer", cacheTtl: 86400 });
      if (!bytes) return new Response("not found", { status: 404, headers: security });
      return new Response(bytes, { headers: { ...security, "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=31536000, immutable", "Content-Security-Policy": "default-src 'none'" } });
    }

    const page = /^\/s\/([^/]+)$/.exec(url.pathname);
    if (page && validId(page[1])) {
      const stored = await env.SHARES.getWithMetadata<{ o?: string }>(`s:${page[1]}`, { type: "stream", cacheTtl: 86400 });
      await stored.value?.cancel();
      // The stored code belongs to the stored image; the link's own code only opens the outfit once the entry expired.
      const linked = url.searchParams.get("o");
      const code = stored.value && validCode(stored.metadata?.o ?? null) ? stored.metadata!.o! : validCode(linked) ? linked : null;
      const self = `${url.origin}/s/${page[1]}${code ? `?o=${code}` : ""}`;
      return new Response(previewPage(env, self, stored.value ? `${url.origin}/i/${page[1]}.jpg` : null, code), {
        headers: { ...security, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
    }
    return Response.redirect(env.APP_URL, 302);
  },
};
