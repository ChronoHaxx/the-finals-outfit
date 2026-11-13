// Local preview for Chinals mode (12 Nov 2026, README.md beside this file). App code from this worktree, the game
// assets from the main checkout's public/ (read-only, read whole per request), /animations/ from a local folder with
// files missing there fetched from --proxy (e.g. the live global animations host), and /chinals-animations/ from
// --chinals. Nothing here is published.
//
// Run from the worktree root (PowerShell; from Git Bash put MSYS_NO_PATHCONV=1 in front, or Git Bash rewrites the
// /chinals-animations/ value into a Windows path):
//   $env:VITE_CHINALS_ANIMATIONS_BASE = '/chinals-animations/'
//   node _docs/chinals-mode-2026-11-12/serve-preview.mjs --set=<empty folder> --proxy=<global animations host>
//     --chinals=scripts/generated/chinals-emotes --port=5191
// Without the variable (and without --chinals) the app runs with Chinals mode off.
import { createServer, searchForWorkspaceRoot } from 'vite';
import { readFile, stat } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const checkout = path.resolve(root, '../../..'); // E:\Coding\the-finals-outfit (the main checkout)
const publicDir = path.join(checkout, 'public');
// The pilot's animations folder: manifest.json (written by convert-clips --activate) points at set-2/ and props-1/.
const setArg = process.argv.find((a) => a.startsWith('--set='))?.slice(6);
if (!setArg) throw new Error('--set=<folder> is required (an empty folder plus --proxy serves the live global set)');
const pilotSet = path.resolve(root, setArg);
// --proxy=<url>: an /animations/ file missing from that folder is fetched from <url> (e.g. the live global host), so a
// local props.json can override one file of a published set. Read-only; nothing is written to disk.
const proxy = process.argv.find((a) => a.startsWith('--proxy='))?.slice(8);
console.log(`/animations/ -> ${pilotSet}${proxy ? ` (missing files from ${proxy})` : ''}`);
// --chinals=<dir> (12 Nov 2026, Chinals mode): serves that folder at /chinals-animations/. Start the server with
// VITE_CHINALS_ANIMATIONS_BASE=/chinals-animations/ so the app shows the Global | Chinals switch. --port=<n> (default 5190).
const chinalsArg = process.argv.find((a) => a.startsWith('--chinals='))?.slice(10);
const chinalsSet = chinalsArg ? path.resolve(root, chinalsArg) : null;
if (chinalsSet) console.log(`/chinals-animations/ -> ${chinalsSet}`);
const port = Number(process.argv.find((a) => a.startsWith('--port='))?.slice(7) ?? 5190);
// [prefix, base folder, required extension, 404 when missing, strip prefix]
const inMemory = [
  ...(chinalsSet ? [['/chinals-animations/', chinalsSet, '', true, true]] : []),
  ['/src/data/', root, '.json', true, false],
  ['/animations/', pilotSet, '', true, true],
  ['/models/', publicDir, '', true, false],
  ['/items/', publicDir, '', true, false],
  ['/', publicDir, '', false, false],
];
const types = {
  '.json': 'application/json', '.glb': 'model/gltf-binary', '.bin': 'application/octet-stream', '.webp': 'image/webp',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.gz': 'application/gzip',
  '.glsl': 'text/plain; charset=utf-8', '.asm': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
};
const plugin = {
  name: 'chinals-mode-in-memory-files',
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      const [pathname, query = ''] = (req.url ?? '').split('?');
      const route = inMemory.find(([prefix, , ext]) => pathname.startsWith(prefix) && pathname.endsWith(ext));
      if ((req.method !== 'GET' && req.method !== 'HEAD') || /(^|&)import(=|&|$)/.test(query) || !route) return next();
      const [prefix, base, , required, strip] = route;
      let file;
      try { file = path.join(base, decodeURIComponent(strip ? pathname.slice(prefix.length) : pathname)); } catch { return next(); }
      if (!file.startsWith(base + path.sep)) return next();
      if (!required && !(await stat(file).then((s) => s.isFile(), () => false))) return next();
      let body;
      try { body = await readFile(file); } catch {
        if (!(proxy && prefix === '/animations/')) { res.statusCode = 404; return res.end(); }
        // Only a plain relative path under the proxy's own folder: "//host/x", "..", "%2e%2e" or a scheme in the request
        // must never turn this into a fetch from another host (security review, 12 Nov 2026).
        const rel = pathname.slice(prefix.length);
        const base = new URL(proxy.endsWith('/') ? proxy : `${proxy}/`);
        const target = /^[A-Za-z0-9._~\-/]+$/.test(rel) && !rel.startsWith('/') && !rel.split('/').includes('..') ? new URL(rel, base) : null;
        if (!target || target.origin !== base.origin || !target.pathname.startsWith(base.pathname)) { res.statusCode = 400; return res.end(); }
        const remote = await fetch(target).catch(() => null);
        if (!remote?.ok) { res.statusCode = remote?.status ?? 502; return res.end(); }
        body = Buffer.from(await remote.arrayBuffer());
      }
      res.setHeader('Content-Type', types[path.extname(file).toLowerCase()] ?? 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Content-Length', body.length);
      res.end(req.method === 'HEAD' ? undefined : body);
    });
  },
};
// node_modules here is a junction to scripts/generated/release-2026-11-06/node_modules (same lockfile). Vite's cache
// goes to this worktree's ignored scripts/generated/, never into the junction target.
const modules = realpathSync(path.join(root, 'node_modules'));
const server = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), publicDir: false,
  cacheDir: path.join(root, `scripts/generated/vite-cache/${port}`),
  plugins: [plugin],
  server: { port, strictPort: true, host: '127.0.0.1',
    fs: { allow: [searchForWorkspaceRoot(root), modules] } } });
await server.listen();
server.printUrls();
