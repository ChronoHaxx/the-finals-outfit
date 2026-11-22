// Recording a take (22 Nov 2026; the model is lib/video-take.ts, storage lib/take-store.ts). The viewer's frame loop
// calls sample() once a frame; the recorder keeps every sample in memory and saves them in chunks every CHUNK_SECONDS,
// one transaction each (the chunk and the take's record), in order. A failed save keeps the samples and is retried with
// the next chunk, so nothing recorded is dropped; while a save is failing the panel says so (the take can still be
// rendered from memory in this tab). Stop saves the rest and marks the take done.
import { CHUNK_SECONDS, MAX_TAKE_SECONDS, TAKE_VERSION, encodeSamples, type TakeLookEvent, type TakeSample } from "./video-take";
import type { CreateResult, TakeLibrary, TakeMeta } from "./take-store";

/** The viewer's state now (null: nothing to record this frame, e.g. no camera yet). */
export type TakeProbe = () => Omit<TakeSample, "t"> | null;

export interface TakeRecorderOptions {
  library: TakeLibrary;
  probe: TakeProbe;
  /** The look the viewer draws now; a new object means a change (the lighting store replaces it on every edit). */
  look: () => unknown;
  mode: string;
  name: string;
  /** Milliseconds, monotonic (performance.now). */
  now?: () => number;
  /** Wall-clock milliseconds, for the record's dates. */
  clock?: () => number;
  newId?: () => string;
  /** Takes this tab is recording (never taken for interrupted). */
  own?: Set<string>;
  onChange?: () => void;
}

export type StopReason = "stopped" | "limit" | "hidden" | "gone";

const newTakeId = () => `take-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export class TakeRecorder {
  readonly samples: TakeSample[] = [];
  readonly events: TakeLookEvent[] = [];
  readonly clips: string[] = [];
  state: "recording" | "stopping" | "stopped" = "recording";
  stopReason: StopReason | null = null;
  /** The last save failed (the samples stay in memory and the next save retries them); null once all is saved. */
  saveError: string | null = null;
  private started: number | null = null;
  private lastLook: unknown = undefined;
  private saved = 0;
  private savedEvents = 0;
  private chunk = 0;
  private lastSave = 0;
  private writes: Promise<void> = Promise.resolve();
  private readonly now: () => number;
  private readonly clock: () => number;

  private constructor(readonly meta: TakeMeta, private readonly options: TakeRecorderOptions) {
    this.now = options.now ?? (() => performance.now());
    this.clock = options.clock ?? Date.now;
  }

  /** Start a take: its record is created first (refused when the takes are full of unrendered ones). */
  static async begin(options: TakeRecorderOptions): Promise<{ recorder: TakeRecorder; evicted: TakeMeta[] } | { refused: CreateResult }> {
    const clock = options.clock ?? Date.now, at = clock();
    const meta: TakeMeta = { id: (options.newId ?? newTakeId)(), version: TAKE_VERSION, name: options.name, createdAt: at, updatedAt: at,
      status: "recording", duration: 0, chunks: 0, clips: [], mode: options.mode, renderedAt: null };
    const result = await options.library.create(meta, options.own);
    if (!result.ok) return { refused: result };
    options.own?.add(meta.id);
    return { recorder: new TakeRecorder(meta, options), evicted: result.evicted };
  }

  get id(): string { return this.meta.id; }

  /** Seconds recorded. */
  get elapsed(): number { return this.samples.length ? this.samples[this.samples.length - 1].t : 0; }

  /** Once a frame, after the frame's pose and camera are final. */
  sample(): void {
    if (this.state !== "recording") return;
    const state = this.options.probe();
    if (!state) return;
    const now = this.now();
    if (this.started === null) this.started = now;
    const t = (now - this.started) / 1000;
    if (this.samples.length && t <= this.samples[this.samples.length - 1].t) return; // the same frame twice
    const look = this.options.look();
    if (look !== this.lastLook) { this.events.push({ t, look }); this.lastLook = look; }
    this.samples.push({ ...state, t });
    if (t >= MAX_TAKE_SECONDS) { void this.stop("limit"); return; }
    if (t - this.lastSave >= CHUNK_SECONDS) { this.lastSave = t; void this.save(false); }
    this.options.onChange?.();
  }

  /** Save what is not saved yet (also on the page being hidden or closed). Resolves when written or failed. */
  flush(): Promise<void> { return this.save(false); }

  /** Stop recording, save the rest and mark the take done. */
  async stop(reason: StopReason = "stopped"): Promise<void> {
    if (this.state !== "recording") return this.writes;
    this.state = "stopping";
    this.stopReason = reason;
    this.options.onChange?.();
    await this.save(true);
    this.state = "stopped";
    this.options.own?.delete(this.id);
    this.options.onChange?.();
  }

  private save(final: boolean): Promise<void> {
    this.writes = this.writes.then(() => this.write(final));
    return this.writes;
  }

  private async write(final: boolean): Promise<void> {
    const samples = this.samples.slice(this.saved), events = this.events.slice(this.savedEvents);
    if (!samples.length && !events.length && !final) return;
    const index = this.chunk;
    const encoded = encodeSamples(samples, this.clips);
    const patch: Partial<TakeMeta> = { updatedAt: this.clock(), duration: this.elapsed, chunks: index + (samples.length || events.length ? 1 : 0),
      clips: [...this.clips], ...(final ? { status: "done" as const } : {}) };
    try {
      const written = await this.options.library.append(this.id, samples.length || events.length
        ? { take: this.id, index, samples: encoded, events } : null, patch);
      if (!written) {
        // The take was discarded in another tab: stop; nothing more is written for it.
        this.saveError = "This take was discarded in another tab.";
        if (this.state === "recording") { this.state = "stopped"; this.stopReason = "gone"; this.options.own?.delete(this.id); }
        this.options.onChange?.();
        return;
      }
      if (samples.length || events.length) this.chunk = index + 1;
      this.saved += samples.length;
      this.savedEvents += events.length;
      this.saveError = null;
    } catch (error) {
      this.saveError = error instanceof DOMException && error.name === "QuotaExceededError"
        ? "The browser is out of space for takes: render this one before closing the tab."
        : "Couldn’t save this take: render it before closing the tab.";
      console.warn("[takes] save failed; kept in memory and retried", error);
    }
    this.options.onChange?.();
  }

  /** The recording as a take to render, from memory (complete even if a save failed). */
  data(): { meta: TakeMeta; samples: TakeSample[]; events: TakeLookEvent[] } {
    return { meta: { ...this.meta, duration: this.elapsed, clips: [...this.clips], status: this.state === "stopped" ? "done" : "recording" },
      samples: [...this.samples], events: [...this.events] };
  }
}
