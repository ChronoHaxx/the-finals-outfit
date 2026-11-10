import * as THREE from 'three';

/**
 * Motion vectors for the stable-frame accumulator's High quality (6 Nov 2026).
 *
 * Why: the moving view averages frames per screen pixel. Once hair moves, a pixel's history belongs to other hair, so
 * the average either smudges or is thrown away by the clamp and the raw alpha-hash dither shows ("grain on any
 * movement"). Motion vectors say where each pixel's surface was in the previous frame, so the history can be read
 * from there (reprojection) and keep averaging the same strand.
 *
 * How: one extra geometry render per frame into a half-float target, with each visible mesh drawn by a small velocity
 * material instead of its own: r,g = this frame's minus last frame's screen position, in UV units (both unjittered);
 * b = this frame's view depth (for the resolve's closest-depth dilation), negative for an alpha-hashed material (hair,
 * lace: the resolve treats their dithered coverage differently); a = the same surface point's view depth in the
 * previous frame. Nothing drawn: all zero. The previous frame's target is kept, so the resolve can check that the
 * history it reprojects from was this surface and not something now gone (a surface uncovered, background where the
 * character was): its depth there must match `a`. That depth is deterministic (no alpha test, below), unlike the
 * colour pass's, where the dither keeps a different strand each frame.
 * - Skinning is evaluated twice in the vertex shader: with this frame's bones (three's boneTexture) and with last
 *   frame's (a copy of the skeleton's bone matrices taken after the previous frame, uploaded as prevBoneTexture),
 *   including the 8-influence extension (skinIndex1/skinWeight1, SourceMesh). Morph targets are applied first, as in
 *   the colour pass; their weights are set per outfit, so they are the same in both frames.
 * - Not reproduced: the static vertex offset some recovered garments add along the skinned normal after skinning
 *   (ReconstructedMaterial vertexOffset, at most about a centimetre): its change between frames is that offset times
 *   the normal's rotation, far below a pixel.
 * - Coverage: no alpha test at all. Every card of a hair or lace mesh writes its velocity, so faint strands and
 *   flyaways that the dither only sometimes shows still carry the hair's motion (an alpha-tested or discarded
 *   velocity gave them the background's zero motion; Fable review, 6 Nov). Over-covering moves a few background
 *   pixels around the silhouette with the hair; the resolve's neighbourhood clamp drops what does not fit.
 * - Skipped: invisible sections and additive (hologram) materials, which have no surface of their own to follow.
 */
