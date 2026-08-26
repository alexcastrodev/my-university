---
version: 1.0
updatedAt: 2026-08-18
---
## Objective

Understand AVL trees — the first self-balancing binary search tree ever published (1962) — as the direct fix for the one real weakness of a plain BST (covered separately): its height, and therefore the cost of every operation, depends entirely on insertion order and can degrade to O(n) on sorted input. AVL trees attach one invariant to every node — the **balance factor**, the height difference between its left and right subtrees, capped at -1, 0, or 1 — and restore it with rotations after every insert or delete, guaranteeing O(log n) height unconditionally, not just on average.

## Use Cases

- Any ordered symbol table where lookups vastly outnumber insertions and deletions, and the tightest possible height bound matters more than update cost — AVL's balance factor is capped at ±1 per node (red-black trees, covered separately, tolerate more slack), so an AVL tree is provably at least as short, and usually shorter, than a red-black tree over the same keys, which makes every search a little faster at the price of pricier updates.
- The direct point of comparison whenever red-black trees come up: "why doesn't `TreeMap` just use AVL, if it's more tightly balanced?" is a natural follow-up question, answered below in Trade-offs.
- Historical/foundational value — every later balanced-tree scheme (red-black trees, 2-3 trees, B-trees) is answering the exact same "bound the height so operations can't degrade to O(n)" problem AVL trees solved first, just with a different rebalancing strategy and a different tolerance for imbalance.
- Read-heavy, write-light indexes (a mostly-static lookup structure rebuilt or bulk-loaded occasionally) — a case where AVL's stricter balance, and therefore faster lookups, pays for itself precisely because updates are rare.

## Deep Dive

### The balance factor: the one invariant that bounds height

A plain BST has no structural safeguard at all: inserting keys in already-sorted order attaches every new node as the previous one's only child, degenerating the tree into a linked list with O(n) height — search, insert, and delete all become O(n) instead of the O(log n) a balanced tree promises. AVL trees close that gap by defining, for every node `x`, a **balance factor**:

```
x.b = h(x.left) - h(x.right)
```

where `h(T)` is the height of subtree `T` (an empty subtree has height 0). A tree is **AVL-balanced** exactly when every node's balance factor is in `{-1, 0, 1}` — no node may lean more than one level to either side. That single per-node constraint, maintained continuously, is what bounds the whole tree's height to O(log n): a tree where every node is only slightly imbalanced can't hide an O(n)-deep path anywhere in it.

Each node stores its own height directly (`h`), rather than recomputing it by walking subtrees on every query, so a node's height is read in O(1) and only recomputed for the O(log n) ancestors touched by an insert or delete:

```java
class AVLNode {
    int key;
    int height;         // 1 + max(height of children); an empty subtree has height 0
    AVLNode left, right, parent;
}

static int height(AVLNode z) {
    return z == null ? 0 : z.height;
}

static int balanceFactor(AVLNode z) {
    return z == null ? 0 : height(z.left) - height(z.right);
}
```

### Rotations: the only tool that fixes an imbalance

Exactly one operation repairs a broken balance factor: a **rotation**, which restructures a small piece of the tree while preserving the BST ordering property (everything still reads left-to-right in sorted order). There are two base rotations, and two "double rotations" built from them.

