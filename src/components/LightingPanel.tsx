import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { MAX_LOOKS, useLightingStore } from "../lib/lighting-store";
import {
  BACKDROP_PRESETS, EXPOSURE_MAX, EXPOSURE_MIN, FULL_LOOKS, INTENSITY_MAX, KEY_POSITION, LIGHT_HEIGHT_MAX, LIGHT_HEIGHT_MIN,
  MAX_LIGHTS, SUN_HEIGHT_MAX, SUN_HEIGHT_MIN, SUN_LOOKS, backdropCss, describeLook, fullLookName, isDefaultLook, isSolid,
  lightAngles, movedLight, newLight, sunCasts, sunOf, type Backdrop, type EnvironmentKind, type StageLight,
  type ToneMappingChoice,
} from "../lib/stage-lighting";
import { SunIcon, TrashIcon } from "./Icons";

/**
 * Lighting and backdrop (11-12 Nov 2026): the whole scene in one panel, a colour picker for everything. Looks (Studio,
 * the reviewed default; Lobby; sun looks; saved looks), the backdrop, each light, the sky/ground fill and reflections,
 * the ground shadows, exposure and tone mapping, Reset and Undo. Everything is remembered in this browser as it changes
 * (lighting-store.ts). Built like the Graphics menu: a button in the viewer's top row and a panel anchored to that row.
 */