const VERTEX = /* glsl */`
#include <common>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
// Skinned meshes: last frame's matrixWorld * bindMatrixInverse (three's attached bind mode recomputes the inverse from
// the mesh's world matrix, so the two only cancel within one frame). Others: last frame's matrixWorld.
uniform mat4 prevModelMatrix;
uniform mat4 prevViewProjection;
uniform mat4 prevViewMatrix;
#ifdef USE_SKINNING
uniform highp sampler2D prevBoneTexture;
mat4 getPrevBoneMatrix( const in float i ) {
  int size = textureSize( prevBoneTexture, 0 ).x;
  int j = int( i ) * 4;
  int x = j % size;
  int y = j / size;
  return mat4( texelFetch( prevBoneTexture, ivec2( x, y ), 0 ), texelFetch( prevBoneTexture, ivec2( x + 1, y ), 0 ),
    texelFetch( prevBoneTexture, ivec2( x + 2, y ), 0 ), texelFetch( prevBoneTexture, ivec2( x + 3, y ), 0 ) );
}
#ifdef VELOCITY_SKIN8
attribute vec4 skinIndex1;
attribute vec4 skinWeight1;
#endif
#endif
varying vec4 vCurrentClip;
varying vec4 vPreviousClip;
varying float vViewDepth;
varying float vPreviousViewDepth;
void main() {
  #include <begin_vertex>
  #include <morphinstance_vertex>
  #include <morphtarget_vertex>
  vec4 previousWorld = prevModelMatrix * vec4( transformed, 1.0 );
  #ifdef USE_SKINNING
    vec4 bound = bindMatrix * vec4( transformed, 1.0 );
    vec4 now = getBoneMatrix( skinIndex.x ) * bound * skinWeight.x + getBoneMatrix( skinIndex.y ) * bound * skinWeight.y
      + getBoneMatrix( skinIndex.z ) * bound * skinWeight.z + getBoneMatrix( skinIndex.w ) * bound * skinWeight.w;
    vec4 before = getPrevBoneMatrix( skinIndex.x ) * bound * skinWeight.x + getPrevBoneMatrix( skinIndex.y ) * bound * skinWeight.y
      + getPrevBoneMatrix( skinIndex.z ) * bound * skinWeight.z + getPrevBoneMatrix( skinIndex.w ) * bound * skinWeight.w;
    #ifdef VELOCITY_SKIN8
      now += getBoneMatrix( skinIndex1.x ) * bound * skinWeight1.x + getBoneMatrix( skinIndex1.y ) * bound * skinWeight1.y
        + getBoneMatrix( skinIndex1.z ) * bound * skinWeight1.z + getBoneMatrix( skinIndex1.w ) * bound * skinWeight1.w;
      before += getPrevBoneMatrix( skinIndex1.x ) * bound * skinWeight1.x + getPrevBoneMatrix( skinIndex1.y ) * bound * skinWeight1.y
        + getPrevBoneMatrix( skinIndex1.z ) * bound * skinWeight1.z + getPrevBoneMatrix( skinIndex1.w ) * bound * skinWeight1.w;
    #endif
    transformed = ( bindMatrixInverse * now ).xyz;
    previousWorld = prevModelMatrix * before;
  #endif
  vec4 view = modelViewMatrix * vec4( transformed, 1.0 );
  gl_Position = projectionMatrix * view;
  vCurrentClip = gl_Position;
  vPreviousClip = prevViewProjection * previousWorld;
  vViewDepth = -view.z;
  vPreviousViewDepth = -( prevViewMatrix * previousWorld ).z;
}`;

const FRAGMENT = /* glsl */`
varying vec4 vCurrentClip;
varying vec4 vPreviousClip;
varying float vViewDepth;
varying float vPreviousViewDepth;
void main() {
  vec2 now = vCurrentClip.xy / vCurrentClip.w;
  vec2 before = vPreviousClip.w > 1e-6 ? vPreviousClip.xy / vPreviousClip.w : now;
  #ifdef VELOCITY_HASHED
    gl_FragColor = vec4( ( now - before ) * 0.5, -vViewDepth, vPreviousViewDepth );
  #else
    gl_FragColor = vec4( ( now - before ) * 0.5, vViewDepth, vPreviousViewDepth );
  #endif
}`;

const SKIP = new THREE.MeshBasicMaterial({ visible: false });

/** The matrix the shader's previous position uses (see prevModelMatrix). */
function modelFor(mesh: THREE.Mesh, target: THREE.Matrix4) {
  target.copy(mesh.matrixWorld);
  if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) target.multiply((mesh as THREE.SkinnedMesh).bindMatrixInverse);
  return target;
}
const noop = () => {};

interface MeshEntry { source: THREE.Material | THREE.Material[]; velocity: THREE.Material | THREE.Material[]; skin8: boolean }
interface BoneCopy { data: Float32Array; texture: THREE.DataTexture }