**Left rotation** — used when a node `x` is right-heavy (`x.b < -1`): its right child `y` moves up to take `x`'s place, `x` becomes `y`'s new left child, and whatever used to be `y`'s left subtree (`β`) is reattached as `x`'s new right subtree (it's still greater than `x` and less than `y`, so the ordering holds):

```java
static AVLNode rotateLeft(AVLNode x) {
    AVLNode y = x.right;
    AVLNode beta = y.left;
    x.right = beta;
    if (beta != null) beta.parent = x;
    y.left = x;
    y.parent = x.parent;
    // caller is responsible for re-linking y into x's old parent (root, or left/right child slot)
    x.parent = y;
    x.height = 1 + Math.max(height(x.left), height(x.right));
    y.height = 1 + Math.max(height(y.left), height(y.right));
    return y; // y is the new root of this subtree
}
```

**Right rotation** is the mirror image — used when a node is left-heavy (`x.b > 1`): its left child moves up, and that child's right subtree is reattached as the pivot's new left subtree.

```java
static AVLNode rotateRight(AVLNode y) {
    AVLNode x = y.left;
    AVLNode beta = x.right;
    y.left = beta;
    if (beta != null) beta.parent = y;
    x.right = y;
    x.parent = y.parent;
    y.parent = x;
    y.height = 1 + Math.max(height(y.left), height(y.right));
    x.height = 1 + Math.max(height(x.left), height(x.right));
    return x; // x is the new root of this subtree
}
```

A single rotation is enough only when the imbalance is a straight line (left child's left subtree grew, or right child's right subtree grew — the **LL** and **RR** cases). When the new key lands on the *inner* side instead — a right-heavy node whose left child is itself left-heavy or vice versa (the **LR** and **RL** cases) — a single rotation isn't enough and would leave the tree just as unbalanced on the other side. These need two rotations in sequence, first pulling the inner grandchild up to its parent's position, then rotating again at the original node:

```java
static AVLNode rotateLeftRight(AVLNode z) { // LR case
    z.left = rotateLeft(z.left);
    return rotateRight(z);
}

static AVLNode rotateRightLeft(AVLNode z) { // RL case
    z.right = rotateRight(z.right);
    return rotateLeft(z);
}
```

### Insertion: ordinary BST insert, then rebalance bottom-up

Inserting into an AVL tree is an ordinary BST insert — walk down comparing keys, attach the new node as a leaf — followed by a bottom-up walk back to the root that recomputes each ancestor's height and checks its balance factor, fixing the *first* node found unbalanced (the one closest to the new leaf):

```java
static AVLNode insert(AVLNode node, int key) {
    if (node == null) return new AVLNode(key);

    if (key < node.key) node.left = insert(node.left, key);
    else if (key > node.key) node.right = insert(node.right, key);
    else return node; // duplicate key: no-op

    node.height = 1 + Math.max(height(node.left), height(node.right));
    int b = balanceFactor(node);

    if (b > 1 && key < node.left.key)  return rotateRight(node);     // Case LL
    if (b < -1 && key > node.right.key) return rotateLeft(node);     // Case RR
    if (b > 1 && key > node.left.key)  return rotateLeftRight(node); // Case LR
    if (b < -1 && key < node.right.key) return rotateRightLeft(node); // Case RL

    return node; // already balanced, nothing to do
}
```

Because only the path from the new leaf back to the root can possibly have changed height, at most one node along that path is ever found unbalanced, and fixing it with at most **one single rotation, or one double rotation**, always restores every balance factor in the tree to `{-1, 0, 1}` — insertion never needs a second, unrelated fix further up.

### Watch it happen: inserting 30, 20, 10 triggers an LL rotation

Inserting three descending keys builds a straight left-leaning chain — the textbook LL case — verified by hand against the rotation logic above: `rotate-right` at the unbalanced node ("30") promotes its left child ("20") to the subtree root, "10" stays "20"'s left child, and "30" becomes "20"'s right child.

```viz
type: tree
insert 30 30 | Insert 30 as the root.
insert 20 20 parent=30 side=left | 20 < 30 -- goes left.
insert 10 10 parent=20 side=left | 10 < 30, then 10 < 20 -- goes left again. Three nodes now form a straight left-leaning chain: 30 -> 20 -> 10.
mark 30 | Walking back up from the new leaf, "30" is the first ancestor whose balance factor leaves {-1,0,1}: its left subtree has height 2, its (empty) right subtree has height 0, so b = 2. The new key (10) is less than "30"'s left child's key (20) -- the LL case.
rotate-right 30 | Single right rotation at "30": "20" becomes the new subtree root, "10" stays its left child, "30" becomes its right child. Every balance factor is back within {-1,0,1}.
insert 25 25 parent=30 side=left | 25 > 20 (the new root), so it descends right to "30"; then 25 < 30, so it becomes "30"'s left child. No rotation needed -- "20" is still balanced (b = -1) since only one subtree grew by one level.
```

### Deletion also needs rebalancing, and can cascade further than insertion

Deletion starts the same way a plain BST's does — a leaf is removed outright, a one-child node is replaced by its child, and a two-child node is replaced by its in-order successor (which is guaranteed to have at most one child, so removing *it* reduces back to one of the first two cases). What's different from insertion is where the rebalancing walk starts and how far it can travel: after splicing out the actual node, AVL retraces ancestors upward from the *replaced* node's old parent, recomputing heights and rotating at the first unbalanced ancestor found — but unlike insertion, fixing that one ancestor does not guarantee every ancestor above it is still balanced, since a rotation during deletion can *reduce* the subtree's height by one, which can propagate the imbalance further up the tree. So a delete can require rebalancing at multiple ancestors on the way back to the root, not just one.

## Trade-offs

- **Strictly tighter balance than red-black trees, at the cost of pricier updates.** A red-black tree's height is bounded by `2 log₂(n+1)`; an AVL tree's is bounded more tightly, close to `1.44 log₂(n+2)` — so AVL lookups are faster in the worst case. The price is that AVL's stricter `{-1,0,1}` invariant needs rebalancing more often and can require more rotation work on deletion than a red-black tree's looser invariant does.
- **This is exactly why `TreeMap`/`TreeSet` use red-black trees, not AVL** — the JDK's own ordered maps favor a scheme with cheaper, more localized rebalancing over one with a marginally tighter height bound, on the reasoning that real workloads mix reads and writes and rarely need AVL's absolute tightest guarantee.
- **Both single and double rotations are O(1)** — a rotation only touches a constant number of pointers and two height fields, regardless of subtree size — so even though insertion or deletion can trigger a rotation at every level walked back to the root, the total rebalancing cost stays O(log n) per operation, matching the height bound itself.
- **Insertion needs at most one fix; deletion can need several** — an insert's bottom-up walk stops at the first unbalanced ancestor, because restoring it is provably enough to rebalance the whole tree. A delete's rebalancing rotation can shrink that subtree's height, which can unbalance an ancestor further up — so deletion's rebalancing walk may have to keep going, checking and fixing ancestors all the way to the root.
- **Book vs. today**: this concept (the balance factor, the four rotation cases, and their Java translation) is drawn from a university course apostila's own worked figures, not from Sedgewick & Wayne's *Algorithms* or Cormen et al.'s *Introduction to Algorithms* — neither of those two books covers AVL trees in their current (4th) editions; both use red-black trees (or, in Sedgewick & Wayne's case, left-leaning red-black BSTs) as their balanced-tree example instead. Don't expect to find AVL's rotation cases described this way in either book.

## Documentation Links

- [AVL tree — Wikipedia](https://en.wikipedia.org/wiki/AVL_tree) — doc
