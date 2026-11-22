// The squad page, #/squad (multi-character Phase 2, 22 Nov 2026): several contestants on one stage. A preview behind a
// flag (useSquads.ts) until the editor lands: contestants stand on fixed spots, play the outfit-screen idle, and come
// in as copies of the builder's outfit or a saved outfit. Every change is saved as it happens (lib/squad-library.ts);
// removing or deleting shows an undo.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import SquadViewer, { type MemberStatus } from "../components/SquadViewer";
import { useBuildStore } from "../store/useBuildStore";
import { useSavedOutfits } from "../store/useSavedOutfits";
import {
  addContestant, deleteSquad, dismissSquadNotice, newSquad, removeContestant, renameSquad, selectSquad, setSquadPreview,
  squadPreviewEnabled, startSquads, useSquads, type OutfitSource,
} from "../store/useSquads";
import type { ContestantRecord } from "../lib/squad-library";
import type { SlotMap } from "../lib/outfit-library";

// Phones and tablets show two contestants (a coarse main pointer, as the graphics settings judge it); the rest stay in
// the squad, untouched, for a larger screen.
const PHONE = typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;
const SHOWN = PHONE ? 2 : 3;
const UNDO_MS = 8000;

interface Undo { message: string; undo: () => boolean }

const contestantName = (contestant: ContestantRecord, index: number) => contestant.from?.name || `Contestant ${index + 1}`;
const pieces = (slots: SlotMap) => Object.keys(slots).length;

export default function Squad() {
  const location = useLocation();
  const [enabled, setEnabled] = useState(squadPreviewEnabled);
  useEffect(() => {
    const preview = new URLSearchParams(location.search).get("preview");
    if (preview === "on" || preview === "off") { setSquadPreview(preview === "on"); setEnabled(squadPreviewEnabled()); }
  }, [location.search]);
  useEffect(() => { if (enabled) void startSquads(); }, [enabled]);

  if (!enabled) return (
    <main className="stripes flex min-h-dvh flex-col items-start justify-center gap-5 px-6 sm:px-12">
      <p className="hud flex items-center gap-2 text-finals"><span aria-hidden="true" className="h-3 w-1 bg-finals" />Preview</p>
      <h1 className="display text-[clamp(48px,9vw,110px)]">Squads</h1>
      <p className="max-w-md text-fg-muted">Several contestants on one stage. Not open yet.</p>
      <Link to="/" className="hud border border-ink-600 px-4 py-3 text-fg transition-colors hover:border-fg">&larr; Back to builder</Link>
    </main>
  );
  return <SquadPage />;
}

