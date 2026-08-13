export interface VizSlot {
  id: string;
  label: string;
}

export interface VizStep {
  caption: string;
  /** Introduce a token and put it in a slot. Multiple `place`s into the same slot stack (chaining);
   *  the engine highlights a slot as a collision purely from holding 2+ tokens, no flag needed here. */
  place?: { token: string; slot: string };
  /** Reparent an existing token into a different slot (e.g. LRU access-order bump). */
  move?: { token: string; toSlot: string };
  /** Exchange two existing tokens' slots atomically in one render (e.g. a sorting algorithm's swap). */
  swap?: { tokenA: string; tokenB: string };
  /** Remove an existing token from the scene (e.g. LRU eviction). */
  remove?: { token: string };
  /** Flash a slot without introducing or moving a token. */
  highlight?: { slot: string };
}

export interface VizScene {
  /** Small caption shown next to the Replay button, e.g. "Table capacity: 8". */
  meta?: string;
  slots: VizSlot[];
  steps: VizStep[];
  /**
   * `'grid'` (default): slots wrap in a grid, each rendered independently — right for
   * order-insensitive placement (hash buckets). `'row'`: a single connected horizontal array
   * where tokens slide smoothly between positions as their slot changes — right for sequences
   * where adjacency and order matter (sorting).
   */
  layout?: 'grid' | 'row';
}

/** A mode turns a raw item list into a scene to play back. */
export type VizMode = (items: string[]) => VizScene;
