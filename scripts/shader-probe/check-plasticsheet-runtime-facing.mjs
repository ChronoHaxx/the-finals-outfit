// Runtime facing check of the PlasticSheet two-sided sign (src/rig/ReconstructedMaterial.ts, scripts/shader-probe/
// plastic_sheet_contract.py in the main repo), through the real loader and its own DoubleSide / alphaHash state.
// check-webgl feeds UE-frame vectors and a fixture face sign straight into the emitted function, so it never exercises
// the vNormal / vTangent / gl_FrontFacing transport of the generic reflected view-space block or three's single-pass
// DoubleSide draw with alpha hashing.
//
// A closed sphere is rendered in the baseColor view with every recovered texture replaced by one constant RGBA8 value
// (so the expected value is exact at any mip). For each probed pixel the mesh's own interpolated frame at the ray hits
// gives the inputs the generic block hands recoveredSurface; the main repo's plastic_runtime_expected.py rebuilds the
// manifest's slice (hash-checked) and evaluates it on the CPU for faceSign +1 and -1.
// - Outside: the nearest hit is a front face (faceSign +1). Alpha hashing may discard it (partial opacity); the pixel then
//   shows the far wall's back face (faceSign -1, kept: back faces keep every fragment). Either is accepted, by value.
// - Inside (camera at the centre): only back faces, faceSign -1, opacity 1, never discarded. A face sign that is not
//   wired (--force-face-plus replaces it with +1) changes the fresnel there, so the colour and coverage no longer match.
// - One-sided programs (FrontSide, no face sign read): outside only; a discarded front fragment leaves the clear colour
//   (alpha 0), accepted only when the front's kept fraction is below 1. --force-face-plus is recorded as not applicable.
// - Nothing drawn where every candidate keeps all its fragments (a kept back face) is a failure.
// Pass: every measured pixel within 2e-3 of its CPU value, at least one outside pixel matched as a front face, and the
// material state DoubleSide (one-sided programs: FrontSide, outside only), alphaHash on, not transparent, depth write on.
// The report counts the rows a wrong sign would change in colour (rowsRefutingOppositeSign) or in kept fraction only.
//
// Usage (dev server running; MSYS_NO_PATHCONV=1 in Git Bash):
//   node scripts/shader-probe/check-plasticsheet-runtime-facing.mjs <manifestUrl> <reportPath> <probeFolder> [--force-face-plus]
// probeFolder holds exports/, built.requests.json and materials/ (scripts/generated/shader-probe/plasticsheet-probe-v1).
import { chromium } from "playwright-core";
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const [manifestUrl, reportPath, probe] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const forcePlus = process.argv.includes("--force-face-plus");
if (!manifestUrl || !reportPath || !probe) throw new Error("Usage: check-plasticsheet-runtime-facing.mjs <manifestUrl> <reportPath> <probeFolder> [--force-face-plus]");
const REPO = process.env.MAIN_REPO ?? "E:/Coding/the-finals-outfit";
const PYTHON = process.env.PYTHON ?? "C:/ProgramData/anaconda3/python.exe";
const TOLERANCE = 2e-3;

