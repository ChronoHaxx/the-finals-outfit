const TRANSIENT = new Set([408, 429, 500, 502, 503, 504]);

// Only retry failed downloads. Parsing, integrity and unsupported-material errors
// are handled by the caller and must remain visible.
export async function fetchAsset(url: string): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(url);
    } catch (error) {
      if (!(error instanceof TypeError) || attempt >= 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 400 * 2 ** attempt));
      continue;
    }
    if (response.ok) return response;
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
