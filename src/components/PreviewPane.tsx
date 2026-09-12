import { SLOTS, SLOT_LABELS, type Slot } from "../lib/slots";
import { getBrowseItem as getItemById } from "../lib/browse-catalog";
import { useBuildStore } from "../store/useBuildStore";
import { assetUrl } from "../lib/assets";
import CharacterViewer from "./CharacterViewer";

export default function PreviewPane() {
  const build = useBuildStore((s) => s.build);
  const unequip = useBuildStore((s) => s.unequip);
  const reset = useBuildStore((s) => s.reset);

  const equipped = SLOTS.map((slot) => ({
    slot,
    item: build[slot] ? getItemById(build[slot]!) : undefined,
  })).filter((e): e is { slot: Slot; item: NonNullable<typeof e.item> } => !!e.item);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="min-h-0 w-full flex-1 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950">
        <CharacterViewer />
      </div>

      <div className="flex shrink-0 items-center justify-between">
        <h2 className="text-sm font-medium text-neutral-300">
          Your build <span className="text-neutral-500">({equipped.length})</span>
        </h2>
        {equipped.length > 0 && (
          <button
            onClick={reset}
            className="text-xs text-neutral-400 hover:text-neutral-200"
          >
            Reset
          </button>
        )}
      </div>

      {equipped.length === 0 ? (
        <p className="hidden shrink-0 text-sm text-neutral-500 lg:block">
          Pick cosmetics from the slots on the right to build a look.
        </p>
      ) : (
        <ul className="grid max-h-16 shrink-0 grid-cols-2 gap-2 overflow-y-auto overscroll-contain sm:grid-cols-3 lg:max-h-32">
          {equipped.map(({ slot, item }) => (
            <li key={slot}>
              <button
                onClick={() => unequip(slot)}
                title={`Remove ${item.name}`}
                className="flex w-full items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900 p-2 text-left hover:border-neutral-600"
              >
                <img
                  src={assetUrl(item.imageUrl)}
                  alt=""
                  className="h-10 w-10 shrink-0 rounded object-contain"
                />
                <span className="min-w-0">
                  <span className="block truncate text-xs text-neutral-200">
                    {item.name}
                  </span>
                  <span className="block text-[10px] uppercase tracking-wide text-neutral-500">
                    {SLOT_LABELS[slot]}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
