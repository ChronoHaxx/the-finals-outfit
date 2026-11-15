import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { createGltfLoader } from "./loaders";

// Emote props (showcase animation, 6 Nov 2026): the objects an emote spawns in the game (a baseball bat, a teacup,
// a guitar), shown on the socket and in the time window the emote's own notifies give.
//
// The game: an AnimNotifyState_DiscoverySpawnProp on the emote's AnimSequence spawns a prop actor at its start, attaches
// it to a socket of the character mesh, and destroys it at its end. Most sockets are the bones prop_01 / weapon_root,
// which hang under spine_03 (through weapon_buffer) and are animated by every emote clip: the clip moves the prop.
// The rest are skeleton sockets (an offset from a hand), plain bones, or none (the character's own origin).
//
// The notify can also carry a RelativeTransform (rotation, offset, scale) that places the actor relative to its socket;
// props.json carries it per window as `transform` (added 10 Nov 2026: it had been dropped, so footballs showed 6x too
// big and chairs lay on their side).
//
// A notify with a CurveDrivenTransformPrefix is moved every frame by the emote's own float curves (11 Nov 2026: the
// MonsterMan poles swing down, the BlackSmith anvil and log stand beside him, the PilotCheckList pen goes from his hand
// to behind his ear). props.json carries them per window as `curve`, already in the app's frame: they act as a moving
// socket in the character's component space, and the notify transform goes on top (world = curve x notify).
//
// The props.json of 6 Nov (props-7) keyed six skeletal props' roots in character space and marked them `space:
// "component"`; newer sets bake their AnimBlueprint's ModifyBone instead (the root held at the socket), so the prop rides
// its socket and `space` no longer appears. Both are handled.
//
// Here: scripts/anim-export/build-props.mjs rebuilt each prop actor as a GLB and wrote props.json (actors, sockets,
// per-emote windows). convert-clips.mjs keeps the attach bones' tracks and lists their rest pose (`attachBones`), so
// this class adds them as plain nodes under the body BEFORE the mixer binds (three resolves a track's target by name
// once, when an action first binds). Props are cloned from a cached template per actor and only shown in their window.
//
// A skeletal prop plays the one sequence its AnimBlueprint evaluates (embedded in its GLB). Most of those blueprints
// evaluate it at an explicit time the emote drives through its PropAnimSequenceTime curve (props.json clock
// "emote-curve"; the clip carries the curve): the Ace Pilot wings unfold to 0.22 s and hold there. The others run from
// the moment the prop spawns ("spawn"). Either way the prop's own mixer is SET to that time each frame (not stepped),
// so a paused frame is exactly repeatable.
//
// Not reproduced: weapon-style AnimBlueprints with no sequence (bows, blades stay in their reference pose; see
// props.json notes), cloth (flags), physics on release, effects (Niagara), and props that depend on the worn cosmetic
// (item-specific spawns, such as the country on a flag).

export interface AttachBone { name: string; parent: string; position: number[]; quaternion: number[] }
export interface ComponentSpace { under: string; quaternion: number[] }

interface SocketInfo { bone: string; translation: number[]; rotation: number[]; scale: number[] }
/** The spawn notify's RelativeTransform, converted to the app's frame by build-props.mjs (absent: identity). */
export interface PropTransform { translation?: number[]; rotation?: number[]; scale?: number[] }
/** Key frames and flat values ([frames], [x, y, z, ...]): linear between keys, held past both ends. */
export type CurveKeys = [number[], number[]];
/** A CurveDrivenTransformPrefix window's per-frame transform (build-props.mjs), in the app's frame. Frame = clip time /
 *  frameTime. */
export interface PropCurve { prefix: string; frameTime: number; frames: number; translation: CurveKeys; rotation: CurveKeys;
  scale?: CurveKeys }
export interface PropWindow { actor: string; socket: string | null; start: number; duration: number; shown: boolean;
  transform?: PropTransform; curve?: PropCurve }
