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
  // Per-axis scale applied to the selected UV set. For a source body paint the X factor is
  // BodyPaintTiles as 1/tiles and Y is 1 — see uvLayout for why Y is never scaled.
  //
  // Its PRESENCE is also what opts a layer into the `uv` channel at all. `uv` predates any UV1
  // support and 26 legacy body paints carry `uv: 1` alongside a mask converted from the packed `_M`
  // texture; those masks are not coverage (most sit at the UE neutral ~128) and re-routing them to
  // UV1 would move 26 items nobody has verified. A layer only leaves vMapUv once it carries a
  // source-derived transform.
  uvScale?: [number, number];
  // The paint coordinate contract read out of the compiled M_Skin base pass (nodes 70-92 of
  // scripts/generated/shader-probe/body-paints-source-formula-v1/*.glsl):
  //
  //   paintUv  = vec2( uv.x * 1/BodyPaintTiles, fract( uv.y ) )
  //   inside   = ceil( clamp(x*(1-x)) * clamp(y*(1-y)) )
  //   coverage = inside * BodyPaintColor.a
  //
  // The vertical axis is an explicit `frc`, NOT a second tile division: the paint texture is one
  // tile tall and the UV set's integer V rows fold onto it. An earlier reading of the
  // TextureStreamingData `SamplingScale` as a uniform 0.5 produced a half-height atlas and put the
  // coverage in the wrong place. Named rather than inferred, so a layer that has not been traced to
  // this material does not silently acquire its wrapping.
  uvLayout?: "sourceBodyPaint";
  // Source BodyPaintPlacement.x, or TattooPlacement.x for a tattoo-branch layer: a U offset added
  // after the X scale, `U = uv.x * uvScale.x + uvOffsetX` (M_Skin asm:144-145; M_Face asm:143 adds
  // it to uv0.x unscaled). Placement -1 puts a one-tile texture on the second UV tile, x in [1,2].
  // Shifted U is never wrapped, so the bounds gate rejects the first tile. The compiled base passes
  // read only the placement's x component. Honoured on a sourceBodyPaint layer only; absent or 0
  // emits exactly the earlier coordinates.
  uvOffsetX?: number;
  // Source BodyColorOverride: the weight of the blend toward the paint colour,
  // `mix(base, C.rgb, G*C.a*BodyColorOverride)` (M_Skin asm:232-235).
  colorOverride?: number;
  // The source multiply that precedes that blend (M_Skin asm:195-198 and 226, M_Face asm:193-196):
  //
  //   base *= clamp( C.rgb + 1 - clamp( G*C.a + G*BodyColorMultiplyNonMasked, 0, 1 ), 0, 1 )
  //
  // "masked" is BodyColorMultiplyNonMasked 0: the base darkens only under paint coverage, and with
  // colorOverride 0 this multiply is the paint's whole colour effect. "nonMasked" is 1: inside the
  // gate the base is multiplied by C.rgb even where C.a is 0, so RGB beneath zero alpha is colour
  // data and must reach the GPU intact. The M_Skin tattoo branch (asm:222-231),
  // `T = mix(1, C.rgb, G); mix(base*T, T, G*C.a*TattooColorOverride)`, is the "nonMasked" form
  // because G is binary.
  //
  // Absent keeps the mix-only composite accepted for the earlier source paints and every legacy
  // overlay. Honoured only on a sourceBodyPaint layer with a colour texture, which define G and C.
  colorMultiply?: "masked" | "nonMasked";
  // Optional packed surface data for a source body paint, linear RGBA: B = roughness, A = metalness,
  // RG = normals. Only B/A are composited here; RG are reserved and never interpreted or altered.
  //
  // Surface composition is an explicit opt-in because it changes compiled GLSL. It needs
  // surfaceOverride: 1, this body-target layer's sourceBodyPaint transform and a successfully
  // loaded colour texture, whose alpha (with the same bounds gate as the colour sample) is the
  // only coverage weight — the packed texture's own alpha is the metalness value, never coverage.
  // A legacy layer, an omitted/zero switch or a failed/missing pack keeps the existing shading.
  surfaceUrl?: string;
  surfaceOverride?: 0 | 1;
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
  surfaceTex: THREE.Texture | null; // packed B/A surface, already vetted for composition
  uv: 0 | 1;
  uvScale: [number, number] | null;
  uvLayout: "sourceBodyPaint" | null;
  uvOffsetX: number; // 0 unless a source layout honours it
  colorOverride: number | null;
  colorMultiply: "masked" | "nonMasked" | null;
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
  private static token = 0; // monotonic; identifies which set() call owns a slot
  private targets = new Map<DecalTarget, THREE.MeshStandardMaterial[]>();
  private active = new Map<Slot, ActiveDecal>();
  private slotTokens = new Map<Slot, number>(); // newest set/clear per slot, so stale loads bail
  private nailMaskTex: THREE.Texture | null = null; // shared across all nail polishes
  private nailMaskPending: Promise<THREE.Texture | null> | null = null;
  private nailMaskEpoch = 0; // bumped by clearAll to invalidate requests from an older state
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

  // Equipping is finished only when the decal can actually be drawn, so this resolves after every
  // required texture has loaded. It used to resolve as soon as the requests were issued and let
  // three fill the samplers in whenever they arrived: an awaited equip could return, the rig could
  // report idle, and the next frame could still be bare skin. On a cold page a 1.5s texture left
  // `waitIdle` returning in 296ms with the paint request still unreleased, which is how a working
  // paint gets recorded as "partially applied".
  //
  // Each call takes a token. Any later set OR clear on the same slot invalidates it, so a slow load
  // that finally arrives after it has been superseded disposes its own textures and touches nothing
  // — it must not repaint over a replacement, clear one, or resurrect a decal that was removed.
  async set(slot: Slot, decal: RigDecal): Promise<void> {
    const token = ++BodyDecalManager.token;
    this.slotTokens.set(slot, token);
    const loaded = await Promise.all(
      decal.layers.map(async (l) => ({
        source: l,
        colorTex: l.colorUrl ? await this.loadTex(l.colorUrl, true) : null,
        maskTex: l.maskUrl ? await this.loadTex(l.maskUrl, false) : null,
        // Only a layer that can actually composite the pack requests it: a legacy or disabled layer
        // must not pay for a texture it can never bind. Awaiting it here is what keeps equip from
        // reporting done before the packed B/A texture exists, exactly like the colour texture.
        surfaceTex: BodyDecalManager.wantsSurface(l) ? await this.loadTex(l.surfaceUrl!, false) : null,
      })),
    );
    // The shared nail mask is a required input for nail layers, so it is awaited here rather than
    // requested from inside the shader patch, which cannot wait for anything.
    if (decal.layers.some((l) => l.target === "nails")) await this.nailMask();

    const owned: THREE.Texture[] = [];
    const layers: ResolvedLayer[] = [];
    for (const { source: l, colorTex, maskTex, surfaceTex } of loaded) {
      if (colorTex) owned.push(colorTex);
      if (maskTex) owned.push(maskTex);
      if (surfaceTex) owned.push(surfaceTex);
      // A layer whose own texture failed to load contributes nothing; the rest of the decal still
      // composites, matching how garment print decals treat a failed load.
      if ((l.colorUrl && !colorTex) || (l.maskUrl && !maskTex)) continue;
      // Re-check the opt-in against what actually loaded: no colour texture means there is no
      // coverage to weight the pack with, and a failed pack itself leaves the colour layer usable
      // with whatever finish the material already had.
      const surfaceEnabled = surfaceTex !== null && colorTex !== null && BodyDecalManager.wantsSurface(l);
      // The traced layout owns the bounds gate and the unwrapped placement U (see RigDecalLayer).
      const sourceLayout = !!l.uvScale && l.uvLayout === "sourceBodyPaint";
      layers.push({
        target: l.target,
        colorTex,
        maskTex,
        surfaceTex: surfaceEnabled ? surfaceTex : null,
        uv: l.uvScale ? l.uv ?? 0 : 0, // see RigDecalLayer.uvScale
        uvScale: l.uvScale ?? null,
        uvLayout: l.uvScale ? l.uvLayout ?? null : null,
        uvOffsetX: sourceLayout ? l.uvOffsetX ?? 0 : 0,
        colorOverride: l.colorOverride ?? null,
        colorMultiply: sourceLayout && colorTex ? l.colorMultiply ?? null : null,
        tint: l.tint ? new THREE.Color(l.tint) : null,
        emissive: !!l.emissive,
      });
    }
    if (this.slotTokens.get(slot) !== token) {
      for (const tex of owned) tex.dispose();
      return;
    }
    this.release(slot);
    this.active.set(slot, { layers, owned });
    for (const t of this.affected(layers)) this.rebuildTarget(t);
  }

  clear(slot: Slot): void {
    this.slotTokens.set(slot, ++BodyDecalManager.token); // cancel any load still in flight
    this.release(slot);
  }

  // Drop whatever is installed in a slot. Kept separate from clear() so set() can replace a decal
  // without invalidating its own token.
  private release(slot: Slot): void {
    const a = this.active.get(slot);
    if (!a) return;
    this.active.delete(slot);
    for (const tex of a.owned) tex.dispose();
    for (const t of this.affected(a.layers)) this.rebuildTarget(t);
  }

  clearAll(): void {
    for (const slot of [...this.active.keys()]) this.release(slot);
    // Every in-flight load is now obsolete: an unknown token can never match again.
    this.slotTokens.clear();
    this.nailMaskEpoch++; // invalidate any mask request still in flight from the cleared state
    this.nailMaskTex?.dispose();
    this.nailMaskTex = null;
    this.nailMaskPending = null;
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

  // The whole opt-in for packed B/A surface data, in one place. Every clause matters:
  //   surfaceOverride: 1 — explicit switch, never inferred from the URL's presence;
  //   target body       — this pack is composited on the body skin path only;
  //   uvScale           — the source transform is what makes the coordinates/gate source-derived;
  //   sourceBodyPaint   — the traced M_Skin layout that owns the fract() fold and bounds gate;
  //   colorUrl          — the colour texture's alpha is the coverage; without it there is no weight.
  // A layer failing any clause keeps its existing shading and never even requests the pack.
  private static wantsSurface(l: RigDecalLayer): boolean {
    return (
      l.surfaceOverride === 1 &&
      !!l.surfaceUrl &&
      !!l.colorUrl &&
      l.target === "body" &&
      l.uvScale != null &&
      l.uvLayout === "sourceBodyPaint"
    );
  }

  // Resolves once the image is decoded, or to null once it is known to have failed. Never hangs:
  // an equip that waits forever on a 404 would be a worse bug than the one this replaces.
  private async loadTex(url: string, color: boolean): Promise<THREE.Texture | null> {
    let tex: THREE.Texture;
    try {
      tex = await new Promise<THREE.Texture>((resolve, reject) =>
        this.texLoader.load(url, resolve, undefined, reject));
    } catch (error) {
      console.warn(`[BodyDecals] failed to load '${url}'`, error);
      return null;
    }
    tex.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.flipY = false; // match glTF UV convention (vMapUv)
    tex.needsUpdate = true; // re-upload with the flags above, whatever the loader already did
    return tex;
  }

  // One shared nail mask for every nail polish: concurrent equips share the single in-flight
  // request and a success stays cached, but a failure is never cached. Retaining the resolved-null
  // promise here stranded every later polish on the failed load, so a fresh request is issued by the
  // next explicit equip instead — there is no timer or automatic retry loop in this method.
  private nailMask(): Promise<THREE.Texture | null> {
    if (this.nailMaskTex) return Promise.resolve(this.nailMaskTex);
    if (this.nailMaskPending) return this.nailMaskPending;
    const epoch = this.nailMaskEpoch;
    const pending = this.loadTex(this.nailMaskUrl, false).then((tex) => {
      // clearAll() bumps the epoch, so a request that settles afterwards belongs to a state that no
      // longer exists. Drop its texture (nothing else owns it) and leave the newer cache and any
      // newer in-flight request untouched.
      if (epoch !== this.nailMaskEpoch) {
        tex?.dispose();
        return null;
      }
      this.nailMaskPending = null; // settled: no longer in flight, cached below on success
      if (tex) this.nailMaskTex = tex;
      return this.nailMaskTex;
    });
    this.nailMaskPending = pending;
    return pending;
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
    // Nails use the shared nail mask in place of a per-item mask. set() awaits that mask before it
    // installs a nail layer, so a missing one means it genuinely failed to load — drop the layer
    // rather than composite an unmasked nail tint over the whole body.
    const resolved = layers.flatMap((l) =>
      l.target !== "nails" ? [l] : this.nailMaskTex ? [{ ...l, maskTex: this.nailMaskTex }] : [],
    );
    // Reset to the clean baked material when nothing actually composites here anymore. A nail layer
    // whose shared mask failed resolves to nothing and must not leave a no-op patch behind.
    if (!resolved.length && !hide) {
      if (mat.userData.decalPatched) {
        mat.onBeforeCompile = base.compile;
        mat.customProgramCacheKey = base.cacheKey;
        mat.userData.decalPatched = false;
        mat.needsUpdate = true;
      }
      return;
    }
    if (!mat.map) mat.map = BodyDecalManager.whiteTex(); // untextured target: see whiteTex()

    const sig =
      (hide ? "h-" : "") +
      resolved
        .map(
          (l) =>
            `${l.target}${l.colorTex ? "c" : ""}${l.maskTex ? "m" : ""}${l.surfaceTex ? "b" : ""}${l.tint ? "t" : ""}${l.emissive ? "e" : ""}` +
            // The UV source and the source constants are compiled into the shader, so two decals
            // that differ only there are different programs. `b` marks the packed B/A path: it
            // emits GLSL, so a layer with a composited pack is a different program from one without.
            `${l.uvScale ? `u${l.uv}s${l.uvScale.join("x")}${l.uvLayout === "sourceBodyPaint" ? "p" : ""}` : ""}` +
            `${l.uvOffsetX ? `x${l.uvOffsetX}` : ""}` +
            `${l.colorOverride === null ? "" : `o${l.colorOverride}`}` +
            `${l.colorMultiply ? `*${l.colorMultiply === "nonMasked" ? "n" : "m"}` : ""}`,
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
      // Body paints are authored against the body's SECOND UV set: UV0 overlaps the left and right
      // halves on one mirrored layout (which is why the base skin texture can be half the size),
      // while UV1 unwraps them separately so a paint can differ per side. three only declares a UV1
      // varying for materials that bind a channel-1 texture, so the layer carries its own.
      if (resolved.some((l) => l.uv === 1)) {
        const anchor = "void main() {";
        if (!shader.vertexShader.includes(anchor)) throw new Error("Body decal vertex anchor is missing");
        shader.vertexShader =
          // Materials that already declare uv1 (the recovered skin surface sets USE_UV1) must not
          // get a second declaration.
          "#ifndef USE_UV1\nattribute vec2 uv1;\n#endif\nvarying vec2 vDecalUv1;\n" +
          shader.vertexShader.replace(anchor, `${anchor}\n\tvDecalUv1 = uv1;`);
        decl += "varying vec2 vDecalUv1;\n";
      }
      // Where this layer reads its textures. Source-prepared layers pick the authored UV set;
      // everything else keeps sampling the material's own map UV.
      const uvOf = (l: ResolvedLayer): string => {
        const set = l.uv === 1 ? "vDecalUv1" : "vMapUv";
        if (!l.uvScale) return set;
        const [x, y] = l.uvScale;
        // The source contract folds V with fract() instead of scaling it — see uvLayout. Done in
        // the shader rather than with a repeating sampler so the transform stays readable and the
        // texture keeps clamp wrapping. The placement offset follows the scale unwrapped, leaving a
        // shifted U outside [0,1] for the bounds gate to reject — see uvOffsetX.
        const offset = l.uvOffsetX ? ` ${l.uvOffsetX < 0 ? "-" : "+"} ${Math.abs(l.uvOffsetX).toFixed(6)}` : "";
        return l.uvLayout === "sourceBodyPaint"
          ? `vec2( ${set}.x * ${x.toFixed(6)}${offset}, fract( ${set}.y ) )`
          : `( ${set} * vec2( ${x.toFixed(6)}, ${y.toFixed(6)} ) )`;
      };
      // The source gates the paint to the unit square before it contributes any coverage.
      const gateOf = (l: ResolvedLayer): string | null =>
        l.uvLayout === "sourceBodyPaint"
          ? "ceil( clamp( duv.x * ( 1.0 - duv.x ), 0.0, 1.0 ) * clamp( duv.y * ( 1.0 - duv.y ), 0.0, 1.0 ) )"
          : null;
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
        if (l.surfaceTex) {
          shader.uniforms[`uDecalS${i}`] = { value: l.surfaceTex };
          decl += `uniform sampler2D uDecalS${i};\n`;
        }
        if (l.tint) {
          shader.uniforms[`uDecalT${i}`] = { value: new THREE.Vector3(l.tint.r, l.tint.g, l.tint.b) };
          decl += `uniform vec3 uDecalT${i};\n`;
        }
        const uv = uvOf(l);
        const gate = gateOf(l);
        // The pack's weight is the colour layer's own coverage (bounds gate × colour alpha), so it
        // is captured here where both exist. It must survive to the roughness/metalness point later
        // in the shader, hence a statement-level local rather than a value scoped to this block.
        if (l.surfaceTex && l.colorTex) body += `  float decalSurfCoverage${i} = 0.0;\n`;
        body += "  {\n";
        body += `    vec2 duv = ${uv};\n`;
        if (gate) body += `    float ins = ${gate};\n`;
        if (l.colorTex) {
          // Absolute overlay: the ink/color texture's own alpha is the coverage.
          body += `    vec4 dc = texture2D( uDecalC${i}, duv );\n`;
          body += `    float a = dc.a;\n`;
          if (gate) body += `    a *= ins;\n`;
          // Surface weight is exactly gate × colour alpha: taken before the colour override weight
          // and the neutral-mask decode below, both of which belong to the colour path only. The
          // packed texture's own alpha is its metalness value, never a coverage weight.
          if (l.surfaceTex) body += `    decalSurfCoverage${i} = dc.a${gate ? " * ins" : ""};\n`;
          // The source multiply (see colorMultiply) precedes the override blend and is weighted by
          // gate × alpha alone, so it too is emitted before the override and the mask decode.
          if (l.colorMultiply === "masked") body += `    diffuseColor.rgb *= clamp( dc.rgb + ( 1.0 - a ), 0.0, 1.0 );\n`;
          else if (l.colorMultiply === "nonMasked")
            body += `    diffuseColor.rgb *= clamp( dc.rgb + ( 1.0 - clamp( a + ins, 0.0, 1.0 ) ), 0.0, 1.0 );\n`;
          // BodyColorOverride weights the blend toward the paint colour (asm:232-235). The converters
          // accept only 0 or 1; at 0 a colorMultiply layer's multiply is its whole colour change.
          if (l.colorOverride !== null) body += `    a *= ${l.colorOverride.toFixed(6)};\n`;
          // The game's `_M` masks come in TWO encodings: true coverage (black outside / white
          // inside) and NEUTRAL-CENTERED modifiers (~128 = x1.0, the UE convention — every head
          // makeup mask hovers at mean ~123). Reading a neutral mask as raw coverage halved the
          // makeup's opacity and it clipped away on the overexposed head. clamp(r*2) decodes
          // both: neutral -> ~1, coverage black -> 0 / white -> 1.
          if (l.maskTex) body += `    a *= clamp( texture2D( uDecalM${i}, duv ).r * 2.0, 0.0, 1.0 );\n`;
          body += `    diffuseColor.rgb = mix( diffuseColor.rgb, dc.rgb, a );\n`;
          if (l.emissive) {
            // glow colour layers (emissive eyeballs): the BRIGHT regions emit (the glowing
            // iris/pupil), the dark sclera stays dark — luminance-gated radiance.
            glow += `  { vec4 gd = texture2D( uDecalC${i}, ${uv} );\n`;
            glow += `    float gl = dot( gd.rgb, vec3(0.299,0.587,0.114) );\n`;
            glow += `    totalEmissiveRadiance += gd.rgb * gd.a * smoothstep( 0.35, 0.8, gl ) * 1.4; }\n`;
          }
        } else if (l.tint) {
          // Luminance-preserving recolor: keep base skin shading, change hue (nails/paint/eyes).
          body += `    float a = 1.0;\n`;
          if (l.maskTex) body += `    a = texture2D( uDecalM${i}, duv ).r;\n`;
          if (gate) body += `    a *= ins;\n`;
          body += `    float bl = clamp( dot( diffuseColor.rgb, vec3(0.299,0.587,0.114) ), 0.0, 1.0 );\n`;
          // No mask (eye color): gate to the darker iris so the bright sclera stays white.
          if (!l.maskTex) body += `    a *= 1.0 - smoothstep( 0.45, 0.75, bl );\n`;
          body += `    vec3 t = uDecalT${i};\n`;
          body += `    float tl = max( dot( t, vec3(0.299,0.587,0.114) ), 0.04 );\n`;
          body += `    vec3 rec = clamp( t * ( bl / tl ), 0.0, 1.0 );\n`;
          body += `    diffuseColor.rgb = mix( diffuseColor.rgb, rec, a );\n`;
          if (l.emissive) {
            // glow items (emissive eye colors): the tint also emits, gated by the mask
            glow += `  { float ea = ${l.maskTex ? `texture2D( uDecalM${i}, ${uv} ).r` : "1.0"};\n`;
            glow += `    totalEmissiveRadiance += uDecalT${i} * ea * 1.5; }\n`;
          }
        }
        body += "  }\n";
      });
      // Packed surface composition, applied where roughnessFactor/metalnessFactor exist and are not
      // overwritten again (three's lights_physical_fragment only reads them). The base callback has
      // already run: a reconstructed skin has replaced the standard roughness/metalness chunks with
      // `= recovered.*` statements, so its anchor is the metalness statement, which is after both
      // declarations. Ordinary materials still carry the standard include.
      let surface = "";
      resolved.forEach((l, i) => {
        if (!l.surfaceTex) return;
        surface +=
          "  {\n" +
          // Same expression as the colour block above, regenerated because `duv` there is scoped to
          // its own block; uvOf is the single source of that coordinate contract.
          `    vec2 duv = ${uvOf(l)};\n` +
          `    vec4 sp = texture2D( uDecalS${i}, duv );\n` +
          // B is roughness, A is metalness (RG are normals, reserved and unread). The base term is
          // the material's own current factor — the source skin base is zero metalness, but a
          // target's general base finish is preserved rather than assumed away.
          `    roughnessFactor = clamp( mix( roughnessFactor, sp.b, decalSurfCoverage${i} ), 0.0, 1.0 );\n` +
          `    metalnessFactor = clamp( mix( metalnessFactor, sp.a, decalSurfCoverage${i} ), 0.0, 1.0 );\n` +
          "  }\n";
      });
      const colourAnchor = mat.userData.reconstructed ? "// recovered_surface_ready" : "#include <map_fragment>";
      if (!shader.fragmentShader.includes(colourAnchor)) throw new Error("Body decal colour anchor is missing");
      let frag = shader.fragmentShader.replace(colourAnchor, colourAnchor + "\n" + body);
      if (surface) {
        const finishAnchor = mat.userData.reconstructed
          ? "float metalnessFactor = recovered.metalness;"
          : "#include <metalnessmap_fragment>";
        if (!frag.includes(finishAnchor)) throw new Error("Body decal finish anchor is missing");
        frag = frag.replace(finishAnchor, finishAnchor + "\n" + surface);
      }
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
