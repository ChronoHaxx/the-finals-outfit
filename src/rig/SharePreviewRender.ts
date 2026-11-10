import * as THREE from "three";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import type { PoseCapture } from "../lib/share-pose";

// The link-preview image: the current outfit from four angles on the viewer's backdrop, 1200x630 (the size link
// cards use). Each angle renders offscreen; the live canvas and its camera are never touched.
//
// three applies tone mapping and the sRGB transfer only when it draws to the screen, so each view renders linear
// into a float target and OutputPass then applies the renderer's own curve (Neutral in the studio) into an 8-bit
// target that is read back. The viewer canvas is transparent over a CSS gradient; the image paints that gradient
// itself and composites the views over it.
//
// Poses (10 Nov 2026): with no pose the card shows the outfit's still pose, as it always has. Given the pose on screen
// (an emote frame, playing or paused), it draws that live pose with its props, centred on the body, and names the
// frame in a caption along the bottom edge. A pose is measured as drawn (posedPoints): three keeps a skinned mesh's
// first computed bounding box for good, and the still-pose card relies on that box being the still pose's. Wide poses
// (arms out, a swung prop) pull the camera back until every view fits its slot.

export const PREVIEW_WIDTH = 1200, PREVIEW_HEIGHT = 630;
const VIEWS = [0, 35, 90, 180]; // degrees around the character: front, three-quarter, side, back
const SPACING = 285; // between view centres; the outer views sit 172 px in so their hands stay in the image
const VIEW_WIDTH = 400; // wider than the spacing so arms can overlap a neighbour instead of being cut
const FEATHER = 12; // px at each side of a view faded out, so a wide ground shadow does not end in a hard edge
const SUPERSAMPLE = 2;
const FOV = 30;
// px an outermost view may reach towards the image edge (its centre sits 172 px in), a few px short of it
const EDGE_REACH = PREVIEW_WIDTH / 2 - SPACING * (VIEWS.length - 1) / 2 - 5;
const CAPTION_ROOM = 0.16; // m kept clear under a posed card's lowest point, for the caption

export interface PreviewScene {
  gl: THREE.WebGLRenderer;
  scene: THREE.Scene;
  root: THREE.Object3D; // the character, for framing
  backdrop: { inner: string; middle: string; outer: string };
  /** Runs a synchronous draw in the outfit's static pose when an animation is playing (RigAnimator.withStillPose),
   *  so a card without a pose shows the still pose, never a random idle frame. */
  stillPose?: <T>(draw: () => T) => T;
}

function visibleBounds(root: THREE.Object3D): THREE.Box3 {
  const box = new THREE.Box3(), part = new THREE.Box3();
  root.updateWorldMatrix(true, true);
  root.traverseVisible(object => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const skinned = mesh as THREE.SkinnedMesh;
    if (skinned.isSkinnedMesh) {
      if (!skinned.boundingBox) skinned.computeBoundingBox();
      part.copy(skinned.boundingBox!).applyMatrix4(skinned.matrixWorld);
    } else {
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      part.copy(mesh.geometry.boundingBox!).applyMatrix4(mesh.matrixWorld);
    }
    if (Number.isFinite(part.min.y) && Number.isFinite(part.max.y)) box.union(part);
  });
  return box;
}

/** Where the body stands on the ground plane: the pelvis (emotes with root travel move it), else the origin. A big
 *  prop must not pull the framing off the character, so the bounds are not used for this. */
function bodyCentre(root: THREE.Object3D): { x: number; z: number } {
  const pelvis = root.getObjectByName("pelvis");
  if (!pelvis) return { x: 0, z: 0 };
  const at = pelvis.getWorldPosition(new THREE.Vector3());
  const clamp = (v: number) => Number.isFinite(v) ? THREE.MathUtils.clamp(v, -3, 3) : 0;
  return { x: clamp(at.x), z: clamp(at.z) };
}

/** Points of every visible mesh as drawn now: skinned vertices sampled through three's own CPU skinning (bones' world
 *  matrices, morphs included), static meshes by their boxes' corners. Touches no cached bounds. */
