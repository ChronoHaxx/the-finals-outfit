import { useCallback, useEffect, useRef, useState } from "react";
import type { RigAnimator } from "../rig/RigAnimator";
import type { TakeInput } from "../rig/VideoExport";
import { takeSlots } from "../rig/take-slots";
import { openTakeLibrary, type TakeEntry, type TakeLibrary } from "../lib/take-store";
import { TakeRecorder } from "../lib/take-recorder";
import { MAX_TAKES, MAX_TAKE_SECONDS } from "../lib/video-take";
import { useLightingStore } from "../lib/lighting-store";
import { requestPersistentStorage } from "../lib/outfit-storage";
import type { SiteMode } from "../lib/site-mode";

// Takes in the Capture panel (22 Nov 2026): "record, then render". Record a take, and everything done in the viewer is
// sampled (lib/video-take.ts): the camera, emotes and their timeline, the lights. Each take is saved in this browser as
// it records (lib/take-store.ts) and listed in the Video tab, to render at 60 fps with the panel's format, size and
// quality (rig/VideoExport.ts renderTake). The state lives in the always-mounted Capture button (useTakes), so a take
// keeps recording with the panel closed; the button shows REC and the time, with Stop beside it.

const CHANNEL = "finals-take";

export const formatClock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

export interface TakesState {
  /** null while storage opens; false: takes last only until this tab closes. */
  persistent: boolean | null;
  entries: TakeEntry[];
  recording: { id: string; elapsed: number; saveError: string | null } | null;
  notice: string;
  canRecord: boolean;
  record(): Promise<boolean>;
  stop(): Promise<void>;
  refresh(): void;
  discard(id: string): Promise<void>;
  /** The take to render: from storage, or from memory when its saving failed in this tab. */
  input(id: string): Promise<TakeInput | null>;
  rendered(id: string): void;
}

