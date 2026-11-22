import { useEffect, useId, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import {
  COORD_LIMIT, DEFAULT_VIEW, MAX_DISTANCE, VIEW_CAP, formatView, getCameraHandle, liveViews, sameView, subscribeCamera,
  viewsWritable, type CameraView, type SavedView, type Vec3,
} from "../lib/camera-view";
import { deleteCameraView, renameCameraView, saveCameraView, useSavedOutfits, type ViewChange } from "../store/useSavedOutfits";
import { PencilIcon, TrashIcon, ViewfinderIcon } from "./Icons";

/**
 * Camera (21 Nov 2026, Shocka's feedback item 3): where the camera is and what it looks at, typed or read as it moves;
 * its roll; and views saved with the outfit, recalled in one click. Built like the Lighting panel: a button in the
 * viewer's top row and a panel anchored to that row. The camera itself is reached through CameraBridge.
 */
export function CameraPanel() {
  const [open, setOpen] = useState(false);
  const [viewerHeight, setViewerHeight] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const viewer = root.current?.closest("[data-viewer]");
    if (viewer) setViewerHeight(viewer.clientHeight);
    // A press elsewhere closes it, except on the 3D view: the panel stays open while you orbit, so the numbers follow.
    const outside = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (root.current?.contains(target) || (target instanceof HTMLCanvasElement && target.closest("[data-viewer]"))) return;
      setOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); button.current?.focus(); } };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);

  return (
    // Not positioned itself: the panel anchors to the whole button row (CharacterViewer), as the Lighting panel's does.
    <div ref={root}>
      <button ref={button} type="button" onClick={() => setOpen(value => !value)} aria-expanded={open} aria-controls={panelId}
        aria-label="Camera" title="Camera: position, roll and saved views"
        className="hud flex h-8 w-8 items-center justify-center bg-ink-950/80 text-fg transition-colors hover:bg-ink-950 aria-expanded:bg-ink-950">
        <ViewfinderIcon size={15} />
      </button>
      {open && (
        <div id={panelId} role="group" aria-label="Camera"
          style={viewerHeight ? { maxHeight: viewerHeight - 56 } : undefined}
          className="absolute right-0 top-9 z-30 flex w-80 max-w-[calc(100vw-1.5rem)] flex-col gap-3 overflow-y-auto border border-line bg-ink-950 p-3 text-sm text-fg shadow-lg">
          {/* Mounted only while open: it follows the camera every frame it moves. */}
          <CameraPanelBody />
        </div>
      )}
    </div>
  );
}

const cameraSnapshot = () => {
  const handle = getCameraHandle();
  return handle ? `${formatView(handle.get())}|${handle.locked() ? "locked" : "free"}` : "";
};

/** Degrees as the panel writes them, with a real minus sign. */
const degrees = (value: number) => `${value < 0 ? "−" : ""}${Math.abs(value)}°`;

