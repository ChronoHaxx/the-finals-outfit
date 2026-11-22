import * as THREE from "three";
import { StableFrameAccumulator } from "./StableFrameAccumulator";
import { withoutOverlays } from "./ViewerOverlay";
import type { BackdropPaint } from "../lib/stage-lighting";

// The viewer's screenshot (12 Nov 2026, community request): the view on screen as a PNG, on its backdrop or with a
// transparent background. Plan reviewed by Fable 5.2 (thread acbfb2ca).
//
// Same lighting as the screen, by construction: the capture draws the live scene (its lights, environment, shadow map,
// tone mapping and exposure) from the live camera's position, through a still-view accumulator of its own, the same
// pipeline the canvas shows (StableFrameAccumulator). Only the size differs, and the accumulation always converges:
// jittered samples drawn synchronously, so a playing emote is captured at the frame on screen, without grain.
//
// Supersampling (21 Nov 2026, feedback: the snipping tool looked crisper than the PNG). The jittered average alone
// anti-aliases edges, but every texture is still read at the mip level of the output size. The capture now renders at
// `supersample` times the output size and averages each k x k block down: textures, normal maps and specular detail
// come from a finer mip and are filtered properly, like a high-DPI screen seen from a normal distance. The large image
// is drawn in tiles (PerspectiveCamera.setViewOffset), so GPU memory is bounded by the tile, not the image: each tile
// accumulates its samples, then a resolve pass averages it into its part of the 8-bit output. The video export
// (VideoExport.ts) draws every frame through the same object.
//
// Where the average is taken. A browser shows the canvas composited over the CSS backdrop in display (sRGB-encoded)
// values, out = P + (1 - A) * B, and an eye or a downscaling screen averages light. So:
// - On the backdrop: each fine pixel is composited over the backdrop exactly as the browser does (premultiplied, in
//   display values, clamped: additive glow adds), then decoded to linear light, averaged, and encoded. Opaque result.
// - Transparent: the accumulator writes straight alpha (straightAlpha): display colour and coverage apart. Colours are
//   averaged in linear light weighted by coverage, coverage by plain mean; the result stays straight, so soft edges
//   keep full 8-bit colour and composite correctly in any editor. The floor shadow and contact shadow are left out
//   (they are part of the floor, not the character), unless asked for. Uncovered additive glow has no straight form:
//   it is exact over black (see StableFrameAccumulator.straightAlpha).

/** userData of the stage's floor objects (the floor shadow, the contact shadow): left out of a transparent capture. */
export const STAGE_FLOOR = { stageFloor: true };

export interface ScreenshotContext { gl: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.Camera }

export interface ScreenshotSize { scale: number; width: number; height: number }

/** The sizes to offer: the stage's CSS size times 1-4, within a pixel and side budget. Never empty: a stage too big
 *  even at 1x is scaled down to fit. (GPU memory is bounded by the capture's tile; the budget bounds the output image,
 *  its read-back and its encoding.) */
export function screenshotSizes(cssWidth: number, cssHeight: number, maxPixels: number, maxSide: number): ScreenshotSize[] {
  const fits = (w: number, h: number) => w * h <= maxPixels && Math.max(w, h) <= maxSide;
  const sizes = [1, 2, 3, 4].map(scale => ({ scale, width: Math.round(cssWidth * scale), height: Math.round(cssHeight * scale) }))
    .filter(size => size.width > 0 && size.height > 0 && fits(size.width, size.height));
  if (sizes.length || cssWidth <= 0 || cssHeight <= 0) return sizes;
  const scale = Math.min(Math.sqrt(maxPixels / (cssWidth * cssHeight)), maxSide / Math.max(cssWidth, cssHeight));
  return [{ scale, width: Math.max(1, Math.floor(cssWidth * scale)), height: Math.max(1, Math.floor(cssHeight * scale)) }];
}

/** How the supersampled image (`fullWidth` x `fullHeight`, both multiples of `factor`) is cut into equal tiles of at
 *  most `maxTile` px a side, each a multiple of `factor` (a tile resolves into whole output pixels). Edge tiles may
 *  reach past the image; the resolve pass clips them. */
export function tileGrid(fullWidth: number, fullHeight: number, maxTile: number, factor: number) {
  const side = (full: number) => {
    const count = Math.ceil(full / Math.max(factor, maxTile - (maxTile % factor)));
    return { count, size: Math.ceil(full / count / factor) * factor };
  };
  const x = side(fullWidth), y = side(fullHeight);
  return { columns: x.count, rows: y.count, tileWidth: x.size, tileHeight: y.size };
}

