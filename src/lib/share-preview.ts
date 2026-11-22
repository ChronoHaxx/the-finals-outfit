import { renderSharePreview } from "../rig/SharePreviewRender";
import { getPreviewScene } from "./viewer-handle";
import { poseParams, type PoseCapture } from "./share-pose";
import { BODY_TYPE_PARAM } from "./body-type";
import { VIEW_PARAM, viewParams, type CameraView } from "./camera-view";
import { PLAYER_NUMBER_PARAM } from "./player-number";

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

/** The upload's query: the outfit code, the body type's share code (body-type.ts; none for Masculine), the player
 *  number's (player-number.ts; none for each piece's own), then the pose's parameters (share-pose.ts grammar), then
 *  the camera view (camera-view.ts grammar). */
export function uploadQuery(code: string, pose: PoseCapture | null, bodyType?: string, playerNumber?: string,
  view: CameraView | null = null): string {
  const params = new URLSearchParams({ o: code });
  if (bodyType) params.set(BODY_TYPE_PARAM, bodyType);
  if (playerNumber) params.set(PLAYER_NUMBER_PARAM, playerNumber);
  for (const [key, value] of pose ? poseParams(pose) : []) params.set(key, value);
  for (const [key, value] of view ? viewParams(view) : []) params.set(key, value);
  return params.toString();
}

/** True when a preview link carries a camera view (a Worker from before camera views leaves it out). */
export const previewKeptView = (url: string) => new URL(url).searchParams.has(VIEW_PARAM);

async function create(code: string, pose: PoseCapture | null, bodyType: string | undefined,
  playerNumber: string | undefined, view: CameraView | null): Promise<string> {
  const scene = getPreviewScene();
  if (!scene) throw new Error("The viewer is not ready");
  // Runs synchronously up to its first await, so the frame drawn is the one on screen when the click arrived.
  const image = await renderSharePreview(scene, pose);
  // The card is the same four views whatever the camera: only the link opens on the camera's view.
  const response = await fetch(`${SHARE_PREVIEW_BASE}/api/share?${uploadQuery(code, pose, bodyType, playerNumber, view)}`, {
    method: "POST", headers: { "Content-Type": "image/jpeg" }, body: image });
  const body = await response.json().catch(() => ({})) as { url?: unknown; error?: unknown };
  if (!response.ok || typeof body.url !== "string" || !body.url.startsWith(`${SHARE_PREVIEW_BASE}/s/`))
    throw new Error(typeof body.error === "string" ? body.error : `Preview upload failed (${response.status})`);
  // A Worker from before poses ignores them: its link opens the outfit only. Still a working link; say so in the console.
  if (pose && !new URL(body.url).searchParams.has("emote")) console.warn("[share preview] the share Worker dropped the pose");
  // A Worker from before camera views (21 Nov 2026) drops the view too. Still the right outfit, so the link is kept and
  // the share panel says the camera was left out (previewKeptView).
  if (view && !previewKeptView(body.url)) console.warn("[share preview] the share Worker dropped the camera view");
  // A Worker from before body types would open the outfit as Masculine under a card that shows another body type.
  // That link would be wrong, not just plainer, so refuse it: the caller copies the plain link instead.
  if (bodyType && new URL(body.url).searchParams.get(BODY_TYPE_PARAM) !== bodyType)
    throw new Error("The share Worker dropped the body type");
  // Likewise a Worker from before player numbers would open the outfit with each piece's own number under a card that
  // shows the chosen one: refuse it too.
  if (playerNumber && new URL(body.url).searchParams.get(PLAYER_NUMBER_PARAM) !== playerNumber)
    throw new Error("The share Worker dropped the player number");
  return body.url;
}

/** A link whose card shows the outfit (and the pose, when one is given). Rejects (and forgets the attempt) when the
 *  render or the upload fails. Call it in the same task as reading the pose, before any frame can move it.
 *  `bodyType` is the body type's share code (body-type.ts bodyTypeShareCode): undefined for Masculine.
 *  `playerNumber` is the number's share code (player-number.ts playerNumberShareCode): undefined for each piece's own.
 *  `view` is the camera the link opens on; the card does not change with it. */
export function previewLink(code: string, pose: PoseCapture | null = null, bodyType?: string,
  playerNumber?: string, view: CameraView | null = null): Promise<string> {
  const key = uploadQuery(code, pose, bodyType, playerNumber, view);
  let link = links.get(key);
  if (!link) {
    link = create(code, pose, bodyType, playerNumber, view);
    links.set(key, link);
    link.catch(() => links.delete(key));
  }
  return link;
}
