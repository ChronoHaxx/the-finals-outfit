// Tests for generate-family-review.mjs with Node alone: no browser, network or game assets.
// The runner replay uses the sibling run-family-review.mjs when present (or FAMILY_REVIEW_RUNNER).
// FAMILY_REVIEW_FIXTURES may name a {catalog, fixtures:[{manifest, cohort, preview, exampleGeometry}]}
// file of real family metadata to replay as well.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { defaultAngles, isSafeComponent, parseCamera, validateConfig } from './capture-family.mjs';
import { PROFILES_FILE, RECEIPT_FILE, describeInput, generateFamilyReview } from './generate-family-review.mjs';
import { MULTIPART_LIMITATIONS, readInputs } from './generate-family-review.mjs';
import { manifestSha } from './freeze-family.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, 'generate-family-review.mjs');
const scratch = fs.mkdtempSync(path.join(here, '.generate-family-review-test-'));
after(() => {
  assert.equal(path.dirname(path.resolve(scratch)), path.resolve(here));
  assert(path.basename(scratch).startsWith('.generate-family-review-test-'));
  fs.rmSync(scratch, { recursive: true, force: true });
});

const profiles = JSON.parse(fs.readFileSync(PROFILES_FILE, 'utf8'));
const CONFIGS = ['variants.json', 'geometry-a.json', 'geometry-idle.json', 'outfits.json'];
const SLOTS = ['upperBody', 'lowerBody', 'hands', 'upperBack', 'feet'];
const BASE_CATALOG = [
  { id: 'head-face-01-base', slot: 'face' },
  { id: 'hairs-afrofade', slot: 'hair' },
  { id: 'casual-basictshirt-cotton-alfaacta', slot: 'upperBody' },
  { id: 'casual-loosejeans-denim-darkblue', slot: 'lowerBody' },
  { id: 'casual-tallsneakers-canvas', slot: 'feet' },
];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** Tiny ordinary family. By default the ordinally first candidate (gloves-a) is deferred. */
function family({ slot = 'hands', ids = ['gloves-c', 'gloves-a', 'gloves-b', 'gloves-d'], implemented } = {}) {
  const mesh = '/Game/Discovery/Characters/Test/Assets/Gloves/SK_Test_Gloves_M.SK_Test_Gloves_M';
  const items = ids.map(id => {
    const name = `MI_${id.replaceAll('-', '_')}`;
    return { id, name: id, slot, materials: [`/Game/Discovery/Characters/Test/Assets/Gloves/Skins/${name}.${name}`] };
  });
  return {
    manifest: {
      schemaVersion: 1,
      id: 'test-family',
      paths: { docs: '_docs/test-family', preview: 'public/models/test-preview-v1',
        active: 'public/models/reconstructed-assemblies-v1', catalog: 'src/data/items.json' },
      mesh: { source: mesh, slot: 'Gloves', itemSlot: slot, facts: { materialSections: 1 } },
    },
    cohort: { meshes: [mesh], items, materials: items.map(item => item.materials[0]), count: items.length },
    preview: { implemented: implemented ?? ids.filter(id => id !== 'gloves-a') },
    catalog: [...BASE_CATALOG, ...ids.map(id => ({ id, name: id, slot }))],
  };
}

function generate(data, profileKey = data.manifest.mesh.itemSlot, options = {}, profileData = profiles) {
  const inputs = { profiles: describeInput('profiles', Buffer.from(JSON.stringify(profileData))) };
  for (const key of ['manifest', 'cohort', 'preview', 'catalog']) {
    inputs[key] = describeInput(key, Buffer.from(JSON.stringify(data[key])));
  }
  return generateFamilyReview({ inputs, profileKey, ...options });
}
const parse = files => Object.fromEntries(Object.entries(files).map(([name, text]) => [name.replace('.json', ''), JSON.parse(text)]));

