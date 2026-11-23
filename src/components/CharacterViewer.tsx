import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import * as THREE from "three";
import { CharacterRig } from "../rig/CharacterRig";
import { SURFACE_VIEWS } from "../rig/ReconstructedMaterial";
import { loadSourceAssemblyAssets, type SourceOutfit } from "../rig/SourceAssembly";
import { indexClass, type RigArchetype } from "../rig/Archetype";
import { ARCHETYPE_LABELS, archetypeOf, archetypePreviewEnabled, type ArchetypeId } from "../lib/archetype";
import { newOutfitPassState, runOutfitPass, type OutfitPassControl } from "../rig/OutfitPass";
import { setPlayerNumber } from "../rig/PlayerNumber";
import { DEV } from "../lib/viewer-dev-params";
import MaterialTuner from "./MaterialTuner";
import { StablePreview } from "./StablePreview";
import { AutoGraphics, FpsMeter, FpsOverlay, GraphicsMenu, useDevicePixelRatio, type TemporalStatusRef } from "./GraphicsSetting";
import { effectiveTier, renderDpr, useGraphicsStore } from "../lib/graphics-quality";
import { ViewerUnavailable } from "./ViewerUnavailable";
import { AnimationControls, AnimationFrameDriver, clockHeldStill, useAnimatorState, useRigAnimator } from "./AnimationControls";
import { EmoteTimeline } from "./EmoteTimeline";
import { animationsBaseUrl, type RigAnimator } from "../rig/RigAnimator";
import { chinalsAnimationsBase, type SiteMode } from "../lib/site-mode";
import MeshInspector from "./MeshInspector";
import OutfitExportPanel, { type ExportContext } from "./OutfitExportPanel";
import { sharedGltfLoader } from "../rig/loaders";
import { useBuildStore } from "../store/useBuildStore";
import { modelUrl } from "../lib/assets";
import { buildShareUrl } from "../lib/share-url";
import { DEVELOPER_CATALOG } from "../lib/catalog-mode";
import { setPreviewScene } from "../lib/viewer-handle";
import { sceneById } from "../lib/scenes";
import { SceneBackdrop, SceneTurntable, withUpright } from "./SceneMode";
import { LightMarkers } from "./LightMarkers";
import { useFeature } from "../lib/discovery";
import { SLOTS } from "../lib/slots";
import { getDownloadProgress, subscribeDownloadProgress } from "../lib/load-progress";
import { AUTOMATED } from "../lib/automation";
import type { ImmersiveMode } from "../lib/immersive-mode";
import type { HideUi } from "../lib/viewer-chrome";
import { CollapseIcon, ExpandIcon, EyeOffIcon } from "./Icons";
import { MeshGateError } from "../lib/mesh-gate";
import { ScreenshotPanel } from "./ScreenshotPanel";
import { captureSlot } from "../rig/VideoExport";
import type { ScreenshotContext } from "../rig/ViewerScreenshot";
import { LightingPanel, SunShortcut } from "./LightingPanel";
import { CameraPanel } from "./CameraPanel";
import { CameraBridge } from "./CameraBridge";
import { useLightingStore } from "../lib/lighting-store";
import { backdropCss, backdropIsDark } from "../lib/stage-lighting";
import { IS_TOUCH, SHADOWS, StageLights, TONE_MAPPING } from "./ViewerStage";

const BODY_URL = modelUrl("models/body/SK_Body_M.glb");
// (22 Nov 2026) The archetype picker is a preview behind a flag (lib/archetype.ts); with it off every outfit is Medium.
const ARCHETYPES = archetypePreviewEnabled();
const NAIL_MASK_URL = modelUrl("models/decals/_shared/nailmask.webp");

// Browser harness contract (visual-diff and shader-probe checks): `__rigIdle` is false while
// body or outfit work is in flight and true once that work settles, including after a failure.
type RigHarness = { __rigIdle?: boolean; __sourceAssembly?: SourceOutfit };
const rigHarness = () => window as unknown as RigHarness;
// Cached selections settle almost immediately; only announce work that is still running after this.
const BUSY_INDICATOR_DELAY_MS = 150;

