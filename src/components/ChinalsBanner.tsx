// What Chinals mode is, said on screen while it is on (lib/site-mode.ts). Draft wording for the site owner to edit:
// _docs/chinals-mode-2026-11-12/README.md lists it. Honest about where the files came from, what is reconstructed,
// what is not shown, and that the outfit itself is made of global items.
export function ChinalsBanner() {
  return <details className="group border-b border-line bg-ink-900 px-4 py-2 text-xs text-fg-muted">
    <summary className="flex cursor-pointer list-none items-start gap-2 [&::-webkit-details-marker]:hidden">
      <span aria-hidden="true" className="mt-[3px] h-3 w-1 shrink-0 bg-finals" />
      <span className="flex-1">
        <strong className="font-semibold text-fg"><span lang="zh-Hans">终极角逐</span> Chinals mode</strong>
        {" "}· Emotes from THE FINALS as Tencent publishes it in mainland China, played on global cosmetics.
        {" "}Fan-made; not affiliated with Embark Studios, Nexon or Tencent.
      </span>
      <span className="hud shrink-0 text-fg-dim group-open:hidden">More</span>
      <span className="hud hidden shrink-0 text-fg-dim group-open:inline">Less</span>
    </summary>
    <div className="mt-2 max-w-3xl space-y-1.5 pl-3 leading-relaxed">
      <p>
        The emotes come from the China client's game files (October 2026), supplied by a community member, and are
        reconstructed the same way as the rest of this site. Most can't be obtained outside China. We don't show
        prices, events or how to get them.
      </p>
      <p>
        Names: the game's own English text where it has one. Otherwise the Chinese name, with our own unofficial
        translation marked as such. Props are shown; effects, sound and facial expressions are not.
      </p>
      <p>
        There are no Chinals cosmetics on the site yet: the outfit is made of global items, and it is the same outfit
        in both modes.
      </p>
    </div>
  </details>;
}