function SquadPage() {
  const snapshot = useSquads(s => s.snapshot);
  const outfits = useSavedOutfits(s => s.library);
  const [statuses, setStatuses] = useState<Record<string, MemberStatus>>({});
  const [undo, setUndo] = useState<Undo | null>(null);
  const [pick, setPick] = useState("");
  useEffect(() => {
    if (!undo) return;
    const timer = window.setTimeout(() => setUndo(null), UNDO_MS);
    return () => window.clearTimeout(timer);
  }, [undo]);

  const current = snapshot?.current ?? null;
  const squad = snapshot?.squads.find(s => s.id === current);
  const all = useMemo(() => (current && snapshot?.contestants[current]) || [], [snapshot, current]);
  const shown = useMemo(() => all.slice(0, SHOWN), [all]);
  const full = !!snapshot && all.length >= snapshot.contestantCap;
  const onStatus = useCallback((next: Record<string, MemberStatus>) => setStatuses(next), []);

  // The builder's outfit as it is on screen: the saved record when one is current (its labels and any fields this
  // version does not know come along), else the unsaved draft's pieces.
  const builderSource = (): OutfitSource => {
    const { build, bodyType, playerNumber } = useBuildStore.getState();
    const slots: SlotMap = Object.fromEntries(Object.entries(build).filter((e): e is [string, string] => !!e[1]));
    const cur = outfits?.current;
    const record = cur?.kind === "record" ? outfits?.outfits.find(o => o.id === cur.id) : undefined;
    if (record) return { ...record, slots, bodyType, playerNumber, name: record.name, outfitId: record.id };
    const draft = cur?.kind === "draft" ? cur.draft : undefined;
    return { slots, ...(draft?.labels ? { labels: draft.labels } : {}), bodyType, playerNumber, name: draft?.name ?? "Builder outfit" };
  };
  const addSaved = () => {
    const record = outfits?.outfits.find(o => o.id === pick);
    if (record) addContestant({ ...record, name: record.name, outfitId: record.id });
  };

  if (!snapshot) return <main className="grid h-dvh place-items-center"><span className="hud text-fg-muted">Opening squads…</span></main>;
  const status = { saved: "Saved", saving: "Saving…", off: "Saving is off in this browser", error: "Couldn’t save" }[snapshot.status];

  return (
    <main className="flex h-dvh flex-col bg-ink-950 lg:flex-row">
      <div className="relative min-h-0 flex-1">
        <SquadViewer contestants={shown} onStatus={onStatus} />
      </div>
      <aside className="flex max-h-[45dvh] w-full flex-col gap-4 overflow-y-auto border-t border-line p-4 text-sm text-fg lg:max-h-none lg:w-80 lg:border-l lg:border-t-0">
        <div className="flex items-center justify-between gap-2">
          <p className="hud flex items-center gap-2 text-finals"><span aria-hidden="true" className="h-3 w-1 bg-finals" />Squad · preview</p>
          <Link to="/" className="hud text-fg-muted hover:text-fg">&larr; Builder</Link>
        </div>

        <section className="flex flex-col gap-2" aria-label="Squad">
          <div className="flex gap-1.5">
            <select aria-label="Squad" value={current ?? ""} onChange={e => selectSquad(e.target.value)}
              className="select-plain h-9 min-w-0 flex-1 border border-line bg-ink-900 px-2">
              {snapshot.squads.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button type="button" className="hud h-9 border border-line px-3 hover:border-fg disabled:opacity-40"
              disabled={snapshot.squads.length >= snapshot.cap} onClick={() => newSquad()}>New</button>
          </div>
          {squad && <input key={squad.id} aria-label="Squad name" defaultValue={squad.name} maxLength={40}
            onBlur={e => renameSquad(squad.id, e.currentTarget.value)}
            onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}
            className="h-9 border border-line bg-ink-900 px-2" />}
        </section>

        <section className="flex flex-col gap-1.5" aria-label="Contestants">
          <p className="hud text-fg-dim">Contestants · {all.length} / {snapshot.contestantCap}</p>
          {shown.map((contestant, index) => {
            const memberStatus = statuses[contestant.id];
            return (
              <div key={contestant.id} className="flex items-center gap-2 border-l-2 border-finals bg-ink-900 py-1.5 pl-2.5 pr-1">
                <div className="min-w-0 flex-1">
                  <p className="truncate">{contestantName(contestant, index)}</p>
                  <p className="hud text-fg-dim">
                    {memberStatus?.error ?? (memberStatus?.loading ? "Loading…" : `${pieces(contestant.slots)} pieces`)}
                  </p>
                </div>
                <button type="button" aria-label={`Remove ${contestantName(contestant, index)}`} title="Remove (undo for a few seconds)"
                  className="hud h-8 px-2 text-fg-muted hover:text-fg"
                  onClick={() => setUndo({ message: `Removed ${contestantName(contestant, index)}`, undo: removeContestant(contestant.id) })}>
                  Remove
                </button>
              </div>
            );
          })}
          {all.length > shown.length && (
            <p className="text-xs text-fg-dim">{all.length - shown.length} more kept in this squad for a larger screen.</p>
          )}
        </section>

        <section className="flex flex-col gap-2" aria-label="Add a contestant">
          <button type="button" disabled={full} onClick={() => addContestant(builderSource())}
            className="hud h-9 bg-fg px-3 text-ink-950 hover:bg-white disabled:opacity-40">Add the builder’s outfit</button>
          <div className="flex gap-1.5">
            <select aria-label="Saved outfit" value={pick} onChange={e => setPick(e.target.value)} disabled={full}
              className="select-plain h-9 min-w-0 flex-1 border border-line bg-ink-900 px-2 disabled:opacity-40">
              <option value="">Saved outfit…</option>
              {outfits?.outfits.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <button type="button" disabled={full || !pick} onClick={addSaved}
              className="hud h-9 border border-line px-3 hover:border-fg disabled:opacity-40">Add</button>
          </div>
          {full && <p className="text-xs text-fg-dim">A squad holds up to {snapshot.contestantCap} contestants{PHONE ? "; this screen shows 2" : ""}.</p>}
          <p className="text-xs text-fg-dim">Each contestant is a copy: changing or deleting the outfit later leaves the squad as it is.</p>
        </section>

        <div className="mt-auto flex flex-col gap-2">
          {squad && <button type="button" className="hud h-9 self-start border border-line px-3 text-fg-muted hover:border-fg hover:text-fg"
            onClick={() => setUndo({ message: `Deleted ${squad.name}`, undo: deleteSquad(squad.id) })}>Delete squad</button>}
          <p role="status" className="hud text-fg-dim">{status}</p>
          {snapshot.notice && <p className="text-xs text-fg-muted">{snapshot.notice} <button type="button" className="underline" onClick={dismissSquadNotice}>OK</button></p>}
        </div>
      </aside>
      {undo && (
        <div role="status" className="fixed bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 border-l-2 border-finals bg-ink-950/95 px-3 py-2 text-sm text-fg">
          <span>{undo.message}</span>
          <button type="button" className="hud underline" onClick={() => { undo.undo(); setUndo(null); }}>Undo</button>
        </div>
      )}
    </main>
  );
}