function CameraPanelBody() {
  useSyncExternalStore(subscribeCamera, cameraSnapshot); // re-render whenever the camera moves or is locked
  const handle = getCameraHandle();
  const view = handle?.get() ?? DEFAULT_VIEW;
  const locked = !handle || handle.locked();
  const library = useSavedOutfits(s => s.library);
  const [note, setNote] = useState("");
  const [undo, setUndo] = useState<(() => ViewChange) | null>(null);

  const current = library?.current ?? null;
  const record = current?.kind === "record" ? library?.outfits.find(r => r.id === current.id) : undefined;
  const list = record ? record.cameraViews : current?.kind === "draft" ? current.draft.cameraViews : undefined;
  const views = liveViews(list);
  const writable = !!current && viewsWritable(list);
  const others = (library?.outfits ?? []).filter(r => r !== record)
    .flatMap(r => liveViews(r.cameraViews).map(saved => ({ saved, outfit: r.name, key: `${r.id}:${saved.id}` })));

  // Typed values apply to the camera as it is now (it may have drifted since the field was focused).
  const move = (change: (now: CameraView) => CameraView) => {
    const now = handle?.get();
    if (now) handle!.set(change(now));
  };
  const setAxis = (part: "position" | "target", axis: number, value: number) => move(now => {
    const next = [...now[part]] as Vec3;
    next[axis] = value;
    return { ...now, [part]: next };
  });
  const report = (result: ViewChange, success: (name: string) => string) => {
    setUndo(null);
    setNote(result.ok ? success(result.name) : result.message);
  };

  const hint = library?.status === "off"
    ? "Kept for this visit only: this browser is not keeping saved outfits."
    : current?.kind === "draft" ? "Saving a view also saves this shared outfit." : "Kept with this outfit in this browser.";

  return <>
    {locked && <p className="border-l-2 border-finals pl-2 text-xs leading-snug text-fg-muted">
      {handle
        ? "The camera is fixed while a scene backdrop is shown, so it can’t be moved from here. Your view and roll come back when the scene is switched off."
        : "The 3D view isn’t ready, so the camera can’t be moved yet."}
    </p>}
    <fieldset disabled={locked} className="flex min-w-0 flex-col gap-3 disabled:opacity-60">
      <Triple label="Camera" values={view.position} onCommit={(axis, value) => setAxis("position", axis, value)} />
      <Triple label="Looking at" values={view.target} onCommit={(axis, value) => setAxis("target", axis, value)} />
      {/* A div, not a label: a label would name (and click) its first control, the Level button. The slider has its
          own name. */}
      <div className="flex flex-col gap-1">
        <span className="flex items-center justify-between gap-2">
          <span className="hud text-fg-muted">Roll</span>
          <span className="flex items-center gap-2">
            <span className="tabular-nums text-xs">{degrees(view.roll)}</span>
            <button type="button" onClick={() => move(now => ({ ...now, roll: 0 }))} disabled={view.roll === 0}
              className="h-6 border border-line px-1.5 text-xs hover:bg-ink-900 disabled:text-fg-dim disabled:hover:bg-transparent">Level</button>
          </span>
        </span>
        <input type="range" min={-180} max={180} step={0.5} value={view.roll} aria-label="Roll" aria-valuetext={degrees(view.roll)}
          onChange={event => move(now => ({ ...now, roll: Number(event.target.value) }))}
          className="timeline-range h-6 w-full cursor-pointer"
          style={{ "--played": `${((view.roll + 180) / 360) * 100}%` } as CSSProperties} />
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs leading-snug text-fg-muted">Metres; y is up. The camera stays within {MAX_DISTANCE} m of where it looks.</span>
        <button type="button" onClick={() => move(() => DEFAULT_VIEW)} disabled={sameView(view, DEFAULT_VIEW)}
          className="h-8 shrink-0 border border-line px-2 text-xs hover:bg-ink-900 disabled:text-fg-dim disabled:hover:bg-transparent">Reset camera</button>
      </div>
    </fieldset>

    <div className="flex flex-col gap-1.5">
      <span className="hud text-fg-muted">Saved views</span>
      {views.length > 0 ? <ul className="flex flex-col gap-1">
        {views.map(saved => <SavedViewRow key={saved.id} saved={saved} active={sameView(saved, view)} locked={locked}
          editable={writable} onRecall={() => handle?.set(saved)}
          onRename={name => renameCameraView(saved.id, name)}
          onDelete={() => {
            const restore = deleteCameraView(saved.id);
            setNote(restore ? `Deleted “${saved.name}”.` : "");
            setUndo(() => restore);
          }} />)}
      </ul> : <span className="text-xs leading-snug text-fg-muted">None yet. Save the camera to come back to this view in one click.</span>}
      <button type="button" disabled={locked || !writable || views.length >= VIEW_CAP}
        onClick={() => {
          if (!handle) return;
          // Hold the camera on the view being saved (a drag's inertia would otherwise carry it past).
          const now = handle.get();
          handle.set(now);
          report(saveCameraView(now), name => `Saved “${name}”.`);
        }}
        className="h-8 border border-line px-2 text-xs hover:bg-ink-900 disabled:cursor-not-allowed disabled:text-fg-muted disabled:hover:bg-transparent">
        Save view
      </button>
      <p role="status" className="flex min-h-4 items-center gap-2 text-xs leading-snug text-fg-muted">
        {note}
        {undo && <button type="button" onClick={() => report(undo(), name => `Restored “${name}”.`)}
          className="font-medium text-fg underline underline-offset-2">Undo</button>}
      </p>
      <span className="text-xs leading-snug text-fg-muted">
        {views.length >= VIEW_CAP ? `${VIEW_CAP} views at most per outfit. ` : ""}{hint} {locked
          ? "Share links leave the camera out while it is fixed." : "Share links open on the camera you see."}
      </span>
    </div>

    {others.length > 0 && <Details title={`Views from other outfits (${others.length})`}>
      <ul className="flex flex-col gap-1">
        {others.map(({ saved, outfit, key }) => (
          <li key={key}>
            <ViewButton saved={saved} active={sameView(saved, view)} disabled={locked} onClick={() => handle?.set(saved)}>
              <span className="truncate">{saved.name}</span>
              <span className="shrink-0 truncate text-fg-dim">· {outfit}</span>
            </ViewButton>
          </li>
        ))}
      </ul>
    </Details>}
  </>;
}

/** Three coordinates under one label. */
function Triple({ label, values, onCommit }: { label: string; values: Vec3; onCommit(axis: number, value: number): void }) {
  return (
    <div role="group" aria-label={label} className="flex min-w-0 flex-col gap-1">
      <span className="hud text-fg-muted">{label}</span>
      <div className="flex gap-1.5">
        {(["X", "Y", "Z"] as const).map((axis, index) => (
          <CoordField key={axis} axis={axis} label={`${label} ${axis}`} value={values[index]} onCommit={value => onCommit(index, value)} />
        ))}
      </div>
    </div>
  );
}

const STEP = 0.01, BIG_STEP = 0.1;
const clampCoord = (value: number) => Math.min(COORD_LIMIT, Math.max(-COORD_LIMIT, value));

