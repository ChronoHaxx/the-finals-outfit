// Bytes downloaded by recovered-asset requests (fetchAsset), for the viewer's "12.3 / 45.6 MB" indicator. A
// response adds its Content-Length to the total as soon as it arrives and its bytes to `loaded` as the caller reads
// them. When its body ends, fails or is cancelled, its share of the total becomes exactly what was read, so progress
// can always reach 100%. Both counters only grow while downloads run: a view shows the difference since it started.

export interface DownloadProgress {
  /** Bytes read so far. */
  loaded: number;
  /** Bytes announced so far (Content-Length, or what was read when larger), including those already read. */
  total: number;
  /** Responses whose body is still being read. */
  active: number;
}

let state: DownloadProgress = { loaded: 0, total: 0, active: 0 };
const listeners = new Set<() => void>();
let scheduled = false;

function update(loaded: number, total: number, active: number) {
  state = { loaded: state.loaded + loaded, total: state.total + total, active: state.active + active };
  // One notification per task: a large download reports thousands of chunks.
  if (scheduled) return;
  scheduled = true;
  setTimeout(() => { scheduled = false; listeners.forEach(listener => listener()); }, 0);
}

export function getDownloadProgress(): DownloadProgress { return state; }

export function subscribeDownloadProgress(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The same response, with its body counted as it is read. */
export function trackDownload(response: Response): Response {
  if (!response.body) return response;
  const length = Number(response.headers.get("Content-Length"));
  // A transfer-compressed body reports its encoded length, which the decoded bytes would overrun: count reads only.
  const announced = Number.isFinite(length) && length > 0 && !response.headers.get("Content-Encoding") ? length : 0;
  let read = 0, share = announced, open = true;
  const finish = () => {
    if (!open) return;
    open = false;
    update(0, read - share, -1);
  };
  update(0, announced, 1);
  const reader = response.body.getReader();
  const counted = new ReadableStream<Uint8Array>({
    async pull(controller) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try { chunk = await reader.read(); } catch (error) { finish(); controller.error(error); return; }
      if (chunk.done) { finish(); controller.close(); return; }
      read += chunk.value.byteLength;
      const grown = Math.max(read, announced);
      update(chunk.value.byteLength, grown - share, 0);
      share = grown;
      controller.enqueue(chunk.value);
    },
    cancel(reason) { finish(); return reader.cancel(reason); },
  });
  return new Response(counted, { status: response.status, statusText: response.statusText, headers: response.headers });
}
