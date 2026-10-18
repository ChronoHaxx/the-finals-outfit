// Runtime check of the cubemap glass source-world transport (src/rig/ReconstructedMaterial.ts), through the real
// loader and its own side/transparency state. check-webgl feeds UE-frame vectors straight into the contract, so it
// never exercises the vNormal/vTangent/gl_FrontFacing transport or three's two-pass DoubleSide draw, where the
// BackSide pass defines FLIP_SIDED (reversed winding, negated normal and tangent).
//
// Each cube is replaced by constant per-face values, so the expected sample is exact at any mip level. Every case
// renders twice, once with distinct faces and once with every face equal; the pixel ratio cancels opacity and the
// reflection tint and leaves the value of the face the reflection vector hit.
// - Outside a sphere with a black interior cube: front faces, Day cube, R = reflect(-V, N) at the hit point.
// - Camera at the sphere centre: only back faces (the FrontSide pass culls them), interior cube, R points back to
//   the camera (-d). A wrong face sign samples the Day cube here, which this check's constant Day values detect.
// Pixels include off-axis ones (R != V). Faces map through three (x, y, z) -> UE (x, z, y).
//
// Lookup inputs (14 Oct 2026, _docs/goal-100-2026-10-11/cubemap-glass-v2/): the program rotates the reflection about
// UE world Z by CubemapRotation * 2 pi, adds CustomWorldNormal, and perturbs the normal with NormalMap. An optional
// JSON from scripts/shader-probe/glass_runtime_frame_inputs.py (keyed by manifest itemId, bound to its shader hash)
// supplies the compiled rotation and offset and names the normal-map slot. The normal map is then replaced by one
// constant tilted tangent-space normal, so the expected face follows from the mesh's own interpolated tangent frame:
// N = faceSign * normalize(n.x T + n.y cross(N, T) w + n.z N). That exercises the tangent and handedness transport
// on both passes. Without the file: rotation 0, no offset, no normal map (the football root instance).
//
// Usage (dev server running):
//   node scripts/shader-probe/check-glass-runtime-frame.mjs [manifestUrl] [reportPath] [lookupInputs.json]
import { chromium } from "playwright-core";
import { readFileSync, writeFileSync } from "node:fs";

