// SEO basics refresh (6 Nov 2026): full-body renders of the two link-card looks through the redesigned app, for
// og-card.html / og-card.py. Same looks as the 29 Oct card (items live on main), now in the outfit-screen idle the app
// plays by default, held at a fixed time so a rerun gives the same frame. Rendered at 2x and downscaled when composed.
//
// Point APP_URL at a dev server of this branch (the capture hooks ?outfit, ?cam and __rigRoot are dev-only). To render
// the artwork the live site serves, start it with the production VITE_*_BASE values from .github/workflows/deploy.yml.
//   Git Bash: MSYS_NO_PATHCONV=1 APP_URL=http://127.0.0.1:5197 node _docs/seo-2026-11-06/og-card-capture.mjs OUT
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright-core';
import {BASE_OUTFIT, outfitUrl, watch, classify, waitIdle, shoot} from '../../scripts/shader-probe/coverage-preview-harness.mjs';

const OUT = process.argv[2];
if (!OUT) throw new Error('Usage: og-card-capture.mjs OUT_DIR');
if (fs.existsSync(OUT)) throw new Error(`Preserve ${OUT}`);
fs.mkdirSync(OUT, { recursive: true });
const FULL = '0,1.0,4.6,0,0.98,0';
const LOOKS = {
  sentinel: { ...BASE_OUTFIT, headwear: 'actionhero-sentinelhelmet-metal-yellow', upperBody: 'actionhero-sentineltop-mesh',
    lowerBody: 'actionhero-sentinelpants-nylon-yellow', hands: 'actionhero-sentinelgloves-nylon-goldwinner',
    feet: 'actionhero-sentinelboots-plastic' },
  street: { ...BASE_OUTFIT, upperBody: 'casual-oversizetrackjacket-satin-pink', lowerBody: 'casual-oversizedcargopants-nylon-camo',
    eyewear: 'attachments-aviatorsunglasses-metal' },
};
const CLIP = 'outfit-idle';
const TIMES = (process.env.ANIM_TIMES ?? '2,6').split(',').map(Number);
const YAWS = [0, -Math.PI / 5];

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const report = [];
for (const [name, slots] of Object.entries(LOOKS)) for (const yaw of YAWS) for (const time of TIMES) {
  const page = await browser.newPage({ viewport: { width: 1000, height: 1300 }, deviceScaleFactor: 2 });
  const log = watch(page);
  // pose: '' drops the harness's A-pose pin; the idle below replaces it. Automation opens still, so play it explicitly.
  await page.goto(outfitUrl(slots, { cam: FULL, pose: '', extra: '&temporal=0' }), { waitUntil: 'domcontentloaded' });
  await waitIdle(page);
  await page.waitForFunction(() => window.__rigAnim?.animator, undefined, { timeout: 60000 });
  await page.evaluate(async ([clip, t, a]) => {
    const anim = window.__rigAnim;
    anim.sway(false); // the approximate secondary motion keeps settling after a seek; off gives a repeatable frame
    await anim.play(clip, t);
    window.__rigRoot.rotation.y = a;
    window.__rigRoot.updateMatrixWorld(true);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  }, [CLIP, time, yaw]);
  await page.waitForTimeout(400);
  // The harness's frameViewer only hides the viewer's own overlays. Since the redesign, the sticky top bar and slot
  // strip of the narrow layout sit outside the viewer and stack above it, so hide every branch without the canvas.
  await page.evaluate(() => {
    for (let node = document.querySelector('canvas'); node && node !== document.body; node = node.parentElement)
      for (const sibling of node.parentElement?.children ?? [])
        if (sibling !== node && sibling instanceof HTMLElement) sibling.style.visibility = 'hidden';
  });
  const state = await page.evaluate(() => window.__rigAnim.state());
  const file = `${name}.y${Math.round(yaw * 180 / Math.PI)}.t${time}.png`;
  await shoot(page, path.join(OUT, file));
  const c = classify(log);
  report.push({ name, slots, clip: CLIP, time, yaw, file, anim: { current: state.current, paused: state.paused },
    errors: c.errors ?? log.errors, failedRequests: c.failedRequests });
  await page.close();
}
await browser.close();
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1) + '\n');
console.log(JSON.stringify(report.map(r => [r.file, r.anim, (r.errors || []).length, (r.failedRequests || []).length])));
