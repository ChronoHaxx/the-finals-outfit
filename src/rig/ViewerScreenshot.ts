import * as THREE from "three";
import { StableFrameAccumulator } from "./StableFrameAccumulator";
import type { BackdropPaint } from "../lib/stage-lighting";

// The viewer's screenshot (12 Nov 2026, community request): the view on screen as a PNG, on its backdrop or with a
// transparent background. Plan reviewed by Fable 5.2 (thread acbfb2ca).
//
// Same lighting as the screen, by construction: the capture draws the live scene (its lights, environment, shadow map,
// tone mapping and exposure) from the live camera's position, through a still-view accumulator of its own, the same
// pipeline the canvas shows (StableFrameAccumulator). Only the size differs, and the accumulation always converges:
// 32 jittered samples drawn synchronously, so a playing emote is captured at the frame on screen, without grain.
//
// Alpha. The canvas holds premultiplied colour (the accumulator divides out coverage BEFORE tone mapping, then
// premultiplies), which the browser composites over the CSS backdrop in display space: out = P + (1 - A) * B.
// - On the backdrop: the capture keeps that premultiplied output and composites it over the same gradient here, with
//   the same formula, so additive glows add to the backdrop exactly as on screen.
// - Transparent: the accumulator writes straight alpha instead (straightAlpha): display colour and coverage apart, so
//   soft edges keep full 8-bit colour and composite correctly in any editor. The floor shadow and contact shadow are
//   left out (they are part of the floor, not the character), unless asked for. Uncovered additive glow has no
//   straight form: it is exact over black (see StableFrameAccumulator.straightAlpha).

/** userData of the stage's floor objects (the floor shadow, the contact shadow): left out of a transparent capture. */
export const STAGE_FLOOR = { stageFloor: true };

export interface ScreenshotContext { gl: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.Camera }

export interface ScreenshotSize { scale: number; width: number; height: number }

/** The sizes to offer: the stage's CSS size times 1-4, within a pixel and side budget (GPU memory: about 24 bytes per
 *  pixel while capturing). Never empty: a stage too big even at 1x is scaled down to fit. */
export function screenshotSizes(cssWidth: number, cssHeight: number, maxPixels: number, maxSide: number): ScreenshotSize[] {
  const fits = (w: number, h: number) => w * h <= maxPixels && Math.max(w, h) <= maxSide;
  const sizes = [1, 2, 3, 4].map(scale => ({ scale, width: Math.round(cssWidth * scale), height: Math.round(cssHeight * scale) }))
    .filter(size => size.width > 0 && size.height > 0 && fits(size.width, size.height));
  if (sizes.length || cssWidth <= 0 || cssHeight <= 0) return sizes;
  const scale = Math.min(Math.sqrt(maxPixels / (cssWidth * cssHeight)), maxSide / Math.max(cssWidth, cssHeight));
  return [{ scale, width: Math.max(1, Math.floor(cssWidth * scale)), height: Math.max(1, Math.floor(cssHeight * scale)) }];
}

export interface Capture {
  width: number; height: number;
  /** RGBA rows top to bottom: straight alpha for a transparent capture, premultiplied otherwise. */
  pixels: Uint8Array;
  straight: boolean;
  /** Samples averaged (32 unless the scene kept changing between samples, which leaves some grain). */
  samples: number;
}

/**
 * Draw the view at `width` x `height`. Everything that touches the renderer and the scene runs synchronously and is
 * restored before this returns its promise (render target, viewport, scissor, the floor's visibility); only the pixel
 * read-back is awaited, so no live frame can run with the scene changed.
 */
