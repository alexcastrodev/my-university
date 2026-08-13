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

// ---------------------------------------------------------------------------
// Tree scenes — binary trees, BSTs, red-black trees. Distinct from VizScene's
// slot/token model because a tree's DEFINING feature is parent-child structure,
// which the array-of-slots model has no way to express. Layout (x/y per node) is
// computed automatically from the tree shape (in-order position × depth), the
// classic technique also used in both source books' own tree figures — the
// content author only ever declares structure (insert/rotate/recolor), never
// coordinates.
// ---------------------------------------------------------------------------

export interface TreeStep {
  caption: string;
  /** Add a new node. `parent: null` makes it the root (only valid for the first insert). */
  insert?: { id: string; label: string; parent: string | null; side?: 'left' | 'right'; color?: string };
  /** Change an existing node's color (e.g. red-black tree recoloring during insert-fixup). */
  recolor?: { id: string; color: string };
  /** Standard BST left rotation pivoting on the node at `at` (CLRS's ROTATE-LEFT). */
  rotateLeft?: { at: string };
  /** Standard BST right rotation pivoting on the node at `at` (CLRS's ROTATE-RIGHT). */
  rotateRight?: { at: string };
  /** Remove a leaf or single-child node from the tree. */
  remove?: { id: string };
  /** Flash a node without changing the tree's structure or color. */
  highlight?: { id: string };
}

export interface TreeScene {
  meta?: string;
  steps: TreeStep[];
}

// ---------------------------------------------------------------------------
// Graph scenes — general (not necessarily tree-shaped) graphs with author-fixed
// node positions, for traversal demos (BFS/DFS/Dijkstra). General graph auto-
// layout (force-directed, etc.) is nondeterministic and not worth the engine
// complexity — textbook graph figures place vertices by hand too, so the
// content author supplies a small (col, row) grid position per node directly.
// ---------------------------------------------------------------------------

export interface GraphNodeSpec {
  id: string;
  label: string;
  col: number;
  row: number;
}

export interface GraphEdgeSpec {
  from: string;
  to: string;
  directed?: boolean;
}

export interface GraphStep {
  caption: string;
  /** Mark a node as visited/current (e.g. dequeued in BFS, the current DFS call). */
  visit?: { id: string };
  /** Highlight an edge as part of the traversal (e.g. a BFS/DFS tree edge). */
  traverseEdge?: { from: string; to: string };
  /** Flash a node without marking it visited (e.g. "considering, not yet visiting"). */
  highlight?: { id: string };
}

export interface GraphScene {
  meta?: string;
  nodes: GraphNodeSpec[];
  edges: GraphEdgeSpec[];
  steps: GraphStep[];
}
