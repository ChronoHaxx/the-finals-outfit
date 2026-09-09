import * as THREE from "three";
import type { Slot } from "../lib/slots";

// 2D body cosmetics (tattoos, makeup, body paint, eye/iris color, nail polish) composited onto
// the PERSISTENT body & head materials via onBeforeCompile, rather than as their own meshes.
// Each layer routes to a target material:
//   body  — the body mesh's M_Skin (tattoos, body paint, and nails via the shared nail mask)
//   head  — the equipped head's skin material (makeup, head tattoos)
//   eyes  — the equipped head's iris material (eye color)
// A color texture (alpha = coverage) is an absolute overlay; a tint (+ optional mask) is a
// luminance-preserving recolor that keeps the base skin shading.

export type DecalTarget = "body" | "head" | "eyes" | "nails";
export interface RigDecalLayer {
  target: DecalTarget;
  colorUrl?: string;
  maskUrl?: string;
  uv?: 0 | 1;
  tint?: string;
  emissive?: boolean; // glow: tint is also added as emissive (e.g. emissive eye colors)
}
export interface RigDecal {
  layers: RigDecalLayer[];
}

interface ResolvedLayer {
  target: DecalTarget;
  colorTex: THREE.Texture | null;
  maskTex: THREE.Texture | null;
  tint: THREE.Color | null;
  emissive: boolean;
}
interface ActiveDecal {
  layers: ResolvedLayer[];
  owned: THREE.Texture[]; // textures this decal allocated (disposed on clear)
}

export class BodyDecalManager {
  private static uid = 0;
  // 1x1 white stand-in map for UNTEXTURED targets (the CNS base head has no albedo map, only a
  // grey factor). three only declares vMapUv when a map exists, so a mapless material could never
  // receive a decal; white multiplies diffuse by 1 = visually identical.
  private static whiteMap: THREE.Texture | null = null;
  private static whiteTex(): THREE.Texture {
    if (!BodyDecalManager.whiteMap) {
      const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
      t.colorSpace = THREE.SRGBColorSpace;
      t.needsUpdate = true;
      BodyDecalManager.whiteMap = t;
    }
    return BodyDecalManager.whiteMap;
  }
  private targets = new Map<DecalTarget, THREE.MeshStandardMaterial[]>();
  private active = new Map<Slot, ActiveDecal>();
  private nailMask: THREE.Texture | null = null; // shared across all nail polishes
  private bodyHideTex: THREE.Texture | null = null; // unioned body-UV mask: white = discard
  private bodyHideUrl: string | null = null; // sorted-url signature of the active union
  private bodyHidePending: Promise<void> = Promise.resolve();
  private readonly materialBases = new WeakMap<THREE.Material, {
    compile: THREE.Material["onBeforeCompile"];
    cacheKey: THREE.Material["customProgramCacheKey"];
    key: string;
  }>();

  constructor(
    private readonly texLoader: THREE.TextureLoader,
    private readonly nailMaskUrl: string,
  ) {}

  // Discard body fragments covered by equipped pieces: the head's coincident neck/chest
  // shell (z-fights as camo patches) and garments' coverage (elbows/thighs clipping
  // through sleeves/pants). Masks are body-UV textures generated offline
  // (scripts/build-body-masks.mjs + scripts/visual-diff/build-garment-masks.mjs); all
  // active masks are unioned into ONE canvas so the shader keeps a single sampler.
  // Missing masks (404) are skipped silently — not every piece ships one.
  setBodyHideMasks(urls: string[], layouts: Record<string, [number, number]> = {}): void {
    const key = JSON.stringify([...urls].sort().map(url => [url, layouts[url] ?? [1, 1]]));
    if (key === this.bodyHideUrl) return;
    this.bodyHideUrl = key;
    this.bodyHidePending = this.composeBodyHide(urls, key, layouts);
  }

  async whenBodyHidesReady(): Promise<void> {
    let pending: Promise<void>;
    do { pending = this.bodyHidePending; await pending; } while (pending !== this.bodyHidePending);
  }

