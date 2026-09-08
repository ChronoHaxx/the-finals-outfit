import * as THREE from 'three';

/** Keep a single sampling camera while residual control damping moves less than
 * an eighth of a physical pixel. The bound covers the entire old view frustum.
 * Compare against the retained camera, so slow cumulative motion cannot freeze.
 * Samples always use that retained pose, rather than blending different cameras.
 */
export class StableCamera {
  readonly matrixWorld = new THREE.Matrix4();
  readonly projectionMatrix = new THREE.Matrix4();
  readonly pixelTolerance = .125;
  private camera: THREE.Camera | null = null;
  private width = 0;
  private height = 0;
  private transform = new THREE.Matrix4();
  private inverse = new THREE.Matrix4();

  select(camera: THREE.Camera, width: number, height: number) {
    camera.updateWorldMatrix(true, false);
    this.transform.copy(camera.projectionMatrix).multiply(camera.matrixWorldInverse)
      .multiply(this.matrixWorld).multiply(this.inverse.copy(this.projectionMatrix).invert());
    const h = this.transform.elements;
    // For |x,y,z| <= 1, bound (H*p).xy/(H*p).w - p.xy by the
    // absolute polynomial coefficients and a positive lower bound on w.
    const denominatorDelta = Math.abs(h[3]) + Math.abs(h[7]) + Math.abs(h[11]);
    const minimumW = h[15] - denominatorDelta;
    const dx = Math.abs(h[0] - h[15]) + Math.abs(h[4]) + Math.abs(h[8]) + Math.abs(h[12]) + denominatorDelta;
    const dy = Math.abs(h[1]) + Math.abs(h[5] - h[15]) + Math.abs(h[9]) + Math.abs(h[13]) + denominatorDelta;
    const pixelBound = minimumW > 0 ? Math.max(dx * width, dy * height) / (2 * minimumW) : Infinity;
    if (this.camera !== camera || this.width !== width || this.height !== height || !Number.isFinite(pixelBound) || pixelBound > this.pixelTolerance) {
      this.matrixWorld.copy(camera.matrixWorld); this.projectionMatrix.copy(camera.projectionMatrix);
      this.camera = camera; this.width = width; this.height = height;
    }
  }

  clear() { this.camera = null; }
}