/**
 * One coordinate. It follows the camera until you type; Enter or leaving the field applies what you typed (a comma works
 * as the decimal point), Escape puts the live value back. Up and down arrows nudge it by 1 cm (Shift: 10 cm).
 */
function CoordField({ axis, label, value, onCommit }: { axis: string; label: string; value: number; onCommit(value: number): void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const live = value.toFixed(3);
  const apply = (text: string) => {
    const number = Number(text.replace(",", ".").trim());
    if (text.trim() !== "" && Number.isFinite(number) && number.toFixed(3) !== live) onCommit(clampCoord(number));
  };
  return (
    <label className="flex h-8 min-w-0 flex-1 items-center border border-line bg-ink-900 focus-within:border-fg/60">
      <span aria-hidden="true" className="hud pl-1.5 text-fg-dim">{axis}</span>
      <input type="text" inputMode="decimal" aria-label={label} value={draft ?? live} spellCheck={false} autoComplete="off"
        onFocus={event => event.currentTarget.select()}
        onChange={event => setDraft(event.target.value)}
        onBlur={event => { if (draft !== null) apply(event.currentTarget.value); setDraft(null); }}
        onKeyDown={event => {
          if (event.key === "Enter") { apply(event.currentTarget.value); setDraft(null); }
          else if (event.key === "Escape" && draft !== null) { event.stopPropagation(); setDraft(null); }
          else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            const step = (event.shiftKey ? BIG_STEP : STEP) * (event.key === "ArrowUp" ? 1 : -1);
            const base = Number((draft ?? live).replace(",", "."));
            onCommit(clampCoord(Math.round(((Number.isFinite(base) ? base : value) + step) * 1000) / 1000));
            setDraft(null);
          }
        }}
        className="h-full w-full min-w-0 bg-transparent px-1.5 text-right font-mono text-xs tabular-nums text-fg outline-none" />
    </label>
  );
}

function SavedViewRow({ saved, active, locked, editable, onRecall, onRename, onDelete }: {
  saved: SavedView; active: boolean; locked: boolean; editable: boolean;
  onRecall(): void; onRename(name: string): void; onDelete(): void;
}) {
  const [editing, setEditing] = useState(false);
  const cancelled = useRef(false);
  if (editing) return (
    <li>
      <input type="text" aria-label={`Name of ${saved.name}`} defaultValue={saved.name} maxLength={40} autoFocus
        onFocus={event => event.currentTarget.select()}
        onBlur={event => { if (!cancelled.current) onRename(event.currentTarget.value); cancelled.current = false; setEditing(false); }}
        onKeyDown={event => {
          if (event.key === "Enter") event.currentTarget.blur();
          else if (event.key === "Escape") { event.stopPropagation(); cancelled.current = true; event.currentTarget.blur(); }
        }}
        className="h-8 w-full border border-fg/60 bg-ink-900 px-2 text-xs text-fg outline-none" />
    </li>
  );
  return (
    <li className="flex items-center gap-1">
      <ViewButton saved={saved} active={active} disabled={locked} onClick={onRecall}>
        <span className="truncate">{saved.name}</span>
      </ViewButton>
      {editable && <>
        <IconButton label={`Rename ${saved.name}`} onClick={() => setEditing(true)}><PencilIcon size={13} /></IconButton>
        <IconButton label={`Delete ${saved.name}`} onClick={onDelete}><TrashIcon size={13} /></IconButton>
      </>}
    </li>
  );
}

/** Recalls a view in one click. Pressed while the camera is on it. */
function ViewButton({ saved, active, disabled, onClick, children }: {
  saved: SavedView; active: boolean; disabled: boolean; onClick(): void; children: ReactNode;
}) {
  const where = `${saved.position.join(", ")} looking at ${saved.target.join(", ")}${saved.roll ? `, roll ${degrees(saved.roll)}` : ""}`;
  return (
    <button type="button" aria-pressed={active} disabled={disabled} onClick={onClick} title={where}
      className="flex h-8 w-full min-w-0 flex-1 items-center gap-1 border border-line px-2 text-left text-xs text-fg transition-colors hover:bg-ink-900 aria-pressed:border-fg/60 aria-pressed:bg-ink-900 disabled:cursor-not-allowed disabled:text-fg-muted disabled:hover:bg-transparent">
      {children}
    </button>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick(): void; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick}
      className="grid size-8 shrink-0 place-items-center border border-line text-fg-muted transition-colors hover:bg-ink-900 hover:text-fg">
      {children}
    </button>
  );
}

function Details({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="group">
      <summary className="hud flex cursor-pointer list-none items-center justify-between text-fg-muted hover:text-fg">
        {title}
        <svg aria-hidden="true" width="9" height="9" viewBox="0 0 10 10" className="transition-transform group-open:rotate-180">
          <path d="M1 3l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </summary>
      <div className="mt-2 flex flex-col gap-2">{children}</div>
    </details>
  );
}