const browser = await chromium.launch({ channel: "msedge", headless: true });
let report;
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (e) => { if (e.type() === "error") errors.push(e.text()); });
  await page.goto(process.env.APP_URL ?? "http://127.0.0.1:5174", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__THREE, undefined, { timeout: 60000 });
  const result = await page.evaluate(async ([url, forcePlus]) => {
    const THREE = window.__THREE;
    const { loadReconstructedMaterial } = await import("/src/rig/ReconstructedMaterial.ts");
    const manifest = await (await fetch(url)).json();
    const loader = await loadReconstructedMaterial(url, "baseColor");
    const geometry = new THREE.SphereGeometry(0.1, 96, 48); geometry.computeTangents();
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
    loader.apply(mesh);
    const material = mesh.material;
    const state = { side: material.side, alphaHash: material.alphaHash, transparent: material.transparent,
      depthWrite: material.depthWrite, forceSinglePass: material.forceSinglePass,
      shadowCoverage: !!mesh.customDepthMaterial || !!mesh.customDistanceMaterial, coveragePolicy: material.userData.coveragePolicy };
    // A one-sided program (Flags bit clear) folds TwoSidedSign to +1 and reads no face sign: no control to run.
    if (forcePlus && !(manifest.requiredGeometryFields ?? []).includes("faceSign")) {
      loader.dispose();
      return { itemId: manifest.itemId, shaderSha256: manifest.shaderSha256, twoSided: manifest.twoSided, state,
        notApplicable: "the manifest reads no face sign (one-sided program); there is nothing to force" };
    }
    if (forcePlus) {
      // Negative control: the same program with the face sign hard-coded to +1.
      const compile = material.onBeforeCompile, key = material.customProgramCacheKey;
      material.onBeforeCompile = (shader, renderer) => {
        compile(shader, renderer);
        const anchor = "recoveredGeometry.faceSign = (gl_FrontFacing ? 1.0 : -1.0) * recoveredUnflip;";
        if (!shader.fragmentShader.includes(anchor)) throw new Error("Face sign assignment not found");
        shader.fragmentShader = shader.fragmentShader.replace(anchor, "recoveredGeometry.faceSign = 1.0;");
      };
      material.customProgramCacheKey = () => key() + ":force-face-plus";
    }
    // One constant RGBA8 value per recovered texture identity, every layer and mip (no packed layers for these programs).
    const textures = {};
    const BYTES = [[150, 110, 230, 200], [90, 170, 60, 140], [200, 80, 120, 255], [40, 210, 180, 90]];
    const ids = [...new Set(manifest.textures.map((spec) => spec.id))];
    manifest.textures.forEach((spec) => {
      const texture = material.userData[spec.id];
      if (!texture?.isTexture || !Array.isArray(texture.mipmaps) || !texture.mipmaps.every((m) => m.data instanceof Uint8Array))
        throw new Error(`Texture ${spec.slot} is not a loaded RGBA8 texture`);
      const bytes = BYTES[ids.indexOf(spec.id) % BYTES.length];
      texture.mipmaps.forEach((m) => { for (let p = 0; p < m.data.length; p += 4) m.data.set(bytes, p); });
      texture.needsUpdate = true;
      textures[spec.slot] = { bytes, srgb: !!spec.srgb };
    });
    if (Object.keys(material.userData).some((k) => k.startsWith("recoveredPack"))) throw new Error("Packed samplers are not handled");
    const scene = new THREE.Scene(); scene.add(mesh);
    const renderer = new THREE.WebGLRenderer(); renderer.setSize(63, 63);
    const target = new THREE.WebGLRenderTarget(63, 63, { type: THREE.FloatType });
    const camera = new THREE.PerspectiveCamera(12, 1, 0.005, 10);
    // Away from the sphere's poles (the UV sphere's pole fans have discontinuous tangents).
    const directions = { "+X": [1, 0, 0], "-X": [-1, 0, 0], "+Z": [0, 0, 1], "-Z": [0, 0, -1], "diagA": [0.8, 0.35, 0.5], "diagB": [-0.6, -0.3, 0.75] };
    const pixels = [[31, 31], [39, 31], [31, 23], [44, 36], [24, 40], [36, 20], [27, 33], [35, 42]];
    const raycaster = new THREE.Raycaster();
    const position = geometry.attributes.position, normal = geometry.attributes.normal, tangent = geometry.attributes.tangent;
    const uvs = geometry.attributes.uv;
    const usesUv1 = (manifest.requiredUvSets ?? [0, 1]).includes(1);
    // What the generic block of ReconstructedMaterial.ts hands recoveredSurface at one ray hit.
    const laneAt = (hit, view, rayDirection) => {
      const corners = [hit.face.a, hit.face.b, hit.face.c];
      const points = corners.map((k) => new THREE.Vector3().fromBufferAttribute(position, k));
      const bary = THREE.Triangle.getBarycoord(hit.point, ...points, new THREE.Vector3()).toArray();
      const rotation = new THREE.Matrix3().setFromMatrix4(view);
      const n = new THREE.Vector3(), t = new THREE.Vector3(), uv = new THREE.Vector2(); let w = 0;
      corners.forEach((k, j) => {
        // Vertex stage: vNormal = normalize(normalMatrix * normal), vTangent = normalize(mat3(modelView) * tangent.xyz).
        n.addScaledVector(new THREE.Vector3().fromBufferAttribute(normal, k).applyMatrix3(rotation).normalize(), bary[j]);
        t.addScaledVector(new THREE.Vector3(tangent.getX(k), tangent.getY(k), tangent.getZ(k)).applyMatrix3(rotation).normalize(), bary[j]);
        w += tangent.getW(k) * bary[j];
        uv.addScaledVector(new THREE.Vector2().fromBufferAttribute(uvs, k), bary[j]);
      });
      const viewPosition = hit.point.clone().applyMatrix4(view).negate();          // vViewPosition = -mvPosition
      const faceNormal = hit.face.normal.clone();                                 // object = world (identity model)
      const front = faceNormal.dot(rayDirection) < 0;                             // CCW front face toward the camera
      const p = [-viewPosition.x * 100, viewPosition.y * 100, -viewPosition.z * 100];
      return { front, uv0: [uv.x, uv.y], uv1: usesUv1 ? [uv.x, uv.y] : [0, 0], geometry: {
        position: p, tangent: [t.x, -t.y, t.z], normal: [n.x, -n.y, n.z], view: p.map((v) => -v), handedness: -w,
        faceSign: front ? 1 : -1 } };
    };
    const rows = [];
    for (const mode of ["outside", "inside"]) {
      if (mode === "inside" && material.side !== THREE.DoubleSide) continue;
      for (const [name, dir] of Object.entries(directions)) {
        const d = new THREE.Vector3(...dir).normalize();
        camera.position.copy(mode === "outside" ? d.clone().multiplyScalar(1) : new THREE.Vector3());
        camera.up.set(0, 1, 0);
        camera.lookAt(mode === "outside" ? new THREE.Vector3() : d); camera.updateMatrixWorld();
        renderer.setRenderTarget(target); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(scene, camera);
        for (const [x, y] of pixels) {
          const rgba = new Float32Array(4); renderer.readRenderTargetPixels(target, x, y, 1, 1, rgba);
          raycaster.setFromCamera(new THREE.Vector2(((x + 0.5) / 63) * 2 - 1, ((y + 0.5) / 63) * 2 - 1), camera);
          const hits = raycaster.intersectObject(mesh, false).slice(0, 2);
          rows.push({ mode, camera: name, pixel: [x, y], rendered: Array.from(rgba),
            hits: hits.map((hit) => laneAt(hit, camera.matrixWorldInverse, raycaster.ray.direction)) });
        }
      }
    }
    renderer.dispose(); target.dispose(); loader.dispose();
    return { itemId: manifest.itemId, shaderSha256: manifest.shaderSha256, twoSided: manifest.twoSided, state, textures, rows };
  }, [manifestUrl, forcePlus]);

  if (result.notApplicable) report = { manifestUrl, itemId: result.itemId, forceFacePlus: forcePlus, state: result.state,
    notApplicable: result.notApplicable, errors, pass: null };
  else report = measure(result, errors);
} finally { await browser.close(); }

