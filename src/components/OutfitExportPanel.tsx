import { useState, type RefObject } from "react";
import type * as THREE from "three";
import type { CharacterRig } from "../rig/CharacterRig";
import { zipSync, type Zippable } from "three/examples/jsm/libs/fflate.module.js";
import { exportOutfit, type ExportPose } from "../rig/OutfitExport";
import { collectSourceFiles } from "../rig/OutfitSourceExport";
import { useBuildStore } from "../store/useBuildStore";

export interface ExportContext { gl: THREE.WebGLRenderer; camera: THREE.Camera }

// Developer catalog only: download the current outfit as a baked .glb for Blender, Unity or Unreal, optionally
// zipped with the source files behind it (meshes, textures, definitions) in an FModel-style layout.
export default function OutfitExportPanel({ rig, context, busy }: {
  rig: CharacterRig; context: RefObject<ExportContext | null>; busy: boolean;
}) {
  const [textureSize, setTextureSize] = useState(1024);
  const [pose, setPose] = useState<ExportPose>("bind");
  const [includeSource, setIncludeSource] = useState(false);
  const build = useBuildStore((s) => s.build);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const run = async () => {
    const ctx = context.current;
    if (!ctx || running) return;
    setRunning(true);
    setStatus("Preparing…");
    try {
      const result = await exportOutfit(rig.root, ctx.gl, ctx.camera, { textureSize, pose, onProgress: setStatus });
      const warnings = [...result.warnings];
      let file: Uint8Array | ArrayBuffer = result.glb, type = "model/gltf-binary", extension = "glb";
      if (includeSource) {
        const ids = Object.values(build).filter((id): id is string => typeof id === "string");
        const source = await collectSourceFiles(rig.root, ids.map(id => ({ id, objects: rig.equippedObjects(id) })), setStatus);
        warnings.push(...source.notes);
        setStatus("Zipping…");
        // Images and meshes are already compressed: store them; deflate only the text files.
        const entries: Zippable = { "outfit.glb": [new Uint8Array(result.glb), { level: 0 }] };
        for (const [path, data] of Object.entries(source.files))
          entries[path] = [data, { level: /\.(json|txt)$/.test(path) ? 6 : 0 }];
        file = zipSync(entries);
        type = "application/zip";
        extension = "zip";
      }
      const url = URL.createObjectURL(new Blob([file as BlobPart], { type }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `finals-outfit-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.${extension}`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      for (const warning of warnings) console.warn("[outfit export]", warning);
      setStatus(`Saved ${(file.byteLength / 1048576).toFixed(1)} MB · ${result.bakedSections} baked materials`
        + (warnings.length ? ` · ${warnings.length} warnings in console` : ""));
    } catch (error) {
      console.error(error);
      setStatus(`Export failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <details className="absolute right-2 top-10 z-10 w-60 rounded-md bg-black/60 text-xs text-white backdrop-blur">
      <summary className="cursor-pointer select-none px-2.5 py-1 font-medium">Export 3D</summary>
      <div className="space-y-2 px-2.5 pb-2.5">
        <label className="flex items-center justify-between gap-2">
          Texture size
          <select className="rounded bg-neutral-800 p-1" value={textureSize} disabled={running}
            onChange={(event) => setTextureSize(Number(event.target.value))}>
            <option value={1024}>1024</option>
            <option value={2048}>2048 (slower)</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={pose === "bind"} disabled={running}
            onChange={(event) => setPose(event.target.checked ? "bind" : "preview")} />
          Rest pose (best for rigging)
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={includeSource} disabled={running}
            onChange={(event) => setIncludeSource(event.target.checked)} />
          Include source files (FModel-style .zip)
        </label>
        <button className="w-full rounded bg-neutral-700 px-2 py-1.5 font-medium hover:bg-neutral-600 disabled:opacity-50"
          disabled={running || busy} onClick={run}>
          {running ? "Exporting…" : includeSource ? "Download .zip" : "Download .glb"}
        </button>
        {status && <p role="status" className="text-neutral-200">{status}</p>}
        <p className="text-[11px] leading-snug text-neutral-400">
          Blender: File › Import › glTF 2.0. Unity: glTFast package. Unreal 5: drag in (glTF importer).
          Keep the outfit unchanged while it bakes.
        </p>
      </div>
    </details>
  );
}
