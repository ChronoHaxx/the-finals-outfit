// The squad's 3D view (multi-character Phase 2, 22 Nov 2026; design in _docs/multi-character-2026-11-11/README.md).
//
// Each contestant is its own CharacterRig, built exactly as the builder builds its one character (so fitting, hides
// and face transactions hold unchanged), inside a placement group: floor position and a turn about the vertical axis,
// nothing else. Its rig never needs to know where it stands, because everything it computes is relative to its own
// root. Per contestant: its own outfit pass (rig/OutfitPass.ts), animator, animation bookkeeping (useAnimationBinding,
// not the builder's primary one, so no link pose or remembered choice is touched) and player-number owner.
//
// Shared: one glTF loader and one clip download cache, the lit stage (ViewerStage.tsx), one frame driver that steps
// every animator and counts one frame, and one still view whose "moving" is any animator moving.
//
// Contestants load one at a time: the next starts once the one before has its body and first outfit on. That keeps the
// download counters (lib/load-progress.ts) meaningful per contestant and spreads the shader compiles.
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import * as THREE from "three";
import { CharacterRig } from "../rig/CharacterRig";
import { newOutfitPassState, runOutfitPass, type OutfitPassControl } from "../rig/OutfitPass";
import { setPlayerNumber } from "../rig/PlayerNumber";
import { animationsBaseUrl, initialClip, type ClipFileCache, type RigAnimator } from "../rig/RigAnimator";
import { sharedGltfLoader } from "../rig/loaders";
import { DEV } from "../lib/viewer-dev-params";
import { modelUrl } from "../lib/assets";
import { AUTOMATED } from "../lib/automation";
import { SLOTS } from "../lib/slots";
import { migrateBuildSlots } from "../lib/outfit-slots";
import { DEFAULT_BODY_TYPE } from "../lib/body-type";
import { getDownloadProgress, subscribeDownloadProgress } from "../lib/load-progress";
import { clockFrozen, clockHeldStill, frameClock } from "../lib/frame-clock";
import { useLightingStore } from "../lib/lighting-store";
import { backdropCss, backdropIsDark } from "../lib/stage-lighting";
import { effectiveTier, renderDpr, useGraphicsStore } from "../lib/graphics-quality";
import type { ContestantRecord } from "../lib/squad-library";
import type { Build } from "../store/useBuildStore";
import { stepAnimator, useRigAnimator } from "./AnimationControls";
import { savedStill, useAnimationBinding } from "./useAnimationBinding";
import { StablePreview } from "./StablePreview";
import { AutoGraphics, useDevicePixelRatio, type TemporalStatusRef } from "./GraphicsSetting";
import { IS_TOUCH, SHADOWS, StageLights, TONE_MAPPING } from "./ViewerStage";

const BODY_URL = modelUrl("models/body/SK_Body_M.glb");
const SOURCE_BODY_URL = DEV.reconstructed && DEV.sourceMeshes && DEV.sourceAssembly && DEV.sourceFitting
  ? modelUrl("models/reconstructed-meshes-v2/SK_Body_M.glb") : undefined;
const NAIL_MASK_URL = modelUrl("models/decals/_shared/nailmask.webp");
const FACE_BODY_HIDE_URL = modelUrl("models/decals/_shared/bodyhide-face.webp");
const STABLE_PREVIEW = DEV.reconstructed && DEV.temporal && !DEV.debugAlbedo && DEV.surfaceView === "lit";
// The default view holds three contestants 1.2 m apart, head to toe, hands included (Phase 3 brings Frame all).
// The builder's dev ?cam=px,py,pz,tx,ty,tz frames this view too (captures, probes).
const CAMERA_POSITION: [number, number, number] = DEV.cam ? [DEV.cam[0], DEV.cam[1], DEV.cam[2]] : [0, 1.05, 5.2];
const CAMERA_TARGET: [number, number, number] = DEV.cam ? [DEV.cam[3], DEV.cam[4], DEV.cam[5]] : [0, 0.95, 0];

/** What the squad page shows of one contestant while it loads. */
export interface MemberStatus { loading: boolean; error: string | null }

// One contestant's animator, as the frame driver and the still view see it.
interface Driven { animator: RigAnimator; yaw: () => number; lastAzimuth: { current: number | null } }