/** The checks run-family-review.mjs makes before capturing, for workspaces without the runner. */
function assertRunnerAccepts(files, { cohort, preview, catalog }) {
  const byId = new Map(cohort.items.map(item => [item.id, item]));
  const eligible = new Set(preview.implemented);
  const slotOf = new Map(catalog.map(item => [item.id, item.slot]));
  const validateSlots = slots => {
    for (const [slot, id] of Object.entries(slots)) {
      assert.equal(slotOf.get(id), slot);
      if (byId.has(id)) assert(eligible.has(id), `deferred item selected: ${id}`);
    }
  };
  for (const name of ['variants', 'geometry-a', 'geometry-idle']) {
    const raw = files[name];
    validateConfig(raw);
    validateSlots(raw.baseOutfit);
    for (const item of raw.items) {
      assert.equal(item.slot, byId.get(item.id).slot);
      assert.deepEqual(item.meshes, cohort.meshes);
      assert.deepEqual(item.materials, byId.get(item.id).materials);
    }
    assert.equal(raw.pose, name === 'geometry-idle' ? 'idle' : 'a');
    assert.equal(raw.angles.length, name === 'variants' ? 2 : 8);
    if (name !== 'variants') assert.equal(raw.items.filter(item => eligible.has(item.id)).length, 1);
  }
  assert.deepEqual(files.variants.items.map(item => item.id).sort(), [...byId.keys()].sort());
  const names = new Set();
  let previous = null;
  for (const step of files.outfits.steps) {
    assert(isSafeComponent(step.name) && !names.has(step.name));
    names.add(step.name);
    assert(parseCamera(step.camera));
    validateSlots(step.slots);
    for (const [id, shown] of Object.entries(step.expected)) assert(slotOf.has(id) && typeof shown === 'boolean');
    if (step.samePage) {
      assert(previous);
      assert.equal(step.camera, previous.camera);
      assert.equal(step.pose ?? 'a', previous.pose ?? 'a');
    }
    previous = step;
  }
}

let repoCount = 0;
function writeRepo(data) {
  const root = path.join(scratch, `repo-${repoCount++}`);
  const put = (file, value) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), `${JSON.stringify(value, null, 2)}\n`);
  };
  put('manifest.json', data.manifest);
  put(`${data.manifest.paths.docs}/cohort.json`, data.cohort);
  put(`${data.manifest.paths.preview}/preview.json`, data.preview);
  put(data.manifest.paths.catalog, data.catalog);
  return root;
}

/** Every directory and file hash under root, so any write shows up. */
function snapshot(root) {
  const entries = {};
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const key = path.relative(root, full).split(path.sep).join('/');
      if (entry.isDirectory()) {
        entries[`${key}/`] = 'dir';
        walk(full);
      } else entries[key] = sha256(fs.readFileSync(full));
    }
  };
  walk(root);
  return entries;
}

const cli = (root, args) => spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8', windowsHide: true });

test('variants bind every candidate while captures and outfits use only eligible IDs', () => {
  const data = family();
  const text = generate(data);
  const files = parse(text);
  assertRunnerAccepts(files, data);
  const material = id => data.cohort.items.find(item => item.id === id).materials;
  assert.deepEqual(files.variants.items, ['gloves-a', 'gloves-b', 'gloves-c', 'gloves-d']
    .map(id => ({ id, slot: 'hands', meshes: data.cohort.meshes, materials: material(id) })));
  assert.deepEqual(files.variants.angles.map(angle => angle.name), ['front', 'back']);
  assert.equal(files.variants.framing, 'positive-x-item');
  for (const [name, pose] of [['geometry-a', 'a'], ['geometry-idle', 'idle']]) {
    assert.deepEqual(files[name].items.map(item => item.id), ['gloves-b']);
    assert.equal(files[name].pose, pose);
    assert.deepEqual(files[name].angles, defaultAngles());
  }
  const selected = new Set(files.outfits.steps.flatMap(step => [step.slots.hands, ...Object.keys(step.expected)]));
  selected.delete(undefined);
  assert.deepEqual([...selected].sort(), ['gloves-b', 'gloves-c']);

  const receipt = files.receipt;
  assert.deepEqual(receipt.candidateRows.ids, ['gloves-a', 'gloves-b', 'gloves-c', 'gloves-d']);
  assert.deepEqual(receipt.implementedIds, ['gloves-b', 'gloves-c', 'gloves-d']);
  assert.deepEqual(receipt.excludedIds, ['gloves-a']);
  assert.deepEqual(receipt.eligibleCaptures,
    { variants: ['gloves-b', 'gloves-c', 'gloves-d'], 'geometry-a': ['gloves-b'], 'geometry-idle': ['gloves-b'] });
  assert.deepEqual([receipt.representative, receipt.alternate],
    [{ id: 'gloves-b', selection: 'default' }, { id: 'gloves-c', selection: 'default' }]);
  for (const name of CONFIGS) assert.equal(receipt.outputs[name].sha256, sha256(text[name]));
  assert.equal(receipt.visualAcceptance, 'pending');
  assert.equal(receipt.humanAcceptance, 'pending');
  assert(receipt.limitations.some(line => /visual review/.test(line)));
});

