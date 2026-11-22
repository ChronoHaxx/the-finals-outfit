// The viewer's URL switches (moved out of CharacterViewer.tsx, 11 Nov 2026, so the outfit pass in
// rig/OutfitPass.ts reads the same values). Read once, when the module loads.
import { SURFACE_VIEWS, type SurfaceView } from "../rig/ReconstructedMaterial";
import { isBodyTypeId, type BodyTypeId } from "../rig/BodyTypePreview";

// Dev-only harness hooks (scripts/visual-diff): pin the camera (?cam=x,y,z,tx,ty,tz&fov=N)
// and render unlit albedo for color calibration (?debugAlbedo=1 — region-tinted materials
// output their albedo directly; tone mapping is switched off so the PNG is sRGB(albedo)).
export interface DevParams {
  cam?: number[];
  fov?: number;
  debugAlbedo: boolean;
  pose?: "a" | "idle";
  noBaked: boolean;
  tune: boolean;
  reconstructed?: boolean;
  sourceMeshes?: boolean;
  sourceAssembly?: boolean;
  sourceFitting?: boolean;
  surfaceView?: SurfaceView;
  isolate?: boolean;
  temporal?: boolean;
  inspect: boolean;
  // Capture-only switch for the gated body-type preview (?bodyType=masculine|feminine|androgynous):
  // one of BODY_TYPE_PREVIEWS, applied before any source staging. Production reads the "bodyType"
  // field in the active index's assets.json instead (masculine today).
  bodyType?: BodyTypeId;
  // Capture-only switch for the gated hair TagOverride precedence (?hairPrecedence=agreeing-orderings
  // or ?hairPrecedence=hide-wins): the gated precedence rule of SourceResolveOptions. Production keeps
  // it off; the activation path is the "hairOverridePrecedence" field in the active index's assets.json.
  hairPrecedence?: "agreeing-orderings" | "hide-wins";
  // Capture-only switch for the gated mirrored attachment scale (?mirroredScale=nonzero, w45-resolver):
  // accept finite nonzero authored LocalScale components on attached parts for this capture only.
  // Production keeps it off; the activation path is the "attachmentMirroredScale" field in the
  // active index's assets.json.
  mirroredScale?: "nonzero";
  // Capture-only switch for the gated inert merged-part transforms (?mergedTransforms=inert,
  // w45-resolver): draw eligible nonattached, mergeable skeletal parts with the identity placement
  // for this capture only. Production keeps it off; the activation path is the
  // "mergedPartTransforms" field in the active index's assets.json.
  mergedTransforms?: "inert";
  // Capture-only switch for the gated activated effect parts (?activatedEffectParts=drop, w61):
  // render nothing for a part whose only renderable is an activated effect, for this capture only,
  // so the item's real meshes render. Production keeps it off; the activation path is the
  // "activatedEffectParts" field in the active index's assets.json.
  activatedEffectParts?: "drop";
}
export function readDevParams(): DevParams {
  if (typeof window === "undefined")
    return { debugAlbedo: false, noBaked: false, tune: false, inspect: false };
  const p = new URLSearchParams(window.location.search);
  // Production uses the validated source paths automatically. Diagnostic URL
  // switches remain local; reconstructed=0 is a complete legacy comparison.
  if (!import.meta.env.DEV) return {
    debugAlbedo: false, noBaked: false, tune: false, inspect: false,
    reconstructed: p.get("reconstructed") !== "0",
    sourceMeshes: true, sourceAssembly: true, sourceFitting: true,
    surfaceView: "lit", isolate: false, temporal: true,
  };
  const cam = p.get("cam")?.split(",").map(Number);
  const fov = Number(p.get("fov"));
  return {
    cam: cam && cam.length === 6 && cam.every(Number.isFinite) ? cam : undefined,
    fov: Number.isFinite(fov) && fov > 0 ? fov : undefined,
    debugAlbedo: p.get("debugAlbedo") === "1",
    pose: p.get("pose") === "a" ? "a" : undefined, // harness pins A-pose for calibration
    // ?nobaked=1 forces the legacy region-tint path even when a baked composite exists —
    // for flat-vs-faithful before/after comparison of the layered-material reconstruction.
    noBaked: p.get("nobaked") === "1",
    // ?tune=1 mounts the DEV MaterialTuner (icon-vs-render slider panel).
    tune: p.get("tune") === "1",
    reconstructed: p.get("reconstructed") === "1",
    sourceMeshes: p.get("sourceMeshes") !== "0",
    sourceAssembly: p.get("sourceAssembly") !== "0",
    sourceFitting: p.get("sourceFitting") !== "0",
    surfaceView: SURFACE_VIEWS.find((v) => v === p.get("surface")) ?? "lit",
    isolate: p.get("isolate") === "1",
    temporal: p.get("temporal") !== "0",
    // ?inspect=1 mounts the DEV MeshInspector. Unlike the tuner it takes its own
    // column rather than overlaying the canvas, so the model is never occluded.
    inspect: p.get("inspect") === "1",
    // ?bodyType=<id> selects that Season 12 Medium body type for this capture only; anything else
    // leaves the index's own choice.
    bodyType: isBodyTypeId(p.get("bodyType")) ? p.get("bodyType") as BodyTypeId : undefined,
    // ?hairPrecedence=agreeing-orderings or ?hairPrecedence=hide-wins gates that hair precedence
    // rule on for this capture only.
    hairPrecedence: p.get("hairPrecedence") === "agreeing-orderings" || p.get("hairPrecedence") === "hide-wins"
      ? p.get("hairPrecedence") as "agreeing-orderings" | "hide-wins" : undefined,
    // ?mirroredScale=nonzero gates the mirrored attachment scale on for this capture only.
    mirroredScale: p.get("mirroredScale") === "nonzero" ? "nonzero" : undefined,
    // ?mergedTransforms=inert gates the inert merged-part transforms on for this capture only.
    mergedTransforms: p.get("mergedTransforms") === "inert" ? "inert" : undefined,
    // ?activatedEffectParts=drop gates the activated-effect-part drop on for this capture only.
    activatedEffectParts: p.get("activatedEffectParts") === "drop" ? "drop" : undefined,
  };
}
export const DEV = readDevParams();
