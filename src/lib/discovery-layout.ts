// Where the discovery layer (components/Discovery.tsx) puts a callout or the tour card beside a control: plain geometry,
// kept apart from the DOM so it can be tested.

export interface Box { left: number; top: number; width: number; height: number }
export type Side = "below" | "above" | "left" | "right";
export interface Placement { left: number; top: number; side: Side | "dock-top" | "dock-bottom"; /** Notch offset along the facing edge. */ notch: number }

/** Distance from a point to a box (0 inside it). */
export function distanceToBox(x: number, y: number, box: Box): number {
  const dx = Math.max(box.left - x, 0, x - (box.left + box.width));
  const dy = Math.max(box.top - y, 0, y - (box.top + box.height));
  return Math.hypot(dx, dy);
}

export const inflate = (box: Box, by: number): Box =>
  ({ left: box.left - by, top: box.top - by, width: box.width + 2 * by, height: box.height + 2 * by });

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

/**
 * Beside the target on the first side in `order` where it fits whole in the viewport (with `margin`), lined up with
 * the target's centre and slid back inside the viewport. When no side fits (a small screen, a wide target), it docks
 * along the top or the bottom edge, whichever leaves the target clear.
 */
export function place(target: Box, size: { width: number; height: number }, viewport: { width: number; height: number },
  { gap = 10, margin = 12, order = ["below", "above", "left", "right"] as readonly Side[] } = {}): Placement {
  const fits = (left: number, top: number) => left >= margin && top >= margin
    && left + size.width <= viewport.width - margin && top + size.height <= viewport.height - margin;
  const cx = target.left + target.width / 2, cy = target.top + target.height / 2;
  for (const side of order) {
    let left: number, top: number;
    if (side === "below" || side === "above") {
      left = clamp(cx - size.width / 2, margin, viewport.width - margin - size.width);
      top = side === "below" ? target.top + target.height + gap : target.top - gap - size.height;
    } else {
      top = clamp(cy - size.height / 2, margin, viewport.height - margin - size.height);
      left = side === "right" ? target.left + target.width + gap : target.left - gap - size.width;
    }
    if (fits(left, top)) {
      const notch = side === "below" || side === "above" ? clamp(cx - left, 10, size.width - 10) : clamp(cy - top, 10, size.height - 10);
      return { left, top, side, notch };
    }
  }
  const left = clamp(cx - size.width / 2, margin, viewport.width - margin - size.width);
  const dockBottom = cy < viewport.height / 2;
  return { left, top: dockBottom ? viewport.height - margin - size.height : margin, side: dockBottom ? "dock-bottom" : "dock-top", notch: 0 };
}

/** Pointer callouts are for controls, not regions: a big target (the slot rail, the timeline) waits for the tour. */
export const CONTROL_MAX = { width: 320, height: 120 };
export const isControlSized = (box: Box) => box.width <= CONTROL_MAX.width && box.height <= CONTROL_MAX.height;

/**
 * The control a pointer at (x, y) is calling for: the nearest within `radius` of it (each candidate has its own radius,
 * 0 for "only when over it"). Nested targets tie at distance 0; the smaller one wins, as the more specific.
 */
export function nearest<T extends { box: Box; radius: number }>(x: number, y: number, candidates: readonly T[]): T | null {
  let best: T | null = null, bestDistance = Infinity, bestArea = Infinity;
  for (const candidate of candidates) {
    const distance = distanceToBox(x, y, candidate.box);
    if (distance > candidate.radius) continue;
    const area = candidate.box.width * candidate.box.height;
    if (distance < bestDistance || (distance === bestDistance && area < bestArea)) {
      best = candidate; bestDistance = distance; bestArea = area;
    }
  }
  return best;
}