test('explicit selections must be eligible and distinct, with no silent fallback', () => {
  const data = family();
  assert.throws(() => generate(data, 'hands', { representative: 'gloves-a' }), /--representative gloves-a is deferred/);
  assert.throws(() => generate(data, 'hands', { alternate: 'gloves-a' }), /--alternate gloves-a is deferred/);
  assert.throws(() => generate(data, 'hands', { representative: 'gloves-z' }), /not a cohort candidate/);
  assert.throws(() => generate(data, 'hands', { representative: 'gloves-c', alternate: 'gloves-c' }), /must differ/);

  const explicit = parse(generate(data, 'hands', { representative: 'gloves-d', alternate: 'gloves-b' }));
  assert.deepEqual([explicit.receipt.representative, explicit.receipt.alternate],
    [{ id: 'gloves-d', selection: 'explicit' }, { id: 'gloves-b', selection: 'explicit' }]);
  assert.deepEqual(explicit['geometry-idle'].items.map(item => item.id), ['gloves-d']);
  assert.throws(() => generate(data, 'hands', { alternate: 'gloves-b' }), /matches the default representative/);
  const alternateOnly = parse(generate(data, 'hands', { alternate: 'gloves-d' })).receipt;
  assert.deepEqual([alternateOnly.representative, alternateOnly.alternate],
    [{ id: 'gloves-b', selection: 'default' }, { id: 'gloves-d', selection: 'explicit' }]);
});

test('rejects duplicate, mismatched, unsupported and malformed family metadata', () => {
  const otherMesh = '/Game/Discovery/Characters/Other/SK_Other.SK_Other';
  const cases = [
    [d => d.cohort.items.push({ ...d.cohort.items[0] }), /duplicate cohort id: gloves-c/],
    [d => d.preview.implemented.push('gloves-b'), /duplicate implemented id: gloves-b/],
    [d => d.preview.implemented.push('gloves-z'), /unknown implemented id/],
    [d => { d.preview.implemented = []; }, /implements no candidates/],
    [d => { d.preview = { implemented: 'gloves-b' }; }, /malformed preview/],
    [d => { d.preview = null; }, /malformed preview/],
    [d => { d.cohort.meshes = [otherMesh]; }, /does not match the manifest mesh/],
    [d => d.cohort.meshes.push(otherMesh), /exactly one mesh/],
    [d => { d.cohort.items[1].slot = 'feet'; }, /does not match manifest item slot hands/],
    [d => { d.manifest.mesh.itemSlot = 'feet'; }, /does not match manifest item slot feet/],
    [d => d.cohort.items[0].materials.push(d.cohort.items[1].materials[0]), /exactly one material/],
    [d => { d.cohort.items[0].meshes = [...d.cohort.meshes]; }, /declares its own meshes/],
    [d => { d.cohort.items[0].materials = ['Game/Test/MI_Bad']; }, /malformed source material path for gloves-c/],
    [d => { d.manifest.mesh.source = '/Game/Test/SK_A.SK_B'; }, /malformed manifest mesh source path/],
    [d => { d.manifest.mesh.facts.materialSections = 2; }, /one material section/],
    [d => { d.catalog = d.catalog.filter(item => item.id !== 'gloves-d'); }, /unknown catalog id: gloves-d/],
    [d => { d.catalog.find(item => item.id === 'gloves-d').slot = 'feet'; }, /wrong catalog slot for gloves-d/],
    [d => d.catalog.push({ id: 'gloves-d', slot: 'hands' }), /duplicate catalog id/],
    [d => d.cohort.materials.pop(), /cohort.materials does not match/],
    [d => { d.manifest.paths.docs = '../elsewhere'; }, /paths.docs must be a repository-relative path/],
  ];
  for (const [mutate, expected] of cases) {
    const data = family();
    mutate(data);
    assert.throws(() => generate(data), expected);
  }
});

