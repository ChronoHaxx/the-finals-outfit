// Derived coverage for the current preview body. These are geometry projections,
// not recovered engine culling rules. Require coverage in both supported poses;
// leave source morph activation / wrap deformation as separate fitting work.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, relative } from "node:path";
import { chromium } from "playwright-core";

const all = process.argv.includes("--all");
// Explicit, bounded legacy geometry mode uses the same preserved Medium body and
// projection method as source assemblies. It writes a sibling preview, never the
// original one-tile legacy mask. Multi-mesh legacy garments need a union first.
const legacy = process.argv.includes("--legacy");
const itemsArg = process.argv.indexOf("--items");
const selectedIds = itemsArg < 0 ? null : new Set(process.argv[itemsArg + 1]?.split(","));
if (selectedIds && (!all || !selectedIds.size || selectedIds.has(""))) throw new Error("--items requires --all and comma-separated item IDs");
if (legacy && (!all || !selectedIds)) throw new Error("--legacy requires --all and explicit --items");
// Some body islands are shared by opposite limbs. Opt in for newly reviewed
// masks: a texel may hide skin only when every body surface mapped there is covered.
// Existing published masks and the default generation policy remain unchanged.
const conservativeSharedUv = process.argv.includes("--conservative-shared-uv");
if (conservativeSharedUv && (!all || !selectedIds)) throw new Error("--conservative-shared-uv requires --all and explicit --items");
const outputArg = process.argv.indexOf("--output");
const output = outputArg < 0 ? "public/models/reconstructed-assemblies-v1" : process.argv[outputArg + 1];
if (!output?.replaceAll("\\", "/").startsWith("public/models/") || output.split(/[\\/]/).includes(".."))
  throw new Error("Coverage outputs must stay in public/models");
if (legacy && (outputArg < 0 || ["public/models/cosmetics", "public/models/reconstructed-assemblies-v1"].includes(output.replaceAll("\\", "/").replace(/\/$/, ""))))
  throw new Error("Legacy coverage requires a separate explicit preview output folder");
// Opt in for reviewed previews (see coverage-projection.mjs): the existing policy is computed
// unchanged, then a hidden texel is restored unless the garment occludes it from the normal and
// fixed oblique views on the body fitted with the given runtime fitting tags. Never hides more.
const fittedOcclusion = process.argv.includes("--fitted-occlusion");
const fittingTagsArg = process.argv.indexOf("--fitting-tags");
const fittingTags = fittingTagsArg < 0 ? [] : (process.argv[fittingTagsArg + 1] ?? "").split(",");
if (fittingTagsArg >= 0 && !fittedOcclusion) throw new Error("--fitting-tags requires --fitted-occlusion");
if (fittedOcclusion && (!all || !selectedIds || legacy || !conservativeSharedUv))
  throw new Error("--fitted-occlusion requires --all, explicit --items and --conservative-shared-uv, and does not support --legacy");
if (fittedOcclusion && (!fittingTags.length || fittingTags.some(tag => !/^Customization\.Shape\.(?:PushInsideClothes|ShrinkWrap|HeadNeckMatch)\.[A-Za-z0-9_]+$/.test(tag))))
  throw new Error("--fitted-occlusion requires --fitting-tags with the items' recorded Customization.Shape tags, comma-separated");
if (fittedOcclusion && (outputArg < 0 || ["public/models/cosmetics", "public/models/reconstructed-assemblies-v1",
    process.argv.includes("--index") ? process.argv[process.argv.indexOf("--index") + 1] : "public/models/reconstructed-assemblies-v1"]
    .some(folder => folder && resolve(folder) === resolve(output))))
  throw new Error("--fitted-occlusion requires a separate explicit --output folder (not the active, cosmetics or --index folder)");
// Every candidate is kept: any existing path, including an earlier occlusion candidate or a failed run, is refused.
if (fittedOcclusion && existsSync(output))
  throw new Error("--fitted-occlusion never writes into an existing output path; choose a new versioned folder");
