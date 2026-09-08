// MeshInspector — DEV-only panel (gated by ?inspect=1) that reports what is ACTUALLY in the
// scene: every mesh, its primitives' materials, and which texture each map slot ended up
// holding. Never shipped to users.
//
// WHY THIS EXISTS. On 2026-08-15 the owner looked at a rendered helmet and asked whether the
// visor was a separate mesh, because something looked wrong inside it. Answering took
// gltf-transform queries in a terminal, and turned up two defects no automated check had
// reported: the piece is two primitives whose materials the runtime flattens into one, and
// every mesh is double-sided so the shell's interior renders through the visor opening.
//
// So this is an inspector, not a tuner. The test it is built against: the owner can answer
// "what am I looking at" without an agent running a query.
//
// It docks to the RIGHT EDGE OF THE WINDOW, not to the canvas. The MaterialTuner is absolutely
// positioned inside the viewer at 300px full-height, which occludes about a third of the render
// including the model being inspected — the first thing said about it in use. A sibling column
// does not work either: CharacterViewer is embedded in a bounded preview card, so a column
// inside it is clipped. Fixed to the window keeps the model, on the left, completely clear.
import { useCallback, useEffect, useState } from "react";
import type { CharacterRig, InspectGroup } from "../rig/CharacterRig";

const MAP_LABEL: Record<string, string> = {
  map: "base colour",
  normalMap: "normal",
  roughnessMap: "roughness",
  metalnessMap: "metalness",
  alphaMap: "alpha",
  emissiveMap: "emissive",
};

/** Trim a texture URL to something readable without losing which file it is. */
function shortSrc(src: string): string {
  if (!src.startsWith("http") && !src.startsWith("/")) return src; // "(embedded in mesh)"
  const file = src.split("?")[0].split("/").pop() ?? src;
  return decodeURIComponent(file);
}

function MaterialRow({ m }: { m: InspectGroup["meshes"][number]["materials"][number] }) {
  const bound = Object.entries(m.maps).filter(([, v]) => v);
  return (
    <div className="mt-1.5 border-l border-neutral-700 pl-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="text-[11px] text-neutral-200">{m.name}</span>
        <span
          className={
            "rounded px-1 py-px text-[10px] " +
            (m.side === "double" ? "bg-amber-900/60 text-amber-200" : "bg-neutral-700 text-neutral-300")
          }
          title={
            m.side === "double"
              ? "Back faces render. Correct for cloth and chainmail; on a closed solid you see its interior."
              : "Back faces culled."
          }
        >
          {m.side}-sided
        </span>
        {m.transparent && <span className="rounded bg-neutral-700 px-1 py-px text-[10px]">transparent</span>}
        {m.alphaTest > 0 && (
          <span className="rounded bg-neutral-700 px-1 py-px text-[10px]">alphaTest {m.alphaTest.toFixed(2)}</span>
        )}
      </div>
      {bound.length === 0 ? (
        <div className="text-[10px] text-neutral-500">no maps bound</div>
      ) : (
        <table className="mt-0.5 w-full">
          <tbody>
            {bound.map(([k, v]) => (
              <tr key={k}>
                <td className="w-[5.5rem] align-top text-[10px] text-neutral-500">{MAP_LABEL[k] ?? k}</td>
                <td className="break-all text-[10px] text-neutral-400">{shortSrc(v!)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function MeshInspector({ rig }: { rig: CharacterRig }) {
  const [groups, setGroups] = useState<InspectGroup[]>([]);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  // The rig mutates the scene outside React (equip is async and self-driven), so poll rather
  // than trying to mirror its lifecycle. Cheap: a traversal of a few thousand nodes.
  const refresh = useCallback(() => setGroups(rig.inspect()), [rig]);
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 1000);
    return () => clearInterval(id);
  }, [refresh]);

  const totals = groups.reduce(
    (a, g) => {
      for (const m of g.meshes) {
        a.meshes++;
        a.tris += m.triangles;
        a.mats += m.materials.length;
        if (m.materials.some((x) => x.side === "double")) a.dbl++;
      }
      return a;
    },
    { meshes: 0, tris: 0, mats: 0, dbl: 0 },
  );

  return (
    <aside className="fixed right-0 top-0 z-50 flex h-screen w-[22rem] flex-col overflow-y-auto border-l border-neutral-700 bg-neutral-900/95 text-neutral-200 backdrop-blur">
      <div className="sticky top-0 z-10 border-b border-neutral-700 bg-neutral-900 px-3 py-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-sky-300">Mesh inspector · dev</div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] tabular-nums text-neutral-400">
          <span>{totals.meshes} meshes</span>
          <span>{totals.mats} materials</span>
          <span>{totals.tris.toLocaleString()} tris</span>
          <span className={totals.dbl ? "text-amber-300" : ""}>{totals.dbl} double-sided</span>
        </div>
      </div>

      <div className="flex-1 px-3 py-2">
        {groups.length === 0 && <p className="text-[11px] text-neutral-500">Nothing equipped yet.</p>}

        {groups.map((g) => (
          <section key={g.label + g.id} className="mb-3">
            <div className="flex items-baseline gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-300">{g.label}</span>
              <span className="truncate text-[10px] text-neutral-500" title={g.id}>
                {g.id}
              </span>
            </div>

            {g.meshes.map((m) => {
              const key = m.uuid;
              const isOpen = open[key] ?? g.meshes.length <= 3;
              const anyDouble = m.materials.some((x) => x.side === "double");
              return (
                <div key={key} className="mt-1 rounded border border-neutral-700/70 bg-neutral-800/40 p-1.5">
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setOpen((o) => ({ ...o, [key]: !isOpen }))}
                      className="text-[10px] text-neutral-500 hover:text-neutral-300"
                      aria-label={isOpen ? "Collapse" : "Expand"}
                    >
                      {isOpen ? "▾" : "▸"}
                    </button>
                    <span className="flex-1 truncate text-[11px]" title={m.name}>
                      {m.name}
                    </span>
                    <span className="text-[10px] tabular-nums text-neutral-500">
                      {m.triangles.toLocaleString()} tris
                    </span>
                  </div>

                  <div className="mt-1 flex flex-wrap gap-1">
                    <button
                      onClick={() => {
                        rig.setMeshVisible(m.uuid, !m.visible);
                        refresh();
                      }}
                      className={
                        "rounded px-1.5 py-px text-[10px] " +
                        (m.visible ? "bg-neutral-700 hover:bg-neutral-600" : "bg-sky-600 text-white")
                      }
                    >
                      {m.visible ? "hide" : "hidden — show"}
                    </button>
                    <button
                      onClick={() => {
                        rig.setMeshSide(m.uuid, anyDouble ? "front" : "double");
                        refresh();
                      }}
                      className="rounded bg-neutral-700 px-1.5 py-px text-[10px] hover:bg-neutral-600"
                      title="Toggle back-face culling for this mesh"
                    >
                      {anyDouble ? "cull back faces" : "show back faces"}
                    </button>
                    {m.skinned && <span className="px-1 py-px text-[10px] text-neutral-500">skinned</span>}
                  </div>

                  {isOpen && m.materials.map((mat, i) => <MaterialRow key={i} m={mat} />)}
                </div>
              );
            })}
          </section>
        ))}
      </div>

      <p className="border-t border-neutral-700 px-3 py-2 text-[10px] leading-snug text-neutral-500">
        Reports the live scene, not the catalog. Where a piece has several primitives, check
        whether they really carry different textures — the runtime assigns one baked set to every
        material on a mesh.
      </p>
    </aside>
  );
}