test('output bytes are deterministic regardless of cohort and implemented order', () => {
  const data = family();
  const first = generate(data);
  assert.deepEqual(generate(data), first);
  assert.doesNotMatch(Object.values(first).join(''), /\d{4}-\d{2}-\d{2}T\d{2}:/);

  const shuffled = structuredClone(data);
  shuffled.cohort.items.reverse();
  shuffled.cohort.materials.reverse();
  shuffled.preview.implemented.reverse();
  shuffled.catalog.reverse();
  const other = generate(shuffled);
  for (const name of CONFIGS) assert.equal(other[name], first[name], name);
  const withoutInputs = text => ({ ...JSON.parse(text), inputs: null });
  assert.deepEqual(withoutInputs(other[RECEIPT_FILE]), withoutInputs(first[RECEIPT_FILE]));
  assert.notEqual(JSON.parse(other[RECEIPT_FILE]).inputs.cohort.sha256, JSON.parse(first[RECEIPT_FILE]).inputs.cohort.sha256);
});

test('a single eligible candidate omits only the switch step', () => {
  const singles = [family({ ids: ['gloves-a'], implemented: ['gloves-a'] }), family({ ids: ['gloves-a', 'gloves-b'] })];
  for (const data of singles) {
    const [id] = data.preview.implemented;
    const files = parse(generate(data));
    assertRunnerAccepts(files, data);
    assert.deepEqual(files.receipt.outfitSteps,
      ['equip', 'remove', 'restore', 'idle', 'rear', 'hand-positive-x', 'hand-negative-x']);
    assert.deepEqual(files.outfits.steps.map(step => step.slots.hands ?? null), [id, null, id, id, id, id, id]);
    assert(files.outfits.steps.every(step => Object.keys(step.expected).join() === id));
    assert.equal(files.receipt.alternate, null);
    assert.match(files.receipt.switchStep, /^omitted: only one eligible candidate/);
    assert.throws(() => generate(data, 'hands', { alternate: id }), /matches the default representative/);
  }
});

test('samePage only follows an identical camera and pose; rear and blind-spot views use their own cameras', () => {
  for (const slot of SLOTS) {
    const data = family({ slot });
    const files = parse(generate(data));
    assertRunnerAccepts(files, data);
    const steps = files.outfits.steps;
    for (const [index, step] of steps.entries()) {
      const previous = steps[index - 1];
      assert.equal(step.samePage, Boolean(previous) && previous.camera === step.camera && previous.pose === step.pose);
      assert.deepEqual(Object.keys(step.expected).sort(), ['gloves-b', 'gloves-c']);
      for (const [id, shown] of Object.entries(step.expected)) assert.equal(shown, step.slots[slot] === id);
    }
    const byName = Object.fromEntries(steps.map(step => [step.name, step]));
    assert.deepEqual(['equip', 'switch', 'remove', 'restore', 'idle', 'rear'].map(name => byName[name].samePage),
      [false, true, true, true, false, false], slot);
    assert.equal(byName.idle.pose, 'idle');
    assert(!(slot in byName.remove.slots) && !(slot in files['geometry-a'].baseOutfit));
    const rear = parseCamera(byName.rear.camera);
    assert.notEqual(byName.rear.camera, byName.equip.camera);
    assert(rear[2] < rear[5], `${slot} rear camera is behind the target`);
  }

  const hands = parse(generate(family())).outfits.steps;
  const handCamera = name => parseCamera(hands.find(step => step.name === name).camera);
  assert(handCamera('hand-positive-x')[0] > 0 && handCamera('hand-negative-x')[0] < 0);
  const bare = parse(generate(family({ slot: 'lowerBody' }))).outfits.steps.find(step => step.name === 'bare-waist-rear');
  const bareCamera = parseCamera(bare.camera);
  assert.deepEqual(Object.keys(bare.slots).sort(), ['face', 'feet', 'hair', 'lowerBody']);
  assert(bareCamera[2] < bareCamera[5]);

  const reuse = structuredClone(profiles);
  const { rear } = reuse.profiles.hands.outfitCameras;
  reuse.profiles.hands.extraViews = [{ name: 'rear-again', camera: rear }, { name: 'rear-idle', camera: rear, pose: 'idle' }];
  const tail = parse(generate(family(), 'hands', {}, reuse)).outfits.steps.slice(-2);
  assert.deepEqual(tail.map(step => [step.name, step.samePage]), [['rear-again', true], ['rear-idle', false]]);
});