function measure(result, errors) {
  // CPU values: every hit, with its own face sign and with the opposite one (to show what a wrong sign would give).
  const lanes = [];
  for (const row of result.rows) for (const hit of row.hits) {
    lanes.push({ uv0: hit.uv0, uv1: hit.uv1, geometry: hit.geometry });
    lanes.push({ uv0: hit.uv0, uv1: hit.uv1, geometry: { ...hit.geometry, faceSign: -hit.geometry.faceSign } });
  }
  const cpu = JSON.parse(execFileSync(PYTHON, [`${REPO}/scripts/shader-probe/plastic_runtime_expected.py`,
    "--exports", `${probe}/exports`, "--requests", `${probe}/built.requests.json`, "--materials", `${probe}/materials`],
  { cwd: `${REPO}/scripts/shader-probe`, input: JSON.stringify({ itemId: result.itemId, lanes, textures: result.textures }),
    maxBuffer: 1 << 26 }).toString());
  if (cpu.shaderSha256 !== result.shaderSha256) throw new Error("CPU values belong to another shader");
  let k = 0;
  const measured = result.rows.map((row) => {
    const candidates = row.hits.map((hit) => {
      const own = cpu.lanes[k++], other = cpu.lanes[k++];
      return { front: hit.front, faceSign: hit.geometry.faceSign, expected: own.baseColor, opacity: own.opacity,
        oppositeSign: other.baseColor, oppositeOpacity: other.opacity };
    });
    const error = (c) => Math.max(...c.expected.map((v, i) => Math.abs(v - row.rendered[i])));
    const errorOpposite = (c) => Math.max(...c.oppositeSign.map((v, i) => Math.abs(v - row.rendered[i])));
    // Inside, only the nearest (back) face may be shown: it keeps every fragment. Outside, the front face or, where alpha
    // hashing discarded it, the back face behind it.
    const allowed = row.mode === "inside" ? candidates.slice(0, 1) : candidates;
    // A pixel-centre ray along a sphere seam or vertex can miss every triangle in the raycaster: recorded, not measured.
    if (!allowed.length) return { mode: row.mode, camera: row.camera, pixel: row.pixel, rendered: row.rendered.slice(0, 3),
      skipped: "no mesh hit for the pixel-centre ray" };
    // Nothing drawn (clear alpha 0): alpha hashing discarded every layer the pixel could show. Consistent only when each
    // has a kept fraction below 1 (a one-sided program's front face over the culled far wall); never for a kept back face.
    if (row.rendered[3] === 0) {
      const discardable = allowed.every((c) => c.opacity < 1);
      return { mode: row.mode, camera: row.camera, pixel: row.pixel, rendered: row.rendered.slice(0, 3), discarded: true,
        matchedLayer: null, matchedFront: null, error: discardable ? 0 : Infinity, errorOppositeSign: null,
        expectedOpacity: allowed.map((c) => c.opacity),
        candidates: allowed.map(({ front, opacity, oppositeOpacity }) => ({ front, opacity, oppositeOpacity })) };
    }
    const scored = allowed.map((c, i) => ({ layer: i, error: error(c), errorOppositeSign: errorOpposite(c), ...c }));
    const best = scored.reduce((a, b) => (b.error < a.error ? b : a), scored[0] ?? { error: Infinity });
    return { mode: row.mode, camera: row.camera, pixel: row.pixel, rendered: row.rendered.slice(0, 3),
      matchedLayer: best.layer ?? null, matchedFront: best.front ?? null, error: best.error,
      errorOppositeSign: best.errorOppositeSign ?? null, expectedOpacity: best.opacity ?? null, oppositeOpacity: best.oppositeOpacity ?? null,
      candidates: scored.map(({ layer, front, error, errorOppositeSign, opacity, oppositeOpacity }) =>
        ({ layer, front, error, errorOppositeSign, opacity, oppositeOpacity })) };
  });
  const rows = measured;
  const counted = rows.filter((r) => !r.skipped);
  const worst = Math.max(...counted.map((r) => r.error));
  const outsideFront = counted.filter((r) => r.mode === "outside" && r.matchedFront && r.error < TOLERANCE).length;
  const inside = counted.filter((r) => r.mode === "inside");
  // How strongly the rows refute a wrong sign: rows whose opposite-sign value is outside the tolerance.
  const refuting = counted.filter((r) => r.errorOppositeSign !== null && r.errorOppositeSign >= TOLERANCE).length;
  // Rows where the opposite sign keeps the colour and changes only the kept fraction: a wrong sign shows there only as
  // discards (or kept fragments where the right sign discards), not as a colour error.
  const coverageOnly = counted.filter((r) => !(r.errorOppositeSign >= TOLERANCE) && typeof r.oppositeOpacity === "number"
    && Math.abs(r.oppositeOpacity - r.expectedOpacity) >= TOLERANCE).length;
  const discarded = counted.filter((r) => r.discarded).length;
  const expectSide = result.twoSided ? 2 : 0;
  return { manifestUrl, itemId: result.itemId, forceFacePlus: forcePlus, state: result.state, textures: result.textures,
    measuredCount: counted.length, skippedCount: rows.length - counted.length, insideCount: inside.length, outsideFrontMatches: outsideFront,
    discardedCount: discarded, rowsRefutingOppositeSign: refuting, rowsOppositeSignCoverageOnly: coverageOnly,
    worstError: worst, tolerance: TOLERANCE, errors,
    pass: errors.length === 0 && counted.length > 0 && worst < TOLERANCE && outsideFront > 0
      && (result.twoSided ? inside.length > 0 : true)
      && result.state.side === expectSide && result.state.alphaHash && !result.state.transparent && result.state.depthWrite
      && !result.state.shadowCoverage,
    rows: measured };
}
writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
if (report.notApplicable) console.log(JSON.stringify({ pass: null, item: report.itemId, forceFacePlus: report.forceFacePlus,
  notApplicable: report.notApplicable }));
else {
  console.log(JSON.stringify({ pass: report.pass, item: report.itemId, forceFacePlus: report.forceFacePlus, measured: report.measuredCount,
    skipped: report.skippedCount, discarded: report.discardedCount, inside: report.insideCount, outsideFront: report.outsideFrontMatches,
    refuting: report.rowsRefutingOppositeSign, coverageOnly: report.rowsOppositeSignCoverageOnly, worst: report.worstError,
    side: report.state.side, alphaHash: report.state.alphaHash,
    errors: report.errors, failures: report.rows.filter((r) => !r.skipped && !(r.error < TOLERANCE)).slice(0, 4) }, null, 1));
  if (!report.pass) process.exitCode = 1;
}