// The bytes the current pass has downloaded (load-progress.ts): "12.3 / 45.6 MB" while the character loads, whose
// files are all requested at once, and "12.3 MB" for an outfit, whose files become known only as each item is
// staged (a total that keeps catching up would read as finished). Nothing until something has been announced.
const megabytes = (bytes: number) => (bytes / 1048576).toFixed(1);
function formatDownload(loaded: number, total: number): string | null {
  return total > 0 ? `${megabytes(Math.min(loaded, total))} / ${megabytes(total)} MB` : null;
}

// The scene is one "look" (lib/stage-lighting.ts): lights, reflections, exposure and backdrop, all the viewer's to change.
// Studio (the reviewed rig, for comparing item colours) is the default; Lobby (dark, warm key, blue rims) is a look too.

// The overlay controls sit inside the screen's safe area (index.html sets viewport-fit=cover). The sides always
// count: on a phone the stage spans the full width, so landscape puts its edge under the notch. Top and bottom only
// in immersive mode, where the stage reaches the screen's edges; in the page layout its bottom is mid-screen, and
// following the bottom inset there would make the lower third jump as Safari's toolbar hides on scroll.
const SAFE_SIDES: CSSProperties = { top: 0, bottom: 0, left: "env(safe-area-inset-left, 0px)", right: "env(safe-area-inset-right, 0px)" };
const SAFE_ALL: CSSProperties = { ...SAFE_SIDES, top: "env(safe-area-inset-top, 0px)", bottom: "env(safe-area-inset-bottom, 0px)" };

// Hands the export panel (outside the Canvas) the live renderer and camera.
// Publishes the scene for the share button's preview render while the outfit is fully loaded.
// The share image paints the backdrop the viewer shows (its three stops) behind the same lit scene.
function PreviewBridge({ root, backdrop, active, animator }: {
  root: THREE.Object3D; backdrop: { inner: string; middle: string; outer: string }; active: boolean; animator: RigAnimator | null;
}) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const { inner, middle, outer } = backdrop;
  useEffect(() => {
    if (!active) return;
    setPreviewScene({ gl, scene, root, backdrop: { inner, middle, outer },
      stillPose: animator ? draw => animator.withStillPose(draw) : undefined,
      // In a scene the character may be turned (turntable mode); the card's views are placed at world angles.
      upright: withUpright });
    return () => setPreviewScene(null);
  }, [gl, scene, root, inner, middle, outer, active, animator]);
  return null;
}

// The still-view accumulator draws the canvas (every look but the developer debug views).
const STABLE_PREVIEW = DEV.reconstructed && DEV.temporal && !DEV.debugAlbedo && DEV.surfaceView === "lit";

// Runs a video export's frames inside the frame loop (rig/VideoExport.ts): each frame is drawn after the contact shadow
// has followed the new pose (priority 0) and before the live view draws (priority 1); the next pose is set after the
// live view has drawn. Without the accumulator (debug views) it draws the canvas itself, since any positive priority
// turns off r3f's own draw.
function CaptureDriver({ ownsDraw }: { ownsDraw: boolean }) {
  useFrame(() => captureSlot.current?.capture(), 0.5);
  useFrame(({ gl, scene, camera }) => { if (ownsDraw) gl.render(scene, camera); }, 1);
  useFrame(() => captureSlot.current?.advance(), 2);
  return null;
}

// Hands the screenshot panel (outside the Canvas) the live renderer, scene and camera.
function ScreenshotBridge({ target }: { target: { current: ScreenshotContext | null } }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    target.current = { gl, scene, camera };
    // Dev only: capture test rigs (_docs/capture-2026-11-21) draw through the same context.
    const host = window as unknown as { __captureContext?: ScreenshotContext };
    if (import.meta.env.DEV) host.__captureContext = target.current;
    return () => { target.current = null; if (host.__captureContext?.gl === gl) delete host.__captureContext; };
  }, [gl, scene, camera, target]);
  return null;
}

function ExportBridge({ target }: { target: { current: ExportContext | null } }) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    target.current = { gl, camera };
    return () => { target.current = null; };
  }, [gl, camera, target]);
  return null;
}

/** `immersive`: the page's full-screen mode (lib/immersive-mode), when the page supports one; adds its button.
 *  `hideUi`: the page's hidden-UI mode (H, lib/viewer-chrome); adds its button, and every overlay hides with it. */