export interface PropsManifest {
  formatVersion: 1;
  sockets: Record<string, SocketInfo>;
  actors: Record<string, { file: string; bytes: number; kind: string; animated?: boolean; clock?: "emote-curve" | "spawn";
    /** "component": its animation places it in character space (attach to the character, not the socket). Older sets
     *  only (props-7); newer ones bake the AnimBlueprint's root override instead (`rootOverrides`, informational). */
    space?: "component"; unanimated?: boolean; notes?: string[];
    rootOverrides?: { component: string; bone: string; translation?: number[]; rotation?: number[]; from: string }[] }>;
  emotes: Record<string, PropWindow[]>;
}

// The keyed segment holding `frame`: the key index before it and how far along (held at both ends).
function segment(keys: number[], frame: number): [number, number] {
  if (frame <= keys[0] || keys.length === 1) return [0, 0];
  const last = keys.length - 1;
  if (frame >= keys[last]) return [last, 0];
  let lo = 0, hi = last;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (keys[mid] <= frame) lo = mid; else hi = mid; }
  return [lo, (frame - keys[lo]) / (keys[lo + 1] - keys[lo])];
}
const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpQa = new THREE.Quaternion(), tmpQb = new THREE.Quaternion();
const tmpP = new THREE.Vector3(), tmpS = new THREE.Vector3(), tmpQ = new THREE.Quaternion();
function sampleVector([keys, values]: CurveKeys, frame: number, out: THREE.Vector3): THREE.Vector3 {
  const [i, u] = segment(keys, frame);
  tmpA.fromArray(values, i * 3);
  return u ? out.copy(tmpA).lerp(tmpB.fromArray(values, (i + 1) * 3), u) : out.copy(tmpA);
}
/** The curve transform at `time` seconds into the emote clip, as a matrix. */
export function sampleCurve(curve: PropCurve, time: number, out = new THREE.Matrix4()): THREE.Matrix4 {
  const frame = time / curve.frameTime;
  sampleVector(curve.translation, frame, tmpP);
  const [i, u] = segment(curve.rotation[0], frame);
  tmpQa.fromArray(curve.rotation[1], i * 4);
  if (u) tmpQa.slerp(tmpQb.fromArray(curve.rotation[1], (i + 1) * 4), u);
  tmpQ.copy(tmpQa).normalize();
  if (curve.scale) sampleVector(curve.scale, frame, tmpS); else tmpS.set(1, 1, 1);
  return out.compose(tmpP, tmpQ, tmpS);
}
const curveMatrix = new THREE.Matrix4();
const transformMatrix = (t: PropTransform | undefined) => new THREE.Matrix4().compose(
  new THREE.Vector3().fromArray(t?.translation ?? [0, 0, 0]), new THREE.Quaternion().fromArray(t?.rotation ?? [0, 0, 0, 1]),
  new THREE.Vector3().fromArray(t?.scale ?? [1, 1, 1]));

/** A loaded prop: its scene (cloned per use) and the animation its AnimBlueprint plays, if any. */
export interface PropTemplate { scene: THREE.Object3D; clips: THREE.AnimationClip[] }

/** The app's loader: the prop GLB through the rig's GLTFLoader (created on first use). */
let sharedLoader: ReturnType<typeof createGltfLoader> | null = null;
async function loadPropGlb(href: string): Promise<PropTemplate> {
  sharedLoader ??= createGltfLoader();
  const gltf = await sharedLoader.loadAsync(href);
  return { scene: gltf.scene, clips: gltf.animations };
}

export class EmoteProps {
  private manifest: Promise<PropsManifest | null> | null = null;
  private resolved: PropsManifest | null = null;
  private templates = new Map<string, Promise<PropTemplate>>(); // by actor
  private ready = new Map<string, PropTemplate>(); // templates that finished loading
  private root: THREE.Object3D | null = null;
  private added: THREE.Object3D[] = []; // attach bones, the component-space node, socket nodes: removed on detach
  private socketNodes = new Map<string, THREE.Object3D>();
  private windows: PropWindow[] = [];
  private instances: (THREE.Object3D | null)[] = [];
  private mixers: (THREE.AnimationMixer | null)[] = [];
  private clock: ((time: number) => number) | null = null; // the emote's PropAnimSequenceTime
  private hidden = false;