/** The takes and the recording, owned by the Capture button. `onStopped`: a recording ended (to show the new take). */
export function useTakes(animator: RigAnimator | null, mode: SiteMode, onStopped?: () => void): TakesState {
  const library = useRef<Promise<TakeLibrary> | null>(null);
  const getLibrary = useCallback(() => (library.current ??= openTakeLibrary()), []);
  const own = useRef(new Set<string>()).current;
  const recorder = useRef<TakeRecorder | null>(null);
  const memory = useRef(new Map<string, TakeInput>()); // takes whose saving failed: renderable in this tab
  const channel = useRef<BroadcastChannel | null>(null);
  const [persistent, setPersistent] = useState<boolean | null>(null);
  const [entries, setEntries] = useState<TakeEntry[]>([]);
  const [recording, setRecording] = useState<TakesState["recording"]>(null);
  const [notice, setNotice] = useState("");
  const stoppedRef = useRef(onStopped);
  stoppedRef.current = onStopped;

  const refresh = useCallback(() => {
    void getLibrary().then(async lib => {
      setPersistent(lib.persistent);
      setEntries(await lib.list(own));
    }).catch(error => console.warn("[takes] list failed", error));
  }, [getLibrary, own]);
  const changed = useCallback(() => { refresh(); try { channel.current?.postMessage("changed"); } catch { /* closed */ } }, [refresh]);

  useEffect(() => {
    refresh();
    try { channel.current = new BroadcastChannel(CHANNEL); channel.current.onmessage = () => refresh(); } catch { /* old browser */ }
    return () => { channel.current?.close(); channel.current = null; };
  }, [refresh]);

  // A recording ended: by Stop, by itself (the length cap), the tab being hidden, or discarded in another tab.
  const finish = useCallback((done: TakeRecorder) => {
    if (recorder.current !== done) return;
    recorder.current = null;
    if (takeSlots.recorder === done) takeSlots.recorder = null;
    if (done.saveError) memory.current.set(done.id, done.data());
    setRecording(null);
    setNotice(done.stopReason === "limit" ? `Stopped at ${formatClock(MAX_TAKE_SECONDS)}, the longest a take can be.`
      : done.stopReason === "hidden" ? "Stopped: the tab was hidden. The take so far is saved."
      : done.stopReason === "gone" ? "This take was discarded in another tab." : done.saveError ? done.saveError : "");
    changed();
    stoppedRef.current?.();
  }, [changed]);

  const stop = useCallback(async () => {
    const current = recorder.current;
    if (!current) return;
    await current.stop("stopped");
    finish(current);
  }, [finish]);

  const record = useCallback(async () => {
    if (recorder.current || !animator || !takeSlots.probe) return false;
    const lib = await getLibrary();
    const existing = await lib.list(own);
    const number = Math.max(0, ...existing.map(e => Number(/^Take (\d+)$/.exec(e.meta.name)?.[1] ?? 0))) + 1;
    const started = await TakeRecorder.begin({ library: lib, own, mode, name: `Take ${number}`,
      probe: () => takeSlots.probe?.() ?? null, look: () => useLightingStore.getState().look });
    if ("refused" in started) {
      setNotice(started.refused.reason === "full"
        ? `${MAX_TAKES} takes are waiting to be rendered: render or discard one to record another.`
        : "Couldn’t start a take: this browser wouldn’t save it.");
      return false;
    }
    recorder.current = started.recorder;
    takeSlots.recorder = started.recorder;
    if (lib.persistent) requestPersistentStorage();
    const gone = started.evicted.map(m => m.name);
    setNotice(gone.length ? `Made room: ${gone.join(", ")} (already rendered) ${gone.length === 1 ? "was" : "were"} removed.` : "");
    setRecording({ id: started.recorder.id, elapsed: 0, saveError: null });
    changed();
    return true;
  }, [animator, changed, getLibrary, mode, own]);

  // The timer and save state, a few times a second (not every frame); a recording that stopped by itself finishes here.
  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => {
      const current = recorder.current;
      if (!current) return;
      if (current.state === "stopped") { finish(current); return; }
      setRecording(r => r && (r.elapsed !== current.elapsed || r.saveError !== current.saveError)
        ? { id: r.id, elapsed: current.elapsed, saveError: current.saveError } : r);
    }, 250);
    return () => window.clearInterval(timer);
  }, [recording, finish]);

  // A hidden tab draws no frames: the take stops there (what was recorded is saved). Closing saves what it can.
  useEffect(() => {
    const hidden = () => {
      const current = recorder.current;
      if (document.visibilityState === "hidden" && current) void current.stop("hidden").then(() => finish(current));
    };
    const leaving = () => { void recorder.current?.flush(); };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", leaving);
    return () => { document.removeEventListener("visibilitychange", hidden); window.removeEventListener("pagehide", leaving); };
  }, [finish]);

  // Another clip set (Chinals mode) or the viewer going away ends a recording.
  useEffect(() => () => {
    const current = recorder.current;
    if (current) void current.stop("stopped").then(() => finish(current));
  }, [animator, finish]);

  const discard = useCallback(async (id: string) => {
    await (await getLibrary()).discard(id);
    memory.current.delete(id);
    changed();
  }, [changed, getLibrary]);

  const input = useCallback(async (id: string): Promise<TakeInput | null> => {
    const fromMemory = memory.current.get(id);
    const stored = await (await getLibrary()).load(id);
    // A failed save left the full take in memory: prefer it when storage has less.
    if (fromMemory && (!stored || fromMemory.samples.length > stored.samples.length)) return fromMemory;
    return stored;
  }, [getLibrary]);

  const rendered = useCallback((id: string) => {
    void getLibrary().then(lib => lib.update(id, { renderedAt: Date.now() })).then(changed).catch(() => undefined);
  }, [changed, getLibrary]);

  return { persistent, entries, recording, notice, canRecord: !!animator, record, stop, refresh, discard, input, rendered };
}

