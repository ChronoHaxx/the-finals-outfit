// Pure preflight for check-family-outfits scenarios. It runs before a browser is launched or an
// evidence folder is created, so a scenario whose screenshots would be mislabelled fails outright.
//
// A same-page step swaps the outfit in place: the page keeps the camera and pose it was opened
// with, which is what lets the fitting restoration and mesh identity checks compare steps. So
// samePage:true is a promise that the step's camera and pose equal the frame already on screen; a
// step that changes either must set samePage:false (or omit it) to open a new page. Nothing here
// reloads silently. The framing recorded for a screenshot is derived from the scenario and the
// navigation performed, never read back from the renderer.
//
// No imports: capture-family.mjs loads the harness, which fixes APP_URL when first imported, so
// its two helpers are mirrored here. tests/outfit-scenario-contract.test.mjs checks their parity.

export const DEFAULT_POSE = 'a';
export const POSES = Object.freeze(['a', 'idle']);
export const FRAMING_BASIS = 'Framing is derived from the scenario and the navigation performed; '
  + 'the renderer camera is not introspected.';

/** True when `name` is a single safe path component (mirrors capture-family.mjs). */
export function isSafeComponent(name) {
  return typeof name === 'string'
    && name.length > 0
    && name !== '.'
    && name !== '..'
    && !name.includes('/')
    && !name.includes('\\')
    && !name.includes('\0')
    && !name.endsWith('.')
    && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)
    && /^[A-Za-z0-9._-]+$/.test(name);
}

/** Parse 'x,y,z,tx,ty,tz' into six finite numbers, or null when malformed (mirrors capture-family.mjs). */
export function parseCamera(camera) {
  if (typeof camera !== 'string') return null;
  const parts = camera.split(',').map(part => part.trim());
  if (parts.length !== 6) return null;
  const numbers = parts.map(part => (part === '' ? Number.NaN : Number(part)));
  if (!numbers.every(Number.isFinite)) return null;
  return numbers;
}

/** Exact numeric equality of two parsed cameras: '1' equals '1.0', and no tolerance is guessed. */
export const sameCamera = (a, b) => a.length === b.length && a.every((value, i) => value === b[i]);

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const show = value => {
  try { return JSON.stringify(value) ?? String(value); } catch { return String(value); }
};

/**
 * Validate a whole scenario sequence without side effects or throwing.
 * Returns { ok, errors, frames }. `frames` has one entry per step when ok, else null:
 *   requested — the step's camera, pose and samePage as written (null means omitted);
 *   effective — 'open' (navigate to a new page) or 'swap' (same page), and the camera and pose of
 *               the page the screenshot is taken on, with the step that opened it.
 */
export function preflightScenarios(scenarios) {
  if (!isRecord(scenarios)) {
    return { ok: false, errors: [`scenarios must be an object with a steps array: ${show(scenarios)}`], frames: null };
  }
  const { steps } = scenarios;
  if (!Array.isArray(steps) || steps.length === 0) {
    return { ok: false, errors: [`scenarios.steps must be a non-empty array: ${show(steps)}`], frames: null };
  }
  const errors = [], frames = [], names = new Map();
  let page = null; // Frame of the open page; null once an earlier error leaves it unknown.
  for (const [index, step] of steps.entries()) {
    const at = `steps[${index}]`;
    if (!isRecord(step)) {
      errors.push(`${at} must be an object: ${show(step)}`);
      page = null;
      continue;
    }
    const named = isSafeComponent(step.name);
    const label = named ? `${at} "${step.name}"` : at;
    if (!named) errors.push(`${at}.name must be a safe file name component: ${show(step.name)}`);
    else {
      // Names become screenshot files, and Windows folders ignore case.
      const key = step.name.toLowerCase();
      if (names.has(key)) errors.push(`${label} reuses the screenshot name of ${names.get(key)} (compared case-insensitively)`);
      else names.set(key, label);
    }
    if (!isRecord(step.slots)) errors.push(`${label}.slots must be an object of slot ids: ${show(step.slots)}`);
    else {
      for (const [slot, id] of Object.entries(step.slots)) {
        if (id !== null && typeof id !== 'string') errors.push(`${label}.slots.${slot} must be an item id or null: ${show(id)}`);
      }
    }
    if (!isRecord(step.expected)) errors.push(`${label}.expected must be an object of visibility booleans: ${show(step.expected)}`);
    else {
      for (const [id, shown] of Object.entries(step.expected)) {
        if (typeof shown !== 'boolean') errors.push(`${label}.expected[${show(id)}] must be true or false: ${show(shown)}`);
      }
    }
    const cameraValues = parseCamera(step.camera);
    if (!cameraValues) errors.push(`${label}.camera must be six finite numbers 'x,y,z,tx,ty,tz': ${show(step.camera)}`);
    const pose = step.pose === undefined ? DEFAULT_POSE : step.pose;
    const posed = POSES.includes(pose);
    if (!posed) errors.push(`${label}.pose must be 'a' or 'idle' (omitted means 'a'): ${show(step.pose)}`);
    if (step.samePage !== undefined && typeof step.samePage !== 'boolean') {
      errors.push(`${label}.samePage must be true, false or omitted: ${show(step.samePage)}`);
    }
    const framed = cameraValues !== null && posed;
    // The first step has no page to keep, so it always opens one, whatever samePage says.
    const swap = index > 0 && step.samePage === true;
    if (!swap) page = framed ? { camera: step.camera, cameraValues, pose, from: label } : null;
    else if (page && framed) {
      const changes = [];
      if (!sameCamera(cameraValues, page.cameraValues)) changes.push(`camera ${show(step.camera)} (page has ${show(page.camera)})`);
      if (pose !== page.pose) changes.push(`pose ${show(pose)} (page has ${show(page.pose)})`);
      if (changes.length) {
        errors.push(`${label} has samePage:true but requests ${changes.join(' and ')}; a swap keeps the frame `
          + `opened by ${page.from}, so the screenshot would not show the requested frame. `
          + 'Set samePage:false to open a new page at this frame.');
      }
    }
    if (page) {
      frames.push({
        name: step.name,
        requested: { camera: step.camera, pose: step.pose ?? null, samePage: step.samePage ?? null },
        effective: { navigation: swap ? 'swap' : 'open', camera: page.camera, cameraValues: [...page.cameraValues],
          pose: page.pose, frameFrom: page.from },
        ...(index === 0 && step.samePage === true ? { note: 'The first step always opens a page.' } : {}),
      });
    }
  }
  const ok = errors.length === 0;
  return { ok, errors, frames: ok ? frames : null };
}
