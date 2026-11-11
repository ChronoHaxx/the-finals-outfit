import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { OutputShader } from 'three/examples/jsm/shaders/OutputShader.js';
import { StableFrameState } from './StableFrameState';
import { StableCamera } from './StableCamera';
import { setAlphaHashMotionFrame, setAlphaHashSample } from './AlphaHashSampling';
import { VelocityPass } from './VelocityPass';

const toneMappingDefines: Record<number, string> = {
  [THREE.LinearToneMapping]: 'LINEAR_TONE_MAPPING', [THREE.ReinhardToneMapping]: 'REINHARD_TONE_MAPPING',
  [THREE.CineonToneMapping]: 'CINEON_TONE_MAPPING', [THREE.ACESFilmicToneMapping]: 'ACES_FILMIC_TONE_MAPPING',
  [THREE.AgXToneMapping]: 'AGX_TONE_MAPPING', [THREE.NeutralToneMapping]: 'NEUTRAL_TONE_MAPPING',
  [THREE.CustomToneMapping]: 'CUSTOM_TONE_MAPPING',
};
// Largest MSAA sample count this GPU supports for RGBA16F render buffers (the sample target), per context. WebGL2 needs
// EXT_color_buffer_float for RGBA16F to be renderable at all; the accumulator only runs with it.
const halfFloatSamples = new WeakMap<WebGL2RenderingContext, number>();
function maxHalfFloatSamples(renderer: THREE.WebGLRenderer): number {
  const gl = renderer.getContext() as WebGL2RenderingContext;
  let max = halfFloatSamples.get(gl);
  if (max === undefined) {
    try {
      const counts = gl.getInternalformatParameter(gl.RENDERBUFFER, gl.RGBA16F, gl.SAMPLES) as Int32Array | null;
      max = counts && counts.length ? Math.max(...counts) : 0;
    } catch { max = 0; }
    halfFloatSamples.set(gl, max);
  }
  return max;
}
const radicalInverse = (index: number, base: number) => {
  let result = 0, fraction = 1 / base;
  while (index > 0) { result += (index % base) * fraction; index = Math.floor(index / base); fraction /= base; }
  return result;
};

// Motion mode (showcase animation, 5 Nov 2026): while the caller says the pose moves every frame (an animation
// playing), resetting on every change would leave one dithered alpha-hash sample per frame: grain on hair, lace and
// sheer fabric. Instead each frame's jittered sample is blended into a running average (exponential, weight
// MOTION_BLEND once warmed up), after clamping the previous average to the min/max of the current sample's 3x3
// neighbourhood. The clamp is what keeps moving edges from smearing: where something moved away, the old colour lies
// outside what the pixel's neighbourhood shows now and is dropped. (Measured without it: a slowly swaying arm smeared
// over several pixels.) No motion vectors, so fast motion falls back towards the raw sample. The still path is unchanged.
// The clamp needs each neighbourhood to show what a see-through surface looks like; with the still path's per-pixel
// random thresholds a 10% surface left all nine pixels uncovered so often that clamping erased it (coverage 0.024 for
// 0.10). Motion frames therefore draw hashed coverage with interleaved gradient noise (AlphaHashSampling motion frame),
// whose thresholds are spread evenly over every 3x3 block.
const MOTION_BLEND = 0.1;

// High quality (6 Nov 2026): the same running average, but each pixel's history is read from where its surface was in
// the previous frame (motion vectors, VelocityPass), so a moving strand keeps averaging with itself instead of with
// whatever passed through that pixel; with the history following the surface the average can run longer. Camera and
// transform changes in a still pose (a drag, a seek) take the same path, which keeps going for SETTLE_FRAMES quiet
// frames after the last change. Then the still path takes over, presented as a crossfade from the moving average into
// its own growing mean (still weight samples / maxSamples), so the end of a drag or a clip does not drop back to one
// grainy sample; the converged still frame is exactly the one Balanced converges to. Entering the motion path from a
// still frame seeds the average with it. Any other change still restarts from a fresh frame. Since 10 Nov every graphics
// preset uses this path (the screen-locked average above smeared garment print on Balanced and Low); quality
// 'balanced' keeps the screen-locked one for test rigs (?quality=balanced).
const REPROJECTED_BLEND = 1 / 16;
// Opaque surfaces (10 Nov 2026, feedback "blurry at times"): the 1/16 history exists to average alpha-hash dither, which
// opaque surfaces do not have; for them it only lags and softens. So opaque pixels take a shorter history that shortens
// further with speed (a fast surface is resampled at large sub-pixel offsets every frame), and drop it where last
// frame's depth says it belonged to another surface (an arm uncovering the print). Alpha-hashed pixels keep 1/16.
// Measured on a printed jacket at 1x (_docs/graphics-options-2026-11-10; detail error against the converged still pose,
// sharpness 1 = as sharp as it, flicker = frame-to-frame change on a held pose, luma levels):
//   history          idle          clap emote    shadow-boxing   held-pose flicker
//   1/16 (before)    6.6 / 0.92    13.5 / 0.81   17.2 / 0.73     0.64
//   1/8 -> 1/3       5.0 / 0.98     7.8 / 0.95    9.3 / 0.92     1.38
//   1/4 -> 1/2       4.2 / 0.99     7.0 / 0.98    8.5 / 0.96     2.76
// 1/4 shimmers on fine print when nearly still; 1/8 keeps most of the gain at half that.
const OPAQUE_BLEND = 1 / 8;
const OPAQUE_FAST_BLEND = 1 / 2; // at 4 or more pixels per frame
const SETTLE_FRAMES = 4;
const SEEDED_FRAMES = 16; // a seeded average counts as this many frames already averaged
export type AccumulatorQuality = 'high' | 'balanced';

