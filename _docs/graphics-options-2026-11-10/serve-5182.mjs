// Dev server for the graphics-options worktree (10 Nov 2026), copied from serve-5181.mjs. Clips come from the evidence
// folder the showcase worktree's public/animations was moved to; app code from this worktree; game assets from the root
// checkout's public/ (read-only). Original notes follow.
//
// _docs/claude-autonomous-2026-09-25/serve-5174.mjs: the app code comes from THIS worktree, the game assets from the
// root checkout's public/ (read-only), and the decoded clips from this worktree's public/animations/.
//
// Why not a junction or Vite's own publicDir streaming for the root assets: Vite streams public files, and a capture
// page that closes mid-download can leave a Windows file handle open; that once blocked the main session's atomic
// replacement of the active index ("Access is denied"). So every file is read whole into memory before the response
// starts, like serve-5174.mjs.
//
// Why publicDir is OFF (6 Nov): Vite indexes every public file at startup and puts a file watcher on the whole public
// folder. The root checkout's public/ reached 170k files (models/ alone 167k), and the watcher's initial scan kept
// the event loop so busy that the server took minutes per request. This middleware serves those files instead: no
// index, no watcher, and files the main session adds later are served without a restart.
//
// Run (Git Bash or PowerShell), from the worktree root:  node _docs/graphics-options-2026-11-10/serve-5182.mjs
import { createServer, searchForWorkspaceRoot } from 'vite';
import { readFile, stat } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const checkout = path.resolve(root, '../../..'); // E:\Coding\the-finals-outfit (the main checkout)
const publicDir = path.join(checkout, 'public');
// [prefix, base folder, required extension, 404 when missing]. The last route is the root checkout's public/ (what
// Vite's publicDir used to serve): any path that names a file there wins over the app's own files, as in Vite.
const inMemory = [
  ['/src/data/', root, '.json', true],
  ['/animations/', path.join(checkout, '.claude/evidence/showcase-hair-agitated-northcutt-2026-11-10-local/public'), '', true],
  ['/models/', publicDir, '', true],
  ['/items/', publicDir, '', true],
  ['/', publicDir, '', false],
];
const types = {
  '.json': 'application/json', '.glb': 'model/gltf-binary', '.bin': 'application/octet-stream', '.webp': 'image/webp',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.gz': 'application/gzip',
  '.glsl': 'text/plain; charset=utf-8', '.asm': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
};
const plugin = {
  name: 'showcase-in-memory-files',
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      const [pathname, query = ''] = (req.url ?? '').split('?');
      const route = inMemory.find(([prefix, , ext]) => pathname.startsWith(prefix) && pathname.endsWith(ext));
      if ((req.method !== 'GET' && req.method !== 'HEAD') || /(^|&)import(=|&|$)/.test(query) || !route) return next();
      const [, base, , required] = route;
      let file;
      try { file = path.join(base, decodeURIComponent(pathname)); } catch { return next(); }
      if (!file.startsWith(base + path.sep)) return next();
      if (!required && !(await stat(file).then((s) => s.isFile(), () => false))) return next();
      let body;
      try { body = await readFile(file); } catch { res.statusCode = 404; return res.end(); }
      res.setHeader('Content-Type', types[path.extname(file).toLowerCase()] ?? 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Content-Length', body.length);
      res.end(req.method === 'HEAD' ? undefined : body);
    });
  },
};
// node_modules in this worktree is a read-only junction to scripts/generated/release-2026-11-05/node_modules (the
// same dependency set as main; nothing is installed here). Vite's dependency cache therefore goes to this worktree's
// ignored scripts/generated/, never into the junction target.
const modules = realpathSync(path.join(root, 'node_modules'));
const server = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), publicDir: false,
  cacheDir: path.join(root, 'scripts/generated/vite-cache/5182'),
  plugins: [plugin],
  server: { port: 5182, strictPort: true, host: '127.0.0.1',
    fs: { allow: [searchForWorkspaceRoot(root), modules] } } });
await server.listen();
server.printUrls();