  constructor(private readonly url: string | null, private readonly attachBones: AttachBone[] = [],
    private readonly componentSpace: ComponentSpace | null = null,
    /** How a prop file is loaded (tests pass their own; the app loads the GLB). */
    private readonly loadTemplate: (href: string) => Promise<PropTemplate> = loadPropGlb) {}

  /** props.json, fetched once (null: this deployment ships no props). */
  load(): Promise<PropsManifest | null> {
    if (!this.manifest) {
      const url = this.url;
      this.manifest = url ? fetch(url).then(async r => r.ok ? await r.json() as PropsManifest : null).catch(() => null) : Promise.resolve(null);
      this.manifest.then(m => { this.resolved = m?.formatVersion === 1 ? m : null; });
    }
    return this.manifest;
  }

  /** props.json has arrived (what each emote shows is known). */
  get loaded(): boolean { return this.resolved !== null; }

  /** The props.json entry list for an emote animation, when loaded. */
  windowsFor(source: string | undefined): PropWindow[] | null {
    if (!this.resolved || !source) return null;
    return this.resolved.emotes[source] ?? [];
  }

  /** Add the attach bones (and the component-space node) under the body. Call before the mixer binds. */
  attach(root: THREE.Object3D): void {
    if (this.root === root) return;
    this.detach();
    this.root = root;
    const byName = (name: string) => root.getObjectByName(name);
    for (const bone of this.attachBones) {
      if (byName(bone.name)) continue; // a body that already has it
      const parent = byName(bone.parent);
      if (!parent) continue;
      const node = new THREE.Object3D();
      node.name = bone.name;
      node.position.fromArray(bone.position);
      node.quaternion.fromArray(bone.quaternion);
      parent.add(node);
      this.added.push(node);
    }
    const under = this.componentSpace && byName(this.componentSpace.under)?.parent;
    if (this.componentSpace && under) {
      const node = new THREE.Object3D();
      node.name = "emote-props:component-space";
      node.quaternion.fromArray(this.componentSpace.quaternion);
      under.add(node);
      this.added.push(node);
      this.socketNodes.set("", node);
    }
  }

  /** Remove everything this class added to the body (a new body, or the viewer unmounting). */
  detach(): void {
    this.setEmote(null);
    for (const node of this.added) node.removeFromParent();
    this.added = [];
    this.socketNodes.clear();
    this.root = null;
  }

  private template(actor: string): Promise<PropTemplate> | null {
    const info = this.resolved?.actors[actor];
    if (!info || !this.url) return null;
    let pending = this.templates.get(actor);
    if (!pending) {
      const base = new URL(this.url, globalThis.location?.href ?? "http://localhost/");
      pending = this.loadTemplate(new URL(info.file, base).href).then(loaded => {
        loaded.scene.traverse(o => {
          if ((o as THREE.Mesh).isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
            if ((o as THREE.SkinnedMesh).isSkinnedMesh) o.frustumCulled = false; // bounds of the bind pose
          }
        });
        loaded.scene.name = `emote-prop:${actor}`;
        this.ready.set(actor, loaded);
        return loaded;
      });
      pending.catch(error => { console.warn(`[animation] prop ${actor} failed to load`, error); this.templates.delete(actor); });
      this.templates.set(actor, pending);
    }
    return pending;
  }

  /** Download the props an emote animation spawns (resolves when they are ready, or failed). */
  async prepare(source: string | undefined): Promise<void> {
    await this.load();
    const windows = this.windowsFor(source) ?? [];
    await Promise.allSettled(windows.filter(w => w.shown).map(w => this.template(w.actor)));
  }

  /** The emote in front changed (null: none, or the idle): its props replace the previous emote's. */
  setEmote(source: string | null | undefined, clock: ((time: number) => number) | null = null): void {
    this.clock = source ? clock : null;
    this.instances.forEach((instance, i) => {
      const mixer = this.mixers[i];
      if (mixer && instance) { mixer.stopAllAction(); mixer.uncacheRoot(instance); }
      instance?.removeFromParent();
    });
    this.instances = [];
    this.mixers = [];
    this.windows = (source && this.windowsFor(source)?.filter(w => w.shown)) || [];
    this.instances = this.windows.map(() => null);
    this.mixers = this.windows.map(() => null);
    for (const w of this.windows) void this.template(w.actor); // already prepared in the normal path
  }