test('pose-specific capture framing is data-driven and rejects malformed overrides', () => {
  const generated = parse(generate(family()));
  assert.equal(generated['geometry-a'].framing, 'positive-x-item');
  assert.equal(generated['geometry-idle'].framing, undefined);
  assert.equal(generated['geometry-idle'].camera, '0,1.05,3.2,0,1.05,0');
  for (const idleCapture of [null, {camera:'bad',framing:'root'}, {camera:'0,1,3,0,1,0',framing:'unknown'}, {camera:'0,1,3,0,1,0',framing:'root',yaw:1}]) {
    const invalid = structuredClone(profiles);
    invalid.profiles.hands.idleCapture = idleCapture;
    assert.throws(() => generate(family(), 'hands', {}, invalid), /idleCapture/);
  }
});

test('rejects unknown, mismatched or malformed profiles and fixed items', () => {
  const data = family();
  const edit = mutate => {
    const copy = structuredClone(profiles);
    mutate(copy.profiles.hands, copy);
    return copy;
  };
  const cases = [
    ['not-a-profile', profiles, /unknown review profile: "not-a-profile"/],
    ['toString', profiles, /unknown review profile/],
    ['upperBody', profiles, /reviews "upperBody", but the family slot is hands/],
    ['hands', edit(p => { p.captureCamera = '0,1.2,2.8'; }), /captureCamera is malformed/],
    ['hands', edit(p => { p.framing = 'left-hand'; }), /framing must be/],
    ['hands', edit(p => { p.outfitCameras.rear = p.outfitCameras.front; }), /rear camera must sit behind/],
    ['hands', edit(p => { p.outfitCameras.yaw = 3.14; }), /unsupported fields: yaw/],
    ['hands', edit(p => { p.family = 'tech-gloves'; }), /unsupported fields: family/],
    ['hands', edit(p => { p.baseOutfit.hands = 'gloves-b'; }), /must exclude the reviewed slot hands/],
    ['hands', edit(p => { p.baseOutfit.feet = 'missing-shoes'; }), /unknown item or wrong slot feet=missing-shoes/],
    ['hands', edit(p => { p.baseOutfit.feet = 'casual-loosejeans-denim-darkblue'; }), /unknown item or wrong slot/],
    ['hands', edit(p => p.extraViews.push({ name: 'rear', camera: p.outfitCameras.rear })), /duplicate step name: rear/],
    ['hands', edit(p => p.extraViews.push({ name: 'bag', camera: p.outfitCameras.rear, withoutSlots: ['upperBack'] })),
      /withoutSlots must name distinct baseOutfit slots/],
    ['hands', edit(p => { p.extraViews[0].pose = 'run'; }), /pose must be 'a' or 'idle'/],
    ['hands', edit((p, all) => { all.path = 'relative'; }), /config.path must be an absolute URL path/],
  ];
  for (const [key, profileData, expected] of cases) {
    assert.throws(() => generate(data, key, {}, profileData), expected);
  }
});

