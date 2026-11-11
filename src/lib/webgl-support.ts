/**
 * Can this browser draw the 3D view? (10 Nov 2026, feedback: LibreWolf "doesn't load the site at all".)
 *
 * The viewer needs WebGL 2. LibreWolf turns WebGL off by default (`webgl.disabled`), some privacy setups and enterprise
 * policies do too, and a browser can block it after GPU driver crashes. Without it three.js throws while creating its
 * renderer, the viewer stays a blank box and the console fills with errors. Probing first lets the page say why instead,
 * while the catalog, saved outfits and links keep working.
 *
 * The probe context is released at once (WEBGL_lose_context), so it does not count against the browser's limit on live
 * contexts.
 */
export interface WebGLSupport {
  ok: boolean;
  /** Plain WebGL 1 works but WebGL 2 does not (an old browser or GPU). */
  webgl1Only?: boolean;
  /** The browser's own explanation, when it gives one (webglcontextcreationerror's statusMessage). */
  detail?: string;
}

let cached: WebGLSupport | null = null;

export function probeWebGL2(): WebGLSupport {
  if (cached) return cached;
  if (typeof document === "undefined") return { ok: true };
  let detail = "";
  const canvas = document.createElement("canvas");
  const onError = (event: Event) => { detail = (event as WebGLContextEvent).statusMessage || detail; };
  canvas.addEventListener("webglcontextcreationerror", onError);
  let gl: WebGL2RenderingContext | null = null;
  try { gl = canvas.getContext("webgl2"); } catch (error) { detail = String(error); }
  let webgl1Only = false;
  if (!gl) {
    try {
      const gl1 = canvas.getContext("webgl") as WebGLRenderingContext | null;
      webgl1Only = !!gl1;
      gl1?.getExtension("WEBGL_lose_context")?.loseContext();
    } catch { /* WebGL 1 is off too */ }
  } else {
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
  canvas.removeEventListener("webglcontextcreationerror", onError);
  cached = gl ? { ok: true } : { ok: false, webgl1Only, detail: detail.trim() || undefined };
  return cached;
}
