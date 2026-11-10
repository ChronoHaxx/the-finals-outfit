import { useEffect, useState } from "react";
import { CloseIcon } from "./Icons";
import { isEdge, NO_JIT_MS, scriptSpeedMs } from "../lib/script-speed";

const KEY = "finals-outfit.edge-security-notice";
const dismissed = () => { try { return window.localStorage.getItem(KEY) === "dismissed"; } catch { return false; } };

/**
 * Edge with "Enhance your security on the web" active on this site (10 Nov 2026, feedback: "horrid" performance in
 * Edge). That mode runs sites the visitor rarely opens without the JavaScript JIT, and this page spends most of each
 * frame in JavaScript, so it crawls. Detected by a short script-speed test a few seconds after load (lib/script-speed),
 * only in Edge; shown once until dismissed (remembered in this browser).
 */
export function SlowScriptNotice() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!isEdge() || dismissed()) return;
    const timer = window.setTimeout(() => { if (scriptSpeedMs() >= NO_JIT_MS) setShow(true); }, 4000);
    return () => window.clearTimeout(timer);
  }, []);
  if (!show) return null;
  const dismiss = () => {
    setShow(false);
    try { window.localStorage.setItem(KEY, "dismissed"); } catch { /* shown again next visit */ }
  };
  return (
    <div role="status" className="flex items-center gap-3 border-b border-kept/25 bg-kept/10 px-4 py-2 text-xs text-kept">
      <p className="flex-1">
        Edge is running this page without its JavaScript speed-up, so the 3D view will be slow. This is Edge&rsquo;s
        &ldquo;enhanced security&rdquo; for sites you rarely visit: click <b>Added security</b> at the left of the address
        bar and turn off <b>Enhance security for this site</b>, then reload.
      </p>
      <button type="button" onClick={dismiss} aria-label="Dismiss" className="grid size-6 place-items-center hover:text-fg">
        <CloseIcon size={12} />
      </button>
    </div>
  );
}