/** Bounded still-view supersampling, not motion-reprojected/native engine TAA.
 * One linear HDR sample per frame, with a fresh first frame whenever inputs change.
 * Two targets only; the converged view needs just one full-screen presentation draw.
 * (Motion mode, above, adds a third target only while an animation plays.)
 */
export class StableFrameAccumulator {
  readonly status = { active: false, samples: 0, maxSamples: 32, resets: 0, sceneRenders: 0,
    reason: 'initial', width: 0, height: 0, targetBytes: 0, additive: false, motion: false, motionFrames: 0,
    reprojected: false, fading: false, velocityRenders: 0, firstOther: '',
    /** The caller's animation is playing (whatever path drew the frame): Auto's measurer and the FPS counter read it. */
    animating: false,
    /** MSAA samples per pixel in the sample target (0: none). */
    msaa: 0 };
  /** Balanced: the screen-locked motion average (as shipped 5 Nov). High: reprojected with motion vectors (above). */
  quality: AccumulatorQuality = 'balanced';
  /** High's tuning, exposed for test rigs (StablePreview's ?rpBlend= / ?rpCubic=0 / ?rpOpaque= ... in dev). */
  readonly reprojection = { blend: REPROJECTED_BLEND, cubic: true, opaqueBlend: OPAQUE_BLEND, opaqueFastBlend: OPAQUE_FAST_BLEND, opaqueReset: true };
  /**
   * Sub-pixel jitter (10 Nov). On: temporal anti-aliasing. Off (the MSAA and Off settings): every sample is drawn at the
   * pixel centre, so the still view's average only converges alpha-hashed coverage and opaque pixels equal one raw frame.
   */
  jitter = true;
  /** MSAA samples for the sample target (10 Nov, the MSAA setting); capped by what this GPU supports for RGBA16F. */
  msaaSamples = 0;
  /**
   * Stay active with no masked or additive item in view (10 Nov), so every outfit gets the same anti-aliasing and the
   * canvas needs no multisampled back buffer of its own. Off by default: the GPU checks drive the bare pass.
   */
  alwaysOn = false;
  private state = new StableFrameState();
  private camera = new StableCamera();
  private sample: THREE.WebGLRenderTarget | null = null;
  private history: THREE.WebGLRenderTarget | null = null;
  private motionHistory: THREE.WebGLRenderTarget | null = null; // the motion average ping-pongs with `history`
  private motionInHistory = false; // which of the two holds the latest motion average
  private velocity: VelocityPass | null = null; // High only
  private targetsHigh = false; // targets made for High (linear filtering: reprojection reads between pixels)
  private settle = 0; // High: motion-path frames left after the last transform change
  private fading = false; // High: the still path is crossfading in from the motion average (kept in motionHistory)
  private motionCount = 0; // frames in the current motion average (sets its blend weight)
  private seedFrom: 'still' | 'motion' | null = null;
  private seedScale = 1;
  private reproject: THREE.ShaderMaterial;
  private crossfade: THREE.ShaderMaterial;
  private viewProjection = new THREE.Matrix4();
  private copy: THREE.ShaderMaterial;
  private resolve: THREE.ShaderMaterial;
  private output: THREE.RawShaderMaterial;
  private quad: FullScreenQuad;
  private outputKey = '';
  private invalidated = 'initial';
  private size = new THREE.Vector2();