/** The Video tab's take section: record, and the takes to render or discard. */
export function TakesSection({ takes, busy, onRecord, onRender }: {
  takes: TakesState; busy: boolean; onRecord(): void; onRender(id: string): void;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const recording = takes.recording;
  return (
    <div className="flex flex-col gap-2">
      {recording ? (
        <div className="flex flex-col gap-1.5">
          <button type="button" onClick={() => void takes.stop()}
            className="flex h-9 items-center justify-center gap-2 bg-finals px-3 text-xs font-semibold text-white hover:brightness-110">
            <span aria-hidden="true" className="size-2.5 bg-white" />Stop recording · <span className="tabular-nums">{formatClock(recording.elapsed)}</span>
          </button>
          <span className="text-[11px] leading-snug text-fg-muted">
            Recording: orbit, zoom, play emotes, use the timeline, change the lights. Stops by itself at {formatClock(MAX_TAKE_SECONDS)}.
          </span>
          {recording.saveError && <span role="alert" className="text-[11px] leading-snug text-finals">{recording.saveError}</span>}
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <button type="button" onClick={onRecord} disabled={busy || !takes.canRecord}
            title={takes.canRecord ? "Record what you do in the viewer, to render as a video" : "Turn on the animation first"}
            className="flex h-9 items-center justify-center gap-2 bg-fg px-3 text-xs font-semibold text-ink-950 hover:bg-white disabled:cursor-not-allowed disabled:bg-fg/30">
            <span aria-hidden="true" className="size-2.5 rounded-full bg-finals" />Record a take
          </button>
          <span className="text-[11px] leading-snug text-fg-muted">
            Records what you do in the viewer: the camera, emotes and the timeline, the lights. Then render it below, frame by frame at
            60 fps, so a slow machine never drops a frame from the video. It renders with the outfit you wear then.
          </span>
        </div>
      )}
      {takes.notice && <span role="status" aria-live="polite" className="text-[11px] leading-snug text-fg-muted">{takes.notice}</span>}
      {takes.entries.length > 0 && (
        <ul aria-label="Takes" className="flex flex-col divide-y divide-line border border-line">
          {takes.entries.map(({ meta, state }) => {
            const mine = recording?.id === meta.id;
            return (
              <li key={meta.id} className="flex items-center gap-2 px-2 py-1.5">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-xs font-semibold">{meta.name}</span>
                  <span className="text-[11px] tabular-nums text-fg-muted">
                    {formatClock(mine ? recording.elapsed : meta.duration)} · {new Date(meta.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    {mine ? " · recording" : state === "recording" ? " · recording in another tab" : state === "interrupted" ? " · interrupted, saved so far"
                      : meta.renderedAt ? " · rendered" : ""}
                  </span>
                </span>
                {confirming === meta.id ? (
                  <span className="flex items-center gap-1">
                    <button type="button" onClick={() => { setConfirming(null); void takes.discard(meta.id); }}
                      className="h-7 border border-finals/70 px-2 text-[11px] font-semibold text-finals hover:bg-ink-900">Discard</button>
                    <button type="button" onClick={() => setConfirming(null)}
                      className="h-7 border border-line px-2 text-[11px] text-fg-muted hover:bg-ink-900">Keep</button>
                  </span>
                ) : (
                  <span className="flex items-center gap-1">
                    <button type="button" disabled={busy || mine || state === "recording" || !!recording} onClick={() => onRender(meta.id)}
                      aria-label={`Render ${meta.name}`}
                      className="h-7 border border-fg/40 px-2 text-[11px] font-semibold hover:bg-ink-900 disabled:cursor-not-allowed disabled:opacity-40">Render</button>
                    <button type="button" disabled={mine || state === "recording"} onClick={() => setConfirming(meta.id)}
                      aria-label={`Discard ${meta.name}`}
                      className="h-7 border border-line px-2 text-[11px] text-fg-muted hover:bg-ink-900 disabled:cursor-not-allowed disabled:opacity-40">Discard…</button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <span className="text-[11px] leading-snug text-fg-muted">
        {takes.persistent === false
          ? "This browser won’t keep takes: they last until you close the tab. Render them before you go."
          : `Takes stay in this browser until you discard them; rendering keeps them. Up to ${MAX_TAKES}: past that the oldest rendered one makes room.`}
      </span>
    </div>
  );
}