type Harness = { __squadIdle?: boolean; __squad?: { members: () => { id: string; settled: boolean; error: string | null }[]; roots?: () => THREE.Object3D[] } };
const harness = () => window as unknown as Harness;

function buildOf(slots: Readonly<Record<string, string>>): Build {
  const blank = Object.fromEntries(SLOTS.map(slot => [slot, null])) as Build;
  return { ...blank, ...migrateBuildSlots(slots) } as Build;
}

// The view follows the group: when the contestants shown change, camera and orbit target move sideways by as much as
// the group's centre moved (an orbit the viewer made is kept, only shifted). Frame all comes with the editor (Phase 3).
function FollowGroup({ centre }: { centre: [number, number] }) {
  const camera = useThree(s => s.camera);
  const controls = useThree(s => s.controls) as unknown as { target?: THREE.Vector3; update?: () => void } | null;
  const last = useRef<[number, number] | null>(null);
  const [x, z] = centre;
  useEffect(() => {
    const target = controls?.target;
    if (!target) return;
    const [lx, lz] = last.current ?? [0, 0];
    last.current = [x, z];
    if (lx === x && lz === z) return;
    camera.position.x += x - lx; camera.position.z += z - lz;
    target.x += x - lx; target.z += z - lz;
    controls?.update?.();
  }, [camera, controls, x, z]);
  return null;
}

// Dev only: the renderer for probes (squad-profile.mjs reads its memory and program counts).
function RendererBridge() {
  const gl = useThree(s => s.gl);
  useEffect(() => {
    const host = window as unknown as { __squadRenderer?: THREE.WebGLRenderer };
    host.__squadRenderer = gl;
    return () => { if (host.__squadRenderer === gl) delete host.__squadRenderer; };
  }, [gl]);
  return null;
}

// Steps every contestant's animator, then counts one frame (the test clock's frames, lib/frame-clock.ts).
function SquadFrameDriver({ driven }: { driven: Set<Driven> }) {
  useFrame(({ camera, controls }, delta) => {
    if (clockFrozen()) return;
    for (const member of driven) stepAnimator(member.animator, camera, controls, member.yaw(), member.lastAzimuth, delta);
    frameClock.steps++;
  });
  return null;
}

// The animation bookkeeping for one contestant, once its animator exists, and its first motion: the outfit-screen
// idle, unless this viewer keeps the builder still, the system asks for reduced motion, or a script drives the page.
function MemberAnimation({ animator, rig, ready, busy, yaw, driven }: {
  animator: RigAnimator; rig: CharacterRig; ready: boolean; busy: boolean; yaw: number; driven: Set<Driven>;
}) {
  const { play } = useAnimationBinding({ animator, rig, ready, busy, primary: false });
  const yawRef = useRef(yaw);
  yawRef.current = yaw;
  useEffect(() => {
    const member: Driven = { animator, yaw: () => yawRef.current + rig.root.rotation.y, lastAzimuth: { current: null } };
    driven.add(member);
    return () => { driven.delete(member); };
  }, [animator, rig, driven]);
  const started = useRef(false);
  useEffect(() => {
    if (!ready || busy || started.current) return;
    started.current = true;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const id = initialClip({ anim: null, defaultIdle: animator.manifest.defaultIdle, automated: AUTOMATED, reducedMotion,
      savedStill: savedStill() });
    if (id && animator.info(id)) play(id);
  }, [ready, busy, animator, play]);
  return null;
}

