import { openFromUrl, type LinkResult } from "./useSavedOutfits";
import { readPoseLink, requestPose } from "../lib/share-pose";

/** Open what the address asks for: the outfit (saved outfits decide how), then the link's pose, if any (an emote
 *  frame, lib/share-pose.ts), for the viewer to apply once the outfit has loaded. The address is read once, first:
 *  opening may tidy the link away at once (when it matches a saved outfit). A refused or unreadable link brings no
 *  pose. Runs at boot (main.tsx) and again whenever the router's address changes (Builder.tsx). */
export function openLink(href: string): LinkResult {
  const result = openFromUrl(href);
  if (!result.declined && !result.error) requestPose(readPoseLink(href));
  return result;
}
