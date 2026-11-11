import { trackDownload } from "./load-progress";
import { gatedUrl, meshRefusal, meshSessionHeadStart, renewMeshSession } from "./mesh-gate";

const TRANSIENT = new Set([408, 429, 500, 502, 503, 504]);

// Only retry failed downloads. Parsing, integrity and unsupported-material errors
// are handled by the caller and must remain visible.
export async function fetchAsset(url: string): Promise<Response> {
  // With the mesh gate on (mesh-gate.ts), a mesh downloads from the site Worker instead of its public host. The caller
  // keeps its own URL as the mesh's identity. The session check gets a head start but never blocks the download (log mode
  // serves meshes without one); a 401 waits for a session once. Gate refusals are explained, not retried.
  const target = gatedUrl(url);
  const gated = target !== null;
  let renewed = false;
  if (gated) await meshSessionHeadStart();
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(target ?? url, gated ? { credentials: "same-origin" } : undefined);
    } catch (error) {
      if (!(error instanceof TypeError) || attempt >= 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 400 * 2 ** attempt));
      continue;
    }
    if (response.ok) return trackDownload(response); // counted for the loading indicator
    if (gated && response.status === 401 && !renewed) {
      // Expired, spent or missing session: get a new one once (this throws if the check failed), then ask again.
      await response.body?.cancel();
      await renewMeshSession();
      renewed = true;
      attempt--;
      continue;
    }
    if (gated && (response.status === 403 || response.status === 429)) {
      const reason = await response.json().then((b: { error?: string }) => b?.error ?? "", () => "");
      const refusal = meshRefusal(response.status, reason);
      if (refusal) throw refusal;
    }
    if (!TRANSIENT.has(response.status) || attempt >= 2) {
      throw new Error(`Asset download failed (${response.status}): ${url}`);
    }
    // Release an error response before asking the server again.
    await response.body?.cancel();
    const retryAfter = response.headers.get("Retry-After");
    const seconds = retryAfter === null ? NaN : Number(retryAfter);
    const requestedDelay = Number.isFinite(seconds) ? seconds * 1000
      : retryAfter ? Date.parse(retryAfter) - Date.now() : NaN;
    // A long rate limit needs user action later, not an early retry or a stalled UI.
    if (requestedDelay > 5000) throw new Error(`Asset server busy; try again later: ${url}`);
    await new Promise(resolve => setTimeout(resolve,
      Math.max(400 * 2 ** attempt, Number.isFinite(requestedDelay) ? requestedDelay : 0)));
  }
}
