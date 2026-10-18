// Bounded cache of hash-verified asset bytes, shared by loads of the same authored file.
//
// Only bytes that decoded as requested and matched their expected SHA-256 are retained. The
// cache keeps its buffers private: every caller, including concurrent callers of one download,
// receives its own copy, so a consumer that mutates or transfers its bytes cannot alter a later
// verified load. GPU objects are never shared here; each caller builds and owns its own texture.
// No DOM, Vite or Three.js dependency, so it runs directly under Node.

export type VerifiedByteEncoding = "identity" | "gzip";
export type VerifiedByteFetcher = (url: string) => Promise<Response>;

export interface VerifiedByteCacheOptions {
  /** Upper bound on retained bytes. A single payload larger than this is verified and returned, never retained. */
  budgetBytes?: number;
  /** Upper bound on retained entries. */
  maxEntries?: number;
}

export const VERIFIED_BYTES_BUDGET = 128 * 1024 * 1024;
export const VERIFIED_BYTES_MAX_ENTRIES = 512;

const DIGEST = /^[0-9a-f]{64}$/i;

/** The lowercase form of a 64-digit hexadecimal SHA-256, or an error for anything else. */
export function normalizeSha256(value: unknown): string {
  if (typeof value !== "string" || !DIGEST.test(value)) throw new Error("Invalid recovered asset digest");
  return value.toLowerCase();
}

async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}

export class VerifiedByteCache {
  readonly budgetBytes: number;
  readonly maxEntries: number;
  private readonly fetcher: VerifiedByteFetcher;
  // Insertion order is recency: the first entry is the least recently used.
  private readonly retained = new Map<string, ArrayBuffer>();
  private readonly pending = new Map<string, Promise<ArrayBuffer>>();
  private retainedBytes = 0;

  constructor(fetcher: VerifiedByteFetcher, options: VerifiedByteCacheOptions = {}) {
    this.fetcher = fetcher;
    this.budgetBytes = options.budgetBytes ?? VERIFIED_BYTES_BUDGET;
    this.maxEntries = options.maxEntries ?? VERIFIED_BYTES_MAX_ENTRIES;
    if (!Number.isSafeInteger(this.budgetBytes) || this.budgetBytes < 1
      || !Number.isSafeInteger(this.maxEntries) || this.maxEntries < 1)
      throw new Error("Invalid verified byte cache bounds");
  }

  /** Verified (and, for gzip, decompressed) bytes of an absolute URL, as a private copy. */
  async load(url: string, sha256: string, encoding: VerifiedByteEncoding): Promise<ArrayBuffer> {
    const href = new URL(url).href;
    const digest = normalizeSha256(sha256);
    if (encoding !== "identity" && encoding !== "gzip") throw new Error("Unsupported recovered asset encoding");
    const key = `${encoding}\n${digest}\n${href}`;
    const hit = this.retained.get(key);
    if (hit) {
      this.retained.delete(key);
      this.retained.set(key, hit);
      return hit.slice(0);
    }
    let flight = this.pending.get(key);
    if (!flight) {
      // One download, decompression and hash check for every concurrent identical request.
      // A failure is never retained, and the settled flight always leaves `pending`.
      flight = this.download(href, digest, encoding)
        .then((data) => { this.retain(key, data); return data; })
        .finally(() => { this.pending.delete(key); });
      this.pending.set(key, flight);
    }
    return (await flight).slice(0);
  }

  stats() {
    return { entries: this.retained.size, bytes: this.retainedBytes, pending: this.pending.size,
      budgetBytes: this.budgetBytes, maxEntries: this.maxEntries };
  }

  private async download(url: string, digest: string, encoding: VerifiedByteEncoding): Promise<ArrayBuffer> {
    const response = await this.fetcher(url);
    let data: ArrayBuffer;
    if (encoding === "gzip") {
      if (!response.body) throw new Error("Empty recovered asset response");
      data = await new Response(response.body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
    } else {
      data = await response.arrayBuffer();
    }
    if (await sha256Hex(data) !== digest) throw new Error("Recovered material asset hash mismatch");
    return data;
  }

  private retain(key: string, data: ArrayBuffer): void {
    if (data.byteLength > this.budgetBytes) return; // verified and returned, but never retained
    const previous = this.retained.get(key);
    if (previous) {
      this.retained.delete(key);
      this.retainedBytes -= previous.byteLength;
    }
    this.retained.set(key, data);
    this.retainedBytes += data.byteLength;
    for (const [oldest, buffer] of this.retained) {
      if (this.retainedBytes <= this.budgetBytes && this.retained.size <= this.maxEntries) break;
      this.retained.delete(oldest);
      this.retainedBytes -= buffer.byteLength;
    }
  }
}
