// A counter with a fixed window, one Durable Object per key: "s:<session id>" counts meshes served to a session,
// "i:<ip tag>" counts sessions minted for an address in a day. Rate limits only see a minute; this is what puts a
// ceiling on a whole session, so a scraper has to keep passing new Turnstile checks, and those are capped per IP.
//
// SQLite-backed (the only kind on Workers Free). The count is written every SAVE_EVERY increments and whenever the
// limit is reached, so an evicted object forgets at most SAVE_EVERY - 1 requests; that keeps storage writes well
// under the free 100,000 rows a day. An alarm deletes the object's storage once its window has passed.

export interface Window { count: number; resetAt: number }
export const SAVE_EVERY = 5;

/** One step of the counter, pure, so the tests cover the rule without a Durable Object. */
export function step(state: Window, limit: number, windowMs: number, nowMs: number): { state: Window; ok: boolean; fresh: boolean } {
  const fresh = nowMs >= state.resetAt;
  const current = fresh ? { count: 0, resetAt: nowMs + windowMs } : state;
  if (current.count >= limit) return { state: current, ok: false, fresh };
  return { state: { count: current.count + 1, resetAt: current.resetAt }, ok: true, fresh };
}

interface Storage {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  setAlarm(time: number): Promise<void>;
  deleteAll(): Promise<void>;
}

export class Budget {
  private window: Window = { count: 0, resetAt: 0 };
  private loaded = false;
  private unsaved = 0;
  constructor(private readonly ctx: { storage: Storage }, _env: unknown) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit")), windowSeconds = Number(url.searchParams.get("window"));
    if (!(limit > 0) || !(windowSeconds > 0)) return new Response("bad budget request", { status: 400 });
    if (!this.loaded) {
      this.window = (await this.ctx.storage.get<Window>("w")) ?? this.window;
      this.loaded = true;
    }
    const now = Date.now();
    const { state, ok, fresh } = step(this.window, limit, windowSeconds * 1000, now);
    this.window = state;
    if (fresh) await this.ctx.storage.setAlarm(state.resetAt + 60_000);
    if (ok) this.unsaved++;
    if (fresh || this.unsaved >= SAVE_EVERY || (!ok && this.unsaved > 0) || state.count >= limit) {
      await this.ctx.storage.put("w", state);
      this.unsaved = 0;
    }
    return Response.json({ ok, used: state.count, resetAt: state.resetAt });
  }

  async alarm(): Promise<void> {
    if (Date.now() < this.window.resetAt) return; // a newer window started; its own alarm is already set
    await this.ctx.storage.deleteAll();
    this.window = { count: 0, resetAt: 0 };
    this.unsaved = 0;
  }
}