export async function captureView({ gl, scene, camera }: ScreenshotContext, width: number, height: number,
  { transparent, keepFloor }: { transparent: boolean; keepFloor: boolean }): Promise<Capture> {
  if (!(camera instanceof THREE.PerspectiveCamera)) throw new Error("Screenshots need the perspective view camera");
  if (gl.getContext().isContextLost()) throw new Error("The 3D view has stopped; reload it first");
  const max = gl.capabilities.maxTextureSize;
  if (width > max || height > max) throw new Error(`This GPU draws at most ${max} px on a side`);

  // Same position and orientation (all the shading reads), the image's aspect. r3f's camera has no parent.
  const view = camera.clone();
  view.aspect = width / height;
  view.updateProjectionMatrix();

  const accumulator = new StableFrameAccumulator();
  accumulator.alwaysOn = true;
  accumulator.quality = "balanced"; // no reprojection: a still capture
  accumulator.jitter = true; // anti-aliased whatever the screen's setting
  accumulator.msaaSamples = 0;
  accumulator.straightAlpha = transparent;
  const target = new THREE.WebGLRenderTarget(width, height, { depthBuffer: false });
  const hidden: THREE.Object3D[] = [];
  const previous = gl.getRenderTarget();
  const viewport = gl.getViewport(new THREE.Vector4()), scissor = gl.getScissor(new THREE.Vector4());
  const scissorTest = gl.getScissorTest();
  let read: Promise<Uint8Array>;
  let samples = 0;
  try {
    if (transparent && !keepFloor) scene.traverse(object => {
      if (object.userData.stageFloor === true && object.visible) { hidden.push(object); object.visible = false; }
    });
    gl.setRenderTarget(target);
    gl.setScissorTest(false);
    const wanted = accumulator.status.maxSamples;
    // A scene input that changes between samples restarts the average: allow a few restarts, then take what there is.
    for (let i = 0; i < wanted * 3 && accumulator.status.samples < wanted; i++) {
      accumulator.render(gl, scene, view, true, false, false);
      if (!accumulator.status.active) throw new Error("This browser cannot draw the still view offscreen (no float render targets)");
    }
    samples = accumulator.status.samples;
    if (gl.getContext().isContextLost()) throw new Error("The 3D view stopped while capturing (out of graphics memory?)");
    // Issued now, while the target is bound and the scene is as drawn; only the wait for the GPU is asynchronous.
    const buffer = new Uint8Array(width * height * 4);
    read = gl.readRenderTargetPixelsAsync(target, 0, 0, width, height, buffer).then(() => buffer);
  } catch (error) {
    target.dispose();
    throw error;
  } finally {
    for (const object of hidden) object.visible = true;
    gl.setRenderTarget(previous);
    gl.setViewport(viewport);
    gl.setScissor(scissor);
    gl.setScissorTest(scissorTest);
    accumulator.dispose();
  }
  let raw: Uint8Array;
  try { raw = await read; } finally { target.dispose(); }
  return { width, height, pixels: flipRows(raw, width, height), straight: transparent, samples };
}

/** GL rows run bottom-up; images top-down. */
export function flipRows(pixels: Uint8Array, width: number, height: number): Uint8Array {
  const stride = width * 4, out = new Uint8Array(pixels.length);
  for (let y = 0; y < height; y++) out.set(pixels.subarray((height - 1 - y) * stride, (height - y) * stride), y * stride);
  return out;
}

/** True when nothing at all was drawn (every pixel fully transparent and black): a failed capture, not a picture. */
export function isBlank(pixels: Uint8Array): boolean {
  for (let i = 0; i < pixels.length; i++) if (pixels[i] !== 0) return false;
  return true;
}

/**
 * Premultiplied capture over an opaque backdrop, exactly as the browser composites the canvas over the CSS backdrop:
 * out = P + (255 - A) * B / 255 per channel, clamped (an additive glow, P above A, adds to the backdrop). Opaque result.
 */
export function compositeOver(premultiplied: Uint8Array, backdrop: Uint8Array | Uint8ClampedArray): Uint8Array {
  if (premultiplied.length !== backdrop.length) throw new Error("Capture and backdrop sizes differ");
  const out = new Uint8Array(premultiplied.length);
  for (let i = 0; i < premultiplied.length; i += 4) {
    const keep = 255 - premultiplied[i + 3];
    for (let c = 0; c < 3; c++) out[i + c] = Math.min(255, premultiplied[i + c] + (((keep * backdrop[i + c] + 127) / 255) | 0));
    out[i + 3] = 255;
  }
  return out;
}

/** The backdrop at the image's size (stage-lighting backdropPaint: the CSS radial gradient's ellipse and stops). */
export function paintBackdrop(width: number, height: number, paint: BackdropPaint): Uint8ClampedArray {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("No 2D canvas for the backdrop");
  if (paint.colors[0] === paint.colors[1] && paint.colors[1] === paint.colors[2]) {
    context.fillStyle = paint.colors[0];
    context.fillRect(0, 0, width, height);
  } else {
    // CSS "ellipse rx ry at cx cy": a unit circle stretched to the ellipse; the outer colour carries on past it.
    const rx = paint.rx * width, ry = paint.ry * height;
    context.setTransform(rx, 0, 0, ry, paint.cx * width, paint.cy * height);
    const gradient = context.createRadialGradient(0, 0, 0, 0, 0, 1);
    paint.stops.forEach((stop, index) => gradient.addColorStop(stop, paint.colors[index]));
    context.fillStyle = gradient;
    context.fillRect(-paint.cx * width / rx, -paint.cy * height / ry, width / rx, height / ry);
  }
  return context.getImageData(0, 0, width, height).data;
}