const occlusionFile = new URL("./coverage-projection.mjs", import.meta.url);
const occlusionSource = fittedOcclusion ? readFileSync(occlusionFile, "utf8") : null;
const occlusionModule = fittedOcclusion ? await import(occlusionFile.href) : null;
mkdirSync(output, { recursive: true });
const indexArg = process.argv.indexOf("--index");
const indexFolder = indexArg < 0 ? "public/models/reconstructed-assemblies-v1" : process.argv[indexArg + 1];
if (!indexFolder?.replaceAll("\\", "/").startsWith("public/models/") || indexFolder.split(/[\\/]/).includes(".."))
  throw new Error("Coverage index must stay in public/models");
const indexUrl = "/" + relative(resolve("public"), resolve(indexFolder)).replaceAll("\\", "/");
const index = JSON.parse(readFileSync(`${indexFolder}/assets.json`, "utf8"));
let items = legacy ? JSON.parse(readFileSync("src/data/items.json", "utf8"))
    .filter(item => selectedIds.has(item.id) && item.model?.gltfPath)
    .map(item => ({ id: item.id, slot: item.slot, legacyMesh: item.model.gltfPath }))
  : all ? JSON.parse(readFileSync(`${indexFolder}/supported-items.json`, "utf8")).ready
  : ["leather-black", "satin", "leather-camo"].map(suffix => ({ id: `casual-longcoat-${suffix}`, slot: "outerwear" }));
if (selectedIds) {
  items = items.filter(item => selectedIds.has(item.id));
  if (items.length !== selectedIds.size) throw new Error("--items contains an unavailable source assembly");
}
const bodyFile = all ? "models/reconstructed-meshes-v2/SK_Body_M.glb" : "models/body/SK_Body_M.glb";
const appUrl = new URL(process.env.APP_URL ?? "http://127.0.0.1:5173");
if (!["127.0.0.1", "localhost", "[::1]"].includes(appUrl.hostname) || appUrl.protocol !== "http:")
  throw new Error("Coverage requires an explicit local development app URL");
