// Game object paths to FModel-style export paths, for the developer source-file export (src/rig/OutfitSourceExport.ts).

export const SAFE = /^[\w./ -]+$/;
// "/Game/Discovery/X/T_Y.0" or "/Game/Discovery/X/MI_Y.MI_Y" -> "Discovery/Content/Discovery/X/T_Y" (FModel's layout);
// other mount points (/Engine/, plugins such as /EmbarkScript/) -> "<Mount>/Content/...".
export function packagePath(objectPath: string): string | null {
  const match = /^\/([A-Za-z]\w*)\/(.+?)(?:\.[^/.]+)?$/.exec(objectPath);
  const path = match ? `${match[1] === "Game" ? "Discovery" : match[1]}/Content/${match[2]}` : null;
  return path && SAFE.test(path) && !path.split("/").includes("..") ? path : null;
}