function SquadMember({ contestant, canLoad, clipFiles, driven, onStatus }: {
  contestant: ContestantRecord; canLoad: boolean; clipFiles: ClipFileCache; driven: Set<Driven>;
  onStatus: (id: string, status: MemberStatus & { settled: boolean }) => void;
}) {
  // This contestant's own player-number owner, so its garments print the number its copy carries.
  const owner = useMemo(() => ({}), []);
  const rig = useMemo(() => new CharacterRig(sharedGltfLoader(), undefined, NAIL_MASK_URL,
    { sheen: !IS_TOUCH, albedoDebug: DEV.debugAlbedo, faceBodyHideUrl: FACE_BODY_HIDE_URL, playerNumberOwner: owner }), [owner]);
  const [allowed, setAllowed] = useState(canLoad);
  useEffect(() => { if (canLoad) setAllowed(true); }, [canLoad]); // once started, a contestant stays loaded
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const outfitState = useRef(newOutfitPassState());
  const id = contestant.id;
  const report = useRef(onStatus);
  report.current = onStatus;

  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    rig.setPose(DEV.pose ?? "idle");
    rig.loadBody(BODY_URL, SOURCE_BODY_URL).then(() => !cancelled && setReady(true)).catch(e => {
      console.error(e);
      if (cancelled) return;
      setError("Couldn’t load this contestant.");
      setBusy(false);
    });
    return () => {
      cancelled = true;
      rig.dispose();
      setReady(false);
      outfitState.current = newOutfitPassState();
    };
  }, [rig, allowed]);

  // The outfit copy, diffed against what the rig wears (the same pass the builder runs).
  const slotsKey = JSON.stringify(contestant.slots);
  const build = useMemo(() => buildOf(contestant.slots), [slotsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const bodyType = contestant.bodyType ?? DEFAULT_BODY_TYPE;
  useEffect(() => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    let cancelled = false;
    const controller = new AbortController();
    const prepared: OutfitPassControl["prepared"] = {};
    runOutfitPass(rig, build, bodyType, outfitState.current, { cancelled: () => cancelled, signal: controller.signal, prepared },
      { setError, setMissingFittingData: () => undefined, setHasRecoveredPreview: () => undefined }).catch(e => {
      if (cancelled) return;
      console.error(e);
      setError("Couldn’t dress this contestant.");
    }).finally(() => {
      prepared.current?.release();
      if (!cancelled) setBusy(false);
    });
    return () => {
      cancelled = true;
      controller.abort();
      prepared.current?.release();
    };
  }, [rig, ready, build, bodyType]);

  useEffect(() => { setPlayerNumber(contestant.playerNumber ?? null, owner); }, [owner, contestant.playerNumber]);
  const settled = (ready && !busy) || (!!error && !busy);
  useEffect(() => { report.current(id, { loading: allowed && !settled, error, settled }); }, [id, allowed, settled, error]);

  const animator = useRigAnimator(animationsBaseUrl(), clipFiles);
  const { x, z, yaw } = contestant.place;
  const yawRadians = THREE.MathUtils.degToRad(yaw);
  return (
    <group position={[x, 0, z]} rotation={[0, yawRadians, 0]} userData={{ squadContestant: id }}>
      <primitive object={rig.root} />
      {animator && <MemberAnimation animator={animator} rig={rig} ready={ready} busy={busy} yaw={yawRadians} driven={driven} />}
    </group>
  );
}

