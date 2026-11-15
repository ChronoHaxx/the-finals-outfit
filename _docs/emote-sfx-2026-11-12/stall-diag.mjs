// What fills an emote's first-play stalls? Times every WebGL shader/texture call, logs each compiled shader (defines,
// and a JS stack once the emote starts) and the props' warm step, and lines them up with the frame gaps.
// node _docs/emote-sfx-2026-11-12/stall-diag.mjs [base] [picker label] [clip id]   (Git Bash, worktree root; the app served)
import { chromium } from "playwright-core";
const BASE = process.argv[2] ?? "http://127.0.0.1:5197/the-finals-outfit";
const LABEL = process.argv[3] ?? "BlackSmith", ID = process.argv[4] ?? "black-smith";
const DEFAULT = { face: "head-face-01-base", upperBody: "casual-basictshirt-cotton-black", lowerBody: "casual-loosejeans-denim-darkblue", feet: "casual-tallsneakers-canvas" };
const outfit = "1." + Buffer.from(JSON.stringify({ slots: DEFAULT })).toString("base64url");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
await context.addInitScript(() => {
  Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false });
  Error.stackTraceLimit = 60; window.__gl = []; window.__shaders = [];
  const src = WebGL2RenderingContext.prototype.shaderSource;
  WebGL2RenderingContext.prototype.shaderSource = function (shader, source) {
    const pick = re => (source.match(re) || [])[1];
    shader.__info = { name: pick(/#define SHADER_NAME (\S+)/), type: source.includes("gl_FragColor") || source.includes("pc_fragColor") || /out highp vec4 pc_fragColor/.test(source) ? "frag" : "vert",
      flags: ["USE_SKINNING", "DEPTH_PACKING", "USE_SHADOWMAP", "TONE_MAPPING", "USE_MAP", "USE_NORMALMAP", "USE_INSTANCING", "DOUBLE_SIDED", "FLIP_SIDED", "USE_FOG", "USE_ENVMAP", "USE_TRANSMISSION", "ALPHATEST", "USE_ALPHAHASH", "SHADOWMAP_TYPE_PCF_SOFT", "USE_BATCHING", "USE_MORPHTARGETS", "DISTANCE"].filter(d => source.includes("#define " + d)),
      out: pick(/vec4 linearToOutputTexel\( vec4 value \) \{ return ( [^;]+);/) ?? pick(/linearToOutputTexel[^{]*\{([^}]*)\}/), tone: pick(/#define TONE_MAPPING[^\n]*\n[^\n]*toneMapping\( vec3 color \) \{ return ([^;]+)/) };
    shader.__info.defines = [...source.matchAll(/^#define ([A-Za-z_0-9]+)(?: (.*))?$/gm)].map(m => m[1] + (m[2] ? "=" + m[2] : "")).filter(d => !d.startsWith("SHADER_NAME"));
    return src.call(this, shader, source);
  };
  const compile = WebGL2RenderingContext.prototype.compileShader;
  WebGL2RenderingContext.prototype.compileShader = function (shader) { if (window.__stacks) shader.__info.stack = new Error().stack.split(String.fromCharCode(10)).slice(8, 30).map(l => l.trim().replace(/https?:\/\/[^)]*\/([^/?)]+)(\?[^:)]*)?:(\d+):\d+/, "$1:$3")).join(" < "); window.__shaders.push([performance.now(), shader.__info]); return compile.call(this, shader); };
  const names = ["compileShader", "linkProgram", "getProgramParameter", "getShaderParameter", "texImage2D", "texSubImage2D",
    "texImage3D", "texStorage2D", "texStorage3D", "compressedTexImage2D", "compressedTexSubImage2D", "generateMipmap", "useProgram"];
  for (const proto of [WebGL2RenderingContext.prototype]) for (const name of names) {
    const original = proto[name];
    proto[name] = function (...args) {
      const t = performance.now();
      const result = original.apply(this, args);
      const ms = performance.now() - t;
      if (name !== "useProgram" || ms > 1) window.__gl.push([t, name, ms]);
      return result;
    };
  }
});
const page = await context.newPage();
await page.goto(`${BASE}/?reconstructed=1&outfit=${outfit}`, { waitUntil: "load", timeout: 240000 });
await page.getByRole("button", { name: /Enter builder|View shared outfit/ }).first().click({ timeout: 60000 }).catch(() => {});
await page.waitForFunction(() => !!window.__rigAnim && window.__rigIdle === true, null, { timeout: 240000 });
await page.waitForTimeout(3000);
await page.evaluate(() => {
  window.__warm = [];
  const props = window.__rigAnim.animator.props;
  const warm = props.warm.bind(props);
  props.warm = (actor, template) => {
    window.__warm.push([performance.now(), actor, props.warmer ? "start" : "no warmer"]);
    return warm(actor, template).then(() => window.__warm.push([performance.now(), actor, "done"]));
  };
  window.__gaps = []; let last = performance.now();
  const tick = t => { window.__gaps.push([t, t - last, window.__rigAnim.state().current]); last = t; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  window.__gl.length = 0; window.__shaders.length = 0; window.__stacks = true;
});
const trigger = page.getByRole("button", { name: /Play an emote|Emotes/ }).first();
const dialog = page.getByRole("dialog", { name: "Emotes" });
await trigger.click(); await dialog.waitFor();
const t0 = await page.evaluate(() => performance.now());
await dialog.getByRole("searchbox").fill(LABEL);
await dialog.getByRole("button", { name: new RegExp(LABEL) }).first().click();
await page.waitForFunction(id => window.__rigAnim.state().current === id, ID, { timeout: 60000 });
await page.keyboard.press("Escape").catch(() => {});
await page.waitForTimeout(2500);
const meshes = await page.evaluate(() => { const out = []; for (const o of window.__rigAnim.animator.props.instances.filter(Boolean)) { o.traverse(m => { if (!m.isMesh) return; const mats = Array.isArray(m.material) ? m.material : [m.material]; out.push({ prop: o.name, mesh: m.name, skinned: !!m.isSkinnedMesh, castShadow: m.castShadow, custom: !!m.customDepthMaterial, mats: mats.map(x => ({ name: x.name, side: x.side, shadowSide: x.shadowSide, map: !!x.map, alphaTest: x.alphaTest, transparent: x.transparent })) }); }); } return out; });
const { gaps, gl, warm, shaders } = await page.evaluate(() => ({ gaps: window.__gaps, gl: window.__gl, warm: window.__warm, shaders: window.__shaders }));
const on = gaps.filter(g => g[2] === ID);
const start = on[0]?.[0] ?? t0;
const rel = t => +((t - start) / 1000).toFixed(3);
const stalls = on.filter(g => g[1] > 100).map(g => ({ end: rel(g[0]), ms: Math.round(g[1]) }));
const sum = rows => rows.reduce((m, [, n, ms]) => ({ ...m, [n]: { calls: (m[n]?.calls ?? 0) + 1, ms: +((m[n]?.ms ?? 0) + ms).toFixed(1) } }), {});
const report = {
  warm: warm.map(([t, a, s]) => [rel(t), a, s]),
  beforeStart: sum(gl.filter(([t]) => t < start)),
  stalls: stalls.map(s => ({ ...s, gl: sum(gl.filter(([t]) => t > start + (s.end * 1000 - s.ms) - 1 && t <= start + s.end * 1000)),
    slowest: gl.filter(([t]) => t > start + (s.end * 1000 - s.ms) - 1 && t <= start + s.end * 1000).sort((a, b) => b[2] - a[2]).slice(0, 4).map(([, n, ms]) => [n, +ms.toFixed(1)]) })),
  afterStart: sum(gl.filter(([t]) => t >= start)),
  shaders: shaders.map(([t, info]) => [rel(t), info?.type, info?.name, (info?.flags ?? []).join(",")]),
  stacks: shaders.filter(([t, info]) => rel(t) >= 0 && info?.stack).map(([t, info]) => [rel(t), info.type, info.name, info.stack]),
  full: shaders.map(([t, info]) => ({ t: rel(t), type: info?.type, name: info?.name, defines: info?.defines })),
};
report.meshes = meshes;
console.log(JSON.stringify(report, null, 1));
await browser.close();