  /** Hide every prop for a still-pose draw (share card, export), or show them again. */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    for (const instance of this.instances) if (instance) instance.visible = !hidden && instance.userData.inWindow === true;
  }

  private socket(name: string | null): THREE.Object3D | null {
    const key = (name ?? "").toLowerCase();
    const cached = this.socketNodes.get(key);
    if (cached) return cached;
    const root = this.root;
    if (!root) return null;
    const attach = this.attachBones.find(b => b.name.toLowerCase() === key);
    let node: THREE.Object3D | null = attach ? root.getObjectByName(attach.name) ?? null : null;
    const socket = this.resolved?.sockets[key];
    if (!node && socket) {
      const bone = root.getObjectByName(socket.bone);
      if (bone) {
        node = new THREE.Object3D();
        node.name = `emote-props:socket:${key}`;
        node.position.fromArray(socket.translation);
        node.quaternion.fromArray(socket.rotation);
        node.scale.fromArray(socket.scale);
        bone.add(node);
        this.added.push(node);
      }
    }
    if (!node) root.traverse(o => { if (!node && (o as THREE.Bone).isBone && o.name.toLowerCase() === key) node = o; });
    if (!node) {
      console.warn(`[animation] prop socket ${name} not found; using the character origin`);
      node = this.socketNodes.get("") ?? null;
    }
    if (node) this.socketNodes.set(key, node);
    return node;
  }

  /** Show the props whose window holds `time` (seconds into the emote clip); null hides them all. */
  update(time: number | null): void {
    this.windows.forEach((w, i) => {
      const inWindow = time !== null && time >= w.start && time < w.start + w.duration;
      let instance = this.instances[i];
      if (inWindow && !instance) {
        const template = this.ready.get(w.actor);
        const inCharacterSpace = this.resolved?.actors[w.actor]?.space === "component";
        const parent = template ? this.socket(inCharacterSpace ? null : w.socket) : null;
        if (template && parent) {
          instance = cloneSkinned(template.scene);
          // The notify places the actor relative to its socket (the football is authored ~1.1 m and scaled 0.16; the
          // office chair is turned 90 degrees). It goes on this clone, never on the socket node or the template: those
          // are shared with every other prop on the same socket and every later spawn.
          const t = w.transform;
          if (w.curve) {
            // Moved every frame: its matrix is set directly (curve x notify), since a mirrored or non-uniformly scaled
            // notify under a rotating curve is not a plain position/rotation/scale.
            instance.matrixAutoUpdate = false;
            instance.userData.notifyMatrix = transformMatrix(t);
          } else {
            if (t?.translation) instance.position.fromArray(t.translation);
            if (t?.rotation) instance.quaternion.fromArray(t.rotation);
            if (t?.scale) instance.scale.fromArray(t.scale);
          }
          parent.add(instance);
          this.instances[i] = instance;
          if (template.clips.length) {
            const mixer = new THREE.AnimationMixer(instance);
            for (const clip of template.clips) mixer.clipAction(clip).play(); // loops, as the sequence player does
            this.mixers[i] = mixer;
          }
        }
      }
      if (instance) {
        instance.userData.inWindow = inWindow;
        instance.visible = inWindow && !this.hidden;
        if (inWindow && time !== null) {
          const curve = this.resolved?.actors[w.actor]?.clock === "emote-curve" ? this.clock : null;
          this.mixers[i]?.setTime(curve ? curve(time) : time - w.start);
          if (w.curve) {
            instance.matrix.multiplyMatrices(sampleCurve(w.curve, time, curveMatrix), instance.userData.notifyMatrix as THREE.Matrix4);
            instance.matrixWorldNeedsUpdate = true;
          }
        }
      }
    });
  }
}
