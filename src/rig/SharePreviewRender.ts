import * as THREE from "three";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

// The link-preview image: the current outfit from four angles on the viewer's backdrop, 1200x630 (the size link
// cards use). Each angle renders offscreen; the live canvas and its camera are never touched.
//
// three applies tone mapping and the sRGB transfer only when it draws to the screen, so each view renders linear
// into a float target and OutputPass then applies the renderer's own curve (Neutral in the studio) into an 8-bit
// target that is read back. The viewer canvas is transparent over a CSS gradient; the image paints that gradient
// itself and composites the views over it.

export const PREVIEW_WIDTH = 1200, PREVIEW_HEIGHT = 630;
const VIEWS = [0, 35, 90, 180]; // degrees around the character: front, three-quarter, side, back
const SPACING = 285; // between view centres; the outer views sit 172 px in so their hands stay in the image
const VIEW_WIDTH = 400; // wider than the spacing so arms can overlap a neighbour instead of being cut
const FEATHER = 12; // px at each side of a view faded out, so a wide ground shadow does not end in a hard edge
const SUPERSAMPLE = 2;
const FOV = 30;

export interface PreviewScene {
  gl: THREE.WebGLRenderer;
  scene: THREE.Scene;
  root: THREE.Object3D; // the character, for framing
  backdrop: { inner: string; middle: string; outer: string };
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

/** Vertical framing from the outfit's bounds, clamped so a stray effect mesh cannot shrink the character away. */
export function framing(bounds: THREE.Box3): { centerY: number; distance: number } {
  const bottom = Math.min(0, Math.max(-0.1, bounds.isEmpty() ? 0 : bounds.min.y));
  const top = Math.min(2.6, Math.max(1.75, bounds.isEmpty() ? 1.9 : bounds.max.y));
  const half = ((top - bottom) / 2) * 1.2;
  return { centerY: (top + bottom) / 2, distance: half / Math.tan(THREE.MathUtils.degToRad(FOV / 2)) };
}

function floatTargetType(gl: THREE.WebGLRenderer): THREE.TextureDataType {
  return gl.extensions.has("EXT_color_buffer_float") || gl.extensions.has("EXT_color_buffer_half_float")
    ? THREE.HalfFloatType : THREE.UnsignedByteType;
}

export async function renderSharePreview({ gl, scene, root, backdrop }: PreviewScene): Promise<Blob> {
  const width = VIEW_WIDTH * SUPERSAMPLE, height = PREVIEW_HEIGHT * SUPERSAMPLE;
  const linear = new THREE.WebGLRenderTarget(width, height, { type: floatTargetType(gl), samples: 4 });
  const display = new THREE.WebGLRenderTarget(width, height);
  const output = new OutputPass();
  const camera = new THREE.PerspectiveCamera(FOV, VIEW_WIDTH / PREVIEW_HEIGHT, 0.05, 50);
  const { centerY, distance } = framing(visibleBounds(root));
  const pixels = new Uint8Array(width * height * 4);
  const views: ImageData[] = [];

  const previousTarget = gl.getRenderTarget(), previousColor = gl.getClearColor(new THREE.Color());
  const previousAlpha = gl.getClearAlpha(), previousAutoClear = gl.autoClear;
  try {
    gl.autoClear = true;
    gl.setClearColor(0x000000, 0);
    for (const degrees of VIEWS) {
      const angle = THREE.MathUtils.degToRad(degrees);
      camera.position.set(Math.sin(angle) * distance, centerY, Math.cos(angle) * distance);
      camera.lookAt(0, centerY, 0);
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
  } finally {
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

  for (const quality of [0.86, 0.75, 0.6]) {
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", quality));
    if (blob && blob.size <= 240_000) return blob;
  }
  throw new Error("Preview image too large");
}