export interface CaptureOptions {
  /** Output size in pixels. */
  width: number; height: number;
  /** Fine pixels per output pixel along each side (1-4). */
  supersample: number;
  /** Jittered samples per fine pixel (1-32). */
  samples: number;
  transparent: boolean;
  /** Transparent only: keep the floor and contact shadows. */
  keepFloor: boolean;
  /** Opaque only: the backdrop the browser paints behind the canvas, composited per fine pixel. */
  backdrop: BackdropPaint | null;
  /** Largest tile side in fine pixels (GPU memory: about 32 bytes per tile pixel). */
  maxTile: number;
}

const RESOLVE_VERTEX = `in vec3 position; void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`;
// One output pixel from its k x k fine pixels (rows top-down: the output target's GL row 0 is the image's top row, so
// a read-back needs no flip). See the top of this file for the two averages.
const RESOLVE_FRAGMENT = `precision highp float;
precision highp int;
uniform sampler2D tile;
uniform sampler2D backdrop;
uniform vec2 outOrigin;   // this tile's first output pixel, in output pixels (x right, y down)
uniform vec2 tileOrigin;  // this tile's first fine pixel, in fine pixels (x right, y down)
uniform vec2 fullSize;    // the whole image, in fine pixels
uniform int tileHeight;
uniform int factor;
uniform bool transparent;
out vec4 color;
vec3 decode(vec3 c) { c = clamp(c, 0.0, 1.0); return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c)); }
vec3 encode(vec3 c) { c = clamp(c, 0.0, 1.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }
void main() {
  ivec2 pixel = ivec2(floor(gl_FragCoord.xy - outOrigin));
  vec3 light = vec3(0.0);
  float coverage = 0.0;
  for (int j = 0; j < 4; j++) {
    if (j >= factor) break;
    for (int i = 0; i < 4; i++) {
      if (i >= factor) break;
      ivec2 fine = pixel * factor + ivec2(i, j);
      vec4 s = texelFetch(tile, ivec2(fine.x, tileHeight - 1 - fine.y), 0);
      if (transparent) {
        float a = clamp(s.a, 0.0, 1.0);
        light += decode(s.rgb) * a;
        coverage += a;
      } else {
        vec3 b = texture(backdrop, (tileOrigin + vec2(fine) + 0.5) / fullSize).rgb;
        light += decode(s.rgb + (1.0 - clamp(s.a, 0.0, 1.0)) * b);
      }
    }
  }
  float n = float(factor * factor);
  color = transparent ? (coverage > 0.0 ? vec4(encode(light / coverage), coverage / n) : vec4(0.0)) : vec4(encode(light / n), 1.0);
}`;

/**
 * A capture of the view through a fixed camera (a copy of the live one, at the image's aspect), drawn on demand. Each
 * draw() renders the scene as it is at that moment; the video export poses the next frame between draws.
 */
export class ViewCapture {
  readonly width: number;
  readonly height: number;
  readonly options: CaptureOptions;
  /** Fewest samples any tile of the last draw averaged (below `options.samples`: the scene kept changing). */
  samples = 0;
  private view: THREE.PerspectiveCamera;
  private accumulator: StableFrameAccumulator;
  private tile: THREE.WebGLRenderTarget;
  private output: THREE.WebGLRenderTarget;
  private backdrop: THREE.DataTexture | null = null;
  private resolve: THREE.RawShaderMaterial;
  private quad: THREE.Mesh;
  private quadScene = new THREE.Scene();
  private quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private grid: ReturnType<typeof tileGrid>;
  private disposed = false;