export function posedPoints(root: THREE.Object3D, budget = 40_000): THREE.Vector3[] {
  root.updateWorldMatrix(true, true);
  const meshes: THREE.Mesh[] = [];
  root.traverseVisible(object => { if ((object as THREE.Mesh).isMesh) meshes.push(object as THREE.Mesh); });
  const skinned = (mesh: THREE.Mesh) => (mesh as THREE.SkinnedMesh).isSkinnedMesh === true;
  const vertices = meshes.reduce((sum, mesh) => sum + (skinned(mesh) ? mesh.geometry.attributes.position?.count ?? 0 : 0), 0);
  const stride = Math.max(1, Math.ceil(vertices / budget));
  const points: THREE.Vector3[] = [], at = new THREE.Vector3(), box = new THREE.Box3();
  const keep = (point: THREE.Vector3) => {
    if (Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z)) points.push(point.clone());
  };
  for (const mesh of meshes) {
    const position = mesh.geometry.attributes.position;
    if (!position) continue;
    if (skinned(mesh)) {
      for (let i = 0; i < position.count; i += stride) keep(mesh.getVertexPosition(i, at).applyMatrix4(mesh.matrixWorld));
      continue;
    }
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox(); // a static shape: its box never changes
    box.copy(mesh.geometry.boundingBox!);
    for (let corner = 0; corner < 8; corner++)
      keep(at.set(corner & 1 ? box.max.x : box.min.x, corner & 2 ? box.max.y : box.min.y, corner & 4 ? box.max.z : box.min.z)
        .applyMatrix4(mesh.matrixWorld));
  }
  return points;
}

/** How far (px from its centre) each view may reach on each side: to the image edge for the outermost sides, else to
 *  where its own feathered edge begins (overlapping a neighbour, as the still card's arms already may). */
export const VIEW_REACH = VIEWS.map((_, index) => ({
  left: index === 0 ? EDGE_REACH : VIEW_WIDTH / 2 - FEATHER,
  right: index === VIEWS.length - 1 ? EDGE_REACH : VIEW_WIDTH / 2 - FEATHER,
}));

/** A posed card's framing: the still card's vertical fit with room for the caption under the feet, then pulled back
 *  until every point lies within its view's reach (VIEW_REACH), exactly, perspective included. Capped at 1.6x, so a
 *  long prop or a stray effect mesh cannot shrink the body away (a wide pose may then be cut at the edges). */
export function posedFraming(points: readonly THREE.Vector3[], centre: { x: number; z: number }): { centerY: number; distance: number } {
  const base = framing(new THREE.Box3().setFromPoints(points as THREE.Vector3[]), CAPTION_ROOM);
  // A point q (from the centre) seen from angle a at distance d: depth d - q.toward, sideways s = q.right. It fits when
  // |s| / depth <= the tangent of that side's reach; so d >= q.toward + |s| / tangent.
  const tangent = (px: number) => Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * (px / (PREVIEW_HEIGHT / 2));
  let needed = 0;
  VIEWS.forEach((degrees, index) => {
    const a = THREE.MathUtils.degToRad(degrees), sin = Math.sin(a), cos = Math.cos(a);
    const left = tangent(VIEW_REACH[index].left), right = tangent(VIEW_REACH[index].right);
    for (const point of points) {
      const x = point.x - centre.x, z = point.z - centre.z, side = x * cos - z * sin;
      needed = Math.max(needed, x * sin + z * cos + (side >= 0 ? side / right : -side / left));
    }
  });
  const distance = Math.min(Math.max(base.distance, needed), base.distance * 1.6);
  // Pulled back, the frame grows around its centre. Keep the ground where it was (just above the caption) and give the
  // extra height to the top, where raised props go. The views look level, so this moves nothing sideways.
  const half = base.distance * Math.tan(THREE.MathUtils.degToRad(FOV / 2)); // framing()'s visible half-height
  const ground = base.centerY - half / 1.2; // the lowest point framing() keeps in view, caption room included
  return { centerY: ground + (distance / base.distance) * half / 1.2, distance };
}