  private async composeBodyHide(urls: string[], key: string, layouts: Record<string, [number, number]>): Promise<void> {
    let tex: THREE.Texture | null = null;
    if (urls.length) {
      const imgs = await Promise.all(
        urls.map(
          (u) =>
            new Promise<HTMLImageElement | null>((res) => {
              const im = new Image();
              // Hosted coverage is drawn into a canvas and uploaded to WebGL.
              // Request CORS permission before src so that canvas stays readable.
              im.crossOrigin = "anonymous";
              im.onload = () => res(im);
              im.onerror = () => res(null);
              im.src = u;
            }),
        ),
      );
      if (key !== this.bodyHideUrl) return; // superseded while loading
      const ok = imgs.flatMap((image, i) => image ? [{ image, tiles: layouts[urls[i]] ?? [1, 1] }] : []);
      if (ok.length) {
        const cnv = document.createElement("canvas");
        // Body UVs span two horizontal tiles. Keep their identities distinct;
        // stretching/repeating a one-tile mask would hide unrelated skin regions.
        const columns = Math.max(...ok.map(m => m.tiles[0])), rows = Math.max(...ok.map(m => m.tiles[1]));
        const size = Math.max(512, ...ok.map(m => Math.max(m.image.naturalWidth / m.tiles[0], m.image.naturalHeight / m.tiles[1])));
        cnv.width = columns * size;
        cnv.height = rows * size;
        const ctx = cnv.getContext("2d")!;
        ctx.globalCompositeOperation = "lighten"; // union of white-on-black masks
        for (const { image, tiles } of ok) ctx.drawImage(image, 0, 0, tiles[0] * size, tiles[1] * size);
        tex = new THREE.CanvasTexture(cnv);
        tex.colorSpace = THREE.NoColorSpace;
        tex.flipY = false;
        tex.userData.coverageUvScale = new THREE.Vector2(1 / columns, 1 / rows);
        tex.needsUpdate = true;
      }
    }
    this.bodyHideTex?.dispose();
    this.bodyHideTex = tex;
    this.rebuildTarget("body");
  }

  // Register the material(s) a target composites onto. Re-applies any active decals routed here
  // (e.g. a makeup selected before its head was equipped). Called by the rig on body/head load.
  registerTarget(name: DecalTarget, materials: THREE.MeshStandardMaterial[]): void {
    this.targets.set(name, materials);
    this.rebuildTarget(name);
  }
  unregisterTarget(name: DecalTarget): void {
    this.targets.delete(name);
  }

  async set(slot: Slot, decal: RigDecal): Promise<void> {
    this.clear(slot);
    const owned: THREE.Texture[] = [];
    const layers: ResolvedLayer[] = decal.layers.map((l) => ({
      target: l.target,
      colorTex: l.colorUrl ? this.loadTex(l.colorUrl, true, owned) : null,
      maskTex: l.maskUrl ? this.loadTex(l.maskUrl, false, owned) : null,
      tint: l.tint ? new THREE.Color(l.tint) : null,
      emissive: !!l.emissive,
    }));
    this.active.set(slot, { layers, owned });
    for (const t of this.affected(layers)) this.rebuildTarget(t);
  }

  clear(slot: Slot): void {
    const a = this.active.get(slot);
    if (!a) return;
    this.active.delete(slot);
    for (const tex of a.owned) tex.dispose();
    for (const t of this.affected(a.layers)) this.rebuildTarget(t);
  }

  clearAll(): void {
    for (const slot of [...this.active.keys()]) this.clear(slot);
    this.nailMask?.dispose();
    this.nailMask = null;
    this.bodyHideTex?.dispose();
    this.bodyHideTex = null;
    this.bodyHideUrl = null;
    this.targets.clear();
  }

  // physical materials a layer set touches: nails ride on the body material.
  private affected(layers: ResolvedLayer[]): Set<DecalTarget> {
    const out = new Set<DecalTarget>();
    for (const l of layers) out.add(l.target === "nails" ? "body" : l.target);
    return out;
  }

