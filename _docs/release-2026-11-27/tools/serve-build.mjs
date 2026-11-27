// (23 Nov 2026 release copy of release-2026-11-12/tools; default worktree = loving-napier-b93181.)
// (12 Nov 2026 release copy of w151-release/tools/serve-build.mjs; root = the session worktree.) // Serve an existing production build folder with Vite preview, at /the-finals-outfit/.
// The build's asset hosts are baked in at build time; this serves only the app shell.
//   node _docs/release-84-percent-2026-10-18/release-plan-v1/serve-build.mjs BUILD_DIR [PORT]
import { preview } from 'vite';
import path from 'node:path';
import { existsSync } from 'node:fs';
const root = path.resolve(process.env.RELEASE_WORKTREE ?? 'E:/Coding/the-finals-outfit/.claude/worktrees/loving-napier-b93181');
const outDir = path.resolve(process.argv[2] ?? '');
if (!existsSync(path.join(outDir, 'index.html'))) throw new Error(`Not a build folder: ${outDir}`);
process.env.VITE_BASE ??= '/the-finals-outfit/';
const server = await preview({ root, configFile: path.join(root, 'vite.config.ts'), build: { outDir },
  preview: { port: Number(process.argv[3] ?? 4341), strictPort: true, host: '127.0.0.1' } });
server.printUrls();