const appRoot = resolve(process.env.APP_ROOT ?? ".");
const harnessFile = resolve(appRoot, "scripts/generated/shader-probe/coverage-harness.html");
mkdirSync(resolve(appRoot, "scripts/generated/shader-probe"), { recursive: true });
writeFileSync(harnessFile, `<!doctype html><html><head>
  <link rel="icon" href="data:,"></head><body><script type="module">
  import * as THREE from 'three'; import { MeshBVH } from 'three-mesh-bvh';
  window.__coverage = { THREE, MeshBVH };
  </script></body></html>`);
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage();
  page.on("console", message => { if (message.text().startsWith("COVERAGE ")) console.log(message.text()); });
  await page.goto(new URL("scripts/generated/shader-probe/coverage-harness.html", appUrl).href, { waitUntil: "networkidle" });
  await page.waitForFunction(() => !!window.__coverage);
  if (fittedOcclusion) await page.evaluate(policy => { window.__coveragePolicy = policy; },
    { source: occlusionSource, fittingTags, settings: { ...occlusionModule.OCCLUSION_DEFAULTS } });
  const result = await page.evaluate(async ({ items, all, bodyFile, indexUrl, conservativeSharedUv }) => {
    const { THREE: T, MeshBVH } = window.__coverage;
    // Set only by --fitted-occlusion; the helper arrives as source, so APP_ROOT may be another worktree.
    const occlusionPolicy = window.__coveragePolicy ?? null;
    const occlusion = occlusionPolicy
      ? await import(URL.createObjectURL(new Blob([occlusionPolicy.source], { type: "text/javascript" }))) : null;
    const { CharacterRig } = await import("/src/rig/CharacterRig.ts");
    const { createGltfLoader } = await import("/src/rig/loaders.ts");
    const { loadSourceOutfit, loadSourceRigParts } = await import("/src/rig/SourceAssembly.ts");
    const rig = new CharacterRig(createGltfLoader());
    await rig.loadBody("/models/body/SK_Body_M.glb", all ? "/" + bodyFile : undefined);
    const body = rig.bodyScene.getObjectsByProperty("isSkinnedMesh", true)[0];
    const makeGeometry = mesh => {
      const g = mesh.geometry.clone(), p = new Float32Array(g.attributes.position.count * 3), v = new T.Vector3();
      for (let i = 0; i < p.length / 3; i++) mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld).toArray(p, i * 3);
      g.setAttribute("position", new T.BufferAttribute(p, 3));
      g.computeVertexNormals(); return g;
    };
    const results = [], visited = new Set();
    for (const { id, slot, legacyMesh } of items) {
      if (legacyMesh) {
        if (visited.has(legacyMesh)) continue;
        await rig.equip({ id, slot, url: "/" + legacyMesh });
        const group = rig.root.children.find(child => child.userData.rigItemId === id);
        const meshes = group?.getObjectsByProperty("isSkinnedMesh", true) ?? [];
        if (meshes.length !== 1) throw new Error(`Legacy coverage requires one skinned mesh: ${id} has ${meshes.length}`);
        meshes[0].userData.sourceMesh = legacyMesh; // provenance key in this disposable rig only
      } else {
        const outfit = await loadSourceOutfit([id], "/models/reconstructed-assembly-v2");
        const parts = await loadSourceRigParts(outfit.items[id], indexUrl);
        await rig.equip({ id, slot, url: "unused.glb", sourceParts: parts });
      }
      const garments = rig.root.getObjectsByProperty("isSkinnedMesh", true)
        .filter(o => o.userData.sourceMesh && (all || !o.userData.sourceMesh.includes("/LongCoat/")) && !visited.has(o.userData.sourceMesh));
      // A source mesh with several material sections loads as one skinned mesh per section. Project
      // them together, so each source mesh yields one record and one mask file.
      const sections = new Map();
      for (const mesh of garments) sections.set(mesh.userData.sourceMesh, [...(sections.get(mesh.userData.sourceMesh) ?? []), mesh]);
      for (const group of sections.values()) {
        const mesh = group[0];
        visited.add(mesh.userData.sourceMesh);
        let covered;
        let coveragePixels;
        const RES = 1024;
        const WIDTH = RES * 2, HEIGHT = RES;
        const poseCounts = [];
        const restoredByPose = [];
        for (const pose of ["a", "idle"]) {
          rig.setPose(pose); rig.root.updateMatrixWorld(true);
          const geometries = group.map(makeGeometry), b = makeGeometry(body);
          const trees = geometries.map(g => new MeshBVH(g, { indirect: true }));
          const tree = { raycast: (...args) => trees.flatMap(t => t.raycast(...args)) };
          const g = { dispose: () => geometries.forEach(x => x.dispose()) };
          const ray = new T.Ray(), point = new T.Vector3(), normal = new T.Vector3();
          const vertices = [new T.Vector3(), new T.Vector3(), new T.Vector3()];
          const normals = [new T.Vector3(), new T.Vector3(), new T.Vector3()];
          const samples = [[1,0,0],[0,1,0],[0,0,1],[.5,.5,0],[.5,0,.5],[0,.5,.5],[1/3,1/3,1/3]];
          const found = new Uint8Array(b.index.count / 3);
          const pixels = new Uint8Array(WIDTH * HEIGHT), uv = b.attributes.uv;
          const exposedPixels = conservativeSharedUv ? new Uint8Array(WIDTH * HEIGHT) : null;
          // A global 4 cm bidirectional projection tolerates intersecting shells.
          // Interior triangles use seven samples; partial boundary triangles are
          // projected per texel. Proximity to an open rim alone is insufficient.
          for (let tri = 0; tri < found.length; tri++) {
            for (let j = 0; j < 3; j++) {
              const i = b.index.getX(tri * 3 + j);
              vertices[j].fromBufferAttribute(b.attributes.position, i);
              normals[j].fromBufferAttribute(b.attributes.normal, i);
            }
            const coveredAt = weights => {
              point.set(0,0,0); normal.set(0,0,0);
              for (let j = 0; j < 3; j++) { point.addScaledVector(vertices[j], weights[j]); normal.addScaledVector(normals[j], weights[j]); }
              normal.normalize(); ray.origin.copy(point).addScaledVector(normal, -.04); ray.direction.copy(normal);
              return tree.raycast(ray, T.DoubleSide, 0, .08).some(hit => hit.face.normal.dot(normal) > .25);
            };
            const hits = samples.map(coveredAt), full = hits.every(Boolean), any = hits.some(Boolean);
            found[tri] = +full;
            // Uncovered triangles matter when another limb shares their UVs.
            if (!conservativeSharedUv && !any) continue;
            const points = [0,1,2].map(j => { const i = b.index.getX(tri*3+j); return [uv.getX(i)*RES, uv.getY(i)*RES]; });
            const [[ax,ay],[bx,by],[cx,cy]] = points;
            const den = (by-cy)*(ax-cx)+(cx-bx)*(ay-cy);
            if (Math.abs(den) < 1e-8) continue;
            const x0 = Math.max(0, Math.floor(Math.min(ax,bx,cx))), x1 = Math.min(WIDTH-1, Math.ceil(Math.max(ax,bx,cx)));
            const y0 = Math.max(0, Math.floor(Math.min(ay,by,cy))), y1 = Math.min(HEIGHT-1, Math.ceil(Math.max(ay,by,cy)));
            for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
              const wa = ((by-cy)*(x+.5-cx)+(cx-bx)*(y+.5-cy))/den;
              const wb = ((cy-ay)*(x+.5-cx)+(ax-cx)*(y+.5-cy))/den, wc = 1-wa-wb;
              if (Math.min(wa,wb,wc) < 0) continue;
              if (full || (any && coveredAt([wa,wb,wc]))) pixels[y*WIDTH+x] = 255;
              else if (exposedPixels) exposedPixels[y*WIDTH+x] = 1;
            }
          }
          let sharedUvRemovedPixels = 0;
          if (exposedPixels) for (let i = 0; i < pixels.length; i++) {
            if (pixels[i] && exposedPixels[i]) { pixels[i] = 0; sharedUvRemovedPixels++; }
          }
          poseCounts.push({ pose, triangles: found.reduce((a, b) => a + b, 0), pixels: pixels.reduce((a,b) => a + +(b > 0), 0),
            ...(conservativeSharedUv ? { sharedUvRemovedPixels } : {}) });
          covered = covered ? covered.map((v, i) => v && found[i] ? 1 : 0) : found;
          coveragePixels = coveragePixels ? coveragePixels.map((v, i) => v && pixels[i] ? 255 : 0) : pixels;
          if (occlusion) {
            // Runtime renders the body with the items' fitting morphs active; the projection above does not.
            // Re-evaluate this pose's hidden texels on the fitted geometry (same UVs and triangles).
            rig.setSourceFittingTags(occlusionPolicy.fittingTags); rig.root.updateMatrixWorld(true);
            const fittingMorphs = [...(body.userData.sourceFittingMorphs ?? [])];
            if (!fittingMorphs.length) throw new Error("--fitted-occlusion: no fitting tag activated a body morph");
            const fb = makeGeometry(body), fittedGarments = group.map(makeGeometry);
            const fittedTrees = fittedGarments.map(x => new MeshBVH(x, { indirect: true }));
            const castRay = new T.Ray();
            const test = occlusion.createOcclusionTest((origin, direction) => {
              castRay.origin.set(origin.x, origin.y, origin.z); castRay.direction.set(direction.x, direction.y, direction.z);
              return fittedTrees.some(t => t.raycastFirst(castRay, T.DoubleSide) !== null);
            }, occlusionPolicy.settings);
            const fp = new T.Vector3(), fnormal = new T.Vector3(), vertex = new T.Vector3(), fuv = fb.attributes.uv;
            const { restored, ...rasterCounts } = occlusion.restoreHiddenTexels({ width: WIDTH, height: HEIGHT, resolution: RES,
              hidden: pixels, triangleCount: found.length,
              triangleUv: tri => [0,1,2].map(j => { const i = fb.index.getX(tri * 3 + j); return [fuv.getX(i), fuv.getY(i)]; }),
              classify: (tri, weights) => {
                fp.set(0,0,0); fnormal.set(0,0,0);
                for (let j = 0; j < 3; j++) {
                  const i = fb.index.getX(tri * 3 + j);
                  fp.addScaledVector(vertex.fromBufferAttribute(fb.attributes.position, i), weights[j]);
                  fnormal.addScaledVector(vertex.fromBufferAttribute(fb.attributes.normal, i), weights[j]);
                }
                return test.classify(fp, fnormal.normalize());
              } });
            restoredByPose.push(restored);
            Object.assign(poseCounts.at(-1), { fittedOcclusion: { fittingMorphs, ...rasterCounts, ...test.stats } });
            fb.dispose(); fittedGarments.forEach(x => x.dispose());
            rig.setSourceFittingTags([]); rig.root.updateMatrixWorld(true);
            if ((body.userData.sourceFittingMorphs ?? []).length) throw new Error("--fitted-occlusion: fitting morphs were not reset");
          }
          g.dispose(); b.dispose();
        }
        if (occlusion) {
          const encode = rgba => { // same canvas encoding as the mask below, so previous hashes are comparable
            const c = document.createElement("canvas"); c.width = WIDTH; c.height = HEIGHT;
            const context = c.getContext("2d"), image = context.createImageData(WIDTH, HEIGHT);
            image.data.set(rgba); context.putImageData(image, 0, 0);
            return c.toDataURL("image/png").split(",")[1];
          };
          const grey = values => { const rgba = new Uint8ClampedArray(values.length * 4);
            for (let i = 0; i < values.length; i++) rgba.set([values[i],values[i],values[i],255], i*4); return rgba; };
          const { pixels: candidatePixels, diagnostic, ...counts } = occlusion.combineCandidate(coveragePixels, restoredByPose);
          (window.__coverageOcclusion ??= {})[mesh.userData.sourceMesh] = { ...counts,
            previousTriangles: covered.reduce((a, b) => a + b, 0), previousPng: encode(grey(coveragePixels)), diagnosticPng: encode(diagnostic) };
          coveragePixels = candidatePixels;
        }
        const canvas = document.createElement("canvas"); canvas.width = WIDTH; canvas.height = HEIGHT;
        const ctx = canvas.getContext("2d"), data = ctx.createImageData(WIDTH,HEIGHT);
        for (let i = 0; i < coveragePixels.length; i++) {
          data.data.set([coveragePixels[i],coveragePixels[i],coveragePixels[i],255], i*4);
        }
        ctx.putImageData(data,0,0);
        results.push({ source: mesh.userData.sourceMesh, sourceIndex: mesh.userData.sourcePartIndex,
          uvTiles: [2,1],
          poseCounts, coveredTriangles: covered.reduce((a, b) => a + b, 0), coveredPixels: coveragePixels.reduce((a,b) => a + +(b > 0), 0),
          png: canvas.toDataURL("image/png").split(",")[1] });
        console.log(`COVERAGE ${mesh.userData.sourceMesh.split(".").at(-1)}: ${results.at(-1).coveredPixels} texels`);
      }
      rig.unequip(slot);
    }
    rig.dispose(); return results;
  }, { items, all, bodyFile, indexUrl, conservativeSharedUv });
  const hashes = bytes => createHash("sha256").update(bytes).digest("hex");
  const records = [];
  for (const { png, ...record } of result) {
    const file = (legacy ? record.source.split("/").at(-1).replace(/\.glb$/, "") : record.source.split(".").at(-1)) + ".bodymask.png";
    const bytes = Buffer.from(png, "base64");
    if (!record.coveredPixels) { console.log(`No body coverage for ${record.source}`); continue; }
    writeFileSync(`${output}/${file}`, bytes);
    records.push({ ...record, file, sha256: hashes(bytes),
      meshSha256: hashes(readFileSync(legacy ? resolve("public", record.source) : resolve(indexFolder, index.meshes[record.source].url))) });
    console.log(`${file}: ${record.coveredTriangles} body triangles covered in both poses`);
  }
  writeFileSync(`${output}/derived-coverage.json`, JSON.stringify({ formatVersion: 1,
    method: "Bidirectional surface projection; 4 cm each direction; seven samples per body triangle plus per-texel projection at partial boundaries; normal alignment > .25; intersection of A and idle coverage"
      + (conservativeSharedUv ? "; texels shared with any uncovered body surface remain visible" : ""),
    ...(conservativeSharedUv ? { sharedUvPolicy: "all-surfaces-covered" } : {}),
    source: "Derived preview coverage, not recovered game rules. Specific to the recorded medium-body geometry, zero fitting weights and supported poses.",
    geometryMode: legacy ? "legacy" : "source", indexFolder: legacy ? null : indexFolder,
    bodyFile, bodySha256: hashes(readFileSync(`public/${bodyFile}`)), records }, null, 2));
  if (fittedOcclusion) {
    const extras = await page.evaluate(() => window.__coverageOcclusion ?? {});
    const coverage = JSON.parse(readFileSync(`${output}/derived-coverage.json`, "utf8"));
    for (const record of coverage.records) {
      const { previousPng, diagnosticPng, previousTriangles, ...counts } = extras[record.source];
      const diagnosticBytes = Buffer.from(diagnosticPng, "base64");
      const diagnosticFile = record.file.replace(/\.bodymask\.png$/, ".fitted-occlusion-diagnostic.png");
      writeFileSync(`${output}/${diagnosticFile}`, diagnosticBytes);
      Object.assign(record, { previousPolicy: { coveredTriangles: previousTriangles, coveredPixels: counts.previousPixels,
        sha256: hashes(Buffer.from(previousPng, "base64")), note: "coveredTriangles above is also this previous-policy count" },
        restoration: counts, diagnosticFile, diagnosticSha256: hashes(diagnosticBytes) });
    }
    const skipped = Object.keys(extras).filter(source => !coverage.records.some(record => record.source === source));
    coverage.method += "; a texel hidden by all of the above stays hidden only if, on the same posed meshes with the listed runtime fitting tags applied, the garment occludes its body samples (texel centre, and texel-cell footprint vertices in a flood-filled boundary band) along the normal and every fixed oblique view";
    coverage.source = "Derived preview coverage, not recovered game rules. Specific to the recorded medium-body geometry and supported poses; the previous policy uses zero fitting weights and the occlusion test uses the listed fitting tags.";
    coverage.occlusionPolicy = { name: occlusionModule.OCCLUSION_POLICY,
      rule: "Run the previous policy unchanged (zero fitting weights, conservative shared UVs, A and idle intersection). Per pose, apply --fitting-tags through CharacterRig.setSourceFittingTags, rebuild posed body and garment geometry, and for every texel the previous policy hid in that pose evaluate each body surface mapped to it at the texel centre (interpolated fitted position and recomputed vertex normal). Then, starting at still-hidden texels with a visible or restored 8-neighbour and flooding to the hidden 8-neighbours of every texel restored this way, evaluate the vertices of each body triangle's intersection with the texel's closed UV cell: cell corners inside the triangle, triangle vertices inside the cell and triangle edges crossing cell edges, whether or not the triangle contains the centre. Rays start surfaceTolerance beneath the interpolated skin point along the normal (0: at the skin) and are unbounded half-lines toward the viewer side: the normal, then azimuths directions at each tilt. Any crossing of any garment face of the same source mesh (all material sections, either orientation) blocks a ray. If any ray from any evaluated point escapes, the texel is restored. A texel restored in either pose, by any surface, is restored. The final mask is the previous mask minus restored texels. Garment topology, heights, item names and image morphology are not used.",
      units: "surfaceTolerance in posed world metres; tilts in degrees",
      settings: { ...occlusionModule.OCCLUSION_DEFAULTS }, fittingTags,
      diagnostic: "RGBA: R = restored because the normal ray escaped in some pose (skin outside the fitted garment); G = restored by an oblique view in some pose; B 255 = still hidden; B 128 with R or G = restored only at texel footprint vertices, at no texel centre; black = visible in the previous policy",
      helper: "scripts/shader-probe/coverage-projection.mjs", helperSha256: hashes(occlusionSource),
      generatorSha256: hashes(readFileSync(new URL(import.meta.url))),
      skippedEmptyCandidates: skipped,
      limitations: "Derived preview heuristic. CPU morph/skinning via three getVertexPosition (up to four skin influences) may differ from the GPU source-skinning path. Body self-occlusion is not modelled (errs toward restoring). Views between azimuths or steeper than the largest tilt, other poses, other bodies, other outfit layers and alpha-cut garment texels are not evaluated. Footprint vertices find exposure whose garment silhouette is straight at texel scale; a silhouette corner inside a cell, or an exposed pocket containing no texel centre with every neighbouring texel hidden, can be missed. Under that condition nearest and base-level linear sampling keep exposed fragments; mipmapped minification is not covered. UV-degenerate body triangles are skipped as in the previous policy. Garment surfaces exactly coincident with the skin are a floating-point tie. Texture filtering in BodyDecals is unchanged." };
    writeFileSync(`${output}/derived-coverage.json`, JSON.stringify(coverage, null, 2));
  }
} finally { await browser.close(); }