/** Vertical framing from the outfit's bounds, clamped so a stray effect mesh cannot shrink the character away.
 *  `reserve`: metres kept clear below the lowest point (a posed card's caption). */
export function framing(bounds: THREE.Box3, reserve = 0): { centerY: number; distance: number } {
  const bottom = Math.min(0, Math.max(-0.1, bounds.isEmpty() ? 0 : bounds.min.y)) - reserve;
  const top = Math.min(2.6, Math.max(1.75, bounds.isEmpty() ? 1.9 : bounds.max.y));
  const half = ((top - bottom) / 2) * 1.2;
  return { centerY: (top + bottom) / 2, distance: half / Math.tan(THREE.MathUtils.degToRad(FOV / 2)) };
}

function floatTargetType(gl: THREE.WebGLRenderer): THREE.TextureDataType {
  return gl.extensions.has("EXT_color_buffer_float") || gl.extensions.has("EXT_color_buffer_half_float")
    ? THREE.HalfFloatType : THREE.UnsignedByteType;
}

/** The caption's words: "ACE PILOT", "1.233 s · frame 37 / 90 · paused". */
export function captionText(pose: PoseCapture): { title: string; detail: string } {
  const seconds = (Math.round(pose.time * 1000) / 1000).toFixed(pose.time >= 100 ? 1 : 2);
  return { title: pose.label.toUpperCase(),
    detail: `${seconds} s · frame ${pose.frame} / ${pose.lastFrame}${pose.paused ? " · paused" : ""}` };
}

async function drawCaption(context: CanvasRenderingContext2D, pose: PoseCapture) {
  const family = '"Saira Variable", "Segoe UI", system-ui, sans-serif';
  try { // the page's own font; it is already loaded for the UI, but never hold the card up for it
    await Promise.race([document.fonts.load(`700 20px ${family}`), new Promise(resolve => setTimeout(resolve, 800))]);
  } catch { /* the fallback face is fine */ }
  const { title, detail } = captionText(pose);
  // Along the bottom edge, in the margin under the feet the framing leaves (8% of the height).
  const x = 18, height = 30, y = PREVIEW_HEIGHT - height - 12;
  context.font = `700 18px ${family}`;
  const titleWidth = context.measureText(title).width;
  context.font = `500 16px ${family}`;
  const detailWidth = context.measureText(detail).width;
  const width = 12 + titleWidth + 14 + detailWidth + 12;
  context.fillStyle = "rgb(9 9 11 / 0.78)";
  context.fillRect(x, y, width, height);
  context.fillStyle = "#d21f3c"; // the site's red, as on the viewer's lower third
  context.fillRect(x, y, 3, height);
  context.textBaseline = "middle";
  context.fillStyle = "#f2efe9";
  context.font = `700 18px ${family}`;
  context.fillText(title, x + 12, y + height / 2 + 1);
  context.fillStyle = "#a6a4ab";
  context.font = `500 16px ${family}`;
  context.fillText(detail, x + 12 + titleWidth + 14, y + height / 2 + 1);
}

/** The card. `pose`: the frame on screen to show (drawn as it is, props included); null for the still pose. The GL
 *  part runs synchronously before the first await, so a caller reading the pose in the same task gets that frame. */