  constructor(maxSamples = 32) {
    if (!Number.isInteger(maxSamples) || maxSamples < 1 || maxSamples > 256) throw new Error('Invalid accumulation sample count');
    this.status.maxSamples = maxSamples;
    this.copy = new THREE.ShaderMaterial({
      uniforms: { map: { value: null }, weight: { value: 1 / maxSamples } },
      vertexShader: 'varying vec2 vUv; void main() { vUv=uv; gl_Position=vec4(position,1.0); }',
      fragmentShader: 'uniform sampler2D map; uniform float weight; varying vec2 vUv; void main() { gl_FragColor=texture2D(map,vUv)*weight; }',
      transparent: true, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, depthTest: false, depthWrite: false, toneMapped: false,
    });
    // Motion resolve: average = mix(clamp(previous average, 3x3 min, 3x3 max), current sample, blend), all in the
    // linear premultiplied target space the still path averages in, so a moving and a paused frame agree.
    this.resolve = new THREE.ShaderMaterial({
      uniforms: { current: { value: null }, previous: { value: null }, texel: { value: new THREE.Vector2() }, blend: { value: 1 } },
      vertexShader: 'varying vec2 vUv; void main() { vUv=uv; gl_Position=vec4(position,1.0); }',
      fragmentShader: `uniform sampler2D current; uniform sampler2D previous; uniform vec2 texel; uniform float blend;
        varying vec2 vUv;
        void main() {
          vec4 now = texture2D(current, vUv), low = now, high = now;
          for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
            vec4 near = texture2D(current, vUv + vec2(float(x), float(y)) * texel);
            low = min(low, near); high = max(high, near);
          }
          gl_FragColor = mix(clamp(texture2D(previous, vUv), low, high), now, blend);
        }`,
      blending: THREE.NoBlending, depthTest: false, depthWrite: false, toneMapped: false,
    });
    // High: the same clamped average, with the history read at this pixel minus its motion. The motion is taken from
    // the nearest surface in the 3x3 neighbourhood (closest-depth dilation): silhouettes and thin strands move with the
    // surface in front. A history position off screen has nothing to offer, so that pixel restarts from the sample.
    // `previousScale` turns a still history's sum into its mean when a still frame seeds the average.
    this.reproject = new THREE.ShaderMaterial({
      uniforms: { current: { value: null }, previous: { value: null }, velocity: { value: null }, texel: { value: new THREE.Vector2() },
        blend: { value: 1 }, previousScale: { value: 1 }, cubic: { value: true }, trustAll: { value: false },
        previousVelocity: { value: null }, previousValid: { value: false },
        opaqueBlend: { value: OPAQUE_BLEND }, opaqueFastBlend: { value: OPAQUE_FAST_BLEND }, opaqueReset: { value: true } },
      vertexShader: 'varying vec2 vUv; void main() { vUv=uv; gl_Position=vec4(position,1.0); }',
      fragmentShader: `uniform sampler2D current; uniform sampler2D previous; uniform sampler2D velocity; uniform vec2 texel;
        uniform float blend; uniform float previousScale; uniform bool cubic; uniform bool trustAll;
        uniform sampler2D previousVelocity; uniform bool previousValid;
        uniform float opaqueBlend; uniform float opaqueFastBlend; uniform bool opaqueReset;
        varying vec2 vUv;
        // Catmull-Rom history read in five bilinear taps (the corner taps dropped, weights renormalised): re-reading the
        // history between pixels every frame with plain bilinear filtering blurs it a little each time, which adds up
        // over the average's ~16 frames; the cubic kernel's negative lobes keep it sharp. Its overshoot is clamped below.
        vec4 readHistory(vec2 uv) {
          if (!cubic) return texture2D(previous, uv);
          vec2 size = 1.0 / texel, position = uv * size, centre = floor(position - 0.5) + 0.5, f = position - centre;
          vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f)), w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
          vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f)), w3 = f * f * (-0.5 + 0.5 * f);
          vec2 w12 = w1 + w2, middle = (centre + w2 / w12) * texel, before = (centre - 1.0) * texel, after = (centre + 2.0) * texel;
          float a = w12.x * w0.y, b = w0.x * w12.y, c = w12.x * w12.y, d = w3.x * w12.y, e = w12.x * w3.y;
          vec4 sum = texture2D(previous, vec2(middle.x, before.y)) * a + texture2D(previous, vec2(before.x, middle.y)) * b
            + texture2D(previous, middle) * c + texture2D(previous, vec2(after.x, middle.y)) * d + texture2D(previous, vec2(middle.x, after.y)) * e;
          return sum / (a + b + c + d + e);
        }
        void main() {
          vec4 now = texture2D(current, vUv), low = now, high = now;
          vec2 motion = vec2(0.0), centre = texture2D(velocity, vUv).rg, slowest = centre, fastest = centre;
          float nearest = 1.0e30, expected = 0.0; bool hashed = false;
          for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
            vec2 offset = vec2(float(x), float(y)) * texel;
            vec4 near = texture2D(current, vUv + offset);
            low = min(low, near); high = max(high, near);
            vec4 moved = texture2D(velocity, vUv + offset);
            float depth = moved.b != 0.0 ? abs(moved.b) : 1.0e30; // 0: nothing drawn there; negative: alpha-hashed
            if (depth < nearest) { nearest = depth; motion = moved.rg; expected = moved.a; hashed = moved.b < 0.0; }
            slowest = min(slowest, moved.rg); fastest = max(fastest, moved.rg);
          }
          vec2 from = vUv - motion;
          bool onScreen = all(greaterThanEqual(from, vec2(0.0))) && all(lessThanEqual(from, vec2(1.0)));
          // Clamp only where the neighbourhood's motion disagrees (by more than a quarter pixel, fully from one pixel):
          // a silhouette or a surface being uncovered, where the history really is someone else's. Where everything
          // around moves together the reprojected history is the same surface and is kept as is: clamping it to one
          // frame's 3x3 range there ratchets stacked dithered layers towards full cover (a window of stacked hair cards
          // is often entirely covered in a single frame), which drew hair too dense and grainy (6 Nov, measured).
          float spread = length((fastest - slowest) / texel);
          // And only where the history was this surface: last frame's depth at the reprojected spot must be this point's
          // depth last frame ("expected"; 0 for background). A mismatch is a surface uncovered, or background where the
          // character was (without this, background kept ghost trails of a dancing character).
          float there = abs(texture2D(previousVelocity, from).b);
          bool same = !previousValid || abs(there - expected) <= 0.02 + 0.03 * max(there, expected);
          // No surface anywhere in the 3x3 (the velocity pass draws every card whole): background, so never trusted. Else a
          // ghost painted next to a silhouette (dilated motion) stayed "consistent background" once the hair moved on.
          bool surface = nearest < 1.0e29;
          float trust = trustAll ? 1.0 : same && surface ? 1.0 - smoothstep(0.25, 1.0, spread) : 0.0;
          vec4 reprojected = readHistory(from) * previousScale;
          reprojected = vec4(max(reprojected.rgb, vec3(0.0)), clamp(reprojected.a, 0.0, 1.0)); // the cubic read's overshoot
          // Trusted dithered surfaces (alpha-hashed hair, lace): only the upper bound. The ratchet above is the lower
          // bound alone (lifting the history to a window that is entirely covered this frame); the upper bound still
          // removes what the window cannot show now, e.g. the shirt that was visible through a swinging ponytail's gaps,
          // dragged along with the hair's motion. Opaque surfaces have no dither to ratchet and keep the full clamp,
          // which drops shading the surface no longer shows (lights stay put while the character turns).
          vec4 history = mix(clamp(reprojected, low, high), min(reprojected, high), hashed ? trust : 0.0);
          // Opaque surfaces (10 Nov): a shorter history, shorter still the faster the surface moves on screen, and none
          // where last frame's depth says the history was another surface (the full clamp alone keeps it inside printed
          // text, where every window holds both ink and fabric colours). Alpha-hashed surfaces keep \`blend\`.
          float speed = length(motion / texel);
          float opaque = max(blend, mix(opaqueBlend, opaqueFastBlend, smoothstep(0.0, 4.0, speed)));
          bool uncovered = opaqueReset && !hashed && !same;
          gl_FragColor = mix(history, now, !onScreen || uncovered ? 1.0 : hashed ? blend : opaque);
        }`,
      blending: THREE.NoBlending, depthTest: false, depthWrite: false, toneMapped: false,
    });
    // High: the still path's crossfade in from the motion average (still weight = samples / maxSamples).
    this.crossfade = new THREE.ShaderMaterial({
      uniforms: { motion: { value: null }, still: { value: null }, stillScale: { value: 1 }, weight: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main() { vUv=uv; gl_Position=vec4(position,1.0); }',
      fragmentShader: `uniform sampler2D motion; uniform sampler2D still; uniform float stillScale; uniform float weight;
        varying vec2 vUv;
        void main() { gl_FragColor = mix(texture2D(motion, vUv), texture2D(still, vUv) * stillScale, weight); }`,
      blending: THREE.NoBlending, depthTest: false, depthWrite: false, toneMapped: false,
    });
    // Samples over a transparent clear contain premultiplied linear RGB. Recover
    // the covered colour BEFORE the nonlinear display transform, then premultiply
    // for the canvas. Tone-mapping already averaged coverage makes bright fringes.
    // ADDITIVE_PASS_THROUGH (signed off as hologramBackdropPassThrough, 14 Oct 2026) is defined only while a recovered
    // additive material is visible and the output is premultiplied. Additive light leaves alpha unchanged, so where
    // no sample covered anything (alpha 0) the history holds only that light: it is tone-mapped as is and written
    // un-premultiplied with alpha 0, which a premultiplied canvas composites as light added to the page backdrop.
    // Without the define the preprocessed program is token-identical to the one before this change.
    const fragmentShader = OutputShader.fragmentShader
      .replace('uniform sampler2D tDiffuse;', 'uniform sampler2D tDiffuse; uniform float historyScale;')
      .replace('gl_FragColor = texture2D( tDiffuse, vUv );', `
        gl_FragColor = texture2D(tDiffuse, vUv) * historyScale;
        gl_FragColor.a = clamp(gl_FragColor.a, 0.0, 1.0);
        #ifdef ADDITIVE_PASS_THROUGH
        bool additivePassThrough = gl_FragColor.a <= 0.000001;
        gl_FragColor.rgb = additivePassThrough ? gl_FragColor.rgb : gl_FragColor.rgb / gl_FragColor.a;
        #else
        gl_FragColor.rgb = gl_FragColor.a > 0.000001 ? gl_FragColor.rgb / gl_FragColor.a : vec3(0.0);
        #endif`)
      .replace(/}\s*$/, '#ifdef PREMULTIPLIED_OUTPUT\n #ifdef ADDITIVE_PASS_THROUGH\n if (!additivePassThrough)\n #endif\n gl_FragColor.rgb *= gl_FragColor.a;\n #endif\n }');
    this.output = new THREE.RawShaderMaterial({
      uniforms: { ...THREE.UniformsUtils.clone(OutputShader.uniforms), historyScale: { value: 1 } },
      vertexShader: OutputShader.vertexShader, fragmentShader,
      depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false,
    });
    this.quad = new FullScreenQuad(this.copy);
  }

