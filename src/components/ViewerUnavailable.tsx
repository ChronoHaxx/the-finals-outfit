import type { WebGLSupport } from "../lib/webgl-support";

/**
 * Shown in place of the 3D view when the browser cannot draw it (10 Nov 2026): WebGL 2 is off or unsupported
 * (lib/webgl-support), or the graphics context was lost. Everything else on the page keeps working.
 */
export function ViewerUnavailable({ support, lost, onRetry }: { support?: WebGLSupport; lost?: boolean; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex h-full w-full items-center justify-center bg-ink-900 p-6">
      <div className="max-w-md border-l-2 border-finals bg-ink-950/90 px-4 py-3 text-sm leading-relaxed text-fg">
        {lost ? <>
          <p className="hud mb-2 text-fg">3D view stopped</p>
          <p className="text-fg-muted">The browser took the graphics context away (a graphics driver reset, or the tab
            ran short of graphics memory). Your outfit is unchanged.</p>
        </> : <>
          <p className="hud mb-2 text-fg">3D preview unavailable</p>
          <p className="text-fg-muted">
            {support?.webgl1Only
              ? "This browser or graphics card supports only WebGL 1; the 3D preview needs WebGL 2."
              : "This browser has WebGL turned off, and the 3D preview needs WebGL 2."}
            {" "}You can still browse the catalog, build an outfit and share it as a link.
          </p>
          {!support?.webgl1Only && <p className="mt-2 text-fg-muted">
            LibreWolf and some privacy setups turn WebGL off on purpose: set <code className="text-fg">webgl.disabled</code> to
            {" "}<code className="text-fg">false</code> in <code className="text-fg">about:config</code> (LibreWolf), or allow
            WebGL for this site, then reload. Other browsers: check that hardware acceleration is on.
          </p>}
          {support?.detail && <p className="mt-2 text-xs text-fg-muted">Browser says: {support.detail}</p>}
        </>}
        {onRetry && <button type="button" onClick={onRetry} className="hud mt-3 h-8 bg-fg px-3 text-ink-950 hover:bg-white">
          {lost ? "Restart 3D view" : "Try again"}
        </button>}
      </div>
    </div>
  );
}