const manifestUrl = process.argv[2] ?? "/models/cubemap-glass-probe-v1/sport-footballhelmet-glass.json";
const reportPath = process.argv[3] ?? null;
const lookupInputs = process.argv[4] ? JSON.parse(readFileSync(process.argv[4], "utf8")) : null;
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (e) => { if (e.type() === "error") errors.push(e.text()); });
  await page.goto(process.env.APP_URL ?? "http://127.0.0.1:5174", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__THREE, undefined, { timeout: 60000 });
  const result = await page.evaluate(async ([url, lookup]) => {
    const THREE = window.__THREE;
    const { loadReconstructedMaterial } = await import("/src/rig/ReconstructedMaterial.ts");
    const manifest = await (await fetch(url)).json();
    const inputs = lookup ? lookup[manifest.itemId] : null;
    if (lookup && !inputs) throw new Error(`No lookup inputs for ${manifest.itemId}`);
    if (inputs && inputs.shaderSha256 !== manifest.shaderSha256) throw new Error("Lookup inputs belong to another shader");
    const theta = inputs?.cubemapRotationRadians ?? 0;
    const offset = inputs?.customWorldNormal ?? [0, 0, 0];
    const loader = await loadReconstructedMaterial(url, "lit");
    const geometry = new THREE.SphereGeometry(0.1, 256, 128); geometry.computeTangents();
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
    loader.apply(mesh);
    const material = mesh.material;
    const state = { side: material.side, transparent: material.transparent, forceSinglePass: material.forceSinglePass };
    // A constant tilted tangent-space normal (n.xy = (byte / 255 - 0.5) * 2, z reconstructed as the program does).
    // About 33 degrees off the vertex normal, so the reflection crosses cube faces at many pixels.
    const NORMAL_BYTES = [185, 89];
    let tilt = null;
    if (inputs?.normalMapSlot) {
      const id = manifest.textures.find((t) => t.slot === inputs.normalMapSlot)?.id;
      const texture = id && material.userData[id];
      if (!texture?.isTexture || !Array.isArray(texture.mipmaps) || !texture.mipmaps.length
          || !texture.mipmaps.every((m) => m.data instanceof Uint8Array) || texture.colorSpace === THREE.SRGBColorSpace)
        throw new Error("Normal map is not a loaded linear RGBA8 texture");
      texture.mipmaps.forEach((m) => { for (let i = 0; i < m.data.length; i += 4) m.data.set([...NORMAL_BYTES, 255, 255], i); });
      texture.needsUpdate = true;
      const [x, y] = NORMAL_BYTES.map((b) => (b / 255 - 0.5) * 2);
      tilt = [x, y, Math.sqrt(Math.max(1 - x * x - y * y, 0))];
    }
    const textures = Object.values(material.userData).filter((t) => t?.isTexture && Array.isArray(t.image) && t.image.length === 6);
    const byKey = Object.fromEntries(Object.entries(material.userData).filter(([, t]) => textures.includes(t)));
    const half = THREE.DataUtils.toHalfFloat;
    const fill = (texture, values) => {
      texture.image.forEach((face, f) => face.mipmaps.forEach((mip) => {
        const h = half(values[f]);
        for (let i = 0; i < mip.data.length; i += 4) { mip.data[i] = h; mip.data[i + 1] = h; mip.data[i + 2] = h; }
      }));
      texture.needsUpdate = true;
    };
    const distinct = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3]; // cube face index -> grey value
    const uniform = Array(6).fill(0.1);
    const zero = Array(6).fill(0);
    // three-frame reflection -> UE lookup (rotated about UE Z by theta, plus the offset) -> cube face index
    // (+X 0, -X 1, +Y 2, -Y 3, +Z 4, -Z 5). The program's RotateAboutAxis: U cos + (Z x U) sin + Z (Z . R).
    const ueFace = (r, angle = theta, add = offset) => {
      const [x, y, z] = [r.x, r.z, r.y]; const c = Math.cos(angle), s = Math.sin(angle);
      const ue = [x * c - y * s + add[0], x * s + y * c + add[1], z + add[2]];
      const a = ue.map(Math.abs); const i = a.indexOf(Math.max(...a));
      const second = [...a].sort((p, q) => q - p)[1];
      return { face: i * 2 + (ue[i] < 0 ? 1 : 0), clarity: a[i] / Math.max(second, 1e-9) };
    };
    const scene = new THREE.Scene(); scene.add(mesh);
    const renderer = new THREE.WebGLRenderer(); renderer.setSize(63, 63);
    const target = new THREE.WebGLRenderTarget(63, 63, { type: THREE.FloatType });
    const camera = new THREE.PerspectiveCamera(12, 1, 0.005, 10);
    const axes = { "+X": [1, 0, 0], "-X": [-1, 0, 0], "+Y": [0, 1, 0], "-Y": [0, -1, 0], "+Z": [0, 0, 1], "-Z": [0, 0, -1] };
    const pixels = [[31, 31], [39, 31], [31, 23], [47, 31], [31, 47], [42, 42]];
    const render = () => {
      renderer.setRenderTarget(target); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(scene, camera);
      return pixels.map(([x, y]) => { const p = new Float32Array(4); renderer.readRenderTargetPixels(target, x, y, 1, 1, p); return p[2]; });
    };
    const raycaster = new THREE.Raycaster();
    const rows = [];
    const run = (mode, setDistinct, setUniform) => {
      for (const [name, dir] of Object.entries(axes)) {
        const d = new THREE.Vector3(...dir);
        camera.position.copy(mode === "outside" ? d : new THREE.Vector3());
        camera.up.set(...(name.endsWith("Y") ? [0, 0, 1] : [0, 1, 0]));
        camera.lookAt(mode === "outside" ? new THREE.Vector3() : d); camera.updateMatrixWorld();
        setDistinct(); const a = render();
        setUniform(); const b = render();
        const rayAt = (px, py) => {
          raycaster.setFromCamera(new THREE.Vector2(((px + 0.5) / 63) * 2 - 1, ((py + 0.5) / 63) * 2 - 1), camera);
          return raycaster.ray.clone();
        };
        pixels.forEach(([x, y], i) => {
          const ray = rayAt(x, y);
          const r = reflection(ray, tilt, mode);
          if (!r) { rows.push({ mode, camera: name, pixel: [x, y], skipped: "no mesh hit for the tangent frame" }); return; }
          const { face, clarity } = ueFace(r);
          if (clarity < 1.3) { rows.push({ mode, camera: name, pixel: [x, y], skipped: "reflection near a cube edge" }); return; }
          // A tilted normal follows the interpolated tangent, which a UV sphere leaves discontinuous at its poles (the
          // pole fan's tangents turn through 360 degrees): only a face that is stable within the pixel is predicted.
          if (tilt && [[-0.3, 0], [0.3, 0], [0, -0.3], [0, 0.3]].some(([dx, dy]) => {
            const near = reflection(rayAt(x + dx, y + dy), tilt, mode); return !near || ueFace(near).face !== face; })) {
            rows.push({ mode, camera: name, pixel: [x, y], skipped: "tangent frame not resolvable within the pixel" }); return;
          }
          // Faces that wrong lookups would hit: without the authored rotation, offset and normal map; with the rotation
          // reversed; with the tangent handedness flipped. A row whose measured face differs from them refutes them.
          const alternatives = { plain: ueFace(reflection(ray, null, mode), 0, [0, 0, 0]).face,
            rotationReversed: ueFace(r, -theta).face,
            handednessFlipped: tilt ? ueFace(reflection(ray, tilt, mode, -1)).face : face };
          const measured = a[i] / b[i]; const expected = distinct[face] / uniform[face];
          rows.push({ mode, camera: name, pixel: [x, y], face, alternatives, measured, expected,
            relativeError: Math.abs(measured - expected) / expected });
        });
      }
    };
    const sphere = new THREE.Sphere(new THREE.Vector3(), 0.1);
    const keys = Object.keys(byKey);
    // Cube roles come from the manifest, never from rendered behaviour (that would let a wrong face sign pass).
    // The interior cube is the CubemapInterior parameter; every other cube (Day, NaN-guard Night) carries Day values.
    const interiorSlot = (manifest.cubemapTextures ?? []).find((c) => c.parameter === "CubemapInterior")?.slot;
    const interiorKey = manifest.textures.find((t) => t.slot === interiorSlot)?.id;
    if (!interiorKey || !byKey[interiorKey]) throw new Error("Manifest names no loaded CubemapInterior cube");
    const setCube = (key, values) => fill(byKey[key], values);
    const dayKeys = keys.filter((k) => k !== interiorKey);
    const setDay = (values) => dayKeys.forEach((k) => setCube(k, values));
    // The mesh's interpolated vertex normal, tangent and handedness where the ray first meets it (both sides).
    const frameRaycaster = new THREE.Raycaster();
    const vertexFrame = (ray) => {
      frameRaycaster.ray.copy(ray);
      const hit = frameRaycaster.intersectObject(mesh, false)[0];
      if (!hit) return null;
      const { position, normal, tangent } = geometry.attributes;
      const corners = [hit.face.a, hit.face.b, hit.face.c];
      const bary = THREE.Triangle.getBarycoord(hit.point, ...corners.map((k) => new THREE.Vector3().fromBufferAttribute(position, k)),
        new THREE.Vector3()).toArray();
      const n = new THREE.Vector3(), t = new THREE.Vector3(); let w = 0;
      corners.forEach((k, j) => {
        n.addScaledVector(new THREE.Vector3().fromBufferAttribute(normal, k), bary[j]);
        t.addScaledVector(new THREE.Vector3(tangent.getX(k), tangent.getY(k), tangent.getZ(k)), bary[j]);
        w += tangent.getW(k) * bary[j];
      });
      return { n, t, w: Math.sign(w) };
    };
    // R = reflect(-V, N) with UE's two-sided sign: back faces negate the whole (perturbed) normal.
    const reflection = (ray, normalTilt, mode, handedness = 1) => {
      const v = ray.direction.clone().negate();
      const front = mode === "outside";
      let n;
      if (front) { const hit = ray.intersectSphere(sphere, new THREE.Vector3()); if (!hit) return null; n = hit.normalize(); }
      else n = ray.direction.clone(); // the outward normal of the back face the ray meets from the centre
      if (normalTilt) {
        const frame = vertexFrame(ray); if (!frame) return null;
        const b = new THREE.Vector3().crossVectors(frame.n, frame.t).multiplyScalar(frame.w * handedness);
        n = frame.t.clone().multiplyScalar(normalTilt[0]).addScaledVector(b, normalTilt[1]).addScaledVector(frame.n, normalTilt[2]).normalize();
      }
      if (!front) n.negate();
      return n.clone().multiplyScalar(2 * n.dot(v)).sub(v);
    };
    run("outside", () => { setDay(distinct); setCube(interiorKey, zero); }, () => { setDay(uniform); setCube(interiorKey, zero); });
    run("inside", () => { setDay(uniform); setCube(interiorKey, distinct); }, () => { setDay(uniform); setCube(interiorKey, uniform); });
    renderer.dispose(); target.dispose(); loader.dispose();
    return { state, cubes: keys, interiorKey, lookupInputs: inputs, normalTilt: tilt, rows };
  }, [manifestUrl, lookupInputs]);
  const measured = result.rows.filter((r) => !r.skipped);
  const worst = Math.max(...measured.map((r) => r.relativeError));
  const report = { manifestUrl, ...result, measuredCount: measured.length, skippedCount: result.rows.length - measured.length,
    refutedAlternatives: Object.fromEntries(["plain", "rotationReversed", "handednessFlipped"].map((k) =>
      [k, measured.filter((r) => r.alternatives[k] !== r.face).length])), worstRelativeError: worst, errors,
    pass: errors.length === 0 && measured.length > 0 && worst < 1e-3
      && result.state.side === 2 && result.state.transparent && !result.state.forceSinglePass };
  if (reportPath) writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ pass: report.pass, measured: measured.length, skipped: report.skippedCount, worst, state: result.state,
    interiorKey: result.interiorKey, failures: measured.filter((r) => r.relativeError >= 1e-3).slice(0, 8), errors }, null, 1));
  if (!report.pass) process.exitCode = 1;
} finally { await browser.close(); }
