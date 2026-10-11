// Pure URL routing shared by the runtime (assets.ts) and the release validator
// (scripts/lib/catalog-host-groups.mjs), so CI checks the host a browser will actually
// fetch from. Dependency-free on purpose: Vite bundles it and Node imports it as-is.

// Reconstruction files live under models/reconstructed/ and the versioned
// models/reconstructed-*/ roots; models/reconstructedness/ is not one of them.
const RECONSTRUCTION_PATH = /^\/*models\/reconstructed[-/]/;
const MODEL_PATH = /^\/*models\//;

export const isModelPath = path => MODEL_PATH.test(path);
export const isReconstructionPath = path => RECONSTRUCTION_PATH.test(path);

// Tolerates a base with or without a trailing slash, and a path with or without a
// leading one, so a mis-punctuated env var cannot produce "//" or a missing "/".
export function joinBase(base, path) {
  return base.trim().replace(/\/*$/, '/') + path.replace(/^\/+/, '');
}

// Optional immutable host map, emitted by the adaptive shard planner. Prefixes
// include a whole directory boundary: one family can never shadow a sibling.
export function parseReconstructionRoutes(value) {
  let routes = typeof value === 'string' ? (value.trim() ? JSON.parse(value) : {}) : value ?? {};
  if (routes?.formatVersion === 1 && Array.isArray(routes.hosts)) {
    const expanded = Object.create(null);
    for (const host of routes.hosts) {
      if (!host || !Array.isArray(host.prefixes)) throw new Error('Invalid reconstruction host group');
      for (const prefix of host.prefixes) {
        if (Object.hasOwn(expanded, prefix)) throw new Error(`Duplicate reconstruction route: ${prefix}`);
        expanded[prefix] = host.baseUrl;
      }
    }
    routes = expanded;
  }
  if (!routes || typeof routes !== 'object' || Array.isArray(routes)) throw new Error('Invalid reconstruction routes');
  for (const [prefix, base] of Object.entries(routes)) {
    if (!/^models\/reconstructed[-/][a-zA-Z0-9_./-]+$/.test(prefix) || prefix.split('/').some(p => p === '..' || p === '.'))
      throw new Error(`Invalid reconstruction route prefix: ${prefix}`);
    const url = new URL(base);
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))
      || url.username || url.password || url.search || url.hash) throw new Error(`Invalid reconstruction host: ${prefix}`);
  }
  return Object.fromEntries(Object.entries(routes).sort(([a], [b]) => b.length - a.length || a.localeCompare(b))
    .map(([prefix, base]) => [prefix, base.trim().replace(/\/*$/, '/') ]));
}

// Avoid repeating a long deployment URL for hundreds of family directories in a
// build environment variable. The expanded and compact representations agree.
export function compactReconstructionRoutes(value) {
  const groups = new Map();
  for (const [prefix, baseUrl] of Object.entries(parseReconstructionRoutes(value))) {
    if (!groups.has(baseUrl)) groups.set(baseUrl, []);
    groups.get(baseUrl).push(prefix);
  }
  return { formatVersion: 1, hosts: [...groups].map(([baseUrl, prefixes]) => ({ baseUrl, prefixes })) };
}

// modelUrl's host: the reconstruction override for reconstruction files, else the
// models override, else the asset default. A blank reconstruction override is unset.
export function modelBase(path, { assetsBase, modelsBase, reconstructionBase, reconstructionRoutes }) {
  const relative = path.replace(/^\/+/, '');
  let selected, length = -1;
  for (const [prefix, base] of Object.entries(reconstructionRoutes ?? {}))
    if (prefix.length > length && (relative === prefix || (prefix.endsWith('/') && (relative.startsWith(prefix) || relative === prefix.slice(0, -1))))) {
      selected = base; length = prefix.length;
    }
  if (selected) return selected;
  const reconstruction = reconstructionBase?.trim();
  return reconstruction && isReconstructionPath(path) ? reconstruction : modelsBase?.trim() || assetsBase.trim();
}

export function modelUrlFor(path, bases) {
  return joinBase(modelBase(path, bases), path);
}