test('CLI writes a new review once and refuses collisions without touching inputs or existing output', () => {
  const root = writeRepo(family());
  const inputs = snapshot(root);
  const refuse = (args, expected) => {
    const before = snapshot(root);
    const result = cli(root, args);
    assert.equal(result.status, 2, result.stdout);
    assert.match(result.stderr, expected);
    assert.deepEqual(snapshot(root), before);
  };
  refuse(['manifest.json', 'hands'], /Usage/);
  refuse(['manifest.json', 'hands', 'review', '--alternat', 'gloves-b'], /unknown option: --alternat/);
  refuse(['manifest.json', 'hands', 'review', '--representative', 'gloves-a'], /deferred/);
  refuse(['manifest.json', 'hands', 'public/models/test-preview-v1/review'], /inside manifest.paths.preview/);

  const created = cli(root, ['manifest.json', 'hands', 'review']);
  assert.equal(created.status, 0, created.stderr);
  assert.deepEqual(fs.readdirSync(path.join(root, 'review')).sort(), [...CONFIGS, RECEIPT_FILE].sort());
  const receipt = JSON.parse(fs.readFileSync(path.join(root, 'review', RECEIPT_FILE), 'utf8'));
  assert.deepEqual(receipt.inputs.manifest, { path: 'manifest.json', sha256: inputs['manifest.json'] });
  assert.deepEqual(receipt.inputs.cohort, { path: '_docs/test-family/cohort.json', sha256: inputs['_docs/test-family/cohort.json'] });
  for (const name of ['generate-family-review.mjs', 'capture-family.mjs', 'coverage-preview-harness.mjs']) {
    assert.equal(receipt.implementation[name].sha256, sha256(fs.readFileSync(path.join(here, name))));
  }
  const written = snapshot(root);
  for (const [file, hash] of Object.entries(inputs)) assert.equal(written[file], hash, file);

  refuse(['manifest.json', 'hands', 'review'], /refusing to reuse an existing output/);
  fs.rmSync(path.join(root, 'public/models/test-preview-v1/preview.json'));
  refuse(['manifest.json', 'hands', 'review-2'], /cannot read preview/);
});

const runner = path.resolve(process.env.FAMILY_REVIEW_RUNNER ?? path.join(here, 'run-family-review.mjs'));
test('the unchanged run-family-review.mjs accepts the generated configs',
  { skip: fs.existsSync(runner) ? false : `runner not found: ${runner}` }, () => {
    const families = SLOTS.map(slot => ({ data: family({ slot }) }));
    if (process.env.FAMILY_REVIEW_FIXTURES) {
      const real = JSON.parse(fs.readFileSync(process.env.FAMILY_REVIEW_FIXTURES, 'utf8'));
      for (const { manifest, cohort, preview, exampleGeometry } of real.fixtures) {
        families.push({ data: { manifest, cohort, preview, catalog: real.catalog }, example: exampleGeometry });
      }
    }
    for (const { data, example } of families) {
      const root = writeRepo(data);
      const slot = data.manifest.mesh.itemSlot;
      const tools = path.join(root, 'tools');
      fs.mkdirSync(tools);
      fs.copyFileSync(runner, path.join(tools, 'run-family-review.mjs'));
      for (const name of ['capture-family.mjs', 'coverage-preview-harness.mjs']) {
        fs.copyFileSync(path.join(here, name), path.join(tools, name));
      }
      const generated = cli(root, ['manifest.json', slot, 'review']);
      assert.equal(generated.status, 0, generated.stderr);
      // An existing run receipt stops the runner after validation, before it writes or launches anything.
      fs.writeFileSync(path.join(root, data.manifest.paths.docs, 'review-run-v1.json'), 'keep\n');
      const before = snapshot(root);
      const run = spawnSync(process.execPath, [path.join(tools, 'run-family-review.mjs'), 'manifest.json', 'review'],
        { cwd: root, encoding: 'utf8', windowsHide: true });
      assert.notEqual(run.status, 0);
      assert.match(run.stderr, /Preserve previous review/, `${data.manifest.id}: ${run.stderr}`);
      assert.deepEqual(snapshot(root), before);
      assertRunnerAccepts(parse(Object.fromEntries(CONFIGS.map(name =>
        [name, fs.readFileSync(path.join(root, 'review', name), 'utf8')]))), data);
      if (example) {
        const geometry = JSON.parse(fs.readFileSync(path.join(root, 'review', 'geometry-a.json'), 'utf8'));
        const { [slot]: _reviewed, ...base } = example.baseOutfit;
        assert.deepEqual([geometry.camera, geometry.framing, geometry.path, geometry.baseOutfit],
          [example.camera, example.framing, example.path, base], data.manifest.id);
      }
    }
  });

// ---------------------------------------------------------------------------------------------
// schemaVersion 2 multipart families: the real Tactical Trousers proof manifest and cohort, with
// synthetic frozen bindings, preview and catalog (no raw assets).
// ---------------------------------------------------------------------------------------------

