import * as THREE from 'three';

// Only unchanged scenes can reuse a frame. Track render inputs, not GPU buffers or
// texture contents; callers must use needsUpdate when editing attributes/textures.
// Custom onBeforeRender/time uniforms outside these inputs must call invalidate().
export class StableFrameState {
  private values: unknown[] = [];
  private cursor = 0;
  private reason = '';
  private category = '';
  private materials = new Set<THREE.Material>();
  private textures = new Set<THREE.Texture>();
  private geometries = new Set<THREE.BufferGeometry>();
  private masked = false;

  private add(value: unknown) {
    if (!Object.is(this.values[this.cursor], value)) this.reason ||= this.category;
    this.values[this.cursor++] = value;
  }

  private numbers(values: ArrayLike<number>) {
    this.add(values.length);
    for (let i = 0; i < values.length; i++) this.add(values[i]);
  }

  private value(value: unknown) {
    if (value instanceof THREE.Texture) {
      this.add(value);
      if (this.textures.has(value)) return;
      this.textures.add(value);
      this.add(value.version); this.add(value.source.version);
      this.add(value.wrapS); this.add(value.wrapT); this.add(value.minFilter); this.add(value.magFilter);
      this.add(value.channel); this.add(value.colorSpace); this.add(value.flipY);
      this.add(value.rotation); this.add(value.mapping); this.add(value.anisotropy);
      this.value(value.offset); this.value(value.repeat); this.value(value.center); this.value(value.matrix);
    } else if (value instanceof THREE.Color) {
      this.add(value.r); this.add(value.g); this.add(value.b);
    } else if (value instanceof THREE.Vector2 || value instanceof THREE.Vector3 || value instanceof THREE.Vector4 || value instanceof THREE.Euler || value instanceof THREE.Quaternion) {
      this.add(value.x); this.add(value.y);
      if ('z' in value) this.add(value.z);
      if ('w' in value) this.add(value.w);
      if ('order' in value) this.add(value.order);
    } else if (value instanceof THREE.Matrix3 || value instanceof THREE.Matrix4) {
      this.numbers(value.elements);
    } else if (Array.isArray(value)) {
      this.add(value.length);
      for (const member of value) this.value(member);
    } else if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
      this.numbers(value as unknown as ArrayLike<number>);
    } else {
      this.add(value);
    }
  }

  private material(material: THREE.Material) {
    this.add(material);
    if (this.materials.has(material)) return;
    this.materials.add(material);
    this.category = 'material';
    // Standard material properties are shallow scalars, colours, vectors and maps.
    // userData may contain compiled shader caches; its texture payloads are inputs.
    for (const [key, value] of Object.entries(material)) {
      if (key === 'userData') {
        for (const entry of Object.values(material.userData)) if (entry instanceof THREE.Texture) this.value(entry);
      } else if (key === 'uniforms') {
        for (const uniform of Object.values(value as Record<string, THREE.IUniform>)) this.value(uniform.value);
      } else if (key !== '_listeners' && typeof value !== 'function') this.value(value);
    }
  }

  capture(scene: THREE.Scene, camera: THREE.Camera, renderer: THREE.WebGLRenderer, samplingCamera = camera as Pick<THREE.Camera, 'matrixWorld' | 'projectionMatrix'>) {
    this.cursor = 0; this.reason = ''; this.masked = false;
    this.materials.clear(); this.textures.clear(); this.geometries.clear();
    scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
    this.category = 'camera';
    this.add(camera); this.value(samplingCamera.matrixWorld); this.value(samplingCamera.projectionMatrix); this.add(camera.layers.mask);
    this.category = 'lighting';
    this.value(scene.environment); this.add(scene.environmentIntensity); this.value(scene.environmentRotation);
    this.value(scene.background); this.add(scene.backgroundIntensity); this.add(scene.backgroundBlurriness); this.value(scene.backgroundRotation);
    this.add(scene.fog);
    if (scene.fog) for (const value of Object.values(scene.fog)) this.value(value);
    this.add(renderer.toneMapping); this.add(renderer.toneMappingExposure); this.add(renderer.outputColorSpace);
    this.add(renderer.shadowMap.enabled); this.add(renderer.shadowMap.type);
    this.value(renderer.getClearColor(new THREE.Color())); this.add(renderer.getClearAlpha());
    this.category = 'material'; this.add(scene.overrideMaterial);
    if (scene.overrideMaterial) this.material(scene.overrideMaterial);

    const visit = (object: THREE.Object3D, parentVisible: boolean) => {
      this.category = 'scene';
      this.add(object); this.add(object.visible); this.add(object.layers.mask);
      this.value(object.matrixWorld); this.add(object.renderOrder); this.add(object.frustumCulled);
      this.add(object.castShadow); this.add(object.receiveShadow);
      const visible = parentVisible && object.visible && camera.layers.test(object.layers);
      if (object instanceof THREE.Mesh) {
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          if (visible && material.visible && material.alphaHash && material.userData.reconstructed) this.masked = true;
          this.material(material);
        }
        this.category = 'geometry';
        const geometry = object.geometry;
        this.add(geometry);
        if (!this.geometries.has(geometry)) {
          this.geometries.add(geometry);
          this.add(geometry.drawRange.start); this.add(geometry.drawRange.count);
          for (const group of geometry.groups) { this.add(group.start); this.add(group.count); this.add(group.materialIndex); }
          const attributes = [geometry.index, ...Object.values(geometry.attributes), ...Object.values(geometry.morphAttributes).flat()];
          this.add(attributes.length);
          for (const attr of attributes) {
            this.add(attr);
            if (attr) this.add(attr instanceof THREE.InterleavedBufferAttribute ? attr.data.version : attr.version);
          }
        }
        this.value(object.morphTargetInfluences);
        if (object instanceof THREE.SkinnedMesh) {
          this.add(object.skeleton); this.value(object.bindMatrix); this.value(object.bindMatrixInverse);
          // Bones can live outside the rendered subtree. Their transforms still
          // determine the skinning even when the mesh itself is stationary.
          for (const bone of object.skeleton.bones) { bone.updateWorldMatrix(true, false); this.value(bone.matrixWorld); }
          for (const inverse of object.skeleton.boneInverses) this.value(inverse);
        }
        if (object instanceof THREE.InstancedMesh) {
          this.add(object.count); this.add(object.instanceMatrix.version); this.add(object.instanceColor?.version); this.value(object.morphTexture);
        }
        if (object.customDepthMaterial) this.material(object.customDepthMaterial);
        if (object.customDistanceMaterial) this.material(object.customDistanceMaterial);
      }
      if (object instanceof THREE.Light) {
        this.category = 'lighting';
        for (const [key, value] of Object.entries(object)) {
          if (['color', 'groundColor', 'intensity', 'distance', 'decay', 'angle', 'penumbra', 'width', 'height'].includes(key)) this.value(value);
        }
        if ('target' in object && object.target instanceof THREE.Object3D) {
          object.target.updateWorldMatrix(true, false); this.value(object.target.matrixWorld);
        }
        if (object instanceof THREE.DirectionalLight || object instanceof THREE.SpotLight || object instanceof THREE.PointLight) {
          this.add(object.shadow.bias); this.add(object.shadow.normalBias); this.add(object.shadow.radius);
          this.add(object.shadow.intensity); this.value(object.shadow.mapSize);
          this.value(object.shadow.camera.projectionMatrix);
        }
      }
      // Parent layers do not hide children; parent visibility does.
      for (const child of object.children) visit(child, parentVisible && object.visible);
    };
    visit(scene, true);
    if (this.cursor !== this.values.length) this.reason ||= 'scene';
    this.values.length = this.cursor;
    return { changed: this.reason, masked: this.masked };
  }

  clear() { this.values.length = 0; this.materials.clear(); this.textures.clear(); this.geometries.clear(); }
}
