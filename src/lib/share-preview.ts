import { renderSharePreview } from "../rig/SharePreviewRender";
import { getPreviewScene } from "./viewer-handle";
import { poseParams, type PoseCapture } from "./share-pose";
import { BODY_TYPE_PARAM } from "./body-type";

// Share links with a preview image. The app is static and its outfit lives in the URL fragment, which link
// crawlers never see, so the preview Worker (workers/share-preview) hosts a small page per shared outfit that
// carries an og:image rendered here. Off unless VITE_SHARE_PREVIEW_BASE is set at build time.
//
// With a pose (an emote frame on screen, 10 Nov 2026) the card shows that frame and says which it is, and the pose
// rides in the upload so the Worker's page opens the builder on it.

export const SHARE_PREVIEW_BASE = (import.meta.env?.VITE_SHARE_PREVIEW_BASE ?? "").replace(/\/$/, ""); // no env in node tests

const links = new Map<string, Promise<string>>(); // outfit code + exact pose -> preview link, so a repeat click reuses it

export const sharePreviewAvailable = () => SHARE_PREVIEW_BASE !== "" && getPreviewScene() !== null;

/** The short link's outfit code ("2.<codes>") from a short share URL. */
export function shortCode(shortUrl: string): string | null {
  const hash = new URL(shortUrl).hash;
  return hash.startsWith("#/?") ? new URLSearchParams(hash.slice(3)).get("o") : null;
}

/** The upload's query: the outfit code, the body type's share code (body-type.ts; none for Masculine), then the
 *  pose's parameters (share-pose.ts grammar). */
export function uploadQuery(code: string, pose: PoseCapture | null, bodyType?: string): string {
  const params = new URLSearchParams({ o: code });
  if (bodyType) params.set(BODY_TYPE_PARAM, bodyType);
  for (const [key, value] of pose ? poseParams(pose) : []) params.set(key, value);
  return params.toString();
}

async function create(code: string, pose: PoseCapture | null, bodyType: string | undefined): Promise<string> {
  const scene = getPreviewScene();
  if (!scene) throw new Error("The viewer is not ready");
  // Runs synchronously up to its first await, so the frame drawn is the one on screen when the click arrived.
  const image = await renderSharePreview(scene, pose);
  const response = await fetch(`${SHARE_PREVIEW_BASE}/api/share?${uploadQuery(code, pose, bodyType)}`, {
    method: "POST", headers: { "Content-Type": "image/jpeg" }, body: image });
  const body = await response.json().catch(() => ({})) as { url?: unknown; error?: unknown };
  if (!response.ok || typeof body.url !== "string" || !body.url.startsWith(`${SHARE_PREVIEW_BASE}/s/`))
    throw new Error(typeof body.error === "string" ? body.error : `Preview upload failed (${response.status})`);
  // A Worker from before poses ignores them: its link opens the outfit only. Still a working link; say so in the console.
  if (pose && !new URL(body.url).searchParams.has("emote")) console.warn("[share preview] the share Worker dropped the pose");
  // A Worker from before body types would open the outfit as Masculine under a card that shows another body type.
  // That link would be wrong, not just plainer, so refuse it: the caller copies the plain link instead.
  if (bodyType && new URL(body.url).searchParams.get(BODY_TYPE_PARAM) !== bodyType)
    throw new Error("The share Worker dropped the body type");
  return body.url;
}

/** A link whose card shows the outfit (and the pose, when one is given). Rejects (and forgets the attempt) when the
 *  render or the upload fails. Call it in the same task as reading the pose, before any frame can move it.
 *  `bodyType` is the body type's share code (body-type.ts bodyTypeShareCode): undefined for Masculine. */
export function previewLink(code: string, pose: PoseCapture | null = null, bodyType?: string): Promise<string> {
  const key = uploadQuery(code, pose, bodyType);
  let link = links.get(key);
  if (!link) {
    link = create(code, pose, bodyType);
    links.set(key, link);
    link.catch(() => links.delete(key));
  }
  return link;
}
