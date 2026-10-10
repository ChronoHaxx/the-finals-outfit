import source from '../data/source-equipment-slots.json';
import { getItemById } from './catalog';
import { SLOTS, type Slot } from './slots';

type Selection = Readonly<Partial<Record<Slot, string | null>>>;
const fullBody = new Set(source.fullBody);
const occupancy: Readonly<Record<string, readonly string[]>> = source.slotsByItem;

// Deliberately limited to source-declared full-body garments. Applying every
// source slot as an equipment ban would change existing hair/hat and coat rules.
export function equipmentConflicts(aSlot: Slot, aId: string, bSlot: Slot, bId: string): boolean {
  if (aSlot === bSlot || (!fullBody.has(aId) && !fullBody.has(bId))) return false;
  // Invalid/unknown link entries must not evict valid selections before filtering.
  if (getItemById(aId)?.slot !== aSlot || getItemById(bId)?.slot !== bSlot) return false;
  return (occupancy[aId] ?? []).some(s => (occupancy[bId] ?? []).includes(s));
}

/** New explicit equip wins. With no history, full-body garments win in stable slot
 * order. A randomiser can protect locked slots before considering new picks. */
export function resolveEquipmentSlots(
  selection: Selection, preferred?: Slot, protectedSlots: ReadonlySet<Slot> = new Set(),
): { slots: Partial<Record<Slot, string>>; removed: Slot[] } {
  const rank = (slot: Slot) => slot === preferred ? 0 : protectedSlots.has(slot) ? 1
    : fullBody.has(selection[slot] ?? '') ? 2 : 3;
  const order = [...SLOTS].sort((a, b) => rank(a) - rank(b));
  const accepted: Slot[] = [], removed: Slot[] = [];
  for (const slot of order) {
    const id = selection[slot];
    if (!id) continue;
    if (accepted.some(other => equipmentConflicts(slot, id, other, selection[other]!))) removed.push(slot);
    else accepted.push(slot);
  }
  // Keep stable serialization order regardless of the priority used above.
  const slots: Partial<Record<Slot, string>> = {};
  for (const slot of SLOTS) if (selection[slot] && !removed.includes(slot)) slots[slot] = selection[slot]!;
  return { slots, removed };
}
