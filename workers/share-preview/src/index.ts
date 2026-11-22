// Link previews for shared outfits. The app is a static GitHub Pages site and its outfit lives in the URL fragment,
// which link crawlers (Discord, X, Slack, iMessage...) never send, so every shared link unfurls as the same generic
// card. This Worker gives a shared outfit its own URL:
//
//   POST /api/share?o=<outfit code>[&bt=<body type>][&pn=<player number>][&emote=<clip>&t=<s>&paused=1][&view=<camera>][&lt=<lighting>]
//                                     body: a 1200x630 JPEG
//                                     -> { url }
//   GET  /s/<id>?o=<outfit code>[&emote=..]   the page crawlers read: og:image + summary_large_image; people are
//                                     sent on to the builder with the outfit (and the pose, if any) loaded
//   GET  /i/<id>.jpg                  the preview image
//
// Abuse limits: uploads need an allowed Origin, are rate limited per IP, must be a baseline/progressive JPEG of exactly
// 1200x630 under MAX_BYTES, and get a random unguessable id (nothing can be overwritten). Entries expire after
// TTL_SECONDS; the outfit code also rides in the link, so an expired link still opens the outfit with the generic card.
// The optional pose (10 Nov 2026: an emote frame the card shows), body type (12 Nov 2026: `bt`, absent for
// Masculine), player number (21 Nov 2026: `pn`, absent for each piece's own) and camera view (21 Nov 2026: `view`, the
// camera the builder opens on; the card is unchanged) and lighting (22 Nov 2026: `lt`, the look the builder opens with,
// carried as an opaque value of the app's grammar) are stored and carried the same way as the code.
// Free-plan quotas (1,000 KV writes a day) are a hard ceiling: past it uploads fail and the app shares a plain link.

import {
  bodyTypeMetadata, bodyTypeQuery, HEIGHT, jpegSize, lightingMetadata, lightingQuery, MAX_BYTES, MAX_METADATA_BYTES,
  metadataBytes, newId, playerNumberMetadata, playerNumberQuery, poseMetadata, poseQuery, previewPage, readBodyType,
  readLighting, readPlayerNumber, readPose, readView, storedBodyType, storedLighting, storedPlayerNumber, storedPose,
  storedView, TTL_SECONDS, validCode, validId, viewMetadata, viewQuery, WIDTH, type Env,
} from "./share";

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
  const pose = readPose(url.searchParams);
  if (pose === null) return json({ error: "bad pose" }, 400, headers);
  const bodyType = readBodyType(url.searchParams);
  if (bodyType === null) return json({ error: "bad body type" }, 400, headers);
  const playerNumber = readPlayerNumber(url.searchParams);
  if (playerNumber === null) return json({ error: "bad player number" }, 400, headers);
  const view = readView(url.searchParams);
  if (view === null) return json({ error: "bad camera view" }, 400, headers);
  const lighting = readLighting(url.searchParams);
  if (lighting === null) return json({ error: "bad lighting" }, 400, headers);
  const metadata = { o: code, ...bodyTypeMetadata(bodyType), ...playerNumberMetadata(playerNumber), ...poseMetadata(pose),
    ...viewMetadata(view), ...lightingMetadata(lighting) };
  if (metadataBytes(metadata) > MAX_METADATA_BYTES) return json({ error: "link too long for a preview" }, 413, headers);
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
    await env.SHARES.put(`s:${id}`, bytes, { expirationTtl: TTL_SECONDS, metadata });
  } catch {
    return json({ error: "storage unavailable" }, 503, headers); // e.g. the daily write quota
  }
  return json({ url: `${url.origin}/s/${id}?o=${code}${bodyTypeQuery(bodyType)}${playerNumberQuery(playerNumber)}${poseQuery(pose)}${viewQuery(view)}${lightingQuery(lighting)}` },
    201, headers);
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
      const stored = await env.SHARES.getWithMetadata<Record<string, unknown>>(`s:${page[1]}`, { type: "stream", cacheTtl: 86400 });
      await stored.value?.cancel();
      // The stored code, body type, player number, pose, view and lighting belong to the stored image; the link's own only
      // open the outfit once the entry expired.
      const linked = url.searchParams.get("o");
      const storedCode = typeof stored.metadata?.o === "string" ? stored.metadata.o : null;
      const fromStore = !!stored.value && validCode(storedCode);
      const code = fromStore ? storedCode : validCode(linked) ? linked : null;
      const pose = !code ? undefined : fromStore ? storedPose(stored.metadata) : readPose(url.searchParams) ?? undefined;
      const bodyType = !code ? undefined
        : fromStore ? storedBodyType(stored.metadata) : readBodyType(url.searchParams) ?? undefined;
      const playerNumber = !code ? undefined
        : fromStore ? storedPlayerNumber(stored.metadata) : readPlayerNumber(url.searchParams) ?? undefined;
      const view = !code ? undefined : fromStore ? storedView(stored.metadata) : readView(url.searchParams) ?? undefined;
      const lighting = !code ? undefined
        : fromStore ? storedLighting(stored.metadata) : readLighting(url.searchParams) ?? undefined;
      const self = `${url.origin}/s/${page[1]}${code
        ? `?o=${code}${bodyTypeQuery(bodyType)}${playerNumberQuery(playerNumber)}${poseQuery(pose)}${viewQuery(view)}${lightingQuery(lighting)}` : ""}`;
      return new Response(previewPage(env, self, stored.value ? `${url.origin}/i/${page[1]}.jpg` : null, code, pose,
        bodyType, playerNumber, view, lighting), {
        headers: { ...security, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
    }
    return Response.redirect(env.APP_URL, 302);
  },
};
