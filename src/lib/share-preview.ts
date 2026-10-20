import { renderSharePreview } from "../rig/SharePreviewRender";
import { getPreviewScene } from "./viewer-handle";

// Share links with a preview image. The app is static and its outfit lives in the URL fragment, which link
// crawlers never see, so the preview Worker (workers/share-preview) hosts a small page per shared outfit that
// carries an og:image rendered here. Off unless VITE_SHARE_PREVIEW_BASE is set at build time.

export const SHARE_PREVIEW_BASE = (import.meta.env.VITE_SHARE_PREVIEW_BASE ?? "").replace(/\/$/, "");

const links = new Map<string, Promise<string>>(); // outfit code -> preview link, so a repeat click reuses it

export const sharePreviewAvailable = () => SHARE_PREVIEW_BASE !== "" && getPreviewScene() !== null;

/** The short link's outfit code ("2.<codes>") from a short share URL. */
export function shortCode(shortUrl: string): string | null {
  const hash = new URL(shortUrl).hash;
  return hash.startsWith("#/?") ? new URLSearchParams(hash.slice(3)).get("o") : null;
}

async function create(code: string): Promise<string> {
  const scene = getPreviewScene();
  if (!scene) throw new Error("The viewer is not ready");
  const image = await renderSharePreview(scene);
  const response = await fetch(`${SHARE_PREVIEW_BASE}/api/share?o=${encodeURIComponent(code)}`, {
    method: "POST", headers: { "Content-Type": "image/jpeg" }, body: image });
  const body = await response.json().catch(() => ({})) as { url?: unknown; error?: unknown };
  if (!response.ok || typeof body.url !== "string" || !body.url.startsWith(`${SHARE_PREVIEW_BASE}/s/`))
    throw new Error(typeof body.error === "string" ? body.error : `Preview upload failed (${response.status})`);
  return body.url;
}

/** A link whose card shows the outfit. Rejects (and forgets the attempt) when the render or the upload fails. */
export function previewLink(code: string): Promise<string> {
  let link = links.get(code);
  if (!link) {
    link = create(code);
    links.set(code, link);
    link.catch(() => links.delete(code));
  }
  return link;
}