const PROOF = path.resolve(here, '../../tests/fixtures/multipart-family/review');
const readProof = name => JSON.parse(fs.readFileSync(path.join(PROOF, name), 'utf8'));

/** The resolved cohort freeze-multipart-family.mjs writes: one explicit override per component. */
function resolveCohort(manifest, cohort) {
  return { ...cohort, manifestSha256: manifestSha(manifest), items: cohort.items.map(item => ({ ...item,
    effectiveParts: manifest.components.map((component, i) => ({ sourceIndex: component.sourceIndex, mesh: component.source,
      binding: 'explicit-override', slots: [{ slot: component.slot, material: item.materials[i] }] })) })) };
}

function multipart() {
  const manifest = readProof('family.json');
  const cohort = readProof('cohort.json');
  const ids = cohort.items.map(item => item.id);
  return { manifest, cohort, resolvedCohort: resolveCohort(manifest, cohort), preview: { implemented: ids.slice(1) },
    catalog: [...BASE_CATALOG, ...ids.map(id => ({ id, name: id, slot: 'lowerBody' }))] };
}

function generate2(data, options = {}) {
  const inputs = { profiles: describeInput('profiles', Buffer.from(JSON.stringify(profiles))) };
  for (const key of ['manifest', 'cohort', 'preview', 'catalog', 'resolvedCohort']) {
    if (data[key] !== undefined) inputs[key] = describeInput(key, Buffer.from(JSON.stringify(data[key])));
  }
  return generateFamilyReview({ inputs, profileKey: 'lowerBody', ...options });
}

test('multipart rows bind every component and its own material in exact source part order', () => {
  const data = multipart();
  const files = generate2(data);
  const out = parse(files);
  const sources = data.manifest.components.map(component => component.source);
  const byId = new Map(data.cohort.items.map(item => [item.id, item]));
  for (const name of ['variants', 'geometry-a', 'geometry-idle']) {
    validateConfig(out[name]);
    for (const row of out[name].items) {
      assert.equal(row.slot, 'lowerBody');
      assert.deepEqual(row.meshes, sources);
      assert.deepEqual(row.materials, byId.get(row.id).materials);
      assert.equal(row.materials.length, 2);
    }
  }
  assert.deepEqual(out.variants.items.map(row => row.id), [...byId.keys()].sort());
  assert.deepEqual(out['geometry-a'].items.map(row => row.id), [out.receipt.representative.id]);
  assertRunnerAccepts(out, data);
  const { receipt } = out;
  assert.equal(receipt.schemaVersion, 2);
  assert.deepEqual(receipt.components, data.manifest.components.map(({ sourceIndex, source, slot }) => ({ sourceIndex, source, slot })));
  assert.deepEqual(Object.keys(receipt.inputs), ['manifest', 'cohort', 'preview', 'catalog', 'profiles', 'resolvedCohort']);
  assert.deepEqual(receipt.excludedIds, [data.cohort.items[0].id]);
  for (const note of MULTIPART_LIMITATIONS) assert(receipt.limitations.includes(note));
  assert.deepEqual([receipt.visualAcceptance, receipt.humanAcceptance], ['pending', 'pending']);
  assert.deepEqual(generate2(multipart()), files);
  const explicit = parse(generate2(multipart(), { representative: 'military-tacticaltrousers-cotton-snowcamo' }));
  assert.deepEqual(explicit.receipt.representative, { id: 'military-tacticaltrousers-cotton-snowcamo', selection: 'explicit' });
  // schemaVersion 1 receipts keep their exact shape.
  const v1 = parse(generate(family())).receipt;
  assert(!('schemaVersion' in v1) && !('components' in v1) && !('resolvedCohort' in v1.inputs));
});

