import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { OutputShader } from 'three/examples/jsm/shaders/OutputShader.js';
import { StableFrameState } from './StableFrameState';
import { StableCamera } from './StableCamera';
import { setAlphaHashMotionFrame, setAlphaHashSample } from './AlphaHashSampling';

const toneMappingDefines: Record<number, string> = {
  [THREE.LinearToneMapping]: 'LINEAR_TONE_MAPPING', [THREE.ReinhardToneMapping]: 'REINHARD_TONE_MAPPING',
  [THREE.CineonToneMapping]: 'CINEON_TONE_MAPPING', [THREE.ACESFilmicToneMapping]: 'ACES_FILMIC_TONE_MAPPING',
  [THREE.AgXToneMapping]: 'AGX_TONE_MAPPING', [THREE.NeutralToneMapping]: 'NEUTRAL_TONE_MAPPING',
  [THREE.CustomToneMapping]: 'CUSTOM_TONE_MAPPING',
};
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

/** Bounded still-view supersampling, not motion-reprojected/native engine TAA.
 * One linear HDR sample per frame, with a fresh first frame whenever inputs change.
 * Two targets only; the converged view needs just one full-screen presentation draw.
 * (Motion mode, above, adds a third target only while an animation plays.)
 */
export class StableFrameAccumulator {
  readonly status = { active: false, samples: 0, maxSamples: 32, resets: 0, sceneRenders: 0,
    reason: 'initial', width: 0, height: 0, targetBytes: 0, additive: false, motion: false, motionFrames: 0 };
  private state = new StableFrameState();
  private camera = new StableCamera();
  private sample: THREE.WebGLRenderTarget | null = null;
  private history: THREE.WebGLRenderTarget | null = null;
  private motionHistory: THREE.WebGLRenderTarget | null = null; // the motion average ping-pongs with `history`
  private motionInHistory = false; // which of the two holds the latest motion average
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


  private releaseTargets() {
    this.sample?.dispose(); this.history?.dispose(); this.sample = null; this.history = null;
    this.motionHistory?.dispose(); this.motionHistory = null; this.status.motionFrames = 0;
    this.status.width = 0; this.status.height = 0; this.status.targetBytes = 0;
    this.copy.uniforms.map.value = null; this.output.uniforms.tDiffuse.value = null;
  }

  /** `moving`: the caller animates the pose every frame (motion mode, see the top of this file). */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, enabled = true, moving = false) {
    const destination = renderer.getRenderTarget();
    if (destination) this.size.set(destination.width, destination.height); else renderer.getDrawingBufferSize(this.size);
    const { x: width, y: height } = this.size;
    this.camera.select(camera, width, height);
    const input = this.state.capture(scene, camera, renderer, this.camera);
    const supported = camera instanceof THREE.PerspectiveCamera || camera instanceof THREE.OrthographicCamera;
    // Masked items need the jittered average; additive items need the linear target (and its alpha-0 pass-through).
    const active = enabled && (input.masked || input.additive) && supported && width > 0 && height > 0
      && renderer.extensions.has('EXT_color_buffer_float') && !renderer.xr.isPresenting;
    if (!active) {
      if (this.status.active) this.releaseTargets();
      this.status.active = false; this.status.samples = 0; this.status.additive = false; this.invalidated = 'activated';
      this.status.motion = false;
      renderer.render(scene, camera);
      return;
    }
    this.status.active = true;
    if (!this.sample || width !== this.status.width || height !== this.status.height) {
      this.releaseTargets();
      this.sample = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
      this.history = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
      this.sample.texture.name = 'Stable preview sample'; this.history.texture.name = 'Stable preview history';
      this.status.width = width; this.status.height = height;
      this.status.targetBytes = width * height * (8 + 4 + 8); // two RGBA16F buffers + sample depth
      this.invalidate('size');
    }
    if (moving) {
      // Any explicit invalidation (size, custom uniforms) restarts the average; ordinary per-frame changes do not.
      if (!this.status.motion || this.invalidated) {
        this.status.motionFrames = 0; this.status.resets++;
        this.status.reason = this.invalidated || 'motion'; this.invalidated = '';
      }
      this.status.motion = true; this.status.samples = 0;
    } else if (this.status.motion) {
      // Back to a still pose: the still path starts a fresh history (the motion average is a mean, not its sum), and
      // the third target goes, so a still view holds exactly the two it always had.
      this.status.motion = false; this.status.motionFrames = 0; this.invalidate('motion ended');
      if (this.motionHistory) { this.motionHistory.dispose(); this.motionHistory = null; this.status.targetBytes -= width * height * 8; }
    }
    if (!moving && (this.invalidated || input.changed)) {
      this.status.samples = 0; this.status.resets++;
      this.status.reason = this.invalidated || input.changed; this.invalidated = '';
      // Every new history starts at the exact current pose, even if the old
      // camera was retained within the subpixel damping tolerance.
      this.camera.clear(); this.camera.select(camera, width, height);
      this.state.capture(scene, camera, renderer, this.camera);
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
      let presented = this.history!, presentedScale = this.status.maxSamples / Math.max(1, this.status.samples);
      if (moving) {
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
          this.motionHistory = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
          this.motionHistory.texture.name = 'Stable preview motion history';
          this.status.targetBytes += width * height * 8;
        }
        const first = this.status.motionFrames === 0;
        const previous = this.motionInHistory ? this.history! : this.motionHistory;
        const next = this.motionInHistory ? this.motionHistory : this.history!;
        this.resolve.uniforms.current.value = this.sample!.texture;
        this.resolve.uniforms.previous.value = first ? this.sample!.texture : previous.texture;
        this.resolve.uniforms.texel.value.set(1 / width, 1 / height);
        this.resolve.uniforms.blend.value = first ? 1 : Math.max(MOTION_BLEND, 1 / (this.status.motionFrames + 1));
        renderer.setRenderTarget(next);
        this.quad.material = this.resolve; this.quad.render(renderer);
        this.motionInHistory = next === this.history;
        this.status.motionFrames++;
        presented = next; presentedScale = 1;
      } else if (this.status.samples < this.status.maxSamples) {
        const n = this.status.samples;
        // The first frame is unjittered: moving cameras/poses never reuse old pixels.
        const dx = n ? radicalInverse(n, 2) - .5 : 0, dy = n ? radicalInverse(n, 3) - .5 : 0;
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
      this.output.uniforms.tDiffuse.value = presented.texture;
      this.output.uniforms.historyScale.value = presentedScale;
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

  dispose() {
    this.releaseTargets(); this.copy.dispose(); this.resolve.dispose(); this.output.dispose(); this.quad.dispose(); this.state.clear(); this.camera.clear();
    this.status.active = false; this.status.samples = 0; this.invalidate('disposed');
  }
}
