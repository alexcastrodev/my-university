---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

Understand red-black trees: a self-balancing binary search tree that guarantees O(log n) height in the worst case — not just on average — by constraining node colors during every insert and delete, which is exactly the guarantee a plain BST (covered separately) doesn't give.

## Use Cases

- Understanding what `TreeMap`/`TreeSet` actually are underneath — the JDK implements both as red-black trees specifically to get a worst-case height guarantee a plain BST can't offer.
- A standard advanced data-structures topic — expect to be asked to state the five properties from memory and trace an insertion by hand.
- The conceptual gateway to other guaranteed-balance structures (AVL trees, B-trees) — red-black trees are the one most production databases and language runtimes actually ship.

## Deep Dive

### The five properties

CLRS defines a red-black tree as a binary search tree with one extra bit per node — its color — satisfying five properties:

```
1. Every node is either red or black.
2. The root is black.
3. Every leaf (NIL) is black.
4. If a node is red, both its children are black.        (no two reds in a row)
5. Every path from a node to any descendant leaf has      (equal black-height
   the same number of black nodes.                         on every path)
```

Property 5 is the one doing the real work: it guarantees the *shortest* possible root-to-leaf path can't be less than half the length of the *longest* one, because property 4 caps how many consecutive red nodes can appear between two black nodes on any path. CLRS proves from this that a red-black tree with n nodes has height at most 2·log₂(n+1) — O(log n), guaranteed, not just expected.

### Insertion: insert red, then fix violations

`RB-INSERT` does an ordinary BST insert (same walk-down-and-attach shown in the plain BST concept), then colors the new node **red**, then calls `RB-INSERT-FIXUP` to repair whatever that coloring choice might have broken. Coloring the new node red (rather than black) is deliberate: it can only ever violate property 2 (if it's the root) or property 4 (if its parent is also red) — never property 5, since a red node with two black `NIL` children doesn't change any path's black count.

`RB-INSERT-FIXUP` handles a red-red violation with three cases, checked in order:

```
Case 1 — the new node's uncle is red:    recolor parent and uncle black, grandparent red,
                                           then continue fixing up from the grandparent.
Case 2 — uncle is black, new node is a   rotate to turn this into Case 3.
          "zigzag" (inner) grandchild:
Case 3 — uncle is black, new node is a   recolor parent black and grandparent red,
          "straight-line" grandchild:    then rotate at the grandparent. Done.
```

Case 1 pushes the problem up the tree without any rotation (cheap, but the violation might recur higher up). Cases 2-3 use exactly the rotations from the plain-BST rotation mechanism to fix things in place, in at most two rotations total, ending the fixup. The very last line of `RB-INSERT-FIXUP` unconditionally recolors the root black — Case 1 can turn the root red if the violation propagates all the way up, and this line is what restores property 2 afterward.

### Watch it happen: inserting 10, 20, 30, 15 into an empty tree

Traced by hand against CLRS's own `RB-INSERT-FIXUP` cases — every recolor and rotation below is exactly what the algorithm does, not a shortcut:

```viz
type: tree
insert 10 10 color=red | New node always starts red -- RB-INSERT colors it red first.
recolor 10 black | Root must always be black (property 2) -- the fixup's last line unconditionally blackens the root.
insert 20 20 parent=10 side=right color=red | "20" > "10" -- inserted right, red. Parent ("10") is black: no violation, no fixup needed.
insert 30 30 parent=20 side=right color=red | "30" > "20" -- inserted right, red. Parent ("20") is red: violation. Uncle (10's other child, NIL) is black.
recolor 20 black | Case 3 (uncle black, straight line): recolor parent black...
recolor 10 red | ...and grandparent red...
rotate-left 10 | ...then rotate left at the grandparent. "20" takes "10"'s old position.
insert 15 15 parent=10 side=right color=red | "15" > "10", "15" < "20" -- inserted as "10"'s right child, red. Parent ("10") is red: violation. Uncle ("30") is red too.
recolor 10 black | Case 1 (uncle red): recolor parent black...
recolor 30 black | ...and uncle black...
recolor 20 red | ...and grandparent red, then continue fixing up from the grandparent.
recolor 20 black | "20" is the root -- the final fixup line blackens it again.
```

## Trade-offs

- **Guaranteed O(log n) height, at the cost of extra bookkeeping every insert/delete** — a plain BST's insert is a simple walk-and-attach; a red-black insert is that same walk plus a fixup pass that can trigger recoloring and up to two rotations. The payoff is that a red-black tree can't degrade to a linked-list shape the way an unlucky-insertion-order plain BST can.
- **Book vs. book, not book vs. today**: Sedgewick and Wayne cover a different formulation — the **left-leaning red-black BST**, derived from 2-3 trees, where color lives on *links* rather than *nodes* and every red link must lean left by construction. It's provably equivalent in the guarantees it gives (same O(log n) height bound), but the invariants and rebalancing code look different from CLRS's per-node coloring shown above — don't mix the two rule sets when implementing one or the other from memory.
- **`TreeMap`/`TreeSet` use red-black trees, not the plain BST from the companion concept** — this is the direct payoff of the height guarantee: a `TreeMap` built from already-sorted input stays O(log n) for every operation, where the equivalent plain BST would degrade to O(n).
- **Deletion is harder than insertion, and out of scope here** — `RB-DELETE-FIXUP` has four cases instead of three and can require up to three rotations; the core recolor-and-rotate toolkit is the same one insertion uses, but the case analysis is denser and worth its own dedicated pass rather than a one-paragraph summary.

## Documentation Links

- Cormen, Leiserson, Rivest, Stein, *Introduction to Algorithms*, 4th Edition (MIT Press, 2022) — Chapter 13 "Red-Black Trees", Sections 13.1 and 13.3, pp. 331-334, 338-345 — book
- Robert Sedgewick, Kevin Wayne, *Algorithms*, 4th Edition (Addison-Wesley, 2011) — Section 3.3 "Balanced Search Trees" (left-leaning red-black BSTs), pp. 424-433 — book
- [TreeMap — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/TreeMap.html) — doc
