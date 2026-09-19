#!/usr/bin/env node
// generate-family-review.mjs — deterministic review configs for one ordinary family: a schemaVersion 1
// single mesh, or an opt-in schemaVersion 2 multipart family (see freeze-multipart-family.mjs).
//
// Reads a family manifest, its docs/cohort.json, preview/preview.json and catalog plus one slot
// profile from review-profiles.json, and writes variants.json, geometry-a.json, geometry-idle.json
// and outfits.json for the unchanged run-family-review.mjs, with a provenance receipt. A multipart
// family also reads docs/resolved-cohort.json, the frozen per-component bindings, and every row
// binds all of its components and materials in source part order.
//
// Profiles are baseline framing, not family-specific regression scenarios. Nothing is rendered,
// replayed or activated here, and visual/human acceptance stay 'pending' for Astra.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { defaultAngles, isSafeComponent, parseCamera, validateConfig } from './capture-family.mjs';
import { manifestSha } from './freeze-family.mjs';
import { assertCohort as assertMultipartCohort, validateManifest as validateMultipartManifest } from './freeze-multipart-family.mjs';

export const TOOL = 'generate-family-review';
export const PROFILES_FILE = fileURLToPath(new URL('./review-profiles.json', import.meta.url));
export const RECEIPT_FILE = 'receipt.json';
export const USAGE = 'Usage: node scripts/shader-probe/generate-family-review.mjs '
  + 'MANIFEST PROFILE_KEY NEW_OUTPUT [--representative ID] [--alternate ID]';
export const LIMITATIONS = Object.freeze([
  'Baseline slot profile only: cameras and base outfit are shared data, not measured for this family; every screenshot still needs visual review.',
  'Not a replacement for family-specific regression, fitting or occlusion scenarios; add them where the family meets other slots or accessories.',
  'Expected visibility is declared only for the chosen family items; base outfit items, fitting tags and accessories carry no visibility promise.',
  'variants.json holds binding rows for every cohort candidate; run-family-review.mjs captures only implemented IDs (see eligibleCaptures).',
  'Generated from metadata only: no rendering, source, GPU or index verification was replayed, and nothing was activated.',
  'Passing generated reviews does not establish fitting correctness, visual fidelity or human acceptance.',
]);
export const MULTIPART_LIMITATIONS = Object.freeze([
  'Multipart: every row binds all components in source part order, but capture-family.mjs compares only the aggregate mesh/material sets; per-component source index, mesh, material and morph checks run in check-family-outfits.mjs.',
]);

// Unreal object path whose object name repeats the package name: /Game/.../Name.Name
const SOURCE_PATH = /^\/Game(?:\/[A-Za-z0-9_-]+)*\/([A-Za-z0-9_-]+)\.\1$/;
const INPUT_KEYS = ['manifest', 'cohort', 'preview', 'catalog', 'profiles'];
const MULTIPART_INPUT_KEYS = [...INPUT_KEYS, 'resolvedCohort'];
const inputKeys = manifest => (manifest.schemaVersion === 2 ? MULTIPART_INPUT_KEYS : INPUT_KEYS);
const PROFILE_FIELDS = ['slot', 'framing', 'captureCamera', 'idleCapture', 'baseOutfit', 'outfitCameras', 'extraViews', 'notes'];
const VIEW_FIELDS = ['name', 'camera', 'pose', 'withoutSlots'];
const BUILT_IN_STEPS = ['equip', 'switch', 'remove', 'restore', 'idle', 'rear'];

const ordinal = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const toJson = value => `${JSON.stringify(value, null, 2)}\n`;
const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isSourcePath = value => typeof value === 'string' && SOURCE_PATH.test(value);
const isRelativePath = value => typeof value === 'string' && value.length > 0
  && !/^(?:[\\/]|[A-Za-z]:)/.test(value) && !value.split(/[\\/]/).includes('..');
const displayPath = file => path.relative(process.cwd(), path.resolve(file)).split(path.sep).join('/');

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function checkFields(value, allowed, where) {
  const unknown = Object.keys(value).filter(key => !allowed.includes(key));
  check(unknown.length === 0, `${where} has unsupported fields: ${unknown.join(', ')}`);
}

// ---------------------------------------------------------------------------------------------
// Inputs. Every input keeps the SHA256 of the exact bytes that were parsed.
// ---------------------------------------------------------------------------------------------