export default function CharacterViewer({ immersive, hideUi, mode = "global" }: { immersive?: ImmersiveMode; hideUi?: HideUi; mode?: SiteMode } = {}) {
  const rig = useMemo(
    () =>
      new CharacterRig(sharedGltfLoader(), undefined, NAIL_MASK_URL, {
        sheen: !IS_TOUCH,
        albedoDebug: DEV.debugAlbedo,
        faceBodyHideUrl: modelUrl("models/decals/_shared/bodyhide-face.webp"),
      }),
    [],
  );
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missingFittingData, setMissingFittingData] = useState(false);
  const [retryAttempt, setRetryAttempt] = useState(0);
  // The look (lighting-store.ts): lights, reflections, exposure, backdrop. The reviewed Studio look unless this viewer
  // changed it; always so when automated.
  const look = useLightingStore((s) => s.look);
  // "Show lights" (Lighting panel): a bulb and cone per light, draggable (LightMarkers.tsx). Hidden with the rest of the
  // UI (H), so a clean view for the system's own screenshot tool never shows them; the site's pictures never do.
  const showLightMarkers = useLightingStore((s) => s.markers);
  const backdrop = look.backdrop;
  // Light chrome (corner marks, loading text) on a dark backdrop, dark chrome on a light one.
  // An in-game scene behind the character (scenes.ts), when the look has one this build knows; null otherwise (an
  // unknown id shows the look's colours). While one is shown the camera stays put and a drag turns the character.
  const scene = sceneById(backdrop.scene);
  const darkBackdrop = scene ? scene.dark : backdropIsDark(backdrop);
  // Showcase animation: null unless this deployment publishes clips (the controls then stay hidden). Chinals mode
  // (lib/site-mode.ts) plays its own clip set: a mode switch replaces the animator, the character stays loaded.
  const animator = useRigAnimator(mode === "chinals" ? chinalsAnimationsBase() : animationsBaseUrl());
  // A timeline drag changes the pose every frame while paused: the still view treats it as motion too.
  const animationMoving = useCallback(() => (!!animator?.state.moving || !!animator?.scrubbing) && !clockHeldStill(), [animator]);
  // The emote timeline sits along the bottom while an emote is in front; the right-hand column stops above it.
  useAnimatorState(animator);
  const timelineShown = ready && !!animator?.timeline();
  // Graphics settings (6 Nov; 10 Nov: anti-aliasing, resolution override, FPS counter). The preset or the hand-picked
  // resolution sets the canvas pixel density; anti-aliasing sets how the still-view accumulator draws.
  const graphicsTier = useGraphicsStore(effectiveTier);
  const antiAliasing = useGraphicsStore((s) => s.aa);
  const resolution = useGraphicsStore((s) => s.resolution);
  const showFps = useGraphicsStore((s) => s.showFps);
  const deviceDpr = useDevicePixelRatio();
  const canvasDpr = renderDpr(graphicsTier, resolution, deviceDpr);
  const temporalStatus = useRef(null) as TemporalStatusRef;
  // The graphics context was lost (driver reset, out of graphics memory): say so, and remount the canvas on request.
  const [contextLost, setContextLost] = useState(false);
  const [canvasGeneration, setCanvasGeneration] = useState(0);
  const exportContext = useRef<ExportContext | null>(null);
  const screenshotContext = useRef<ScreenshotContext | null>(null);
  const uiHidden = !!hideUi?.hidden;
  // The viewer's own controls on the discovery map (lib/discovery.ts): their callouts name them and give the key.
  const hideFeature = useFeature("hide-ui", "Hide UI for a clean look (H; H or Esc brings it back)");
  const fullScreenFeature = useFeature("full-screen", immersive?.immersive ? "Exit full screen (Esc)" : "Full screen: hide everything but the character");
  const build = useBuildStore((s) => s.build);
  // The outfit's body type (src/lib/body-type.ts): Masculine, or another the picker offers.
  const outfitBodyType = useBuildStore((s) => s.bodyType);
  // The outfit's player number (lib/player-number.ts): every recovered material that prints one reads it live
  // (rig/PlayerNumber.ts), so a change re-uploads two uniforms and reloads nothing.
  const outfitPlayerNumber = useBuildStore((s) => s.playerNumber);
  useEffect(() => { setPlayerNumber(outfitPlayerNumber); }, [outfitPlayerNumber]);
  // The outfit's archetype (lib/archetype.ts) as stored, and the class the body is built for: the stored one while the
  // archetype preview is on, else Medium. A class the index cannot build falls back to Medium with a notice.
  const outfitArchetype = useBuildStore((s) => s.archetype);
  const requestedArchetype: ArchetypeId = ARCHETYPES ? archetypeOf(outfitArchetype) : "medium";
  const [bodyArchetype, setBodyArchetype] = useState<ArchetypeId>("medium");
  // Selected items the class cannot build yet (rig/OutfitPass.ts classUnavailableItems), and a class the index lacks.
  const [classNotice, setClassNotice] = useState<string | null>(null);
  const equippedCount = SLOTS.filter((slot) => build[slot]).length;
  // What the rig wore after its last committed outfit pass (rig/OutfitPass.ts), kept between passes.
  const outfitState = useRef(newOutfitPassState());
  // Cancels for the outfit passes still running. A body change (a new class, 22 Nov 2026) cancels them before the rig
  // disposes the body they are dressing: their own cleanup runs only on the commit where `ready` drops, and a pass that
  // resumes before it would equip onto no skeleton and commit stale keys into `outfitState`. Seen once when a hot
  // reload re-ran the body effect mid-pass; a picker click flushes that commit too soon to show it (8/8 clean).
  const livePasses = useRef(new Set<() => void>());
  const [hasRecoveredPreview, setHasRecoveredPreview] = useState(false);
  // One owner for "the preview is still changing". Every body/outfit pass takes a new id and
  // only the latest id may clear it, so a superseded pass can never end a newer one.
  const [busy, setBusy] = useState(true);
  const [showBusy, setShowBusy] = useState(false);
  const operation = useRef(0);
  // Download counters when the current pass began: the indicator shows this pass's bytes only.
  const progressBase = useRef(getDownloadProgress());
  const progress = useSyncExternalStore(subscribeDownloadProgress, getDownloadProgress);
  const download = formatDownload(progress.loaded - progressBase.current.loaded, progress.total - progressBase.current.total);
  const downloaded = progress.loaded > progressBase.current.loaded
    ? `${megabytes(progress.loaded - progressBase.current.loaded)} MB` : null;
  const downloadFraction = progress.total > progressBase.current.total
    ? (progress.loaded - progressBase.current.loaded) / (progress.total - progressBase.current.total) : 0;
  const beginOperation = useCallback(() => {
    const id = ++operation.current;
    progressBase.current = getDownloadProgress();
    setBusy(true);
    rigHarness().__rigIdle = false;
    return id;
  }, []);
  const endOperation = useCallback((id: number) => {
    if (operation.current !== id) return;
    setBusy(false);
    rigHarness().__rigIdle = true;
  }, []);
  useEffect(() => {
    if (!busy || !ready) {
      setShowBusy(false);
      return;
    }
    const timer = window.setTimeout(() => setShowBusy(true), BUSY_INDICATOR_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [busy, ready]);

  // Dev-only: expose the rig root + THREE so the visual-diff harness can bisect rendering
  // issues (toggle maps/meshes, inject test textures) in the live scene without guessing.
  useEffect(() => {
    if (import.meta.env.DEV) {
      const w = window as unknown as { __rigRoot?: THREE.Object3D; __THREE?: typeof THREE };
      w.__rigRoot = rig.root;
      w.__THREE = THREE;
    }
  }, [rig]);

  // Load the base body once (StrictMode-safe: rig.dispose on cleanup, loadBody replaces).
  useEffect(() => {
    let cancelled = false;
    // Busy until the outfit pass that a successful load starts takes over this operation.
    const operationId = beginOperation();
    rig.setPose(DEV.pose ?? "idle"); // applied to the skeleton once the body loads
    const sourceBodies = DEV.reconstructed && DEV.sourceMeshes && DEV.sourceAssembly && DEV.sourceFitting;
    // (22 Nov 2026) A Light or Heavy body: its class record in the index (rig/Archetype.ts). Without source bodies, or
    // with an index that has no such class, the body stays Medium and says so.
    const classOf = async (): Promise<RigArchetype | undefined> => {
      if (requestedArchetype === "medium") return undefined;
      const assetsUrl = modelUrl("models/reconstructed-assemblies-v1");
      const found = sourceBodies ? indexClass(await loadSourceAssemblyAssets(assetsUrl), requestedArchetype,
        path => new URL(path, new URL(assetsUrl + "/", window.location.href)).href)?.rig : undefined;
      if (!found && !cancelled)
        setClassNotice(`${ARCHETYPE_LABELS[requestedArchetype]} contestants aren’t available here yet; showing Medium.`);
      return found;
    };
    setClassNotice(null);
    classOf()
      .then(archetype => {
        if (cancelled) return;
        setBodyArchetype(archetype?.id ?? "medium");
        return rig.loadBody(BODY_URL, archetype ? archetype.bodyUrl
          : sourceBodies ? modelUrl("models/reconstructed-meshes-v2/SK_Body_M.glb") : undefined, archetype);
      })
      .then(() => !cancelled && setReady(true))
      .catch((e) => {
        console.error(e);
        if (cancelled) return;
        // A mesh-gate refusal (bot check, rate limit, daily quota) says what happened and what to do.
        setError(e instanceof MeshGateError ? e.message : "Failed to load the base body model.");
        endOperation(operationId);
      });
    return () => {
      cancelled = true;
      for (const cancel of livePasses.current) cancel();
      livePasses.current.clear();
      rig.dispose();
      setReady(false);
      outfitState.current.prev = {};
    };
  }, [rig, requestedArchetype, beginOperation, endOperation]);

  // Diff the serializable `build` -> rig equip/unequip whenever it changes (rig/OutfitPass.ts).
  useEffect(() => {
    if (!ready) return;
    const operationId = beginOperation();
    setError(null);
    setMissingFittingData(false);
    let cancelled = false;
    const controller = new AbortController();
    const cancel = () => { cancelled = true; controller.abort(); };
    livePasses.current.add(cancel);
    const prepared: OutfitPassControl["prepared"] = {};
    runOutfitPass(rig, build, outfitBodyType, outfitState.current,
      { cancelled: () => cancelled, signal: controller.signal, prepared },
      { setError, setMissingFittingData, setHasRecoveredPreview,
        onAssembly: assembly => { rigHarness().__sourceAssembly = assembly; },
        setClassUnavailable: (archetype, names) => setClassNotice(names.length
          ? `Not on ${ARCHETYPE_LABELS[archetype]} yet: ${names.join(", ")}. Their ${ARCHETYPE_LABELS[archetype]} versions aren’t in the viewer yet, so they’re left off; your outfit keeps them.`
          : null) }).catch((e) => {
      // Anything the pass's own per-step handlers did not anticipate: surface it so Retry works.
      if (cancelled) return;
      console.error(e);
      setError("Couldn’t update the preview.");
    }).finally(() => {
      livePasses.current.delete(cancel);
      prepared.current?.release();
      // Idle only once the whole pass, including body hides, has settled. A cancelled pass
      // leaves the busy state to the pass that superseded it.
      if (!cancelled) endOperation(operationId);
    });
    return () => {
      cancel();
      livePasses.current.delete(cancel);
      prepared.current?.release();
    };
  }, [build, outfitBodyType, ready, rig, retryAttempt, beginOperation, endOperation]);

  const changePreviewOption = (name: "surface" | "isolate", value: string) => {
    const url = new URL(buildShareUrl(window.location.href, { build, bodyType: outfitBodyType, playerNumber: outfitPlayerNumber,
      archetype: outfitArchetype }));
    // A share link uses the global route; the reload stays in Chinals mode when that is on (lib/site-mode.ts).
    if (mode === "chinals") url.hash = url.hash.replace(/^#\/\?/, "#/chinals?");
    // Picker edits do not rewrite the address bar.
    // Save the current outfit before reloading to change a preview option.
    url.searchParams.set(name, value);
    window.location.assign(url);
  };

  return (
    <div
      data-viewer=""
      className="relative h-full w-full"
      style={{ background: backdropCss(backdrop) }}
    >
      {scene && <SceneBackdrop scene={scene} />}
      {/* The key remounts the Canvas only for Retry after a lost graphics context. The look's tone mapping and exposure
          change live: r3f re-applies the gl props below on a re-render, and the still-view accumulator rebuilds its
          output pass for a new tone mapping and restarts its history. */}
      <Canvas
        key={canvasGeneration}
        aria-busy={busy}
        camera={{
          position: DEV.cam ? [DEV.cam[0], DEV.cam[1], DEV.cam[2]] : [0, 1.0, 3.6],
          fov: DEV.fov ?? 35,
        }}
        dpr={canvasDpr}
        onCreated={({ gl }) => {
          const canvas = gl.domElement;
          // Only a loss on the canvas still on the page is a failure. Switching Lobby/Studio (or Restart) remounts the
          // Canvas through its key, and r3f calls forceContextLoss() on the old, already-removed canvas 500 ms later to
          // free its graphics memory. That deliberate loss showed "3D view stopped" on every switch (11 Nov 2026, Chrome
          // and Firefox; _docs/goal-100-2026-10-11/studio-sun-tests).
          canvas.addEventListener("webglcontextlost", () => { if (canvas.isConnected) setContextLost(true); });
        }}
        shadows={SHADOWS}
        gl={{
          alpha: true,
          // No multisampled back buffer: every frame is drawn by the still-view accumulator into its own targets
          // (StablePreview alwaysOn), whose anti-aliasing is the Graphics setting; the canvas only receives one
          // full-screen copy. (r3f's default 4x MSAA buffer cost up to ~190 MB at 3000x2000 for nothing.)
          antialias: false,
          // Tone mapping squeezes the scene's unbounded linear light into what a screen can show: Neutral keeps colours
          // closest to the material (the Studio look, for comparing items), ACES rolls highlights off filmically and
          // shifts hue a little (the Lobby look), AgX desaturates bright light more gently.
          toneMapping: DEV.debugAlbedo ? THREE.NoToneMapping : TONE_MAPPING[look.toneMapping],
          toneMappingExposure: look.exposure,
          outputColorSpace: THREE.SRGBColorSpace,
        }}
      >
        <StageLights look={look} root={rig.root} />
        <primitive object={rig.root} />
        {DEVELOPER_CATALOG && <ExportBridge target={exportContext} />}
        <ScreenshotBridge target={screenshotContext} />
        <PreviewBridge root={rig.root} backdrop={backdrop} active={ready && !busy} animator={animator} />
        {animator && <AnimationFrameDriver animator={animator} yaw={() => rig.root.rotation.y} />}
        {STABLE_PREVIEW && <StablePreview isMoving={animationMoving} aa={antiAliasing} statusRef={temporalStatus} />}
        <CaptureDriver ownsDraw={!STABLE_PREVIEW} />
        <AutoGraphics status={temporalStatus} active={ready && !busy} deviceDpr={deviceDpr} />
        {showFps && <FpsMeter status={temporalStatus} />}
        {/* The camera for the camera panel and share links, and its roll. It uses the default controls below; its frame
            step runs after theirs by priority, whatever the order here. */}
        <CameraBridge />
        <OrbitControls
          target={DEV.cam ? [DEV.cam[3], DEV.cam[4], DEV.cam[5]] : [0, 0.9, 0]}
          enablePan
          screenSpacePanning
          minDistance={0.05}
          maxDistance={10}
          makeDefault
          enabled={!scene}
        />
        {scene && <SceneTurntable scene={scene} root={rig.root} />}
        {showLightMarkers && !uiHidden && <LightMarkers dark={darkBackdrop} />}
      </Canvas>
      {contextLost && <div className="absolute inset-0 z-20">
        <ViewerUnavailable lost onRetry={() => { setContextLost(false); setCanvasGeneration((n) => n + 1); }} />
      </div>}
      {/* The overlay controls, inset by the safe area (SAFE_SIDES). The frame takes no pointer events, so the canvas
          behind every empty part still orbits; each control opts back in. */}
      <div className={`@container pointer-events-none absolute z-10 ${uiHidden ? "invisible" : ""}`} inert={uiHidden}
        style={immersive?.immersive || uiHidden ? SAFE_ALL : SAFE_SIDES}>
        {/* Viewfinder corners. Decorative, and kept out of automated canvas captures. */}
        {!AUTOMATED && <div aria-hidden="true" className="brackets pointer-events-none absolute inset-3 z-[5]"
          style={{ "--b": darkBackdrop ? "rgb(242 239 233 / 0.32)" : "rgb(9 9 11 / 0.32)" } as CSSProperties} />}
        {/* No backdrop-filter on anything over the canvas: the canvas repaints every frame, so a
            blur behind it would be recomputed every frame too — a real cost on phones. */}
        {/* The top row speaks one button language (ViewerPanel.tsx): square icon buttons act at once (full screen, hide
            the controls); buttons with a chevron open a panel (Graphics, Capture, Camera, Lighting), and the two kinds
            sit in their own groups. */}
        <div className="absolute right-3 top-3 z-20 flex gap-3 *:flex *:gap-1.5 *:*:pointer-events-auto">
          <div>
            {immersive && (
              // The same button enters and leaves, in the same place; leaving also says so in words.
              <button type="button" onClick={immersive.toggle} {...fullScreenFeature}
                aria-label={immersive.immersive ? "Exit full screen" : "Full screen"}
                className={`hud flex h-8 items-center gap-2 whitespace-nowrap bg-ink-950/80 text-fg transition-colors hover:bg-ink-950 ${immersive.immersive ? "px-3" : "w-8 justify-center"}`}>
                {immersive.immersive ? <CollapseIcon size={14} /> : <ExpandIcon size={14} />}
                {immersive.immersive && "Exit full screen"}
              </button>
            )}
            {hideUi && (
              <button type="button" onClick={hideUi.hide} aria-label="Hide UI" {...hideFeature}
                className="hud flex h-8 w-8 items-center justify-center bg-ink-950/80 text-fg transition-colors hover:bg-ink-950">
                <EyeOffIcon size={15} />
              </button>
            )}
          </div>
          <div>
            {/* Graphics quality (Auto by default). Left out in full screen, where the wider exit button needs the room. */}
            {!immersive?.immersive && <GraphicsMenu deviceDpr={deviceDpr} />}
            <ScreenshotPanel context={screenshotContext} backdrop={backdrop} ready={ready && !busy} animator={animator} />
            {/* Camera: position and target to read or type, roll, and views saved with the outfit. */}
            <CameraPanel />
            {/* Lighting and backdrop: one panel for the whole scene (the Studio/Lobby switch became two of its looks). */}
            <LightingPanel />
          </div>
        </div>
        {/* One right-hand column under the top row, so the animation controls and the developer export panel
            stack instead of overlapping. It spans to the bottom so the emote picker can fit the viewer's height; only
            its children take pointer events, so the canvas behind the empty part still orbits. */}
        <div data-callout-side="left" className={`pointer-events-none absolute right-3 top-12 z-10 flex flex-col items-end gap-1.5 *:pointer-events-auto *:shrink-0 ${timelineShown ? "bottom-15 pointer-coarse:bottom-17" : "bottom-3"}`}>
          {/* PR #37's Sun slider, kept as a shortcut to the sun's direction. */}
          <SunShortcut />
          {animator && <AnimationControls animator={animator} rig={rig} ready={ready} busy={busy} studio={!darkBackdrop} />}
          {DEVELOPER_CATALOG && ready && <OutfitExportPanel rig={rig} context={exportContext} busy={busy} animator={animator} />}
        </div>
        {/* Bottom-left "lower third", as on a broadcast. The loading tag sits above any error, so a
            failed slot never hides the status of the pass that is still running. */}
        <div className="pointer-events-none absolute inset-x-3 bottom-3 z-10 flex flex-col items-start gap-2">
          {/* FPS counter (Graphics menu): stacked above the status tags, clear of the button row at any width. */}
          {showFps && <FpsOverlay />}
          <div role="status" aria-live="polite">
            {!ready && !error ? <span className="sr-only">Loading model…</span> : showBusy && (
              <span className="flex h-8 items-center gap-2.5 border-l-2 border-finals bg-ink-950/85 pl-2.5 pr-3 text-fg">
                <span aria-hidden="true" className="relative block h-0.5 w-8 overflow-hidden bg-fg/20">
                  <span className="absolute inset-y-0 left-0 w-2/5 animate-sweep bg-finals" />
                </span>
                <span className="hud">Loading outfit…</span>
                {downloaded && <span className="hud tabular-nums text-fg-dim">{downloaded}</span>}
              </span>
            )}
          </div>
          {!AUTOMATED && ready && !showBusy && !error && (
            <span aria-hidden="true" className={`flex h-8 animate-fade items-center gap-2 border-l-2 border-finals bg-ink-950/85 pl-2.5 pr-3 ${timelineShown ? "max-lg:hidden" : ""}`}>
              <span className="hud text-fg-dim">Contestant</span>
              <span className="hud text-fg">{ARCHETYPE_LABELS[bodyArchetype]} · {equippedCount} {equippedCount === 1 ? "piece" : "pieces"}</span>
            </span>
          )}
          {error && (
            <div role="alert" className="pointer-events-auto flex w-full flex-wrap items-center gap-x-4 gap-y-2 border-l-2 border-finals bg-ink-950/95 px-3 py-2.5 text-sm text-fg">
              <p className="flex-1">{error}</p>
              {!missingFittingData && <button type="button" className="hud h-8 shrink-0 bg-fg px-3 text-ink-950 hover:bg-white"
                onClick={() => {
                  if (ready) setRetryAttempt(attempt => attempt + 1);
                  else changePreviewOption("isolate", DEV.isolate ? "1" : "0");
                }}>Retry preview</button>}
            </div>
          )}
          {classNotice && !error && (
            <p role="status" data-class-notice="" className="pointer-events-auto w-full border-l-2 border-fg-dim bg-ink-950/90 px-3 py-2 text-sm text-fg-muted">
              {classNotice}
            </p>
          )}
          {animator && ready && <EmoteTimeline animator={animator} />}
        </div>
      </div>
      {import.meta.env.DEV && DEV.reconstructed && hasRecoveredPreview && !uiHidden && (
        <div className="absolute left-2 top-2 z-10 rounded-md bg-black/70 px-3 py-2 text-xs text-white">
          <span className="mb-1 block">Recovered shader · preview lighting</span>
          <select
            aria-label="Recovered material view"
            className="w-full rounded bg-neutral-800 p-1"
            value={DEV.surfaceView}
            onChange={(event) => changePreviewOption("surface", event.target.value)}
          >
            {SURFACE_VIEWS.map((view) => <option key={view} value={view}>{view === "baseColor" ? "Material colour" : view === "lit" ? "Lit surface" : view[0].toUpperCase() + view.slice(1)}</option>)}
          </select>
          <label className="mt-2 flex items-center gap-2">
            <input type="checkbox" checked={DEV.isolate ?? false}
              onChange={(event) => changePreviewOption("isolate", event.target.checked ? "1" : "0")} />
            Isolate recovered items
          </label>
        </div>
      )}
      {DEV.tune && ready && <MaterialTuner rig={rig} />}
      {!ready && !error && !uiHidden && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="flex flex-col items-center gap-3">
            <span className={`hud ${darkBackdrop ? "text-fg-muted" : "text-ink-700"}`}>Loading contestant</span>
            {/* Download progress (load-progress.ts): a sweep until the first sizes are known, then the fraction. */}
            <span className="relative block h-0.5 w-32 overflow-hidden bg-ink-950/15">
              {downloadFraction > 0
                ? <span className="absolute inset-y-0 left-0 bg-finals transition-[width] duration-200"
                    style={{ width: `${Math.round(Math.min(1, downloadFraction) * 100)}%` }} />
                : <span className="absolute inset-y-0 left-0 w-2/5 animate-sweep bg-finals" />}
            </span>
            <span className={`hud tabular-nums ${darkBackdrop ? "text-fg-muted" : "text-ink-700"}`}>
              {download ?? "\u00a0" /* keeps the line height */}
            </span>
          </div>
        </div>
      )}
      {DEV.inspect && ready && <MeshInspector rig={rig} />}
    </div>
  );
}