  constructor(private readonly gl: THREE.WebGLRenderer, private readonly scene: THREE.Scene, camera: THREE.Camera, options: CaptureOptions) {
    if (!(camera instanceof THREE.PerspectiveCamera)) throw new Error("Captures need the perspective view camera");
    if (gl.getContext().isContextLost()) throw new Error("The 3D view has stopped; reload it first");
    const { width, height } = options, factor = Math.round(options.supersample);
    if (!(factor >= 1 && factor <= 4)) throw new Error("Supersampling is 1 to 4 times");
    const max = gl.capabilities.maxTextureSize;
    if (width > max || height > max) throw new Error(`This GPU draws at most ${max} px on a side`);
    if (!gl.extensions.has("EXT_color_buffer_float")) throw new Error("This browser cannot draw the still view offscreen (no float render targets)");
    this.width = width; this.height = height;
    this.options = { ...options, supersample: factor, maxTile: Math.min(options.maxTile, max) };
    // Same position and orientation (all the shading reads), the image's aspect. r3f's camera has no parent. A copy keeps
    // the live camera's layers, so the on-screen helpers (light markers) are switched off on it: never in a capture.
    this.view = withoutOverlays(camera.clone());
    this.view.clearViewOffset();
    this.view.aspect = width / height;
    this.view.updateProjectionMatrix();
    this.grid = tileGrid(width * factor, height * factor, this.options.maxTile, factor);
    this.accumulator = new StableFrameAccumulator(Math.max(1, Math.min(32, Math.round(options.samples))));
    this.accumulator.alwaysOn = true;
    this.accumulator.quality = "balanced"; // no reprojection: a still capture
    this.accumulator.jitter = true; // anti-aliased whatever the screen's setting
    this.accumulator.msaaSamples = 0;
    this.accumulator.straightAlpha = options.transparent;
    // The tile holds the accumulator's display-encoded output; half float keeps its precision for the average.
    this.tile = new THREE.WebGLRenderTarget(this.grid.tileWidth, this.grid.tileHeight,
      { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.output = new THREE.WebGLRenderTarget(width, height, { depthBuffer: false });
    if (!options.transparent && options.backdrop) {
      const pixels = paintBackdrop(width, height, options.backdrop);
      // Rows top-down, as painted; the resolve reads it by image position (v down). Display values, never decoded.
      this.backdrop = new THREE.DataTexture(new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength), width, height);
      this.backdrop.colorSpace = THREE.NoColorSpace;
      this.backdrop.minFilter = this.backdrop.magFilter = THREE.LinearFilter;
      this.backdrop.generateMipmaps = false;
      this.backdrop.needsUpdate = true;
    }
    this.resolve = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: RESOLVE_VERTEX, fragmentShader: RESOLVE_FRAGMENT,
      uniforms: {
        tile: { value: this.tile.texture }, backdrop: { value: this.backdrop }, outOrigin: { value: new THREE.Vector2() },
        tileOrigin: { value: new THREE.Vector2() }, fullSize: { value: new THREE.Vector2(width * factor, height * factor) },
        tileHeight: { value: this.grid.tileHeight }, factor: { value: factor }, transparent: { value: options.transparent },
      },
      depthTest: false, depthWrite: false, blending: THREE.NoBlending,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.resolve);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  /** GPU memory held while capturing (the accumulator's targets, the tile and the output), in bytes. */
  get bytes(): number {
    return this.accumulator.status.targetBytes + this.grid.tileWidth * this.grid.tileHeight * 8 + this.width * this.height * 4;
  }

  /**
   * Draw the image as the scene is now. Everything that touches the renderer and the scene runs synchronously and is
   * restored before this returns (render target, viewport, scissor, the floor's visibility), so no live frame can run
   * with the scene changed.
   */
  draw(): void {
    if (this.disposed) throw new Error("Capture already disposed");
    const { gl, scene, view, accumulator, grid } = this;
    const { supersample: factor, transparent, keepFloor } = this.options;
    const hidden: THREE.Object3D[] = [];
    const previous = gl.getRenderTarget();
    const viewport = gl.getViewport(new THREE.Vector4()), scissor = gl.getScissor(new THREE.Vector4());
    const scissorTest = gl.getScissorTest(), autoClear = gl.autoClear;
    const fullWidth = this.width * factor, fullHeight = this.height * factor;
    let fewest = Infinity;
    try {
      if (transparent && !keepFloor) scene.traverse(object => {
        if (object.userData.stageFloor === true && object.visible) { hidden.push(object); object.visible = false; }
      });
      gl.setScissorTest(false);
      gl.autoClear = false;
      const wanted = accumulator.status.maxSamples;
      for (let row = 0; row < grid.rows; row++) for (let column = 0; column < grid.columns; column++) {
        const x = column * grid.tileWidth, y = row * grid.tileHeight;
        view.setViewOffset(fullWidth, fullHeight, x, y, grid.tileWidth, grid.tileHeight);
        gl.setRenderTarget(this.tile);
        // A new tile (or frame) is a new history: start it, then fill it. A scene input that changes between samples
        // restarts the average: allow a few restarts, then take what there is.
        accumulator.invalidate("capture");
        accumulator.render(gl, scene, view, true, false, false);
        if (!accumulator.status.active) throw new Error("This browser cannot draw the still view offscreen (no float render targets)");
        for (let i = 0; i < wanted * 3 && accumulator.status.samples < wanted; i++) accumulator.render(gl, scene, view, true, false, false);
        fewest = Math.min(fewest, accumulator.status.samples);
        // Resolve the tile into its output pixels (rows top-down; past the image's edge the viewport clips).
        // (A target's viewport goes through the target: renderer.setViewport writes the canvas rectangle.)
        const ox = x / factor, oy = y / factor, ow = grid.tileWidth / factor, oh = grid.tileHeight / factor;
        this.output.viewport.set(ox, oy, ow, oh);
        gl.setRenderTarget(this.output);
        this.resolve.uniforms.outOrigin.value.set(ox, oy);
        this.resolve.uniforms.tileOrigin.value.set(x, y);
        gl.render(this.quadScene, this.quadCamera);
      }
      if (gl.getContext().isContextLost()) throw new Error("The 3D view stopped while capturing (out of graphics memory?)");
    } finally {
      view.clearViewOffset();
      this.output.viewport.set(0, 0, this.width, this.height);
      for (const object of hidden) object.visible = true;
      gl.setRenderTarget(previous);
      gl.setViewport(viewport);
      gl.setScissor(scissor);
      gl.setScissorTest(scissorTest);
      gl.autoClear = autoClear;
    }
    this.samples = fewest;
  }

  /** The last draw's pixels: RGBA rows top-down, straight alpha if transparent, else opaque. Issued now (the output
   *  target is as drawn); only the wait for the GPU is asynchronous. */
  read(into: Uint8Array = new Uint8Array(this.width * this.height * 4)): Promise<Uint8Array> {
    return this.gl.readRenderTargetPixelsAsync(this.output, 0, 0, this.width, this.height, into).then(() => into);
  }

  /** A take's render (22 Nov 2026): move the capture's camera (the live one stays where the viewer left it). Position,
   *  rotation and vertical field of view; the capture keeps its own aspect. */
  setView(position: readonly number[], quaternion: readonly number[], fov: number): void {
    this.view.position.set(position[0], position[1], position[2]);
    this.view.quaternion.set(quaternion[0], quaternion[1], quaternion[2], quaternion[3]);
    if (fov !== this.view.fov) { this.view.fov = fov; this.view.updateProjectionMatrix(); }
    this.view.updateMatrixWorld(true);
  }

  /** A take's render: the backdrop changed (its look did). An opaque capture only; a transparent one has none. */
  setBackdrop(paint: BackdropPaint): void {
    if (!this.backdrop) return;
    const pixels = paintBackdrop(this.width, this.height, paint);
    (this.backdrop.image.data as Uint8Array).set(new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength));
    this.backdrop.needsUpdate = true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.accumulator.dispose();
    this.tile.dispose();
    this.output.dispose();
    this.backdrop?.dispose();
    this.resolve.dispose();
    this.quad.geometry.dispose();
  }
}