test('multipart manifest, cohort and binding mismatches fail before any output', () => {
  const [trousers, socks] = multipart().manifest.components.map(component => component.source);
  const swap = pair => [pair[1], pair[0]];
  const first = d => d.cohort.items[0];
  const firstPart = (d, i = 0) => d.resolvedCohort.items[0].effectiveParts[i];
  const cases = [
    [d => { d.cohort.meshes = swap(d.cohort.meshes); }, /not exactly the manifest components in source part order/],
    [d => { d.cohort.meshes = [trousers]; }, /not exactly the manifest components in source part order/],
    [d => { d.cohort.meshes = [trousers, socks.replaceAll('TacticalSocks_M', 'TacticalSocks_F')]; }, /source part order/],
    [d => { d.manifest.components = swap(d.manifest.components); }, /invalid schemaVersion 2 manifest: .*ascending source part order/],
    [d => { d.manifest.components = d.manifest.components.slice(0, 1); }, /invalid schemaVersion 2 manifest: .*at least two/],
    [d => { d.manifest.components[1].source = '/Game/Test/SK_A.SK_B'; }, /invalid schemaVersion 2 manifest/],
    [d => { delete d.manifest.components[0].morphNames; }, /invalid schemaVersion 2 manifest/],
    [d => { d.manifest.schemaVersion = 3; }, /schemaVersion 1 object/],
    [d => { first(d).materials = swap(first(d).materials); }, /resolved cohort item .* differs from the cohort/],
    [d => { first(d).materials = first(d).materials.slice(0, 1); }, /exactly one material per component \(2\)/],
    [d => { first(d).materials[1] = 'Game/Test/MI_Bad'; }, /malformed source material path/],
    [d => { first(d).slot = 'feet'; }, /does not match manifest item slot lowerBody/],
    [d => { firstPart(d).slots[0].material = first(d).materials[1]; }, /component 0 binds/],
    [d => { firstPart(d, 1).slots[0].slot = 'TacticalTrousers'; }, /component 1 binds/],
    [d => { firstPart(d).binding = 'default'; }, /not bound by an explicit item override/],
    [d => { delete firstPart(d, 1).binding; }, /not bound by an explicit item override/],
    [d => { firstPart(d, 1).slots = []; }, /component 1 binds \[\]/],
    [d => { firstPart(d, 1).sourceIndex = 2; }, /not the manifest component in source part order/],
    [d => { d.resolvedCohort.items[0].effectiveParts.reverse(); }, /not the manifest component in source part order/],
    [d => { d.resolvedCohort.items[0].effectiveParts.pop(); }, /does not bind exactly the 2 manifest components/],
    [d => { d.resolvedCohort.items.reverse(); }, /not exactly the cohort items in order/],
    [d => { d.resolvedCohort.manifestSha256 = '0'.repeat(64); }, /frozen from a different manifest/],
    [d => { d.manifest.fittingTags = d.manifest.fittingTags.slice(0, 1); }, /frozen from a different manifest/],
    [d => { delete d.resolvedCohort; }, /missing resolvedCohort input/],
    [d => { d.cohort.attached = true; }, /attached family/],
    [d => { d.cohort.materials.pop(); }, /cohort.materials does not match/],
  ];
  for (const [mutate, expected] of cases) {
    const data = multipart();
    mutate(data);
    assert.throws(() => generate2(data), expected, String(mutate));
  }
});

test('readInputs reads the frozen resolved cohort only for a multipart manifest', () => {
  const data = multipart();
  const root = path.join(scratch, 'multipart-inputs');
  const put = (file, value) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), `${JSON.stringify(value, null, 2)}\n`);
  };
  put('family.json', data.manifest);
  put(`${data.manifest.paths.docs}/cohort.json`, data.cohort);
  put(`${data.manifest.paths.preview}/preview.json`, data.preview);
  put(data.manifest.paths.catalog, data.catalog);
  const cwd = process.cwd();
  process.chdir(root);
  try {
    assert.throws(() => readInputs('family.json'), /cannot read resolved cohort/);
    put(`${data.manifest.paths.docs}/resolved-cohort.json`, data.resolvedCohort);
    const inputs = readInputs('family.json');
    assert.equal(inputs.resolvedCohort.path, `${data.manifest.paths.docs}/resolved-cohort.json`);
    assert.equal(parse(generateFamilyReview({ inputs, profileKey: 'lowerBody' })).receipt.inputs.resolvedCohort.sha256,
      sha256(fs.readFileSync(inputs.resolvedCohort.path)));
    const v1 = writeRepo(family());
    process.chdir(v1);
    assert(!('resolvedCohort' in readInputs('manifest.json')));
  } finally {
    process.chdir(cwd);
  }
});
