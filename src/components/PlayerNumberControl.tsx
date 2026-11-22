import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { useBuildStore } from "../store/useBuildStore";
import { isPlayerNumber, PLAYER_NUMBER_MAX, PLAYER_NUMBER_MIN, shownPlayerNumber } from "../lib/player-number";
import { playerNumberPieces, subscribePlayerNumberPieces } from "../rig/PlayerNumber";

// The player (contestant) number: part of the outfit, saved and shared with it (lib/player-number.ts). "Own" shows
// each piece's authored number, as the item icons do; a number 0-99 replaces it on every piece that prints one (a
// one-digit number prints centred, as in game). There is no "off": the game has none (lib/player-number.ts).
export default function PlayerNumberControl() {
  const stored = useBuildStore((s) => s.playerNumber);
  const setPlayerNumber = useBuildStore((s) => s.setPlayerNumber);
  const shown = shownPlayerNumber(stored);
  const pieces = useSyncExternalStore(subscribePlayerNumberPieces, playerNumberPieces);
  const [draft, setDraft] = useState(shown === null ? "" : String(shown));
  const hintId = useId();

  // Another outfit, a link or another tab changed it: show that, unless the field already says the same number
  // (an empty field is not 0).
  useEffect(() => {
    setDraft(current => (current !== "" && Number(current) === shown) ? current
      : shown === null ? "" : String(shown));
  }, [shown]);

  const edit = (text: string) => {
    const digits = text.replace(/\D/g, "").slice(0, 2);
    setDraft(digits);
    const value = Number(digits);
    if (digits !== "" && isPlayerNumber(value)) setPlayerNumber(value);
  };
  // Leaving the field: an empty field means each piece's own number; a number is shown as it is stored ("07" is 7).
  const commit = () => {
    if (draft === "") setPlayerNumber(null);
    else setDraft(isPlayerNumber(Number(draft)) ? String(Number(draft)) : shown === null ? "" : String(shown));
  };

  const hint = pieces === 0 ? "Nothing equipped prints a number"
    : `On ${pieces} ${pieces === 1 ? "piece" : "pieces"}${shown === null ? " · each shows its own" : ""}`;

  return (
    <div role="group" aria-label="Player number" className="flex flex-wrap items-center gap-2.5">
      <span aria-hidden="true" className="hud text-fg-dim">Number</span>
      <div className="flex border border-line">
        <button type="button" aria-pressed={shown === null} onClick={() => { setPlayerNumber(null); setDraft(""); }}
          title="Each piece shows the number it was made with, as in its icon"
          className={`h-8 px-3 text-[13px] font-semibold uppercase tracking-[0.02em] [font-stretch:87.5%] transition-colors
            ${shown === null ? "bg-fg text-ink-950" : "bg-ink-900 text-fg-muted hover:bg-ink-850 hover:text-fg"}`}>
          Own
        </button>
        <input type="text" inputMode="numeric" autoComplete="off" maxLength={2} value={draft}
          placeholder={`${PLAYER_NUMBER_MIN}–${PLAYER_NUMBER_MAX}`} aria-label={`Player number, ${PLAYER_NUMBER_MIN} to ${PLAYER_NUMBER_MAX}`}
          aria-describedby={hintId}
          title={`Your number on every piece that prints one in game (${PLAYER_NUMBER_MIN}–${PLAYER_NUMBER_MAX})`}
          onChange={e => edit(e.target.value)} onBlur={commit}
          onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setDraft(shown === null ? "" : String(shown)); e.currentTarget.blur(); } }}
          className={`h-8 w-16 border-l border-line px-2 text-center text-[15px] font-semibold tabular-nums outline-none transition-colors
            placeholder:text-[12px] placeholder:font-normal placeholder:text-fg-dim focus:bg-ink-800
            ${shown !== null ? "bg-fg text-ink-950 focus:text-fg" : "bg-ink-900 text-fg"}`} />
      </div>
      <span id={hintId} className="hud text-[10px] text-fg-dim">{hint}</span>
    </div>
  );
}