export interface Capture {
  width: number; height: number;
  /** RGBA rows top to bottom: straight alpha for a transparent capture, opaque (composited on its backdrop) otherwise. */
  pixels: Uint8Array;
  straight: boolean;
  /** Fewest samples averaged per fine pixel (below the target when the scene kept changing: some grain). */
  samples: number;
  wantedSamples: number;
}

/** The screenshot: 2x supersampled, 16 jittered samples per fine pixel (64 per output pixel). */
export const SCREENSHOT_SUPERSAMPLE = 2;
export const SCREENSHOT_SAMPLES = 16;

/** Draw the view at `width` x `height` (see ViewCapture) and read it back. */
export async function captureView({ gl, scene, camera }: ScreenshotContext, width: number, height: number,
  { transparent, keepFloor, backdrop, maxTile }: { transparent: boolean; keepFloor: boolean; backdrop: BackdropPaint; maxTile: number }): Promise<Capture> {
  const capture = new ViewCapture(gl, scene, camera, { width, height, supersample: SCREENSHOT_SUPERSAMPLE,
    samples: SCREENSHOT_SAMPLES, transparent, keepFloor, backdrop: transparent ? null : backdrop, maxTile });
  try {
    capture.draw();
    const pixels = await capture.read();
    return { width, height, pixels, straight: transparent, samples: capture.samples, wantedSamples: SCREENSHOT_SAMPLES };
  } finally {
    capture.dispose();
  }
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
 * (The capture composites on the GPU per fine pixel since 21 Nov 2026; this is the same formula, kept as its reference.)
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
