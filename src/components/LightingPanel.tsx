import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { MAX_LOOKS, useLightingStore } from "../lib/lighting-store";
import {
  BUILT_IN_LOOKS, DEFAULT_LOBBY_HUE, DEFAULT_SUN_ELEVATION, SUN_ELEVATION_MAX, SUN_ELEVATION_MIN, backdropChoices, backdropCss,
  describeLighting, isDefaultLighting, rimLights, type LightingSettings, type SceneTheme,
} from "../lib/stage-lighting";
import { SunIcon, TrashIcon } from "./Icons";

/**
 * Lighting and backdrop (11 Nov 2026): the Studio sun's direction and height and its floor shadow, the Lobby rim hue,
 * a backdrop per theme, ready-made and saved looks, Reset and Undo. Everything is remembered in this browser as it
 * changes (lighting-store.ts); untouched, every control is the reviewed look. Built like the Graphics menu: a button in
 * the viewer's top row and a panel anchored to that row.
 */
export function LightingPanel({ theme }: { theme: SceneTheme }) {
  const settings = useLightingStore(state => state.settings);
  const previous = useLightingStore(state => state.previous);
  const looks = useLightingStore(state => state.looks);
  const { change, setBackdrop, apply, reset, undo, saveLook, deleteLook } = useLightingStore.getState();
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [viewerHeight, setViewerHeight] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) { setConfirmDelete(null); return; }
    const viewer = root.current?.closest("[data-viewer]");
    if (viewer) setViewerHeight(viewer.clientHeight);
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); button.current?.focus(); } };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);

  const custom = !isDefaultLighting(settings);
  const elevation = settings.sunElevation ?? Math.round(DEFAULT_SUN_ELEVATION);
  const hue = settings.lobbyHue ?? Math.round(DEFAULT_LOBBY_HUE);
  const builtIns = BUILT_IN_LOOKS.filter(look => look.theme === theme);
  const matches = (patch: Partial<LightingSettings>) =>
    (Object.keys(patch) as (keyof LightingSettings)[]).every(key => settings[key] === patch[key]);

  return (
    // Not positioned itself: the panel anchors to the whole button row (CharacterViewer), as the Graphics menu's does.
    <div ref={root}>
      <button ref={button} type="button" onClick={() => setOpen(value => !value)} aria-expanded={open} aria-controls={panelId}
        aria-label="Lighting and backdrop" title="Lighting and backdrop"
        className="hud relative flex h-8 w-8 items-center justify-center bg-ink-950/80 text-fg transition-colors hover:bg-ink-950">
        <SunIcon size={15} />
        {/* A mark while the look is not the reviewed one, so a changed light is never a surprise. */}
        {custom && <span aria-hidden="true" className="absolute right-1 top-1 size-1.5 bg-finals" />}
      </button>
      {open && (
        <div id={panelId} role="group" aria-label="Lighting and backdrop"
          style={viewerHeight ? { maxHeight: viewerHeight - 56 } : undefined}
          className="absolute right-0 top-9 z-30 flex w-72 max-w-[calc(100vw-1.5rem)] flex-col gap-3 overflow-y-auto border border-line bg-ink-950 p-3 text-sm text-fg shadow-lg">
          {theme === "studio" ? <>
            <Slider label="Sun direction" min={-180} max={180} value={settings.sunAzimuth}
              readout={`${settings.sunAzimuth}°`} reviewed={settings.sunAzimuth === 0}
              onChange={value => change({ sunAzimuth: value })} onReset={() => change({ sunAzimuth: 0 })}
              hint="Turns the light that casts the shadow round the character." />
            <Slider label="Sun height" min={SUN_ELEVATION_MIN} max={SUN_ELEVATION_MAX} value={elevation}
              readout={`${elevation}°`} reviewed={settings.sunElevation === null}
              onChange={value => change({ sunElevation: value })} onReset={() => change({ sunElevation: null })}
              hint="Low sun, long shadows; high sun, short ones." />
            <label className="flex cursor-pointer items-start gap-2">
              <input type="checkbox" checked={settings.floorShadow} onChange={event => change({ floorShadow: event.target.checked })}
                className="mt-0.5 size-4 cursor-pointer accent-finals" />
              <span className="flex flex-col">
                <span>Floor shadow</span>
                <span className="text-xs leading-snug text-fg-muted">The sun's shadow on the ground, which moves with the sliders.</span>
              </span>
            </label>
          </> : <>
            <Slider label="Rim colour" min={0} max={359} value={hue} hue
              readout={settings.lobbyHue === null ? "Blue" : `${hue}°`} reviewed={settings.lobbyHue === null}
              onChange={value => change({ lobbyHue: value })} onReset={() => change({ lobbyHue: null })}
              hint="The two back lights. Brightness is held, so every colour reads about as strong as the blue."
              swatch={rimLights(settings.lobbyHue)[0].color} />
          </>}

          <Section title="Looks">
            <div className="flex flex-wrap gap-1.5">
              {builtIns.map(look => (
                <button key={look.id} type="button" aria-pressed={matches(look.patch)}
                  onClick={() => apply({ ...settings, ...look.patch })}
                  className="h-7 border border-line px-2 text-xs text-fg transition-colors hover:bg-ink-900 aria-pressed:border-fg/60 aria-pressed:bg-ink-900">
                  {look.label}
                </button>
              ))}
            </div>
          </Section>

          <Section title="Backdrop">
            <div role="radiogroup" aria-label="Backdrop" className="flex flex-wrap gap-1.5">
              {backdropChoices(theme).map(choice => {
                const checked = settings.backdrop[theme] === choice.id;
                return (
                  <button key={choice.id} type="button" role="radio" aria-checked={checked} title={choice.label}
                    aria-label={choice.label} onClick={() => setBackdrop(theme, choice.id)}
                    className={`size-7 border transition-shadow ${checked ? "border-fg ring-1 ring-fg" : "border-line hover:border-fg/50"}`}
                    style={{ background: backdropCss(theme, choice.id) }}>
                    {choice.id === "default" && <span className={`hud text-[9px] ${choice.dark ? "text-fg" : "text-ink-950"}`}>Def</span>}
                  </button>
                );
              })}
            </div>
            <span className="text-xs leading-snug text-fg-muted">
              {backdropChoices(theme).find(choice => choice.id === settings.backdrop[theme])?.label ?? "Default"} · this
              theme only; share images use it too.
            </span>
          </Section>

          <Section title="Saved looks">
            {looks.length > 0 && <ul className="flex flex-col gap-1">
              {looks.map(look => (
                <li key={look.id} className="flex items-center gap-1.5">
                  <button type="button" onClick={() => apply(look.settings)} title={`Use ${look.name}`}
                    className="flex min-w-0 flex-1 flex-col items-start border border-line px-2 py-1 text-left hover:bg-ink-900">
                    <span className="text-xs">{look.name}</span>
                    <span className="w-full truncate text-[11px] text-fg-muted">{describeLighting(look.settings)}</span>
                  </button>
                  {confirmDelete === look.id ? (
                    <button type="button" onClick={() => { deleteLook(look.id); setConfirmDelete(null); }}
                      className="h-8 shrink-0 bg-finals px-2 text-xs text-fg" aria-label={`Confirm deleting ${look.name}`}>
                      Delete
                    </button>
                  ) : (
                    <button type="button" onClick={() => setConfirmDelete(look.id)} aria-label={`Delete ${look.name}`}
                      title="Delete (asks again)" className="flex size-8 shrink-0 items-center justify-center text-fg-muted hover:text-fg">
                      <TrashIcon />
                    </button>
                  )}
                </li>
              ))}
            </ul>}
            <button type="button" onClick={() => saveLook()} disabled={looks.length >= MAX_LOOKS}
              className="h-8 border border-line px-2 text-xs hover:bg-ink-900 disabled:cursor-not-allowed disabled:text-fg-muted disabled:hover:bg-transparent">
              Save current look
            </button>
            {looks.length >= MAX_LOOKS && <span className="text-xs text-fg-muted">{MAX_LOOKS} saved: delete one to save another.</span>}
          </Section>

          <div className="flex gap-1.5 border-t border-line pt-3">
            <button type="button" onClick={reset} disabled={!custom}
              className="h-8 flex-1 bg-fg px-2 text-xs text-ink-950 hover:bg-white disabled:cursor-not-allowed disabled:bg-fg/30">
              Reset to default
            </button>
            {previous && (
              <button type="button" onClick={undo} title={`Back to: ${describeLighting(previous)}`}
                className="h-8 border border-line px-3 text-xs hover:bg-ink-900">
                Undo
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="hud text-fg-muted">{title}</span>
      {children}
    </div>
  );
}

/** A labelled slider with a readout; "default" when it holds the reviewed value; double-click returns to it. */
function Slider({ label, min, max, value, readout, reviewed, onChange, onReset, hint, hue, swatch }: {
  label: string; min: number; max: number; value: number; readout: string; reviewed: boolean;
  onChange(value: number): void; onReset(): void; hint: string; hue?: boolean; swatch?: string;
}) {
  return (
    <label className="flex flex-col gap-1" title="Double-click the slider to return to the default.">
      <span className="flex items-center justify-between gap-2">
        <span className="hud text-fg-muted">{label}</span>
        <span className="flex items-center gap-1.5 tabular-nums text-xs">
          {swatch && <span aria-hidden="true" className="size-2.5 border border-fg/40" style={{ background: swatch }} />}
          {readout}{reviewed && <span className="text-fg-muted">· default</span>}
        </span>
      </span>
      <input type="range" min={min} max={max} step={1} value={value} aria-label={label}
        aria-valuetext={`${readout}${reviewed ? ", default" : ""}`}
        onChange={event => onChange(Number(event.target.value))} onDoubleClick={onReset}
        className={`h-6 w-full cursor-pointer ${hue ? "hue-range" : "timeline-range"}`}
        style={hue ? undefined : { "--played": `${((value - min) / (max - min)) * 100}%` } as CSSProperties} />
      <span className="text-xs leading-snug text-fg-muted">{hint}</span>
    </label>
  );
}