  invalidate(reason = 'explicit') { this.invalidated = reason; }

  /** Sample (RGBA16F + depth, times the MSAA samples, plus its resolved texture) and history (RGBA16F). */
  private baseBytes(width: number, height: number) {
    const msaa = this.status.msaa;
    return width * height * ((8 + 4) * Math.max(1, msaa) + (msaa ? 8 : 0) + 8);
  }


  private releaseTargets() {
    this.sample?.dispose(); this.history?.dispose(); this.sample = null; this.history = null;
    this.motionHistory?.dispose(); this.motionHistory = null; this.status.motionFrames = 0;
    this.velocity?.dispose(); this.velocity = null;
    this.settle = 0; this.fading = false; this.motionCount = 0; this.seedFrom = null;
    this.status.reprojected = false; this.status.fading = false;
    this.status.width = 0; this.status.height = 0; this.status.targetBytes = 0; this.status.msaa = 0;
    this.copy.uniforms.map.value = null; this.output.uniforms.tDiffuse.value = null;
  }

  /**
   * `moving`: the caller animates the pose every frame (motion mode, see the top of this file). `animating`: the
   * animation plays, even when the caller draws it without the motion path (MSAA and Off reset every changed frame);
   * only reported in `status.animating`.
   */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, enabled = true, moving = false, animating = moving) {
    this.status.animating = animating;
    const destination = renderer.getRenderTarget();
    if (destination) this.size.set(destination.width, destination.height); else renderer.getDrawingBufferSize(this.size);
    const { x: width, y: height } = this.size;
    this.camera.select(camera, width, height);
    const input = this.state.capture(scene, camera, renderer, this.camera);
    if (input.changed) this.status.firstOther = this.state.firstOther;
    const supported = camera instanceof THREE.PerspectiveCamera || camera instanceof THREE.OrthographicCamera;
    // Masked items need the jittered average; additive items need the linear target (and its alpha-0 pass-through).
    const active = enabled && (input.masked || input.additive || this.alwaysOn) && supported && width > 0 && height > 0
      && renderer.extensions.has('EXT_color_buffer_float') && !renderer.xr.isPresenting;
    if (!active) {
      if (this.status.active) this.releaseTargets();
      this.status.active = false; this.status.samples = 0; this.status.additive = false; this.invalidated = 'activated';
      this.status.motion = false;
      renderer.render(scene, camera);
      return;
    }
    this.status.active = true;
    const high = this.quality === 'high';
    const msaa = this.msaaSamples > 0 ? Math.min(this.msaaSamples, maxHalfFloatSamples(renderer)) : 0;
    if (!this.sample || width !== this.status.width || height !== this.status.height || high !== this.targetsHigh
      || msaa !== this.status.msaa) {
      const qualityChanged = !!this.sample && (high !== this.targetsHigh || msaa !== this.status.msaa);
      this.releaseTargets();
      // High reads the history between pixels (reprojection), so its targets filter linearly; Balanced's stay nearest.
      const filter = high ? THREE.LinearFilter : THREE.NearestFilter;
      // MSAA: only the sample is multisampled; three resolves it into the texture at the end of each render().
      this.sample = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, minFilter: filter, magFilter: filter, samples: msaa });
      this.status.msaa = msaa;
      this.history = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: filter, magFilter: filter });
      this.sample.texture.name = 'Stable preview sample'; this.history.texture.name = 'Stable preview history';
      this.status.width = width; this.status.height = height;
      this.status.targetBytes = this.baseBytes(width, height);
      this.targetsHigh = high;
      this.invalidate(qualityChanged ? 'quality' : 'size');
    }
    // High: a transform-only change (camera, object or bone matrices) in a still pose goes through the reprojected
    // motion path, which runs on for SETTLE_FRAMES quiet frames; any other change or invalidation ends it.
    let motionPath = moving;
    if (high && !moving) {
      if (this.invalidated || (input.changed && !input.reprojectable)) this.settle = 0;
      else if (input.changed) this.settle = SETTLE_FRAMES;
      else if (this.settle > 0) this.settle--;
      motionPath = this.settle > 0;
    }
    const stillSamples = this.status.samples;
    if (motionPath) {
      // Any explicit invalidation (size, custom uniforms) restarts the average; ordinary per-frame changes do not.
      if (!this.status.motion || this.invalidated) {
        // High: start from what is on screen (a still frame's mean, or the motion average still crossfading out).
        this.seedFrom = high && !this.invalidated ? (stillSamples > 0 ? 'still' : this.fading ? 'motion' : null) : null;
        this.seedScale = this.seedFrom === 'still' ? this.status.maxSamples / stillSamples : 1;
        this.status.motionFrames = 0; this.motionCount = this.seedFrom ? SEEDED_FRAMES : 0; this.status.resets++;
        this.status.reason = this.invalidated || (moving ? 'motion' : 'reprojected'); this.invalidated = '';
        if (!this.seedFrom) this.velocity?.forget();
      }
      this.status.motion = true; this.status.samples = 0;
    } else if (this.status.motion) {
      // Back to a still pose: the still path starts a fresh history (the motion average is a mean, not its sum). In
      // Balanced the third target goes, so a still view holds exactly the two it always had; High keeps the motion
      // average in it while the still path crossfades in, then lets it go.
      this.status.motion = false; this.status.motionFrames = 0; this.invalidate('motion ended');
      if (high && this.motionHistory) {
        if (this.motionInHistory) [this.history, this.motionHistory] = [this.motionHistory, this.history!];
        this.motionInHistory = false; this.fading = true;
      } else if (this.motionHistory) { this.motionHistory.dispose(); this.motionHistory = null; }
    }
    if (!motionPath && (this.invalidated || input.changed)) {
      // A real change (anything but leaving the motion path): nothing left to fade from.
      if (this.fading && (this.invalidated !== 'motion ended' || (input.changed && !input.reprojectable))) this.endFade(width, height);
      this.status.samples = 0; this.status.resets++;
      this.status.reason = this.invalidated || input.changed; this.invalidated = '';
      // Every new history starts at the exact current pose, even if the old
      // camera was retained within the subpixel damping tolerance.
      this.camera.clear(); this.camera.select(camera, width, height);
      this.state.capture(scene, camera, renderer, this.camera);
      if (high) this.velocity?.forget();
    }

    const clearColor = renderer.getClearColor(new THREE.Color()), clearAlpha = renderer.getClearAlpha();
    const autoClear = renderer.autoClear, viewport = renderer.getViewport(new THREE.Vector4());
    const scissor = renderer.getScissor(new THREE.Vector4()), scissorTest = renderer.getScissorTest();
    const face = renderer.getActiveCubeFace(), mip = renderer.getActiveMipmapLevel();
    const projection = camera.projectionMatrix.clone(), inverse = camera.projectionMatrixInverse.clone();
    const world = camera.matrixWorld.clone(), worldInverse = camera.matrixWorldInverse.clone();
    const worldAutoUpdate = camera.matrixWorldAutoUpdate, worldNeedsUpdate = camera.matrixWorldNeedsUpdate;
    try {
      camera.matrixWorldAutoUpdate = false;
      camera.matrixWorld.copy(this.camera.matrixWorld); camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
      camera.projectionMatrix.copy(this.camera.projectionMatrix);
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
      renderer.autoClear = false; renderer.setScissorTest(false);
      // The motion branch presents its average as is; the still path presents the history's mean, scaled by the
      // sample count AFTER this frame's sample is added (below). (6 Nov fix: computing it here, before the increment,
      // drew every partly converged still frame too bright, 2x on the second sample after a reset, then 1.5x, 1.33x...:
      // a flash after every still restart, seen as flicker while a drag settled and after a window resize.)
      let motionPresented: THREE.WebGLRenderTarget | null = null;
      if (motionPath) {
        const m = this.status.motionFrames % 8; // an 8-point Halton jitter cycle
        const dx = radicalInverse(m + 1, 2) - .5, dy = radicalInverse(m + 1, 3) - .5;
        const p = camera.projectionMatrix.elements;
        if (camera instanceof THREE.PerspectiveCamera) { p[8] += 2 * dx / width; p[9] -= 2 * dy / height; }
        else { p[12] -= 2 * dx / width; p[13] += 2 * dy / height; }
        camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
        setAlphaHashMotionFrame(this.status.motionFrames);
        renderer.setRenderTarget(this.sample); renderer.clear();
        this.state.renderDiscountingSideFlips(() => renderer.render(scene, camera));
        setAlphaHashMotionFrame(null);
        this.status.sceneRenders++;
        if (!this.motionHistory) {
          const filter = high ? THREE.LinearFilter : THREE.NearestFilter;
          this.motionHistory = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: filter, magFilter: filter });
          this.motionHistory.texture.name = 'Stable preview motion history';
        }
        const seed = this.status.motionFrames === 0 ? this.seedFrom : null;
        // A still seed is in `history` (its sum): average into motionHistory. A fading motion average is in
        // motionHistory: average into history. Otherwise ping-pong as before.
        const previous = seed === 'still' ? this.history! : seed === 'motion' ? this.motionHistory
          : this.motionInHistory ? this.history! : this.motionHistory;
        const next = previous === this.history ? this.motionHistory : this.history!;
        const first = this.motionCount === 0;
        const blend = first ? 1 : Math.max(high ? this.reprojection.blend : MOTION_BLEND, 1 / (this.motionCount + 1));
        if (high) {
          // Motion vectors from the unjittered sampling camera, against the previous frame's (VelocityPass.remember).
          camera.projectionMatrix.copy(this.camera.projectionMatrix);
          camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
          if (!this.velocity) this.velocity = new VelocityPass(width, height);
          this.velocity.render(renderer, scene, camera);
          this.status.velocityRenders++;
          this.reproject.uniforms.current.value = this.sample!.texture;
          this.reproject.uniforms.previous.value = first ? this.sample!.texture : previous.texture;
          this.reproject.uniforms.velocity.value = this.velocity.target.texture;
          this.reproject.uniforms.previousVelocity.value = this.velocity.previous.texture;
          this.reproject.uniforms.previousValid.value = this.velocity.previousValid;
          this.reproject.uniforms.texel.value.set(1 / width, 1 / height);
          this.reproject.uniforms.blend.value = blend;
          this.reproject.uniforms.cubic.value = this.reprojection.cubic;
          this.reproject.uniforms.opaqueBlend.value = this.reprojection.opaqueBlend;
          this.reproject.uniforms.opaqueFastBlend.value = this.reprojection.opaqueFastBlend;
          this.reproject.uniforms.opaqueReset.value = this.reprojection.opaqueReset;
          this.reproject.uniforms.previousScale.value = !first && seed === 'still' ? this.seedScale : 1;
          renderer.setRenderTarget(next);
          this.quad.material = this.reproject; this.quad.render(renderer);
        } else {
          this.resolve.uniforms.current.value = this.sample!.texture;
          this.resolve.uniforms.previous.value = first ? this.sample!.texture : previous.texture;
          this.resolve.uniforms.texel.value.set(1 / width, 1 / height);
          this.resolve.uniforms.blend.value = blend;
          renderer.setRenderTarget(next);
          this.quad.material = this.resolve; this.quad.render(renderer);
        }
        this.motionInHistory = next === this.history;
        this.status.motionFrames++; this.motionCount++;
        this.fading = false;
        motionPresented = next;
      } else if (this.status.samples < this.status.maxSamples) {
        const n = this.status.samples;
        // The first frame is unjittered: moving cameras/poses never reuse old pixels. Without jitter (MSAA, Off) every
        // sample is: only the alpha-hash thresholds change between samples.
        const jittered = n > 0 && this.jitter;
        const dx = jittered ? radicalInverse(n, 2) - .5 : 0, dy = jittered ? radicalInverse(n, 3) - .5 : 0;
        const p = camera.projectionMatrix.elements;
        if (camera instanceof THREE.PerspectiveCamera) { p[8] += 2 * dx / width; p[9] -= 2 * dy / height; }
        else { p[12] -= 2 * dx / width; p[13] += 2 * dy / height; }
        camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
        // Decision #19: samples 1..N-1 draw alpha-hashed coverage from per-pixel stratified thresholds, so the average
        // converges to the authored opacity; sample 0 keeps three's own hash (AlphaHashSampling).
        setAlphaHashSample(n, this.status.maxSamples);
        // (w133) three's own side-flip needsUpdate bumps during this render are not input changes (StableFrameState).
        renderer.setRenderTarget(this.sample); renderer.clear();
        this.state.renderDiscountingSideFlips(() => renderer.render(scene, camera));
        setAlphaHashSample(0);
        this.status.sceneRenders++;
        renderer.setRenderTarget(this.history);
        if (n === 0) { renderer.setClearColor(0, 0); renderer.clear(); }
        this.copy.uniforms.map.value = this.sample!.texture;
        this.quad.material = this.copy; this.quad.render(renderer);
        this.status.samples++;
      }
      if (!motionPresented && this.fading) {
        if (this.status.samples >= this.status.maxSamples || !this.motionHistory) this.endFade(width, height);
        else {
          // The still mean so far, weighed in against the motion average it replaces; drawn into the sample target,
          // which is free until the next frame's render.
          this.crossfade.uniforms.motion.value = this.motionHistory.texture;
          this.crossfade.uniforms.still.value = this.history!.texture;
          this.crossfade.uniforms.stillScale.value = this.status.maxSamples / this.status.samples;
          this.crossfade.uniforms.weight.value = this.status.samples / this.status.maxSamples;
          renderer.setRenderTarget(this.sample);
          this.quad.material = this.crossfade; this.quad.render(renderer);
          motionPresented = this.sample;
        }
      }
      this.status.reprojected = high && this.status.motion;
      // GPU memory held: sample (RGBA16F + depth) and history, the motion average while it lives, and High's velocities.
      this.status.targetBytes = this.baseBytes(width, height) + (this.motionHistory ? width * height * 8 : 0) + (this.velocity?.bytes ?? 0);
      this.status.fading = this.fading;
      if (high) {
        // Next frame's "previous": this frame's unjittered sampling camera and every mesh's transforms and bones.
        const view = new THREE.Matrix4().copy(this.camera.matrixWorld).invert();
        this.viewProjection.copy(this.camera.projectionMatrix).multiply(view);
        if (!this.velocity) this.velocity = new VelocityPass(width, height);
        // Converged and still: the velocity targets wait for the next motion (remember() keeps working without them).
        if (!this.status.motion && !this.fading && this.status.samples >= this.status.maxSamples) this.velocity.releaseTargets();
        this.velocity.remember(scene, this.viewProjection, view);
      }
      const premultiplied = !!destination || renderer.getContext().getContextAttributes()?.premultipliedAlpha !== false;
      const passThrough = input.additive && premultiplied;
      this.status.additive = passThrough;
      const outputKey = `${renderer.outputColorSpace}/${renderer.toneMapping}/${premultiplied}/${passThrough}`;
      if (outputKey !== this.outputKey) {
        this.outputKey = outputKey;
        this.output.defines = {};
        if (THREE.ColorManagement.getTransfer(renderer.outputColorSpace) === THREE.SRGBTransfer) this.output.defines.SRGB_TRANSFER = '';
        const tone = toneMappingDefines[renderer.toneMapping];
        if (tone) this.output.defines[tone] = '';
        if (premultiplied) this.output.defines.PREMULTIPLIED_OUTPUT = '';
        if (passThrough) this.output.defines.ADDITIVE_PASS_THROUGH = '';
        this.output.needsUpdate = true;
      }
      this.output.uniforms.tDiffuse.value = (motionPresented ?? this.history!).texture;
      this.output.uniforms.historyScale.value = motionPresented ? 1 : this.status.maxSamples / this.status.samples;
      this.output.uniforms.toneMappingExposure.value = renderer.toneMappingExposure;
      renderer.setRenderTarget(destination, face, mip);
      renderer.setViewport(viewport); renderer.setScissor(scissor); renderer.setScissorTest(scissorTest);
      this.quad.material = this.output; this.quad.render(renderer);
    } catch (error) {
      this.invalidate('interrupted render');
      throw error;
    } finally {
      setAlphaHashSample(0); setAlphaHashMotionFrame(null);
      camera.projectionMatrix.copy(projection); camera.projectionMatrixInverse.copy(inverse);
      camera.matrixWorld.copy(world); camera.matrixWorldInverse.copy(worldInverse);
      camera.matrixWorldAutoUpdate = worldAutoUpdate; camera.matrixWorldNeedsUpdate = worldNeedsUpdate;
      renderer.setRenderTarget(destination, face, mip); renderer.setClearColor(clearColor, clearAlpha);
      renderer.setViewport(viewport); renderer.setScissor(scissor); renderer.setScissorTest(scissorTest);
      renderer.autoClear = autoClear;
    }
  }

  /** High: the crossfade is over (converged, or replaced by a real change): drop the motion average and its target. */
  private endFade(width: number, height: number) {
    this.fading = false; this.status.fading = false;
    if (this.motionHistory) { this.motionHistory.dispose(); this.motionHistory = null; this.status.targetBytes = this.baseBytes(width, height) + (this.velocity?.bytes ?? 0); }
  }

  dispose() {
    this.releaseTargets(); this.copy.dispose(); this.resolve.dispose(); this.reproject.dispose(); this.crossfade.dispose();
    this.output.dispose(); this.quad.dispose(); this.state.clear(); this.camera.clear();
    this.status.active = false; this.status.samples = 0; this.invalidate('disposed');
  }
}
