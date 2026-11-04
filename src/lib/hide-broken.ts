import type { SyntheticEvent } from "react";

// A thumbnail that fails to load shows nothing rather than the browser's broken-image glyph;
// the tile's own background stays as the honest "not here" surface.
export function hideBroken(event: SyntheticEvent<HTMLImageElement>) {
  event.currentTarget.style.visibility = "hidden";
}