export function describeInput(file, bytes) {
  let data;
  try {
    data = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch (error) {
    throw new Error(`malformed JSON in ${file}: ${error.message}`);
  }
  return { path: file, sha256: sha256(bytes), data };
}

function readInput(file, label) {
  let bytes;
  try {
    bytes = fs.readFileSync(file);
  } catch (error) {
    throw new Error(`cannot read ${label} ${file}: ${error.code ?? error.message}`);
  }
  return describeInput(displayPath(file), bytes);
}

function validateManifest(manifest) {
  if (isObject(manifest) && manifest.schemaVersion === 2) {
    // The same exact accept/reject rules as the multipart freeze and prepare stages.
    try {
      validateMultipartManifest(manifest);
    } catch (error) {
      throw new Error(`invalid schemaVersion 2 manifest: ${error.message}`);
    }
    return manifest;
  }
  check(isObject(manifest) && manifest.schemaVersion === 1,
    'manifest must be a schemaVersion 1 object (or a schemaVersion 2 multipart manifest)');
  check(isSafeComponent(manifest.id), `manifest.id must be a safe name: ${JSON.stringify(manifest.id)}`);
  check(isObject(manifest.paths), 'manifest.paths must be an object');
  for (const key of ['docs', 'preview', 'catalog']) {
    check(isRelativePath(manifest.paths[key]), `manifest.paths.${key} must be a repository-relative path`);
  }
  const mesh = manifest.mesh;
  check(isObject(mesh) && typeof mesh.itemSlot === 'string' && mesh.itemSlot.length > 0,
    'manifest.mesh.itemSlot is required');
  check(isSourcePath(mesh.source), `malformed manifest mesh source path: ${JSON.stringify(mesh.source)}`);
  check(mesh.facts?.materialSections === 1, 'unsupported shape: the manifest mesh must have exactly one material section');
  return manifest;
}

/** Read the manifest, then the cohort, preview and catalog it names (repository-relative) and the profiles. */
export function readInputs(manifestFile, profilesFile = PROFILES_FILE) {
  const manifest = readInput(manifestFile, 'manifest');
  const { paths, schemaVersion } = validateManifest(manifest.data);
  return {
    manifest,
    cohort: readInput(`${paths.docs}/cohort.json`, 'cohort'),
    preview: readInput(`${paths.preview}/preview.json`, 'preview'),
    catalog: readInput(paths.catalog, 'catalog'),
    profiles: readInput(profilesFile, 'profiles'),
    ...(schemaVersion === 2 ? { resolvedCohort: readInput(`${paths.docs}/resolved-cohort.json`, 'resolved cohort') } : {}),
  };
}

// ---------------------------------------------------------------------------------------------
// Validation. Everything is checked before any output exists.
// ---------------------------------------------------------------------------------------------

/** Source mesh components in exact source part order; a schemaVersion 1 mesh is the only component. */
function familyComponents(manifest) {
  if (manifest.schemaVersion !== 2) return [{ source: manifest.mesh.source }];
  return manifest.components.map(({ sourceIndex, source, slot }) => ({ sourceIndex, source, slot }));
}

/** The frozen resolver output must bind each component through its own explicit override to the cohort material. */
function validateResolvedCohort(resolved, manifest, cohort, components) {
  check(isObject(resolved), 'resolved cohort must be an object');
  check(resolved.manifestSha256 === manifestSha(manifest), 'resolved cohort was frozen from a different manifest');
  check(JSON.stringify(resolved.meshes) === JSON.stringify(cohort.meshes), 'resolved cohort meshes differ from the cohort');
  const ids = cohort.items.map(item => item.id);
  check(Array.isArray(resolved.items) && JSON.stringify(resolved.items.map(row => row?.id)) === JSON.stringify(ids),
    'resolved cohort items are not exactly the cohort items in order');
  resolved.items.forEach((row, n) => {
    const item = cohort.items[n];
    check(row.slot === item.slot && JSON.stringify(row.materials) === JSON.stringify(item.materials),
      `resolved cohort item ${item.id} differs from the cohort`);
    check(Array.isArray(row.effectiveParts) && row.effectiveParts.length === components.length,
      `resolved cohort item ${item.id} does not bind exactly the ${components.length} manifest components`);
    components.forEach((component, i) => {
      const part = row.effectiveParts[i];
      const where = `resolved cohort item ${item.id} component ${component.sourceIndex}`;
      check(isObject(part) && part.sourceIndex === component.sourceIndex && part.mesh === component.source,
        `${where} is not the manifest component in source part order: ${JSON.stringify([part?.sourceIndex, part?.mesh])}`);
      check(part.binding === 'explicit-override', `${where} is not bound by an explicit item override: ${JSON.stringify(part.binding)}`);
      check(Array.isArray(part.slots) && part.slots.length === 1 && part.slots[0]?.slot === component.slot
        && part.slots[0]?.material === item.materials[i],
      `${where} binds ${JSON.stringify(part.slots)}, not ${component.slot} = ${item.materials[i]}`);
    });
  });
}

function validateFamily(manifest, cohort, preview, catalog, resolved) {
  const multipart = manifest.schemaVersion === 2;
  const slot = multipart ? manifest.itemSlot : manifest.mesh.itemSlot;
  const components = familyComponents(manifest);
  const meshes = components.map(component => component.source);
  check(Array.isArray(catalog), 'catalog must be an array');
  const catalogById = new Map();
  for (const entry of catalog) {
    check(isObject(entry) && typeof entry.id === 'string' && typeof entry.slot === 'string',
      'catalog entries need an id and slot');
    check(!catalogById.has(entry.id), `duplicate catalog id: ${entry.id}`);
    catalogById.set(entry.id, entry);
  }

  check(isObject(cohort), 'cohort must be an object');
  if (multipart) {
    check(Array.isArray(cohort.meshes) && JSON.stringify(cohort.meshes) === JSON.stringify(meshes),
      `cohort meshes ${JSON.stringify(cohort.meshes)} are not exactly the manifest components in source part order`);
    check(!cohort.attached, 'unsupported shape: the cohort is an attached family');
  } else {
    check(Array.isArray(cohort.meshes) && cohort.meshes.length === 1, 'unsupported shape: the cohort must bind exactly one mesh');
    check(cohort.meshes[0] === manifest.mesh.source, `cohort mesh does not match the manifest mesh: ${cohort.meshes[0]}`);
  }
  check(Array.isArray(cohort.items) && cohort.items.length > 0, 'cohort.items must be a nonempty array');
  const materials = new Map();
  const seen = new Set();
  for (const item of cohort.items) {
    check(isObject(item) && isSafeComponent(item.id), `cohort item id must be a safe name: ${JSON.stringify(item?.id)}`);
    check(!seen.has(item.id.toLowerCase()), `duplicate cohort id: ${item.id}`);
    seen.add(item.id.toLowerCase());
    check(item.slot === slot, `cohort item ${item.id} slot ${JSON.stringify(item.slot)} does not match manifest item slot ${slot}`);
    check(item.meshes === undefined, `unsupported shape: cohort item ${item.id} declares its own meshes`);
    if (multipart) {
      check(Array.isArray(item.materials) && item.materials.length === meshes.length,
        `cohort item ${item.id} must name exactly one material per component (${meshes.length}), in component order`);
    } else {
      check(Array.isArray(item.materials) && item.materials.length === 1,
        `unsupported shape: cohort item ${item.id} must have exactly one material`);
    }
    for (const material of item.materials) {
      check(isSourcePath(material), `malformed source material path for ${item.id}: ${JSON.stringify(material)}`);
    }
    check(catalogById.has(item.id), `unknown catalog id: ${item.id}`);
    check(catalogById.get(item.id).slot === slot, `wrong catalog slot for ${item.id}: ${catalogById.get(item.id).slot}`);
    materials.set(item.id, [...item.materials]);
  }
  if (cohort.count !== undefined) check(cohort.count === materials.size, 'cohort.count does not match cohort.items');
  if (cohort.materials !== undefined) {
    const sorted = values => JSON.stringify([...new Set(values)].sort(ordinal));
    check(Array.isArray(cohort.materials) && sorted(cohort.materials) === sorted([...materials.values()].flat()),
      'cohort.materials does not match the item materials');
  }
  if (multipart) {
    try {
      assertMultipartCohort(cohort, { components, itemSlot: slot });
    } catch (error) {
      throw new Error(`invalid multipart cohort: ${error.message}`);
    }
    validateResolvedCohort(resolved, manifest, cohort, components);
  }

  check(isObject(preview) && Array.isArray(preview.implemented), 'malformed preview: implemented must be an array');
  const implemented = new Set();
  for (const id of preview.implemented) {
    check(materials.has(id), `unknown implemented id: ${JSON.stringify(id)}`);
    check(!implemented.has(id), `duplicate implemented id: ${id}`);
    implemented.add(id);
  }
  check(implemented.size > 0, 'preview implements no candidates; nothing to review');

  const ids = [...materials.keys()].sort(ordinal);
  return {
    slot,
    multipart,
    components,
    meshes,
    materials,
    catalogById,
    ids,
    eligible: ids.filter(id => implemented.has(id)),
    excluded: ids.filter(id => !implemented.has(id)),
  };
}

function validateProfile(profiles, key, family) {
  check(isObject(profiles) && profiles.schemaVersion === 1 && isObject(profiles.profiles),
    'review profiles must be a schemaVersion 1 object with profiles');
  checkFields(profiles, ['schemaVersion', 'description', 'path', 'profiles'], 'review profiles');
  check(Object.hasOwn(profiles.profiles, key), `unknown review profile: ${JSON.stringify(key)}`);
  const profile = profiles.profiles[key];
  const where = `profile ${key}`;
  check(isObject(profile), `${where} must be an object`);
  checkFields(profile, PROFILE_FIELDS, where);
  check(profile.slot === family.slot, `${where} reviews ${JSON.stringify(profile.slot)}, but the family slot is ${family.slot}`);
  check(['root', 'positive-x-item'].includes(profile.framing), `${where} framing must be 'root' or 'positive-x-item'`);
  check(parseCamera(profile.captureCamera), `${where} captureCamera is malformed`);
  if (profile.idleCapture !== undefined) {
    check(isObject(profile.idleCapture), `${where} idleCapture must be an object`);
    checkFields(profile.idleCapture, ['camera', 'framing'], `${where} idleCapture`);
    check(parseCamera(profile.idleCapture.camera), `${where} idleCapture camera is malformed`);
    check(['root', 'positive-x-item'].includes(profile.idleCapture.framing), `${where} idleCapture framing is invalid`);
  }

  check(isObject(profile.baseOutfit), `${where} baseOutfit must map slot -> id`);
  check(!Object.hasOwn(profile.baseOutfit, family.slot), `${where} baseOutfit must exclude the reviewed slot ${family.slot}`);
  for (const [slot, id] of Object.entries(profile.baseOutfit)) {
    check(family.catalogById.get(id)?.slot === slot, `${where} baseOutfit: unknown item or wrong slot ${slot}=${id}`);
  }

  // Rear shots use a camera behind the target: the outfit harness ignores any yaw field.
  check(isObject(profile.outfitCameras), `${where} outfitCameras must be an object`);
  checkFields(profile.outfitCameras, ['front', 'rear'], `${where} outfitCameras`);
  const front = parseCamera(profile.outfitCameras.front);
  const rear = parseCamera(profile.outfitCameras.rear);
  check(front && front[2] > front[5], `${where} front camera must sit in front of its target`);
  check(rear && rear[2] < rear[5], `${where} rear camera must sit behind its target`);

  check(Array.isArray(profile.extraViews), `${where} extraViews must be an array`);
  const names = new Set(BUILT_IN_STEPS);
  for (const view of profile.extraViews) {
    check(isObject(view) && isSafeComponent(view.name), `${where} extra view names must be safe`);
    checkFields(view, VIEW_FIELDS, `${where} view ${view.name}`);
    check(!names.has(view.name.toLowerCase()), `${where} duplicate step name: ${view.name}`);
    names.add(view.name.toLowerCase());
    check(parseCamera(view.camera), `${where} view ${view.name} camera is malformed`);
    check(view.pose === undefined || ['a', 'idle'].includes(view.pose), `${where} view ${view.name} pose must be 'a' or 'idle'`);
    const without = view.withoutSlots ?? [];
    check(Array.isArray(without) && without.every(slot => Object.hasOwn(profile.baseOutfit, slot))
      && new Set(without).size === without.length,
    `${where} view ${view.name} withoutSlots must name distinct baseOutfit slots`);
  }
  check(profile.notes === undefined || (Array.isArray(profile.notes)
    && profile.notes.every(note => typeof note === 'string' && note.length > 0)), `${where} notes must be strings`);
  return profile;
}

/** Explicit choices must be eligible and distinct; defaults follow the ordinal ID order. */
function chooseSelections(family, { representative, alternate }) {
  for (const [flag, id] of [['--representative', representative], ['--alternate', alternate]]) {
    if (id === undefined) continue;
    check(family.materials.has(id), `${flag} ${JSON.stringify(id)} is not a cohort candidate`);
    check(family.eligible.includes(id), `${flag} ${id} is deferred: it is not implemented in the preview`);
  }
  check(representative === undefined || representative !== alternate, '--representative and --alternate must differ');
  const chosen = representative ?? family.eligible[0];
  check(chosen !== alternate, '--alternate matches the default representative; choose a different --alternate or set --representative explicitly');
  const next = alternate ?? family.eligible.find(id => id !== chosen);
  return {
    representative: { id: chosen, selection: representative === undefined ? 'default' : 'explicit' },
    alternate: next === undefined ? null : { id: next, selection: alternate === undefined ? 'default' : 'explicit' },
  };
}

// ---------------------------------------------------------------------------------------------
// Generation. Pure: identical inputs give identical bytes.
// ---------------------------------------------------------------------------------------------

function outfitSteps(family, profile, representative, alternate) {
  const { front, rear } = profile.outfitCameras;
  const plan = [
    { name: 'equip', camera: front, pose: 'a', item: representative },
    ...(alternate ? [{ name: 'switch', camera: front, pose: 'a', item: alternate }] : []),
    { name: 'remove', camera: front, pose: 'a', item: null },
    { name: 'restore', camera: front, pose: 'a', item: representative },
    { name: 'idle', camera: front, pose: 'idle', item: representative },
    { name: 'rear', camera: rear, pose: 'a', item: representative },
    ...profile.extraViews.map(view => ({ name: view.name, camera: view.camera, pose: view.pose ?? 'a',
      item: representative, without: view.withoutSlots ?? [] })),
  ];
  const choices = [representative, alternate].filter(Boolean);
  let previous = null;
  return plan.map(({ name, camera, pose, item, without = [] }) => {
    const slots = Object.fromEntries(Object.entries(profile.baseOutfit).filter(([slot]) => !without.includes(slot)));
    if (item) slots[family.slot] = item;
    // Swap in place only when the page already shows this exact camera and pose.
    const samePage = previous !== null && previous.camera === camera && previous.pose === pose;
    const expected = Object.fromEntries(choices.map(id => [id, slots[family.slot] === id]));
    previous = { name, samePage, camera, pose, slots, expected };
    return previous;
  });
}

/**
 * Build every output file as text. `inputs` holds { path, sha256, data } for manifest, cohort,
 * preview, catalog and profiles (see readInputs/describeInput). Throws on any invalid input.
 */
export function generateFamilyReview({ inputs, profileKey, representative, alternate }) {
  const present = key => isObject(inputs?.[key]) && typeof inputs[key].sha256 === 'string';
  for (const key of INPUT_KEYS) check(present(key), `missing ${key} input`);
  const manifest = validateManifest(inputs.manifest.data);
  const keys = inputKeys(manifest);
  for (const key of keys) check(present(key), `missing ${key} input`);
  const family = validateFamily(manifest, inputs.cohort.data, inputs.preview.data, inputs.catalog.data,
    inputs.resolvedCohort?.data);
  const profile = validateProfile(inputs.profiles.data, profileKey, family);
  const chosen = chooseSelections(family, { representative, alternate });

  // Every row carries the full component and material arrays, in source part order.
  const binding = id => ({ id, slot: family.slot, meshes: [...family.meshes], materials: [...family.materials.get(id)] });
  const capture = (ids, pose, angles) => validateConfig({
    items: ids.map(binding),
    baseOutfit: profile.baseOutfit,
    camera: pose === 'idle' && profile.idleCapture ? profile.idleCapture.camera : profile.captureCamera,
    path: inputs.profiles.data.path,
    angles,
    pose,
    framing: pose === 'idle' && profile.idleCapture ? profile.idleCapture.framing : profile.framing,
  });
  const frontBack = defaultAngles().filter(angle => angle.name === 'front' || angle.name === 'back');
  const representativeId = chosen.representative.id;
  const alternateId = chosen.alternate?.id ?? null;
  const steps = outfitSteps(family, profile, representativeId, alternateId);
  const files = {
    'variants.json': toJson(capture(family.ids, 'a', frontBack)),
    'geometry-a.json': toJson(capture([representativeId], 'a', defaultAngles())),
    'geometry-idle.json': toJson(capture([representativeId], 'idle', defaultAngles())),
    'outfits.json': toJson({ steps }),
  };

  const receipt = {
    tool: TOOL,
    family: manifest.id,
    ...(family.multipart ? { schemaVersion: 2, components: family.components } : {}),
    profile: { key: profileKey, slot: profile.slot, framing: profile.framing },
    inputs: Object.fromEntries(keys.map(key => [key, { path: inputs[key].path, sha256: inputs[key].sha256 }])),
    outputs: Object.fromEntries(Object.entries(files).map(([name, text]) => [name, { sha256: sha256(text) }])),
    candidateRows: {
      file: 'variants.json',
      ids: family.ids,
      note: 'Exact mesh/material binding rows for every cohort candidate, not captures; the runner filters them to implemented IDs.',
    },
    implementedIds: family.eligible,
    excludedIds: family.excluded,
    eligibleCaptures: {
      variants: family.eligible,
      'geometry-a': [representativeId],
      'geometry-idle': [representativeId],
    },
    representative: chosen.representative,
    alternate: chosen.alternate,
    outfitSteps: steps.map(step => step.name),
    switchStep: alternateId ? 'included'
      : 'omitted: only one eligible candidate, so there is no distinct alternate; equip, remove and restore still run',
    limitations: [...LIMITATIONS, ...(family.multipart ? MULTIPART_LIMITATIONS : []), ...(profile.notes ?? [])],
    visualAcceptance: 'pending',
    humanAcceptance: 'pending',
  };
  return { ...files, [RECEIPT_FILE]: toJson(receipt) };
}

// ---------------------------------------------------------------------------------------------
// Output and entry point.
// ---------------------------------------------------------------------------------------------

/** Output must be new and must not sit inside the manifest's index, work or input folders. */
export function assertOutputLocation(output, manifest) {
  const target = path.resolve(output);
  check(!fs.existsSync(target), `refusing to reuse an existing output: ${output}`);
  for (const [key, value] of Object.entries(manifest.paths)) {
    if (key === 'docs' || key === 'appUrl' || typeof value !== 'string') continue;
    const relative = path.relative(path.resolve(value), target);
    const outside = relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
    check(relative !== '' && outside, `output must not be inside manifest.paths.${key}: ${output}`);
  }
  return target;
}

export function writeFamilyReview(output, files) {
  const target = path.resolve(output);
  check(!fs.existsSync(target), `refusing to reuse an existing output: ${output}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.mkdirSync(target);
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(target, name), text, { flag: 'wx' });
  return target;
}

export function parseArgs(argv) {
  const positional = [];
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--representative' || arg === '--alternate') {
      const key = arg.slice(2);
      const value = argv[index + 1];
      check(!Object.hasOwn(options, key), `${arg} given more than once`);
      check(value !== undefined && !value.startsWith('--'), `missing value for ${arg}`);
      options[key] = value;
      index += 1;
    } else {
      check(!arg.startsWith('--'), `unknown option: ${arg}\n${USAGE}`);
      positional.push(arg);
    }
  }
  check(positional.length === 3, USAGE);
  const [manifest, profileKey, output] = positional;
  return { manifest, profileKey, output, ...options };
}

export function main(argv = process.argv.slice(2)) {
  try {
    const args = parseArgs(argv);
    check(!fs.existsSync(args.output), `refusing to reuse an existing output: ${args.output}`);
    const inputs = readInputs(args.manifest);
    const files = generateFamilyReview({ inputs, ...args });
    const receipt = JSON.parse(files[RECEIPT_FILE]);
    receipt.implementation = Object.fromEntries([
      'generate-family-review.mjs', 'capture-family.mjs', 'coverage-preview-harness.mjs',
      ...(receipt.schemaVersion === 2 ? ['freeze-multipart-family.mjs', 'freeze-family.mjs'] : []),
    ].map(name => {
      const file = fileURLToPath(new URL(`./${name}`, import.meta.url));
      return [name, { path: displayPath(file), sha256: sha256(fs.readFileSync(file)) }];
    }));
    files[RECEIPT_FILE] = toJson(receipt);
    assertOutputLocation(args.output, inputs.manifest.data);
    writeFamilyReview(args.output, files);
    console.log(JSON.stringify({ tool: TOOL, family: receipt.family, profile: args.profileKey, output: args.output,
      candidates: receipt.candidateRows.ids.length, eligible: receipt.implementedIds.length,
      representative: receipt.representative.id, alternate: receipt.alternate?.id ?? null }));
    return 0;
  } catch (error) {
    console.error(`${TOOL}: ${error.message}`);
    return 2;
  }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) process.exitCode = main();
