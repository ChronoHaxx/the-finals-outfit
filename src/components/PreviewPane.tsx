import BuildList from "./BuildList";
import CharacterViewer from "./CharacterViewer";

// The 3D preview. On wide screens the build list sits beneath it; on phones it lives in the bottom sheet instead
// (Builder.tsx), so the character keeps the space above the sheet.
export default function PreviewPane() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="min-h-0 w-full flex-1 overflow-hidden bg-neutral-950 lg:rounded-xl lg:border lg:border-neutral-800">
        <CharacterViewer />
      </div>
      <div className="hidden lg:contents">
        <BuildList variant="grid" />
      </div>
    </div>
  );
}