export async function renderSharePreview({ gl, scene, root, backdrop, stillPose = draw => draw() }: PreviewScene,
  pose: PoseCapture | null = null): Promise<Blob> {
  const width = VIEW_WIDTH * SUPERSAMPLE, height = PREVIEW_HEIGHT * SUPERSAMPLE;
  const linear = new THREE.WebGLRenderTarget(width, height, { type: floatTargetType(gl), samples: 4 });
  const display = new THREE.WebGLRenderTarget(width, height);
  const output = new OutputPass();
  const camera = new THREE.PerspectiveCamera(FOV, VIEW_WIDTH / PREVIEW_HEIGHT, 0.05, 50);
  const pixels = new Uint8Array(width * height * 4);
  const views: ImageData[] = [];

  const previousTarget = gl.getRenderTarget(), previousColor = gl.getClearColor(new THREE.Color());
  const previousAlpha = gl.getClearAlpha(), previousAutoClear = gl.autoClear;
  // Framing and all four views are drawn in one synchronous pass, so they share one pose: the still pose, or the
  // frame on screen when a pose is given (no animation update can run inside a synchronous pass).
  const pass = pose ? <T>(draw: () => T) => draw() : stillPose;
  try { pass(() => {
    const { x: cx, z: cz } = pose ? bodyCentre(root) : { x: 0, z: 0 };
    const { centerY, distance } = pose ? posedFraming(posedPoints(root), { x: cx, z: cz }) : framing(visibleBounds(root));
    gl.autoClear = true;
    gl.setClearColor(0x000000, 0);
    for (const degrees of VIEWS) {
      const angle = THREE.MathUtils.degToRad(degrees);
      camera.position.set(cx + Math.sin(angle) * distance, centerY, cz + Math.cos(angle) * distance);
      camera.lookAt(cx, centerY, cz);
      camera.updateMatrixWorld();
      gl.setRenderTarget(linear);
      gl.render(scene, camera);
      output.render(gl, display, linear, 0, false);
      gl.readRenderTargetPixels(display, 0, 0, width, height, pixels);
      // GL rows run bottom-up, and blending over a transparent clear leaves colour multiplied by alpha:
      // flip, and divide it back out for the canvas, which expects straight alpha.
      const image = new ImageData(width, height), feather = FEATHER * SUPERSAMPLE;
      const fade = Float32Array.from({ length: width }, (_, x) => {
        const t = Math.min(1, Math.min(x + 0.5, width - x - 0.5) / feather);
        return t * t * (3 - 2 * t);
      });
      for (let y = 0; y < height; y++) {
        const from = (height - 1 - y) * width * 4, to = y * width * 4;
        for (let x = 0; x < width; x++) {
          const i = x * 4, a = pixels[from + i + 3], scale = a ? 255 / a : 0;
          image.data[to + i] = Math.min(255, pixels[from + i] * scale);
          image.data[to + i + 1] = Math.min(255, pixels[from + i + 1] * scale);
          image.data[to + i + 2] = Math.min(255, pixels[from + i + 2] * scale);
          image.data[to + i + 3] = a * fade[x];
        }
      }
      views.push(image);
    }
  }); } finally {
    gl.setRenderTarget(previousTarget);
    gl.setClearColor(previousColor, previousAlpha);
    gl.autoClear = previousAutoClear;
    linear.dispose();
    display.dispose();
    output.dispose();
  }

  const canvas = document.createElement("canvas");
  canvas.width = PREVIEW_WIDTH;
  canvas.height = PREVIEW_HEIGHT;
  const context = canvas.getContext("2d")!;
  const gradient = context.createRadialGradient(PREVIEW_WIDTH / 2, PREVIEW_HEIGHT * 0.35, 0,
    PREVIEW_WIDTH / 2, PREVIEW_HEIGHT * 0.35, PREVIEW_WIDTH * 0.62);
  gradient.addColorStop(0, backdrop.inner);
  gradient.addColorStop(0.55, backdrop.middle);
  gradient.addColorStop(1, backdrop.outer);
  context.fillStyle = gradient;
  context.fillRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
  const view = document.createElement("canvas");
  view.width = width;
  view.height = height;
  const viewContext = view.getContext("2d")!;
  context.imageSmoothingQuality = "high";
  views.forEach((image, index) => {
    viewContext.putImageData(image, 0, 0);
    const center = PREVIEW_WIDTH / 2 + SPACING * (index - (VIEWS.length - 1) / 2);
    context.drawImage(view, center - VIEW_WIDTH / 2, 0, VIEW_WIDTH, PREVIEW_HEIGHT);
  });
  if (pose) await drawCaption(context, pose);

  for (const quality of [0.86, 0.75, 0.6]) {
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", quality));
    if (blob && blob.size <= 240_000) return blob;
  }
  throw new Error("Preview image too large");
}
