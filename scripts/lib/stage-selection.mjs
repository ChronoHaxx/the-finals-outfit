import { isModelPath, isReconstructionPath } from '../../src/lib/asset-routing.mjs';

// Pure package selection and Cloudflare Pages Free preflight for stage-assets.mjs.
// A release may span any number of deployments; each package must fit one of them.

const MODES = { '--models-only': 'models', '--reconstruction-only': 'reconstruction', '--icons-only': 'icons' };
const MiB = 1024 * 1024;
// manifest.json and _headers are generated; one more is held back for platform files.
export const PAGES_FREE = { maxFiles: 20000, reservedFiles: 3, maxFileBytes: 25 * MiB };

export function stageMode(args) {
  const flags = [...new Set(args.filter(arg => arg.startsWith('--')))];
  const unknown = flags.filter(flag => !Object.hasOwn(MODES, flag));
  if (unknown.length) throw new Error(`Unknown option: ${unknown.join(', ')}`);
  if (flags.length > 1) {
    throw new Error(`${flags.join(' and ')} are mutually exclusive; stage each shard as its own version.`);
  }
  return flags.length ? MODES[flags[0]] : 'all';
}

// all: catalog + companions + reconstruction closure. models: the models/ subset of that.
// icons: the catalog and companion paths outside models/, the ASSETS_BASE host's share once
// models and reconstruction have their own hosts (new item icons without re-uploading 3D).
// reconstruction: catalog and companion paths the router sends to the reconstruction
// host, plus the whole closure, including relative dependencies outside the prefix
// (body masks), which are duplicated here so relative URLs resolve on this host.
export function selectStagePaths(mode, { catalog, companions, reconstruction }) {
  if (mode === 'reconstruction') {
    return new Set([...[...catalog, ...companions].filter(isReconstructionPath), ...reconstruction]);
  }
  if (mode === 'icons') return new Set([...catalog, ...companions].filter(path => !isModelPath(path)));
  const all = new Set([...catalog, ...companions, ...reconstruction]);
  return mode === 'models' ? new Set([...all].filter(path => path.startsWith('models/'))) : all;
}

export function preflightPackage(mode, paths, sizeOf, limits = PAGES_FREE) {
  const list = [...paths], problems = [];
  const files = list.length + limits.reservedFiles;
  if (files > limits.maxFiles) {
    problems.push(`${list.length} files + ${limits.reservedFiles} reserved = ${files} exceeds ${limits.maxFiles}`);
  }
  const oversize = list.map(path => [path, sizeOf(path)]).filter(([, size]) => size > limits.maxFileBytes);
  if (oversize.length) {
    problems.push(`${oversize.length} file(s) over ${limits.maxFileBytes / MiB} MiB: ` +
      oversize.slice(0, 10).map(([path, size]) => `${path} (${(size / MiB).toFixed(1)} MiB)`).join(', '));
  }
  if (!problems.length) return;
  throw new Error([
    `The '${mode}' package does not fit one Cloudflare Pages Free deployment:`,
    ...problems.map(problem => `  - ${problem}`),
    'Nothing was staged. Split the referenced asset graph across as many deployments as it needs:',
    '  - give each new deployment its own path prefix and route it in src/lib/asset-routing.mjs,',
    '    scripts/lib/catalog-host-groups.mjs and this selection, so runtime and validator agree;',
    '  - keep files that reference each other by relative URL in one deployment, or duplicate',
    '    the dependency into every deployment that references it;',
    '  - keep every active catalog reference published: do not drop items or ship a partial package.',
    ...(oversize.length ? ['Oversized files cannot be fixed by splitting; they need a smaller encoding from the ' +
      'asset pipeline, with references updated, before release.'] : []),
  ].join('\n'));
}
