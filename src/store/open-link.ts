import { openFromUrl, type LinkResult } from "./useSavedOutfits";
import { readPoseLink, requestPose } from "../lib/share-pose";
import { readViewLink, requestView } from "../lib/camera-view";
import { readLightingLink } from "../lib/share-lighting";
import { offerLinkLighting } from "../lib/lighting-store";

/** Open what the address asks for: the outfit (saved outfits decide how), then the link's pose, if any (an emote
 *  frame, lib/share-pose.ts), for the viewer to apply once the outfit has loaded, its camera view, if any
 *  (lib/camera-view.ts), for the viewer to apply once its camera can move, and its lighting, if any
 *  (lib/share-lighting.ts), shown at once in place of the viewer's own until they keep it or go back
 *  (lib/lighting-store.ts). The address is read once, first: opening may tidy the link away at once (when it matches a
 *  saved outfit). A refused or unreadable link brings no pose, no view and no lighting. Runs at boot (main.tsx) and
 *  again whenever the router's address changes (Builder.tsx). */
export function openLink(href: string): LinkResult {
  const result = openFromUrl(href);
  if (!result.declined && !result.error) {
    requestPose(readPoseLink(href));
    requestView(readViewLink(href));
    offerLinkLighting(href, readLightingLink(href));
  }
  return result;
}
