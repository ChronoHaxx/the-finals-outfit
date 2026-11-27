// (23 Nov 2026 release copy of release-2026-11-12/tools; default worktree = loving-napier-b93181.)
// (12 Nov 2026 release, branch claude/release-2026-11-12.) Copy of release-2026-11-11/tools/build-release.mjs with the
// worktree and default output updated: the release branch lives in the session worktree modest-lamarr-349080.
// Production app build without copying public/; the caller sets the deploy.yml VITE_* env. Output goes to a new
// evidence folder; refuses to reuse one.
import { build } from 'vite';
import { existsSync } from 'node:fs';
import path from 'node:path';
const root = path.resolve(process.env.RELEASE_WORKTREE ?? 'E:/Coding/the-finals-outfit/.claude/worktrees/loving-napier-b93181');
const outDir = path.resolve(process.argv[2] ?? 'E:/Coding/the-finals-outfit/.claude/worktrees/loving-napier-b93181/scripts/generated/release-2026-11-23/production-build-v1');
if (existsSync(outDir)) throw new Error(`Output exists: ${outDir}`);
await build({ root, configFile: path.join(root, 'vite.config.ts'), build: { copyPublicDir: false, outDir, emptyOutDir: false } });
