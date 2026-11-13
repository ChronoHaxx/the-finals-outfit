import { useDeferredValue, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { AnimatorState, ClipInfo, RigAnimator } from "../rig/RigAnimator";
import { CloseIcon, SearchIcon } from "./Icons";

// The emote picker (showcase animation, 5 Nov 2026): every Season 12 emote item with the game's own icon, newest
// season first. Most emotes also spawn a prop (a guitar, a flag, wings) or effects (smoke, sparks) from notifies in
// their animation. Props are shown (EmoteProps.ts) except a few; effects are not, so every tile and the details line
// say what is not shown (once props.json has loaded, only what is really missing).
// Reactions, idles and the emote animations no current item plays sit under "More".
//
// Layout: the character stays visible while choosing. On desktop the panel docks beside the 3D viewer, over the
// catalog column (inside the viewer it hid the character); with no room there it sits in the viewer's right-hand
// column. On phones it is a sheet under the sticky 3D stage. Docked panels and sheets render at the body, so the
// sticky slot rail cannot paint over them.

const DESKTOP = "(min-width: 64rem)"; // Tailwind lg, where the builder switches to its two-pane layout
function useDesktop(): boolean {
  return useSyncExternalStore(
    listener => { const query = window.matchMedia(DESKTOP); query.addEventListener("change", listener); return () => query.removeEventListener("change", listener); },
    () => window.matchMedia(DESKTOP).matches,
  );
}

const DOCK_MIN = 20 * 16, DOCK_MAX = 26 * 16, GAP = 12; // px

/** Where to dock beside the viewer (fixed coordinates, kept current on resize), or null when there is no room. */
function useDock(anchor: HTMLElement | null, enabled: boolean): CSSProperties | null {
  const [style, setStyle] = useState<CSSProperties | null>(null);
  useEffect(() => {
    if (!anchor || !enabled) { setStyle(null); return; }
    const measure = () => {
      const rect = anchor.getBoundingClientRect();
      const room = window.innerWidth - rect.right - 2 * GAP;
      setStyle(room < DOCK_MIN ? null
        : { position: "fixed", left: rect.right + GAP, top: rect.top, height: rect.height, width: Math.min(DOCK_MAX, room) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(anchor);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true); };
  }, [anchor, enabled]);
  return style;
}

const RARITY_BAR: Record<string, string> = {
  Mythic: "bg-finals-hi", Legendary: "bg-kept", Epic: "bg-[#a466ef]", Rare: "bg-[#3f8cf0]", Uncommon: "bg-[#4fb36b]", Common: "bg-fg-dim",
};

/** "BP_Emote_AcePilotWings_Prop" -> "Ace Pilot Wings": a readable name for a spawned actor. */
export function propLabel(asset: string): string {
  return asset.replace(/^BP_(Emote_)?/, "").replace(/_(Prop|C)$/i, "").replace(/_?\d+$/, "")
    .replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\s+/g, " ").trim();
}

/** Which of an emote's props the preview shows (EmoteProps once props.json has loaded; without it, none). */
export interface PropsView { windowsFor(source: string | undefined): { actor: string; shown: boolean }[] | null }

function propsLeftOut(info: ClipInfo, props?: PropsView): string[] {
  const listed = info.emote?.props ?? [];
  const windows = props?.windowsFor(info.source);
  if (!windows) return listed;
  const shown = new Set(windows.filter(w => w.shown).map(w => w.actor));
  return listed.filter(actor => !shown.has(actor));
}

/** What the preview leaves out of an emote, as one short phrase, or null when it shows everything. */
export function missingSummary(info: ClipInfo | undefined, props?: PropsView): string | null {
  const emote = info?.emote;
  if (!info || !emote) return null;
  const parts: string[] = [];
  const left = [...new Set(propsLeftOut(info, props).map(propLabel))];
  if (left.length) parts.push(`${left.length === 1 ? "prop" : "props"} (${left.join(", ")})`);
  if (emote.fx?.length) parts.push("effects");
  return parts.length ? `Not shown: ${parts.join(" and ")}` : null;
}

export function missingBadge(info: ClipInfo, props?: PropsView): string | null {
  if (propsLeftOut(info, props).length) return "Prop";
  if (info.emote?.fx?.length) return "FX";
  return null;
}

type Tab = "emotes" | "more";

// Chinese text is marked as such, so the browser picks Simplified Chinese glyph forms (Han characters shared with
// Japanese render differently by language).
const zhHans = (text: string) => /\p{Script=Han}/u.test(text) ? "zh-Hans" : undefined;

export function EmotePicker({ animator, state, onPlay, onClose, anchor }: {
  animator: RigAnimator; state: AnimatorState; onPlay: (id: string) => void; onClose: () => void;
  /** The 3D viewer, to dock beside on desktop. */
  anchor: HTMLElement | null;
}) {
  const desktop = useDesktop();
  const dock = useDock(anchor, desktop);
  const [tab, setTab] = useState<Tab>("emotes");
  const [query, setQuery] = useState("");
  const [bodyOnly, setBodyOnly] = useState(false);
  const deferredQuery = useDeferredValue(query);
  const [detail, setDetail] = useState<string | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  // Focus the search on open; Escape closes from anywhere in the panel.
  useEffect(() => { search.current?.focus({ preventScroll: true }); }, []);
  // What each emote shows depends on props.json: fetched once, when the picker first opens.
  useEffect(() => { animator.loadProps(); }, [animator]);
  const propsLoaded = animator.props.loaded;

  const { clips, rarityOrder = [] } = { clips: animator.manifest.clips, rarityOrder: animator.manifest.rarityOrder };
  // The Chinals set (lib/site-mode.ts): no seasons, Chinese names, and translations marked as this site's own.
  const chinals = animator.manifest.edition === "chinals";
  const emotes = useMemo(() => clips.filter(c => c.kind === "emote" && c.emote && !c.emote.unlisted), [clips]);
  const groups = useMemo(() => {
    const needle = deferredQuery.trim().toLowerCase();
    const rank = (r?: string | null) => { const i = rarityOrder.indexOf(r ?? ""); return i < 0 ? rarityOrder.length : i; };
    const matches = (c: ClipInfo) => [c.label, c.emote?.description, c.emote?.nameZh, c.emote?.translation]
      .some(text => text?.toLowerCase().includes(needle));
    const shown = emotes.filter(c => (!needle || matches(c))
      && (!bodyOnly || !missingBadge(c, animator.props)));
    const bySeason = new Map<number, ClipInfo[]>();
    for (const c of shown) {
      const season = c.emote?.season ?? 0;
      bySeason.set(season, [...(bySeason.get(season) ?? []), c]);
    }
    return [...bySeason.entries()].sort((a, b) => b[0] - a[0]).map(([season, list]) => ({
      season, clips: list.sort((a, b) => rank(a.emote?.rarity) - rank(b.emote?.rarity) || a.label.localeCompare(b.label)),
    }));
  }, [emotes, deferredQuery, bodyOnly, rarityOrder, propsLoaded, animator]);
  const shownCount = groups.reduce((n, g) => n + g.clips.length, 0);
  const more = useMemo(() => [
    { label: "Idle loops", clips: clips.filter(c => c.kind === "idle") },
    { label: "Outfit reactions", clips: clips.filter(c => c.kind === "react") },
    { label: "Unlisted emote animations", note: "In the game files, but no current emote item plays them.", clips: clips.filter(c => c.kind === "emote" && (!c.emote || c.emote.unlisted)) },
  ].filter(g => g.clips.length), [clips]);

  const playing = state.current;
  const shownDetail = animator.info(detail ?? playing ?? "");
  const detailEmote = shownDetail?.emote && !shownDetail.emote.unlisted ? shownDetail : undefined;
  const missing = missingSummary(detailEmote, animator.props);

  const tile = (clip: ClipInfo) => {
    const icon = animator.iconUrl(clip);
    const badge = missingBadge(clip, animator.props);
    const active = playing === clip.id, loading = state.loading === clip.id;
    return (
      <button key={clip.id} type="button" aria-pressed={active}
        title={[clip.label, clip.emote?.translation && `${clip.emote.translation} (unofficial translation)`, missingSummary(clip, animator.props)].filter(Boolean).join(" · ")}
        onClick={() => onPlay(clip.id)} onPointerEnter={() => setDetail(clip.id)} onFocus={() => setDetail(clip.id)}
        className={`group relative flex flex-col bg-ink-900 text-left outline-none transition-colors [contain-intrinsic-size:auto_118px] [content-visibility:auto] hover:bg-ink-800 focus-visible:ring-2 focus-visible:ring-fg ${active ? "bg-ink-800" : ""}`}>
        <span className="relative block aspect-square overflow-hidden bg-ink-850">
          {icon && <img src={icon} alt="" width={80} height={80} loading="lazy" decoding="async"
            className="size-full object-cover transition-transform duration-200 ease-out group-hover:scale-[1.05]" />}
          {badge && <span className="absolute left-1 top-1 bg-ink-950/85 px-1 py-[3px] text-[8px] font-bold uppercase leading-none tracking-[0.08em] text-fg-muted">{badge}</span>}
          {loading && <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-[3px] overflow-hidden bg-ink-950/60"><span className="block h-full w-1/3 animate-sweep bg-fg" /></span>}
        </span>
        <span aria-hidden="true" className={`h-[3px] ${RARITY_BAR[clip.emote?.rarity ?? ""] ?? "bg-ink-700"}`} />
        {/* Padding outside the clamp: overflow clips at the padding edge, so a third line would peek into it. */}
        <span className="block px-1.5 pb-1.5 pt-1">
          <span lang={zhHans(clip.label)} className={`line-clamp-2 min-h-[2.4em] text-[10px] font-semibold uppercase leading-[1.2] tracking-[0.02em] [font-stretch:87.5%] [overflow-wrap:anywhere] ${active ? "text-fg" : "text-fg-muted group-hover:text-fg"}`}>
            {clip.label}
          </span>
        </span>
        {active && <span aria-hidden="true" className="pointer-events-none absolute inset-0 border-2 border-fg" />}
      </button>
    );
  };

  const tabButton = (value: Tab, label: ReactNode) => (
    <button type="button" aria-pressed={tab === value} onClick={() => setTab(value)}
      className={`hud h-8 border-b-2 px-2 transition-colors ${tab === value ? "border-finals text-fg" : "border-transparent text-fg-dim hover:text-fg-muted"}`}>
      {label}
    </button>
  );

  const body = (
    <div ref={panel} role="dialog" aria-label="Emotes" onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}
      onPointerLeave={() => setDetail(null)}
      style={dock ?? undefined}
      className={dock ? "z-40 flex flex-col border border-line bg-ink-950 shadow-2xl"
        : desktop ? "flex min-h-0 w-[23rem] max-w-[calc(100vw-2rem)] flex-col border border-line bg-ink-950/95 shadow-2xl"
        : "fixed inset-x-0 bottom-0 top-(--stage-h) z-40 flex flex-col border-t border-line bg-ink-950 pb-[env(safe-area-inset-bottom)]"}>
      <div className="flex shrink-0 items-center gap-1 border-b border-line pl-2 pr-1">
        {tabButton("emotes", <>Emotes <span className="text-fg-dim">{emotes.length}</span></>)}
        {tabButton("more", "More")}
        <button type="button" onClick={onClose} aria-label="Close emotes" title="Close (Esc)"
          className="ml-auto grid size-8 place-items-center text-fg-muted transition-colors hover:text-fg"><CloseIcon size={14} /></button>
      </div>
      {tab === "emotes" ? <>
        <div className="flex shrink-0 items-center gap-1.5 px-2 py-2">
          <label className="relative min-w-0 flex-1">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-dim" />
            <span className="sr-only">Search emotes</span>
            <input ref={search} type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search emotes"
              className="h-8 w-full border border-line bg-ink-900 pl-8 pr-2 text-[13px] text-fg outline-none transition-colors placeholder:text-fg-dim focus:border-ink-600" />
          </label>
          <button type="button" aria-pressed={bodyOnly} onClick={() => setBodyOnly(on => !on)}
            title="Only emotes this preview shows completely (no prop or effects in the game)"
            className={`hud flex h-8 shrink-0 items-center gap-1.5 border px-2 transition-colors ${bodyOnly ? "border-fg-dim text-fg" : "border-line text-fg-muted hover:text-fg"}`}>
            <span aria-hidden="true" className={`size-2 ${bodyOnly ? "bg-fg" : "border border-fg/50"}`} />
            Complete only
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2">
          {shownCount === 0 && <p className="py-6 text-center text-sm text-fg-muted">No emotes match.</p>}
          {groups.map(group => (
            <section key={group.season} aria-label={group.season ? `Season ${group.season}` : chinals ? "Chinals emotes" : "No season"}>
              <h3 className="hud sticky top-0 z-10 bg-ink-950 py-1.5 text-fg-dim">
                {group.season ? `Season ${group.season}` : chinals ? "Chinals emotes" : "Other"} <span className="text-ink-600">·</span> {group.clips.length}
              </h3>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-1">{group.clips.map(tile)}</div>
            </section>
          ))}
        </div>
      </> : (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2">
          {more.map(group => (
            <section key={group.label} className="mb-3">
              <h3 className="hud py-1.5 text-fg-dim">{group.label}</h3>
              {"note" in group && group.note && <p className="mb-1.5 text-[11px] text-fg-dim">{group.note}</p>}
              <div className="flex flex-wrap gap-1">
                {group.clips.map(clip => (
                  <button key={clip.id} type="button" aria-pressed={playing === clip.id} onClick={() => onPlay(clip.id)}
                    className={`h-8 border px-2.5 text-[12px] font-semibold transition-colors [font-stretch:87.5%] ${playing === clip.id ? "border-fg text-fg" : "border-line text-fg-muted hover:border-fg-dim hover:text-fg"}`}>
                    {clip.label}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
      <div aria-live="polite" className="min-h-[3.25rem] shrink-0 border-t border-line px-2.5 py-1.5">
        {detailEmote ? <>
          <p className="truncate text-[12px] font-semibold text-fg">
            <span lang={zhHans(detailEmote.label)}>{detailEmote.label}</span>
            {detailEmote.emote?.nameZh && <span lang="zh-Hans" className="ml-1.5 font-normal text-fg-muted">{detailEmote.emote.nameZh}</span>}
            <span className="hud ml-2 text-fg-dim">{[chinals ? "Chinals exclusive" : null, detailEmote.emote?.rarity, detailEmote.emote?.season ? `Season ${detailEmote.emote.season}` : null].filter(Boolean).join(" · ")}</span>
          </p>
          {detailEmote.emote?.translation && <p className="truncate text-[11px] leading-snug text-fg-muted">
            “{detailEmote.emote.translation}” <span className="text-fg-dim">(unofficial translation by this site)</span>
          </p>}
          <p className={`text-[11px] leading-snug ${missing ? "text-fg-muted" : "text-fg-dim"}`}>
            {missing ?? "No prop or effects in the game."}
            {detailEmote.emote?.itemProps?.length ? " Extra prop with a matching cosmetic." : ""}
          </p>
        </> : <p className="text-[11px] leading-snug text-fg-dim">
          {chinals ? "Chinals emotes on your outfit (global cosmetics)" : "The game's emote animations on your outfit"}, with
          their props{animator.sounds.available ? " and sound" : ""}. Effects and facial expressions are not shown yet.
        </p>}
      </div>
    </div>
  );
  return desktop && !dock ? body : createPortal(body, document.body);
}
