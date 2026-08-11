import * as THREE from "three";

// Deep-dispose an Object3D subtree's GPU resources (geometries, materials, textures)
// to avoid leaks when cosmetics are swapped/removed. Does NOT touch shared skeleton
// bones — those are plain Object3D with no GPU resources and may be shared.
export function disposeObject3D(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as Partial<THREE.Mesh>;
    mesh.geometry?.dispose();
    const material = mesh.material;
    if (material) {
      for (const m of Array.isArray(material) ? material : [material]) disposeMaterial(m);
    }
  });
}

function disposeMaterial(material: THREE.Material): void {
  for (const value of Object.values(material as unknown as Record<string, unknown>)) {
    if (value && (value as THREE.Texture).isTexture) (value as THREE.Texture).dispose();
  }
  // Textures attached out-of-band (e.g. the rig's ColorMask, stashed on userData so the
  // onBeforeCompile tint can reference it) aren't standard material slots — free them too.
  for (const value of Object.values(material.userData ?? {})) {
    if (value && (value as THREE.Texture).isTexture) (value as THREE.Texture).dispose();
  }
  material.dispose();
}