  private loadTex(url: string, color: boolean, owned: THREE.Texture[]): THREE.Texture {
    const tex = this.texLoader.load(url);
    tex.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.flipY = false; // match glTF UV convention (vMapUv)
    tex.needsUpdate = true;
    owned.push(tex);
    return tex;
  }

  private nailMaskTex(): THREE.Texture {
    if (!this.nailMask) {
      this.nailMask = this.texLoader.load(this.nailMaskUrl);
      this.nailMask.colorSpace = THREE.NoColorSpace;
      this.nailMask.flipY = false;
    }
    return this.nailMask;
  }

  // All active layers (across slots) that composite onto a given physical material.
  private layersFor(target: DecalTarget): ResolvedLayer[] {
    const out: ResolvedLayer[] = [];
    for (const a of this.active.values())
      for (const l of a.layers) {
        if (target === "body" ? l.target === "body" || l.target === "nails" : l.target === target)
          out.push(l);
      }
    return out;
  }

  private rebuildTarget(name: DecalTarget): void {
    const mats = this.targets.get(name);
    if (!mats) return;
    const layers = this.layersFor(name);
    const hide = name === "body" ? this.bodyHideTex : null;
    for (const mat of mats) this.patch(mat, layers, hide);
  }

  private patch(
    mat: THREE.MeshStandardMaterial,
    layers: ResolvedLayer[],
    hide: THREE.Texture | null = null,
  ): void {
    let base = this.materialBases.get(mat);
    if (!base) {
      base = { compile: mat.onBeforeCompile, cacheKey: mat.customProgramCacheKey, key: mat.customProgramCacheKey() };
      this.materialBases.set(mat, base);
    }
    // Reset to the clean baked material when nothing routes here anymore.
    if (!layers.length && !hide) {
      if (mat.userData.decalPatched) {
        mat.onBeforeCompile = base.compile;
        mat.customProgramCacheKey = base.cacheKey;
        mat.userData.decalPatched = false;
        mat.needsUpdate = true;
      }
      return;
    }
    if (!mat.map) mat.map = BodyDecalManager.whiteTex(); // untextured target: see whiteTex()

    // nails use the shared nail mask in place of a per-item mask.
    const resolved = layers.map((l) =>
      l.target === "nails" ? { ...l, maskTex: this.nailMaskTex() } : l,
    );
    const sig =
      (hide ? "h-" : "") +
      resolved
        .map(
          (l) =>
            `${l.target}${l.colorTex ? "c" : ""}${l.maskTex ? "m" : ""}${l.tint ? "t" : ""}${l.emissive ? "e" : ""}`,
        )
        .join("-");
    const key = `decal-${sig}-${BodyDecalManager.uid++}`;
    mat.userData.decalPatched = true;
    mat.customProgramCacheKey = () => `${base.key}:${key}`;
    mat.onBeforeCompile = (shader, renderer) => {
      // Body coverage and decals must compose with the source skinning patch.
      // Replacing it would silently drop influences 5-8 on the GPU.
      base.compile.call(mat, shader, renderer);
      let decl = "";
      let body = "";
      let glow = "";
      if (hide) {
        shader.uniforms.uBodyHide = { value: hide };
        shader.uniforms.uBodyHideUvScale = { value: hide.userData.coverageUvScale ?? new THREE.Vector2(1, 1) };
        decl += "uniform sampler2D uBodyHide;\nuniform vec2 uBodyHideUvScale;\n";
        body += `  vec2 coverageUv = vMapUv * uBodyHideUvScale;
          if (all(greaterThanEqual(coverageUv, vec2(0.0))) && all(lessThan(coverageUv, vec2(1.0))) &&
              texture2D(uBodyHide, coverageUv).r > 0.5) discard;\n`;
      }
      resolved.forEach((l, i) => {
        if (l.colorTex) {
          shader.uniforms[`uDecalC${i}`] = { value: l.colorTex };
          decl += `uniform sampler2D uDecalC${i};\n`;
        }
        if (l.maskTex) {
          shader.uniforms[`uDecalM${i}`] = { value: l.maskTex };
          decl += `uniform sampler2D uDecalM${i};\n`;
        }
        if (l.tint) {
          shader.uniforms[`uDecalT${i}`] = { value: new THREE.Vector3(l.tint.r, l.tint.g, l.tint.b) };
          decl += `uniform vec3 uDecalT${i};\n`;
        }
        body += "  {\n";
        if (l.colorTex) {
          // Absolute overlay: the ink/color texture's own alpha is the coverage.
          body += `    vec4 dc = texture2D( uDecalC${i}, vMapUv );\n`;
          body += `    float a = dc.a;\n`;
          // The game's `_M` masks come in TWO encodings: true coverage (black outside / white
          // inside) and NEUTRAL-CENTERED modifiers (~128 = x1.0, the UE convention — every head
          // makeup mask hovers at mean ~123). Reading a neutral mask as raw coverage halved the
          // makeup's opacity and it clipped away on the overexposed head. clamp(r*2) decodes
          // both: neutral -> ~1, coverage black -> 0 / white -> 1.
          if (l.maskTex) body += `    a *= clamp( texture2D( uDecalM${i}, vMapUv ).r * 2.0, 0.0, 1.0 );\n`;
          body += `    diffuseColor.rgb = mix( diffuseColor.rgb, dc.rgb, a );\n`;
          if (l.emissive) {
            // glow colour layers (emissive eyeballs): the BRIGHT regions emit (the glowing
            // iris/pupil), the dark sclera stays dark — luminance-gated radiance.
            glow += `  { vec4 gd = texture2D( uDecalC${i}, vMapUv );\n`;
            glow += `    float gl = dot( gd.rgb, vec3(0.299,0.587,0.114) );\n`;
            glow += `    totalEmissiveRadiance += gd.rgb * gd.a * smoothstep( 0.35, 0.8, gl ) * 1.4; }\n`;
          }
        } else if (l.tint) {
          // Luminance-preserving recolor: keep base skin shading, change hue (nails/paint/eyes).
          body += `    float a = 1.0;\n`;
          if (l.maskTex) body += `    a = texture2D( uDecalM${i}, vMapUv ).r;\n`;
          body += `    float bl = clamp( dot( diffuseColor.rgb, vec3(0.299,0.587,0.114) ), 0.0, 1.0 );\n`;
          // No mask (eye color): gate to the darker iris so the bright sclera stays white.
          if (!l.maskTex) body += `    a *= 1.0 - smoothstep( 0.45, 0.75, bl );\n`;
          body += `    vec3 t = uDecalT${i};\n`;
          body += `    float tl = max( dot( t, vec3(0.299,0.587,0.114) ), 0.04 );\n`;
          body += `    vec3 rec = clamp( t * ( bl / tl ), 0.0, 1.0 );\n`;
          body += `    diffuseColor.rgb = mix( diffuseColor.rgb, rec, a );\n`;
          if (l.emissive) {
            // glow items (emissive eye colors): the tint also emits, gated by the mask
            glow += `  { float ea = ${l.maskTex ? `texture2D( uDecalM${i}, vMapUv ).r` : "1.0"};\n`;
            glow += `    totalEmissiveRadiance += uDecalT${i} * ea * 1.5; }\n`;
          }
        }
        body += "  }\n";
      });
      const surfaceAnchor = mat.userData.reconstructed ? "// recovered_surface_ready" : "#include <map_fragment>";
      if (!shader.fragmentShader.includes(surfaceAnchor)) throw new Error("Body decal surface anchor is missing");
      let frag = shader.fragmentShader.replace(surfaceAnchor, surfaceAnchor + "\n" + body);
      if (glow)
        frag = frag.replace(
          "#include <emissivemap_fragment>",
          "#include <emissivemap_fragment>\n" + glow,
        );
      shader.fragmentShader = decl + frag;
    };
    mat.needsUpdate = true;
  }
}
