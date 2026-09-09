import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { OutputShader } from 'three/examples/jsm/shaders/OutputShader.js';
import { StableFrameState } from './StableFrameState';
import { StableCamera } from './StableCamera';

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

/** Bounded still-view supersampling, not motion-reprojected/native engine TAA.
 * One linear HDR sample per frame, with a fresh first frame whenever inputs change.
 * Two targets only; the converged view needs just one full-screen presentation draw.
 */
export class StableFrameAccumulator {
  readonly status = { active: false, samples: 0, maxSamples: 32, resets: 0, sceneRenders: 0,
    reason: 'initial', width: 0, height: 0, targetBytes: 0 };
  private state = new StableFrameState();
  private camera = new StableCamera();
  private sample: THREE.WebGLRenderTarget | null = null;
  private history: THREE.WebGLRenderTarget | null = null;
  private copy: THREE.ShaderMaterial;
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
    // Samples over a transparent clear contain premultiplied linear RGB. Recover
    // the covered colour BEFORE the nonlinear display transform, then premultiply
    // for the canvas. Tone-mapping already averaged coverage makes bright fringes.
    const fragmentShader = OutputShader.fragmentShader
      .replace('uniform sampler2D tDiffuse;', 'uniform sampler2D tDiffuse; uniform float historyScale;')
      .replace('gl_FragColor = texture2D( tDiffuse, vUv );', `
        gl_FragColor = texture2D(tDiffuse, vUv) * historyScale;
        gl_FragColor.a = clamp(gl_FragColor.a, 0.0, 1.0);
        gl_FragColor.rgb = gl_FragColor.a > 0.000001 ? gl_FragColor.rgb / gl_FragColor.a : vec3(0.0);`)
      .replace(/}\s*$/, '#ifdef PREMULTIPLIED_OUTPUT\n gl_FragColor.rgb *= gl_FragColor.a;\n #endif\n }');
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
    this.status.width = 0; this.status.height = 0; this.status.targetBytes = 0;
    this.copy.uniforms.map.value = null; this.output.uniforms.tDiffuse.value = null;
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, enabled = true) {
    const destination = renderer.getRenderTarget();
    if (destination) this.size.set(destination.width, destination.height); else renderer.getDrawingBufferSize(this.size);
    const { x: width, y: height } = this.size;
    this.camera.select(camera, width, height);
    const input = this.state.capture(scene, camera, renderer, this.camera);
    const supported = camera instanceof THREE.PerspectiveCamera || camera instanceof THREE.OrthographicCamera;
    const active = enabled && input.masked && supported && width > 0 && height > 0
      && renderer.extensions.has('EXT_color_buffer_float') && !renderer.xr.isPresenting;
    if (!active) {
      if (this.status.active) this.releaseTargets();
      this.status.active = false; this.status.samples = 0; this.invalidated = 'activated';
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
    if (this.invalidated || input.changed) {
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
      if (this.status.samples < this.status.maxSamples) {
        const n = this.status.samples;
        // The first frame is unjittered: moving cameras/poses never reuse old pixels.
        const dx = n ? radicalInverse(n, 2) - .5 : 0, dy = n ? radicalInverse(n, 3) - .5 : 0;
        const p = camera.projectionMatrix.elements;
        if (camera instanceof THREE.PerspectiveCamera) { p[8] += 2 * dx / width; p[9] -= 2 * dy / height; }
        else { p[12] -= 2 * dx / width; p[13] += 2 * dy / height; }
        camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
        renderer.setRenderTarget(this.sample); renderer.clear(); renderer.render(scene, camera);
        this.status.sceneRenders++;
        renderer.setRenderTarget(this.history);
        if (n === 0) { renderer.setClearColor(0, 0); renderer.clear(); }
        this.copy.uniforms.map.value = this.sample!.texture;
        this.quad.material = this.copy; this.quad.render(renderer);
        this.status.samples++;
      }
      const premultiplied = !!destination || renderer.getContext().getContextAttributes()?.premultipliedAlpha !== false;
      const outputKey = `${renderer.outputColorSpace}/${renderer.toneMapping}/${premultiplied}`;
      if (outputKey !== this.outputKey) {
        this.outputKey = outputKey;
        this.output.defines = {};
        if (THREE.ColorManagement.getTransfer(renderer.outputColorSpace) === THREE.SRGBTransfer) this.output.defines.SRGB_TRANSFER = '';
        const tone = toneMappingDefines[renderer.toneMapping];
        if (tone) this.output.defines[tone] = '';
        if (premultiplied) this.output.defines.PREMULTIPLIED_OUTPUT = '';
        this.output.needsUpdate = true;
      }
      this.output.uniforms.tDiffuse.value = this.history!.texture;
      this.output.uniforms.historyScale.value = this.status.maxSamples / this.status.samples;
      this.output.uniforms.toneMappingExposure.value = renderer.toneMappingExposure;
      renderer.setRenderTarget(destination, face, mip);
      renderer.setViewport(viewport); renderer.setScissor(scissor); renderer.setScissorTest(scissorTest);
      this.quad.material = this.output; this.quad.render(renderer);
    } catch (error) {
      this.invalidate('interrupted render');
      throw error;
    } finally {
      camera.projectionMatrix.copy(projection); camera.projectionMatrixInverse.copy(inverse);
      camera.matrixWorld.copy(world); camera.matrixWorldInverse.copy(worldInverse);
      camera.matrixWorldAutoUpdate = worldAutoUpdate; camera.matrixWorldNeedsUpdate = worldNeedsUpdate;
      renderer.setRenderTarget(destination, face, mip); renderer.setClearColor(clearColor, clearAlpha);
      renderer.setViewport(viewport); renderer.setScissor(scissor); renderer.setScissorTest(scissorTest);
      renderer.autoClear = autoClear;
    }
  }

  dispose() {
    this.releaseTargets(); this.copy.dispose(); this.output.dispose(); this.quad.dispose(); this.state.clear(); this.camera.clear();
    this.status.active = false; this.status.samples = 0; this.invalidate('disposed');
  }
}
