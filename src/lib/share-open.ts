import { readLightingLink } from "./share-lighting";
import { readPoseLink } from "./share-pose";
import { readViewLink } from "./camera-view";
import { readOutfitLink } from "./share-url";
import type { EventProps } from "./track";

/** What `share_link_opened` reports for this address, or null when it opens no shared outfit. Read by the app's own
 *  link readers, so it agrees with what the builder opens (short `o`, legacy `outfit`, in the query or the fragment).
 *  Only whether each extra is present: never the code, pose, view or lighting itself. */
export function sharedLinkProps(href: string): EventProps["share_link_opened"] | null {
  try { if (!readOutfitLink(href)) return null; } catch { return null; }
  const has = (read: (href: string) => unknown) => { try { return read(href) !== null; } catch { return false; } };
  return { has_pose: has(readPoseLink), has_camera: has(readViewLink), has_lighting: has(readLightingLink) };
}
