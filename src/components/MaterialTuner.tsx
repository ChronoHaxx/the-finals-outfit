// MaterialTuner — DEV-only panel (gated by ?tune=1) that puts the official item icon next to the
// live 3D render and exposes per-item material sliders, so the correct lit look can be dialled in
// BY EYE against the icon (the project's primary verification rule) instead of bake→import→guess.
// The sliders push global PBR factors onto the equipped meshes via rig.setMaterialParams; Export
// copies the tuned values as JSON to fold back into the bake/import. Never shipped to users.
import { useEffect, useMemo, useState } from "react";
import type { CharacterRig } from "../rig/CharacterRig";
import { useBuildStore, effectiveBuild } from "../store/useBuildStore";
import { getItemById } from "../lib/catalog";
import { assetUrl } from "../lib/assets";
import { SLOTS, type Slot } from "../lib/slots";

interface TuneParams {
  roughness: number;
  metalness: number;
  normalScale: number;
  envMapIntensity: number;
  colorHex: string;
}
const DEFAULTS: TuneParams = {
  roughness: 1,
  metalness: 1,
  normalScale: 1,
  envMapIntensity: 1,
  colorHex: "#ffffff",
};
const isDefault = (p: TuneParams) =>
  p.roughness === 1 && p.metalness === 1 && p.normalScale === 1 && p.envMapIntensity === 1 && p.colorHex === "#ffffff";

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <div className="flex justify-between text-[11px] text-neutral-300">
        <span>{label}</span>
        <span className="tabular-nums text-neutral-400">{value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-sky-400"
      />
    </label>
  );
}

export default function MaterialTuner({ rig }: { rig: CharacterRig }) {
  const build = useBuildStore((s) => s.build);
  // Equipped slots that carry a 3D mesh (the tuner can only touch materials, not 2D decals).
  // effectiveBuild so the auto-substituted open-coat undersuit shows up as a tunable slot too.
  const eff = useMemo(() => effectiveBuild(build), [build]);
  const slots = useMemo(
    () => SLOTS.filter((s) => eff[s] && getItemById(eff[s]!)?.model?.gltfPath),
    [eff],
  );
  const [slot, setSlot] = useState<Slot | null>(null);
  const [params, setParams] = useState<Partial<Record<Slot, TuneParams>>>({});

  // Keep a valid selection as the build changes.
  useEffect(() => {
    if (!slot || !slots.includes(slot)) setSlot(slots[0] ?? null);
  }, [slots, slot]);

  // Re-equip (build change) rebuilds materials from the baked defaults, so re-push any non-default
  // tweaks once the async equip loop has settled (rigIdle), per slot.
  useEffect(() => {
    let tries = 0;
    const id = setInterval(() => {
      const idle = (window as unknown as { __rigIdle?: boolean }).__rigIdle;
      if (idle || tries++ > 20) {
        clearInterval(id);
        for (const s of SLOTS) {
          const p = params[s];
          if (p && !isDefault(p)) rig.setMaterialParams(s, p);
        }
      }
    }, 150);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eff, rig]);

  const cur = (slot && params[slot]) || DEFAULTS;
  const item = slot ? getItemById(eff[slot]!) : undefined;

  const set = (patch: Partial<TuneParams>) => {
    if (!slot) return;
    const next = { ...cur, ...patch };
    setParams((prev) => ({ ...prev, [slot]: next }));
    rig.setMaterialParams(slot, next);
  };

  const reset = () => {
    if (!slot) return;
    setParams((prev) => ({ ...prev, [slot]: { ...DEFAULTS } }));
    rig.setMaterialParams(slot, DEFAULTS);
  };

  const exportJson = () => {
    const out: Record<string, TuneParams> = {};
    for (const s of SLOTS) {
      const p = params[s];
      const id = eff[s];
      if (p && id && !isDefault(p)) out[id] = p;
    }
    const json = JSON.stringify(out, null, 2);
    navigator.clipboard?.writeText(json).catch(() => {});
    // eslint-disable-next-line no-console
    console.log("[MaterialTuner] tuned params:\n" + json);
  };

  return (
    <div className="absolute right-0 top-0 z-20 flex h-full w-[300px] flex-col gap-3 overflow-y-auto bg-neutral-900/85 p-3 text-sm text-neutral-200 backdrop-blur">
      <div className="text-xs font-semibold uppercase tracking-wide text-sky-300">Material Tuner · dev</div>

      {/* Equipped slot picker */}
      <div className="flex flex-wrap gap-1">
        {slots.map((s) => (
          <button
            key={s}
            onClick={() => setSlot(s)}
            className={
              "rounded px-2 py-0.5 text-[11px] " +
              (s === slot ? "bg-sky-500 text-white" : "bg-neutral-700/70 text-neutral-300 hover:bg-neutral-600")
            }
          >
            {s}
          </button>
        ))}
        {!slots.length && <span className="text-[11px] text-neutral-500">no meshed items equipped</span>}
      </div>

      {item && (
        <>
          <div className="text-[11px] leading-tight text-neutral-400">
            {item.name}
            <span className="ml-1 text-neutral-600">({item.id})</span>
          </div>
          {/* Official icon = the match target. Eyeball the render (left) against this. */}
          <div className="rounded bg-neutral-800/80 p-1">
            <div className="mb-1 text-[10px] uppercase tracking-wide text-neutral-500">official icon</div>
            <img
              src={assetUrl(item.imageUrl)}
              alt={item.name}
              className="mx-auto block w-full max-w-[180px] rounded bg-neutral-200/5"
            />
          </div>

          <div className="flex flex-col gap-2.5">
            <Slider label="Roughness ×" value={cur.roughness} min={0} max={1} step={0.01} onChange={(v) => set({ roughness: v })} />
            <Slider label="Metalness ×" value={cur.metalness} min={0} max={1} step={0.01} onChange={(v) => set({ metalness: v })} />
            <Slider label="Normal scale" value={cur.normalScale} min={0} max={3} step={0.05} onChange={(v) => set({ normalScale: v })} />
            <Slider label="Env intensity" value={cur.envMapIntensity} min={0} max={3} step={0.05} onChange={(v) => set({ envMapIntensity: v })} />
            <label className="flex items-center justify-between text-[11px] text-neutral-300">
              <span>Colour ×</span>
              <input
                type="color"
                value={cur.colorHex}
                onChange={(e) => set({ colorHex: e.target.value })}
                className="h-6 w-10 cursor-pointer rounded border border-neutral-600 bg-transparent"
              />
            </label>
          </div>

          <div className="mt-1 flex gap-2">
            <button onClick={reset} className="flex-1 rounded bg-neutral-700 px-2 py-1 text-[11px] hover:bg-neutral-600">
              Reset
            </button>
            <button onClick={exportJson} className="flex-1 rounded bg-sky-600 px-2 py-1 text-[11px] text-white hover:bg-sky-500">
              Export JSON
            </button>
          </div>
          <p className="text-[10px] leading-snug text-neutral-500">
            Roughness/Metalness are factors over the baked maps (work on baked pieces; region-tinted
            pieces set those per-region in-shader). Export copies tuned values (keyed by item id) to
            the clipboard + console.
          </p>
        </>
      )}
    </div>
  );
}
