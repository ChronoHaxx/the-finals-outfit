/**
 * Pointers a tool in the 3D view has taken over (21 Nov 2026: a light marker being dragged, LightMarkers.tsx). The view
 * has other drag handlers on the same canvas (the orbit camera, the scene turntable); they ignore a claimed pointer, so
 * dragging a marker moves the light and nothing else. A claim lasts from pointerdown to pointerup or pointercancel.
 */
const claimed = new Set<number>();

export function claimPointer(id: number): void { claimed.add(id); }
export function releasePointer(id: number): void { claimed.delete(id); }
export function pointerClaimed(id: number): boolean { return claimed.has(id); }