export function LightingPanel() {
  const look = useLightingStore(state => state.look);
  const previous = useLightingStore(state => state.previous);
  const looks = useLightingStore(state => state.looks);
  const { edit, apply, reset, undo, saveLook, deleteLook } = useLightingStore.getState();
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

  const name = fullLookName(look) ?? "Custom";
  const sun = sunOf(look);
  const casting = sunCasts(look);
  const editLight = (id: string, change: (light: StageLight) => StageLight) =>
    edit(next => ({ ...next, lights: next.lights.map(light => light.id === id ? change(light) : light) }));
  const sunLookActive = (s: (typeof SUN_LOOKS)[number]) => {
    if (!sun) return false;
    const a = lightAngles(sun.position);
    return Math.round(a.bearing) === s.bearing && Math.round(a.height) === s.height && look.floorShadow && casting;
  };

  return (
    // Not positioned itself: the panel anchors to the whole button row (CharacterViewer), as the Graphics menu's does.
    <div ref={root}>
      <button ref={button} type="button" onClick={() => setOpen(value => !value)} aria-expanded={open} aria-controls={panelId}
        title="Lighting and backdrop"
        className="hud flex h-8 items-center gap-2 bg-ink-950/80 px-3 text-fg transition-colors hover:bg-ink-950">
        <SunIcon size={14} />
        <span className="sr-only">Lighting and backdrop: </span>
        <span>{name}</span>
        <svg aria-hidden="true" width="9" height="9" viewBox="0 0 10 10" className={`transition-transform ${open ? "rotate-180" : ""}`}>
          <path d="M1 3l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
      {open && (
        <div id={panelId} role="group" aria-label="Lighting and backdrop"
          style={viewerHeight ? { maxHeight: viewerHeight - 56 } : undefined}
          className="absolute right-0 top-9 z-30 flex w-80 max-w-[calc(100vw-1.5rem)] flex-col gap-3 overflow-y-auto border border-line bg-ink-950 p-3 text-sm text-fg shadow-lg">

          <Section title="Looks">
            <div className="flex flex-wrap gap-1.5">
              {FULL_LOOKS.map(full => (
                <Chip key={full.id} pressed={name === full.label} onClick={() => apply(full.look())}>{full.label}</Chip>
              ))}
            </div>
            {sun && <div className="flex flex-wrap gap-1.5">
              {SUN_LOOKS.map(s => (
                <Chip key={s.id} pressed={sunLookActive(s)} onClick={() => {
                  const next = structuredClone(look);
                  next.lights = next.lights.map(l => l.role === "sun"
                    ? { ...movedLight(l, { bearing: s.bearing, height: s.height }), enabled: true, castShadow: true } : l);
                  next.floorShadow = true;
                  apply(next);
                }}>{s.label}</Chip>
              ))}
            </div>}
            <span className="text-xs leading-snug text-fg-muted">
              Studio is the default, for comparing item colours. Sun looks move the sun and turn the floor shadow on.
            </span>
          </Section>

          <Section title="Backdrop">
            <BackdropEditor backdrop={look.backdrop} onChange={backdrop => edit(next => ({ ...next, backdrop }))} />
          </Section>

          <Section title="Lights">
            {look.lights.map(light => (
              <LightCard key={light.id} light={light} onChange={change => editLight(light.id, change)}
                onRemove={light.role === "sun" ? undefined
                  : () => apply({ ...structuredClone(look), lights: look.lights.filter(l => l.id !== light.id) })} />
            ))}
            <button type="button" disabled={look.lights.length >= MAX_LIGHTS}
              onClick={() => apply({ ...structuredClone(look), lights: [...look.lights, newLight(look.lights)] })}
              className="h-8 border border-line px-2 text-xs hover:bg-ink-900 disabled:cursor-not-allowed disabled:text-fg-muted disabled:hover:bg-transparent">
              Add light
            </button>
            <span className="text-xs leading-snug text-fg-muted">
              {look.lights.length >= MAX_LIGHTS ? `${MAX_LIGHTS} lights at most. ` : ""}
              Adding or removing a light, or switching a shadow on or off, makes the 3D view pause briefly while its shaders rebuild.
            </span>
          </Section>

          <Section title="Ground">
            <Check label="Contact shadow" hint="The soft shade right under the feet."
              checked={look.contactShadow} onChange={value => edit(next => ({ ...next, contactShadow: value }))} />
            <Check label="Floor shadow" hint={casting ? "The sun's shadow on the ground." : "Needs the sun on, with its shadow."}
              checked={look.floorShadow} disabled={!casting}
              onChange={value => edit(next => ({ ...next, floorShadow: value }))} />
            {look.floorShadow && casting && (
              <Slider label="Floor shadow strength" min={5} max={100} step={1} value={Math.round(look.floorShadowOpacity * 100)}
                readout={`${Math.round(look.floorShadowOpacity * 100)}%`}
                onChange={value => edit(next => ({ ...next, floorShadowOpacity: value / 100 }))} />
            )}
          </Section>

          <Details title="Sky and reflections">
            <div className="flex gap-3">
              <ColorField label="Sky" value={look.hemisphere.sky}
                onChange={sky => edit(next => ({ ...next, hemisphere: { ...next.hemisphere, sky } }))} />
              <ColorField label="Ground" value={look.hemisphere.ground}
                onChange={ground => edit(next => ({ ...next, hemisphere: { ...next.hemisphere, ground } }))} />
            </div>
            <Slider label="Sky and ground light" min={0} max={2} step={0.05} value={look.hemisphere.intensity}
              readout={look.hemisphere.intensity.toFixed(2)}
              onChange={intensity => edit(next => ({ ...next, hemisphere: { ...next.hemisphere, intensity } }))}
              hint="Soft light from above in the sky colour and from below in the ground colour." />
            <label className="flex flex-col gap-1">
              <span className="hud text-fg-muted">Reflections</span>
              <select value={look.environment.kind} aria-label="Reflections"
                onChange={event => edit(next => ({ ...next, environment: { ...next.environment, kind: event.target.value as EnvironmentKind } }))}
                className="h-8 cursor-pointer border border-line bg-ink-900 px-2 text-fg outline-none focus-visible:ring-1 focus-visible:ring-fg/60">
                <option value="softbox">Softbox studio</option>
                <option value="room">Room</option>
                <option value="none">None</option>
              </select>
            </label>
            {look.environment.kind !== "none" && <>
              <Slider label="Reflection strength" min={0} max={3} step={0.05} value={look.environment.intensity}
                readout={look.environment.intensity.toFixed(2)}
                onChange={intensity => edit(next => ({ ...next, environment: { ...next.environment, intensity } }))} />
              <Slider label="Reflection turn" min={-180} max={180} step={1} value={look.environment.rotation}
                readout={`${look.environment.rotation}°`}
                onChange={rotation => edit(next => ({ ...next, environment: { ...next.environment, rotation } }))}
                hint="Turns what metal and glass reflect round the character." />
            </>}
          </Details>

          <Details title="Camera">
            <Slider label="Exposure" min={EXPOSURE_MIN} max={EXPOSURE_MAX} step={0.05} value={look.exposure}
              readout={look.exposure.toFixed(2)} onChange={exposure => edit(next => ({ ...next, exposure }))}
              hint="Overall brightness, before tone mapping." />
            <label className="flex flex-col gap-1">
              <span className="hud text-fg-muted">Tone mapping</span>
              <select value={look.toneMapping} aria-label="Tone mapping"
                onChange={event => edit(next => ({ ...next, toneMapping: event.target.value as ToneMappingChoice }))}
                className="h-8 cursor-pointer border border-line bg-ink-900 px-2 text-fg outline-none focus-visible:ring-1 focus-visible:ring-fg/60">
                <option value="neutral">Neutral (true colours)</option>
                <option value="aces">ACES Filmic (punchy)</option>
                <option value="agx">AgX (soft highlights)</option>
              </select>
              <span className="text-xs leading-snug text-fg-muted">How bright light is squeezed into what a screen can show.</span>
            </label>
          </Details>

          <Section title="Saved looks">
            {looks.length > 0 && <ul className="flex flex-col gap-1">
              {looks.map(saved => (
                <li key={saved.id} className="flex items-center gap-1.5">
                  <button type="button" onClick={() => apply(saved.look)} title={`Use ${saved.name}`}
                    className="flex min-w-0 flex-1 flex-col items-start border border-line px-2 py-1 text-left hover:bg-ink-900">
                    <span className="text-xs">{saved.name}</span>
                    <span className="w-full truncate text-[11px] text-fg-muted">{describeLook(saved.look)}</span>
                  </button>
                  {confirmDelete === saved.id ? (
                    <button type="button" onClick={() => { deleteLook(saved.id); setConfirmDelete(null); }}
                      className="h-8 shrink-0 bg-finals px-2 text-xs text-fg" aria-label={`Confirm deleting ${saved.name}`}>
                      Delete
                    </button>
                  ) : (
                    <button type="button" onClick={() => setConfirmDelete(saved.id)} aria-label={`Delete ${saved.name}`}
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
            <button type="button" onClick={reset} disabled={isDefaultLook(look)}
              className="h-8 flex-1 bg-fg px-2 text-xs text-ink-950 hover:bg-white disabled:cursor-not-allowed disabled:bg-fg/30">
              Reset to Studio
            </button>
            {previous && (
              <button type="button" onClick={undo} title={`Back to: ${describeLook(previous)}`}
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

/** PR #37's Sun slider, kept on the viewer as a shortcut to the sun's direction (0° = in front of the character).
 *  Double-click returns the sun to its reviewed place. Nothing when the look has no sun. */
export function SunShortcut() {
  const look = useLightingStore(state => state.look);
  const edit = useLightingStore(state => state.edit);
  const sun = sunOf(look);
  if (!sun) return null;
  const bearing = Math.round(lightAngles(sun.position).bearing);
  const reviewed = sun.position.every((v, i) => v === KEY_POSITION[i]);
  return (
    <label className="hud flex h-8 items-center gap-2 bg-ink-950/80 px-3 text-fg"
      title="Turn the sun (the light casting the shadow) round the character. Double-click to return it to its default place.">
      <span aria-hidden="true">☀</span>Sun
      <input type="range" min={-180} max={180} step={1} value={bearing}
        onChange={event => {
          const value = Number(event.target.value);
          edit(next => ({ ...next, lights: next.lights.map(l => l.id === sun.id ? movedLight(l, { bearing: value }) : l) }));
        }}
        onDoubleClick={() => edit(next => ({ ...next, lights: next.lights.map(l => l.id === sun.id ? { ...l, position: [...KEY_POSITION] } : l) }))}
        aria-label="Sun direction" aria-valuetext={`${bearing} degrees${reviewed ? ", default" : ""}`}
        className="timeline-range h-full w-24 cursor-pointer pointer-coarse:w-32"
        style={{ "--played": `${((bearing + 180) / 360) * 100}%` } as CSSProperties} />
    </label>
  );
}

function LightCard({ light, onChange, onRemove }: {
  light: StageLight; onChange(change: (light: StageLight) => StageLight): void; onRemove?: () => void;
}) {
  const { bearing, height } = lightAngles(light.position);
  const isSun = light.role === "sun";
  return (
    <details open={isSun} className="border border-line">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-2 py-1.5 hover:bg-ink-900">
        <span aria-hidden="true" className="size-3 shrink-0 border border-fg/40"
          style={{ background: light.enabled ? light.color : "transparent" }} />
        <span className="flex-1 text-xs">{light.name}{isSun ? " · casts shadow" : ""}</span>
        <span className="text-[11px] text-fg-muted">{light.enabled ? `${light.intensity.toFixed(2)}` : "off"}</span>
      </summary>
      <div className="flex flex-col gap-2 border-t border-line p-2">
        <div className="flex items-end gap-3">
          <ColorField label="Colour" value={light.color} onChange={color => onChange(l => ({ ...l, color }))} />
          <Check label="On" checked={light.enabled} onChange={enabled => onChange(l => ({ ...l, enabled }))} />
          {onRemove && (
            <button type="button" onClick={onRemove} aria-label={`Remove ${light.name}`} title="Remove this light"
              className="ml-auto flex size-8 items-center justify-center text-fg-muted hover:text-fg">
              <TrashIcon />
            </button>
          )}
        </div>
        <Slider label="Brightness" min={0} max={INTENSITY_MAX} step={0.05} value={light.intensity}
          readout={light.intensity.toFixed(2)} onChange={intensity => onChange(l => ({ ...l, intensity }))} />
        <Slider label="Direction" min={-180} max={180} step={1} value={Math.round(bearing)} readout={`${Math.round(bearing)}°`}
          onChange={value => onChange(l => movedLight(l, { bearing: value }))}
          hint="0° in front, 90° from the right, 180° from behind." />
        <Slider label="Height" min={isSun ? SUN_HEIGHT_MIN : LIGHT_HEIGHT_MIN} max={isSun ? SUN_HEIGHT_MAX : LIGHT_HEIGHT_MAX}
          step={1} value={Math.round(height)} readout={`${Math.round(height)}°`}
          onChange={value => onChange(l => movedLight(l, { height: value }))} />
        {isSun && <Check label="Casts shadow" hint="Off: no shadows at all, and a little faster."
          checked={light.castShadow} onChange={castShadow => onChange(l => ({ ...l, castShadow }))} />}
      </div>
    </details>
  );
}

function BackdropEditor({ backdrop, onChange }: { backdrop: Backdrop; onChange(backdrop: Backdrop): void }) {
  const solid = isSolid(backdrop);
  const css = backdropCss(backdrop);
  return (
    <>
      <div role="radiogroup" aria-label="Backdrop presets" className="flex flex-wrap gap-1.5">
        {BACKDROP_PRESETS.map(preset => {
          const checked = backdropCss(preset.backdrop) === css;
          return (
            <button key={preset.id} type="button" role="radio" aria-checked={checked} title={preset.label}
              aria-label={preset.label} onClick={() => onChange({ ...preset.backdrop })}
              className={`size-7 border transition-shadow ${checked ? "border-fg ring-1 ring-fg" : "border-line hover:border-fg/50"}`}
              style={{ background: backdropCss(preset.backdrop) }} />
          );
        })}
      </div>
      <div className="flex gap-1.5" role="radiogroup" aria-label="Backdrop style">
        <Chip pressed={solid} onClick={() => !solid && onChange({ ...backdrop, inner: backdrop.middle, outer: backdrop.middle })}>Solid</Chip>
        <Chip pressed={!solid} onClick={() => solid && onChange({ ...backdrop, inner: shade(backdrop.middle, 0.12), outer: shade(backdrop.middle, -0.18) })}>Gradient</Chip>
      </div>
      <div className="flex gap-3">
        {solid
          ? <ColorField label="Colour" value={backdrop.middle} onChange={color => onChange({ ...backdrop, inner: color, middle: color, outer: color })} />
          : <>
              <ColorField label="Centre" value={backdrop.inner} onChange={inner => onChange({ ...backdrop, inner })} />
              <ColorField label="Middle" value={backdrop.middle} onChange={middle => onChange({ ...backdrop, middle })} />
              <ColorField label="Edge" value={backdrop.outer} onChange={outer => onChange({ ...backdrop, outer })} />
            </>}
      </div>
      <span className="text-xs leading-snug text-fg-muted">Behind the character only (it lights nothing). Share images use it too.</span>
    </>
  );
}

/** A #rrggbb colour lightened (amount > 0, towards white) or darkened (towards black), in sRGB. */
function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16), to = amount > 0 ? 255 : 0, t = Math.abs(amount);
  const channel = (shift: number) => Math.round(((n >> shift) & 255) * (1 - t) + to * t);
  return `#${[16, 8, 0].map(s => channel(s).toString(16).padStart(2, "0")).join("")}`;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="hud text-fg-muted">{title}</span>
      {children}
    </div>
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

function Chip({ pressed, onClick, children }: { pressed: boolean; onClick(): void; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={pressed} onClick={onClick}
      className="h-7 border border-line px-2 text-xs text-fg transition-colors hover:bg-ink-900 aria-pressed:border-fg/60 aria-pressed:bg-ink-900">
      {children}
    </button>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange(value: string): void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="hud text-fg-muted">{label}</span>
      <input type="color" value={value} aria-label={label} onChange={event => onChange(event.target.value.toLowerCase())}
        className="h-8 w-12 cursor-pointer border border-line bg-ink-900 p-0.5" />
    </label>
  );
}

function Check({ label, hint, checked, disabled, onChange }: {
  label: string; hint?: string; checked: boolean; disabled?: boolean; onChange(value: boolean): void;
}) {
  return (
    <label className={`flex items-start gap-2 ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}>
      <input type="checkbox" checked={checked && !disabled} disabled={disabled} onChange={event => onChange(event.target.checked)}
        className="mt-0.5 size-4 cursor-pointer accent-finals disabled:cursor-not-allowed" />
      <span className="flex flex-col">
        <span>{label}</span>
        {hint && <span className="text-xs leading-snug text-fg-muted">{hint}</span>}
      </span>
    </label>
  );
}

/** A labelled slider with a readout. */
function Slider({ label, min, max, step, value, readout, onChange, hint }: {
  label: string; min: number; max: number; step: number; value: number; readout: string; onChange(value: number): void; hint?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-center justify-between gap-2">
        <span className="hud text-fg-muted">{label}</span>
        <span className="tabular-nums text-xs">{readout}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} aria-label={label} aria-valuetext={readout}
        onChange={event => onChange(Number(event.target.value))}
        className="timeline-range h-6 w-full cursor-pointer"
        style={{ "--played": `${((value - min) / (max - min)) * 100}%` } as CSSProperties} />
      {hint && <span className="text-xs leading-snug text-fg-muted">{hint}</span>}
    </label>
  );
}