export class VelocityPass {
  // Made on the first render and released by the accumulator once the still view has converged: two RGBA16F targets
  // with depth are 24 bytes a pixel, ~100 MB for a 2x canvas, needed only while something moves. remember() needs none.
  private targets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget] | null = null;
  private index = 0;
  private width: number;
  private height: number;
  private entries = new WeakMap<THREE.Mesh, MeshEntry>();
  private previousModel = new WeakMap<THREE.Object3D, THREE.Matrix4>();
  private previousBones = new WeakMap<THREE.Skeleton, BoneCopy>();
  private boneCopies = new Set<BoneCopy>();
  private previousViewProjection = new THREE.Matrix4();
  private previousView = new THREE.Matrix4();
  private hasPrevious = false;
  private renderedThisFrame = false;
  private renderedLastFrame = false;
  /** Whether `previous` holds the immediately preceding frame's velocities (its depths can vouch for the history). */
  previousValid = false;
  private created = new Set<THREE.Material>();

  constructor(width: number, height: number) { this.width = width; this.height = height; }

  /** This frame's velocities (after render). */
  get target() { return this.targets![this.index]; }
  /** The previous render's velocities. */
  get previous() { return this.targets![1 - this.index]; }
  /** GPU memory held now: two RGBA16F targets with 32-bit depth while allocated. */
  get bytes() { return this.targets ? this.width * this.height * (8 + 4) * 2 : 0; }

  /** Free the two targets (the still view has converged); the next render makes them again. */
  releaseTargets() {
    if (!this.targets) return;
    for (const target of this.targets) target.dispose();
    this.targets = null; this.renderedLastFrame = false; this.previousValid = false;
  }

  /** Forget last frame: the next velocity render reports no motion (a cut, a reset, a resize). */
  forget() { this.hasPrevious = false; this.renderedLastFrame = false; }

  /** Draw the velocity target for `scene` seen by `camera` (its current, unjittered matrices, already up to date). */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    const viewProjection = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    if (!this.hasPrevious) { this.previousViewProjection.copy(viewProjection); this.previousView.copy(camera.matrixWorldInverse); }
    if (!this.targets) {
      const make = () => {
        const target = new THREE.WebGLRenderTarget(this.width, this.height, { type: THREE.HalfFloatType, depthBuffer: true,
          minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
        target.texture.name = 'Stable preview velocity';
        return target;
      };
      this.targets = [make(), make()];
      this.renderedLastFrame = false;
    }
    this.previousValid = this.hasPrevious && this.renderedLastFrame;
    this.index = 1 - this.index;
    this.renderedThisFrame = true;
    // Each swapped mesh also loses its render callbacks for this pass: the thin-translucent gems draw their extra
    // multiply/add passes from onAfterRender, which would land in the velocity target.
    const swapped: [THREE.Mesh, THREE.Material | THREE.Material[], THREE.Object3D['onBeforeRender'], THREE.Object3D['onAfterRender']][] = [];
    const hidden: THREE.Object3D[] = [];
    scene.traverseVisible(object => {
      if ((object as THREE.Mesh).isMesh) {
        const mesh = object as THREE.Mesh;
        const velocity = this.materialsFor(mesh);
        const previousModel = (this.hasPrevious && this.previousModel.get(mesh)) || modelFor(mesh, new THREE.Matrix4());
        let bones: THREE.Texture | null = null;
        if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
          const skeleton = (mesh as THREE.SkinnedMesh).skeleton;
          if (skeleton.boneTexture === null) skeleton.computeBoneTexture();
          const copy = this.hasPrevious ? this.previousBones.get(skeleton) : undefined;
          bones = copy && copy.data.length === skeleton.boneMatrices?.length ? copy.texture : skeleton.boneTexture;
        }
        for (const material of Array.isArray(velocity) ? velocity : [velocity]) {
          if (!(material instanceof THREE.ShaderMaterial)) continue;
          material.uniforms.prevModelMatrix.value.copy(previousModel);
          material.uniforms.prevViewProjection.value.copy(this.previousViewProjection);
          material.uniforms.prevViewMatrix.value.copy(this.previousView);
          material.uniforms.prevBoneTexture.value = bones;
        }
        swapped.push([mesh, mesh.material, mesh.onBeforeRender, mesh.onAfterRender]);
        mesh.material = velocity; mesh.onBeforeRender = noop; mesh.onAfterRender = noop;
      } else if ((object as THREE.Points).isPoints || (object as THREE.Line).isLine || (object as THREE.Sprite).isSprite) {
        hidden.push(object); // nothing there to follow; keep it out of the depth search
      }
    });
    for (const object of hidden) object.visible = false;
    const background = scene.background, environment = scene.environment, override = scene.overrideMaterial;
    const autoUpdate = renderer.shadowMap.autoUpdate, clearColor = renderer.getClearColor(new THREE.Color()), clearAlpha = renderer.getClearAlpha();
    try {
      scene.background = null; scene.environment = null; scene.overrideMaterial = null;
      renderer.shadowMap.autoUpdate = false; // the colour pass already drew this frame's shadow maps
      renderer.setRenderTarget(this.target);
      renderer.setClearColor(0x000000, 0); renderer.clear(); // nothing drawn: no motion, depth 0 (no surface)
      renderer.render(scene, camera);
    } finally {
      for (const [mesh, material, before, after] of swapped) { mesh.material = material; mesh.onBeforeRender = before; mesh.onAfterRender = after; }
      for (const object of hidden) object.visible = true;
      scene.background = background; scene.environment = environment; scene.overrideMaterial = override;
      renderer.shadowMap.autoUpdate = autoUpdate; renderer.setClearColor(clearColor, clearAlpha);
    }
  }

  /** After each presented frame (whichever path drew it): keep this frame's transforms as the next frame's "previous".
   *  `viewProjection`, `view`: the frame's unjittered sampling camera. */
  remember(scene: THREE.Scene, viewProjection: THREE.Matrix4, view: THREE.Matrix4) {
    this.previousViewProjection.copy(viewProjection); this.previousView.copy(view);
    this.renderedLastFrame = this.renderedThisFrame; this.renderedThisFrame = false;
    scene.traverseVisible(object => {
      if (!(object as THREE.Mesh).isMesh) return;
      let model = this.previousModel.get(object);
      if (!model) this.previousModel.set(object, model = new THREE.Matrix4());
      modelFor(object as THREE.Mesh, model);
      if (!(object as THREE.SkinnedMesh).isSkinnedMesh) return;
      const skeleton = (object as THREE.SkinnedMesh).skeleton;
      // computeBoneTexture pads the matrices to a square texture; copy that layout.
      if (skeleton.boneTexture === null) skeleton.computeBoneTexture();
      const matrices = skeleton.boneMatrices;
      if (!matrices) return;
      let copy = this.previousBones.get(skeleton);
      if (copy && copy.data.length !== matrices.length) { copy.texture.dispose(); this.boneCopies.delete(copy); copy = undefined; }
      if (!copy) {
        const data = new Float32Array(matrices.length), size = Math.sqrt(data.length / 4);
        const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.FloatType);
        texture.name = 'Stable preview previous bones';
        copy = { data, texture };
        this.previousBones.set(skeleton, copy); this.boneCopies.add(copy);
      }
      copy.data.set(matrices); copy.texture.needsUpdate = true;
    });
    this.hasPrevious = true;
  }

  dispose() {
    this.releaseTargets();
    for (const copy of this.boneCopies) copy.texture.dispose();
    this.boneCopies.clear();
    for (const material of this.created) material.dispose();
    this.created.clear();
  }

  private materialsFor(mesh: THREE.Mesh): THREE.Material | THREE.Material[] {
    const skin8 = !!mesh.geometry.attributes.skinIndex1 && !!mesh.geometry.attributes.skinWeight1;
    const cached = this.entries.get(mesh);
    if (cached && cached.source === mesh.material && cached.skin8 === skin8) {
      for (const [i, source] of (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).entries()) {
        const velocity = Array.isArray(cached.velocity) ? cached.velocity[i] : cached.velocity;
        if (velocity instanceof THREE.ShaderMaterial) velocity.side = source.side;
      }
      return cached.velocity;
    }
    const make = (source: THREE.Material) => {
      if (!source.visible || source.blending === THREE.AdditiveBlending || source.userData.recoveredAdditive === true) return SKIP;
      const material = new THREE.ShaderMaterial({
        name: 'Stable preview velocity', vertexShader: VERTEX, fragmentShader: FRAGMENT, side: source.side,
        uniforms: { prevModelMatrix: { value: new THREE.Matrix4() }, prevViewProjection: { value: new THREE.Matrix4() },
          prevViewMatrix: { value: new THREE.Matrix4() }, prevBoneTexture: { value: null } },
        defines: { ...(skin8 ? { VELOCITY_SKIN8: '' } : {}), ...(source.alphaHash ? { VELOCITY_HASHED: '' } : {}) },
        blending: THREE.NoBlending, depthTest: true, depthWrite: true, toneMapped: false,
      });
      this.created.add(material);
      return material;
    };
    const velocity = Array.isArray(mesh.material) ? mesh.material.map(make) : make(mesh.material);
    if (cached) for (const old of Array.isArray(cached.velocity) ? cached.velocity : [cached.velocity])
      if (old !== SKIP) { old.dispose(); this.created.delete(old); }
    this.entries.set(mesh, { source: mesh.material, velocity, skin8 });
    return velocity;
  }
}
