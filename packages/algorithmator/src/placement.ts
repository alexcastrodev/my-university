import { VizMode, VizSlot } from './types';

export interface PlacementConfig {
  /** Build the fixed set of slots up front, from the full item list (e.g. table capacity from key count). */
  slots: (items: string[]) => VizSlot[];
  /** Which slot a given item (at a given index) lands in. */
  slotOf: (item: string, index: number, slots: VizSlot[]) => string;
  /** Small caption next to the Replay button, e.g. "Table capacity: 8". */
  meta?: (slots: VizSlot[]) => string;
  /** Per-step caption. Defaults to a generic "X -> slot Y" / "X collides in slot Y" line. */
  captionFor?: (item: string, slot: string, collision: boolean) => string;
}

const defaultCaption = (item: string, slot: string, collision: boolean): string =>
  collision ? `"${item}" collides in slot ${slot}` : `"${item}" → slot ${slot}`;

// Covers any "place items one at a time into a slot computed from the item" visualization —
// hash tables, arrays, anything where the only real per-mode logic is *where does this item go*.
// Handles collision bookkeeping and step/caption assembly generically so a mode only supplies
// the placement math. Modes that need move/remove semantics (LRU eviction, etc.) build a
// VizScene by hand instead — see types.ts.
export function placementMode(config: PlacementConfig): VizMode {
  return (items) => {
    const slots = config.slots(items);
    const slotOf = (item: string, index: number): string => config.slotOf(item, index, slots);
    const captionFor = config.captionFor ?? defaultCaption;

    const seen = new Set<string>();
    const collisions = new Set<string>();
    items.forEach((item, index) => {
      const slot = slotOf(item, index);
      if (seen.has(slot)) collisions.add(slot);
      seen.add(slot);
    });

    return {
      meta: config.meta?.(slots),
      slots,
      steps: items.map((item, index) => {
        const slot = slotOf(item, index);
        return { caption: captionFor(item, slot, collisions.has(slot)), place: { token: item, slot } };
      }),
    };
  };
}