/** The squad on its stage. `contestants`: the ones this device shows, in the order they load. */
export default function SquadViewer({ contestants, onStatus }: {
  contestants: readonly ContestantRecord[];
  onStatus?: (statuses: Record<string, MemberStatus>) => void;
}) {
  const look = useLightingStore(s => s.look);
  const backdrop = look.backdrop;
  const graphicsTier = useGraphicsStore(effectiveTier);
  const antiAliasing = useGraphicsStore(s => s.aa);
  const resolution = useGraphicsStore(s => s.resolution);
  const deviceDpr = useDevicePixelRatio();
  const temporalStatus = useRef(null) as TemporalStatusRef;
  const clipFiles = useMemo<ClipFileCache>(() => new Map(), []);
  const driven = useMemo(() => new Set<Driven>(), []);
  const group = useMemo(() => new THREE.Group(), []);
  const [statuses, setStatuses] = useState<Record<string, MemberStatus & { settled: boolean }>>({});
  const report = useCallback((id: string, status: MemberStatus & { settled: boolean }) => setStatuses(all =>
    all[id]?.loading === status.loading && all[id]?.error === status.error && all[id]?.settled === status.settled
      ? all : { ...all, [id]: status }), []);
  const allSettled = contestants.every(c => statuses[c.id]?.settled);
  // Where each contestant stands: the sun's shadow camera and the contact shadow are fitted to these (ViewerStage.tsx).
  const spotsKey = contestants.map(c => `${c.place.x},${c.place.z}`).join(";");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const spots = useMemo(() => contestants.map(c => ({ x: c.place.x, z: c.place.z })), [spotsKey]);
  const centre = useMemo<[number, number]>(() => {
    if (!contestants.length) return [0, 0];
    const mean = (pick: (c: ContestantRecord) => number) => contestants.reduce((sum, c) => sum + pick(c), 0) / contestants.length;
    return [mean(c => c.place.x), mean(c => c.place.z)];
  }, [contestants]);
  const isMoving = useCallback(() => {
    if (clockHeldStill()) return false;
    for (const member of driven) if (member.animator.state.moving || member.animator.scrubbing) return true;
    return false;
  }, [driven]);
  // Per-contestant download progress: contestants load one at a time, so the shared counters are the current one's.
  const progress = useSyncExternalStore(subscribeDownloadProgress, getDownloadProgress);
  const loadingIndex = contestants.findIndex(c => statuses[c.id]?.loading);
  const loadingId = loadingIndex >= 0 ? contestants[loadingIndex].id : null;
  const progressBase = useRef<{ id: string | null; loaded: number }>({ id: null, loaded: 0 });
  if (progressBase.current.id !== loadingId) progressBase.current = { id: loadingId, loaded: progress.loaded };
  const downloaded = progress.loaded - progressBase.current.loaded;

  useEffect(() => { onStatus?.(statuses); }, [statuses, onStatus]);
  useEffect(() => {
    const host = harness();
    host.__squadIdle = allSettled;
    host.__squad = {
      members: () => contestants.map(c => ({ id: c.id, settled: !!statuses[c.id]?.settled, error: statuses[c.id]?.error ?? null })),
      ...(import.meta.env.DEV ? { roots: () => group.children.slice() } : {}),
    };
  }, [allSettled, contestants, statuses, group]);
  useEffect(() => () => { delete harness().__squad; delete harness().__squadIdle; }, []);

  return (
    <div data-viewer="" className="relative h-full w-full" style={{ background: backdropCss(backdrop) }}>
      <Canvas
        aria-busy={!allSettled}
        camera={{ position: CAMERA_POSITION, fov: DEV.fov ?? 35 }}
        dpr={renderDpr(graphicsTier, resolution, deviceDpr)}
        shadows={SHADOWS}
        gl={{ alpha: true, antialias: false, toneMapping: DEV.debugAlbedo ? THREE.NoToneMapping : TONE_MAPPING[look.toneMapping],
          toneMappingExposure: look.exposure, outputColorSpace: THREE.SRGBColorSpace }}
      >
        <StageLights look={look} root={group} spots={spots} />
        <primitive object={group}>
          {contestants.map((contestant, index) => (
            <SquadMember key={contestant.id} contestant={contestant} clipFiles={clipFiles} driven={driven} onStatus={report}
              canLoad={contestants.slice(0, index).every(before => statuses[before.id]?.settled)} />
          ))}
        </primitive>
        <SquadFrameDriver driven={driven} />
        {STABLE_PREVIEW && <StablePreview isMoving={isMoving} aa={antiAliasing} statusRef={temporalStatus} />}
        <AutoGraphics status={temporalStatus} active={allSettled && contestants.length > 0} deviceDpr={deviceDpr} />
        <OrbitControls target={CAMERA_TARGET} enablePan screenSpacePanning minDistance={0.05} maxDistance={14} makeDefault />
        <FollowGroup centre={centre} />
        {import.meta.env.DEV && <RendererBridge />}
      </Canvas>
      {loadingIndex >= 0 && (
        <div role="status" className="pointer-events-none absolute bottom-3 left-3 flex h-8 items-center gap-2.5 border-l-2 border-finals bg-ink-950/85 pl-2.5 pr-3 text-fg">
          <span aria-hidden="true" className="relative block h-0.5 w-8 overflow-hidden bg-fg/20">
            <span className="absolute inset-y-0 left-0 w-2/5 animate-sweep bg-finals" />
          </span>
          <span className="hud">Loading contestant {loadingIndex + 1} of {contestants.length}…</span>
          {downloaded > 0 && <span className="hud tabular-nums text-fg-dim">{(downloaded / 1048576).toFixed(1)} MB</span>}
        </div>
      )}
      {contestants.length === 0 && (
        <p className={`hud pointer-events-none absolute inset-0 grid place-items-center ${backdropIsDark(backdrop) ? "text-fg-muted" : "text-ink-700"}`}>
          Add a contestant to start
        </p>
      )}
    </div>
  );
}
