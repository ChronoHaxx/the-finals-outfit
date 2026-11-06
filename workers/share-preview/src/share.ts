// Pure parts of the share-preview Worker, kept out of index.ts: workerd treats every named export of the main
// module as an entrypoint, so the main module may export only its handler.

export interface Env {
  SHARES: KVNamespace;
  UPLOAD_LIMIT?: { limit(options: { key: string }): Promise<{ success: boolean }> };
  APP_URL: string; // e.g. https://chronohaxx.github.io/the-finals-outfit/
  ALLOWED_ORIGINS: string; // comma-separated
  UPLOADS_DISABLED?: string; // "1" stops new uploads; existing links keep working
}

export const WIDTH = 1200, HEIGHT = 630, MAX_BYTES = 250_000, TTL_SECONDS = 365 * 24 * 3600;
const ID = /^[0-9A-Za-z]{12}$/;
export const validId = (id: string) => ID.test(id);
// The app's short-link grammar (src/lib/share-url.ts): "2." then up to one code per slot.
const CODE = /^2\.(?:[0-9a-z]{2,5}(?:\.[0-9a-z]{2,5}){0,39})?$/;

export const validCode = (code: string | null): code is string => code !== null && CODE.test(code);

/** Width and height of a JPEG from its first SOF marker, or null when the bytes are not a well-formed JPEG. */
export function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return null;
  if (bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) return null;
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    if (marker === 0xff) { i++; continue; } // fill byte
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    if (length < 2 || i + 2 + length > bytes.length) return null;
    // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (length < 7) return null;
      return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8] };
    }
    if (marker === 0xda) return null; // scan before any frame header
    i += 2 + length;
  }
  return null;
}

export function newId(): string {
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let id = "";
  while (id.length < 12) for (const byte of crypto.getRandomValues(new Uint8Array(16)))
    if (byte < 248 && id.length < 12) id += alphabet[byte % 62]; // 248 = 4 * 62: no modulo bias
  return id;
}

const escape = (text: string) => text.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const appLink = (env: Env, code: string | null) => `${env.APP_URL}${code ? `#/?o=${code}` : ""}`;

export function previewPage(env: Env, self: string, image: string | null, code: string | null): string {
  const app = appLink(env, code);
  const title = code ? "THE FINALS outfit" : "the-finals-outfit";
  const meta = [
    ["og:site_name", "the-finals-outfit"], ["og:type", "website"], ["og:title", title],
    ["og:description", "A look made in the fan-made THE FINALS outfit builder. Open it to turn it around in 3D."],
    ["og:url", self],
    ...(image ? [["og:image", image], ["og:image:width", String(WIDTH)], ["og:image:height", String(HEIGHT)],
      ["og:image:type", "image/jpeg"], ["og:image:alt", "The outfit from the front, three-quarter, side and back"]] : []),
  ].map(([property, content]) => `<meta property="${property}" content="${escape(content)}">`);
  const twitter = [["twitter:card", image ? "summary_large_image" : "summary"], ["twitter:title", title],
    ...(image ? [["twitter:image", image]] : [])].map(([name, content]) => `<meta name="${name}" content="${escape(content)}">`);
  // No meta refresh: some crawlers follow it and would read the app's generic tags instead of these.
  // noindex: each share page is a per-person redirect, not a page to rank; link-preview bots ignore it.
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escape(title)}</title>
<meta name="robots" content="noindex">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#5b8def">
${[...meta, ...twitter].join("\n")}
<script>location.replace(${JSON.stringify(app).replace(/</g, "\\u003c")})</script></head>
<body style="font-family:system-ui,sans-serif;background:#0b0b0e;color:#e5e5e5;padding:2rem">
<a style="color:#93c5fd" href="${escape(app)}">Open this outfit in the builder</a></body></html>`;
}
