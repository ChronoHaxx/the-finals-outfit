// Local preview of an emote animations set (11 Nov 2026), from _docs/chinals-intake-2026-11-06/emote-pilot/serve-5190.mjs
// (stoic-golick worktree). The app code comes from THIS worktree, the game assets from the main checkout's public/
// (read-only), and /animations/ from --set (a folder with manifest.json plus the clip and props sets it points at).
// Nothing is published.
//
// Run from the worktree root (PowerShell or Git Bash):
//   node _docs/emote-prop-placement-2026-11-11/serve-preview.mjs --set=<animations folder> [--port=5195] [--proxy=<url>]
// then open http://127.0.0.1:<port>/. --proxy fetches /animations/ files missing from --set from <url> (read-only).
import { createServer, searchForWorkspaceRoot } from 'vite';
import { readFile, stat } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const checkout = path.resolve(root, '../../..'); // E:\Coding\the-finals-outfit (the main checkout)
const publicDir = path.join(checkout, 'public');
// The animations folder: its manifest.json (convert-clips --activate writes one) points at a clip set and a props set.
const setArg = process.argv.find((a) => a.startsWith('--set='))?.slice(6);
if (!setArg) throw new Error('--set=<animations folder> is required');
const pilotSet = path.resolve(root, setArg);
// --proxy=<url>: an /animations/ file missing from that folder is fetched from <url> (e.g. the live global host), so a
// local props.json can override one file of a published set. Read-only; nothing is written to disk.
const PORT = Number(process.argv.find((a) => a.startsWith('--port='))?.slice(7) ?? 5195);
const proxy = process.argv.find((a) => a.startsWith('--proxy='))?.slice(8);
console.log(`/animations/ -> ${pilotSet}${proxy ? ` (missing files from ${proxy})` : ''}`);
// [prefix, base folder, required extension, 404 when missing, strip prefix]
const inMemory = [
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
  name: 'emote-preview-in-memory-files',
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
        const remote = await fetch(new URL(pathname.slice(prefix.length), proxy)).catch(() => null);
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
// node_modules may be a junction to another install of the same lockfile; Vite may read it, and its cache goes to this
// worktree's ignored scripts/generated/, never into the junction target.
const modules = realpathSync(path.join(root, 'node_modules'));
const server = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), publicDir: false,
  cacheDir: path.join(root, `scripts/generated/vite-cache/${PORT}`),
  plugins: [plugin],
  server: { port: PORT, strictPort: true, host: '127.0.0.1',
    fs: { allow: [searchForWorkspaceRoot(root), modules] } } });
await server.listen();
server.printUrls();
