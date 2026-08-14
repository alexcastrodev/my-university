---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

Understand B-trees: a search tree engineered not to minimize comparisons, the way a binary search tree or red-black tree is, but to minimize the number of DISK ACCESSES a lookup requires — by making every node huge (dozens to thousands of keys) so the tree's height stays tiny, and why that one design choice reshapes every operation (search, insert, delete) around "fat nodes, short tree" instead of the binary-branching shape the companion BST and red-black-tree concepts use.

## Use Cases

- Database indexes: PostgreSQL, MySQL/InnoDB, Oracle, and SQL Server all default to a "B-tree" index (in practice usually the B+-tree variant, see Trade-offs) for exactly this reason — the disk-bound lookups behind `WHERE`, `ORDER BY`, and `JOIN` are dominated by block reads, and a B-tree minimizes how many of those a lookup needs.
- Filesystem metadata: NTFS directories, HFS+'s catalog file, and XFS's directory and extent maps are all B-tree-family structures, solving the identical disk-I/O-minimization problem a database index solves.
- The natural next stop after red-black trees in the "guaranteed height" family of data structures — same O(log n)-height guarantee, but optimized for a completely different cost model: a few, large, disk-resident nodes instead of many small, in-memory ones.

## Deep Dive

### Why B-trees exist: the disk-access cost model, and "fat node, short tree"

Every structure covered in the companion BST and red-black-tree concepts assumes the whole tree lives in memory, where the dominant cost is the number of key *comparisons* a search performs. B-trees are designed for the opposite assumption: the tree is too large to fit in memory, so it lives on disk (or, today, on any storage whose per-access latency dwarfs an in-memory comparison — a database index or filesystem catalog is the canonical example), and reading one node means one disk access. A disk access is enormously more expensive than a comparison, so the cost model that actually matters is the number of nodes touched on the way to an answer — not the number of keys compared once a node is in hand.

A binary search tree pays for this the hard way: even perfectly balanced, it needs O(log₂ n) nodes visited per operation, and each visited node is a separate disk seek. For a billion-row index, that is roughly 30 disk accesses per lookup — far too slow when each access costs milliseconds. A B-tree's fix is to make each node hold not one key but *many* — commonly hundreds to thousands, sized so one node fills exactly one disk block/page — so that one disk access buys a multiway branching decision instead of a single comparison. Fewer, fatter nodes mean a dramatically shorter tree for the same key count.

Cormen states this precisely as a theorem bounding a B-tree's worst-case height (Theorem 18.1): for any n-key B-tree of height h and minimum degree t ≥ 2,

```
h <= log_t( (n + 1) / 2 )
```

Plug in numbers to see why this matters. With minimum degree t = 1000 (a realistic branching factor for a disk-page-sized node) and n = 1,000,000,000 keys:

```
h <= log_1000( (10^9 + 1) / 2 )  =  log_1000( ~5 x 10^8 )  ~=  2.9
```

Since height is an integer, the tree can be no taller than h = 2 — that is, at most 3 levels of nodes: the root, one internal level, and the leaves. A lookup in a billion-key B-tree therefore touches at most 3 disk blocks. (Real disk-based B-trees typically report this as "3-4" levels in practice, since actual branching factors run somewhat below the theoretical maximum once per-key pointer overhead and partially-filled nodes are accounted for — but the order of magnitude is exactly this: a handful of disk accesses, not thirty.) A red-black tree over the same billion keys, by contrast, has height up to 2·log₂(n+1) ~= 60 — twenty times taller, and twenty times the disk accesses if it were stored the same way. That gap, not any difference in asymptotic *notation* (both are O(log n)), is the entire reason B-trees exist: the base of the logarithm is under the tree designer's control, and disk-based structures deliberately make it huge.

### The formal structure: a B-tree node, and a tiny example tree

Cormen's formal definition, generalizing a BST's "left subtree smaller, right subtree larger" rule from two children to many:

```
1. Every node x stores x.n keys in sorted order (x.key[0] <= x.key[1] <= ... ),
   plus -- if x is not a leaf -- exactly x.n + 1 child pointers: one more child
   than it has keys.
2. The keys inside a node separate the key ranges of its children: every key in
   the subtree rooted at child c[i] falls between key[i-1] and key[i] (using the
   node's own keys as boundaries, with -infinity/+infinity at the two ends).
3. All leaves have exactly the same depth -- the tree's height h. A B-tree is
   PERFECTLY height-balanced, not just approximately balanced the way a
   red-black tree is (see Trade-offs).
4. Every node other than the root holds between t-1 and 2t-1 keys, where t >= 2
   is the tree's fixed minimum degree. A node with n keys always has exactly
   n+1 children, so an internal node has between t and 2t children. A node
   holding the maximum, 2t-1 keys, is called FULL.
5. The root may hold as few as 1 key (0 only if the whole tree is empty).
```

The smallest legal case, t = 2, is exactly a 2-3-4 tree: every node has 1-3 keys and 2-4 children. A node's physical layout alternates child pointers and keys — for a node with 3 keys (and therefore 4 children):

```
one B-tree node x, with x.n = 3 keys and x.n + 1 = 4 children:

       c[0]    key[0]   c[1]    key[1]   c[2]    key[2]   c[3]
     +------+--------+------+--------+------+--------+------+
     |  *   |   10    |  *   |   22    |  *   |   35    |  *   |
     +------+--------+------+--------+------+--------+------+
        |                 |                 |                 |
   keys < 10        10 < keys < 22    22 < keys < 35     keys > 35
```

And a tiny example tree, height 2 (3 levels), t = 2, using letters as keys the same way Cormen's own figures do:

```
                              [   P   ]
                             /         \
                    [ D   H ]           [ T   X ]
                   /    |    \         /    |    \
              [A,C] [E,F] [J,K,M]  [Q,R] [U,V] [Y,Z]
```

Every leaf sits at depth 2, every node's key count falls in [t-1, 2t-1] = [1, 3], and the keys route correctly at each level (e.g. everything under `[D H]` is < P; everything under `[E,F]` is between D and H).

Searching a B-tree is a straightforward generalization of BST search: instead of a two-way branch (less-than / greater-than), each node makes an (n+1)-way branch by scanning its sorted keys for an exact match or the correct child to descend into. Cormen's B-TREE-SEARCH, in Java-style pseudocode:

```java
// x is the node currently being examined; k is the key being searched for.
// Returns the (node, index) pair where k lives, or null if k is not in the tree.
SearchResult bTreeSearch(Node x, Key k) {
    int i = 0;
    while (i < x.n && k.compareTo(x.key[i]) > 0) {
        i++;
    }
    if (i < x.n && k.compareTo(x.key[i]) == 0) {
        return new SearchResult(x, i);       // exact match, right here in this node
    } else if (x.leaf) {
        return null;                          // fell off a leaf -- k is not in the tree
    } else {
        diskRead(x.child[i]);                 // child i is the only subtree that can hold k
        return bTreeSearch(x.child[i], k);
    }
}
```

The `diskRead` call is worth noticing: in Cormen's model, a child pointer is a disk-block address until it is actually read into memory, and the whole point of the algorithm is that this loop runs at most h = O(log_t n) times — one disk access per level, not one per key.

### Insertion: split on the way down, one pass, no backtracking

Like a BST, a B-tree inserts by walking down to the correct leaf and adding the key there. Unlike a BST, that leaf might already be full (2t-1 keys) — and a B-tree node can never exceed that bound, so the node must SPLIT: its median key moves *up* into the parent, and the remaining 2t-2 keys divide evenly into two new nodes of t-1 keys each. If the parent was already full too, receiving that promoted key overflows it in turn, and the split propagates upward — potentially all the way to the root. If the root itself splits, a brand-new root is created one level up, and the tree's height grows by exactly one. This is precisely why every leaf stays at the same depth: a B-tree always grows at the top, never at the bottom, the opposite of an unbalanced BST degrading by adding leaves.

Cormen's specific optimization: rather than inserting first and discovering an overflow afterward (which would require backtracking up the tree to fix it), B-TREE-INSERT splits every FULL node it meets *on the way down* — proactively, before descending into it. That guarantees the node the algorithm is about to recurse into is never full, so the whole insertion is a single downward pass with no backtracking at all.

Hand-traced example: insert `A, B, C, D, E, F, G` in that order into an empty B-tree with minimum degree t = 2 (every node holds 1-3 keys; a node is full, and therefore split on sight, once it hits 3):

```
insert(A):  root = [A]
insert(B):  root = [A B]
insert(C):  root = [A B C]                        <- root is now full (3 keys)

insert(D):  root [A B C] is full -> split it BEFORE descending. Median B moves
            up into a brand-new root; A and C become its two children. This is
            the ONLY way a B-tree's height grows -- at the root, on the way in.
                    [B]
                   /   \
                [A]     [C]
            D > B -> descend right into [C] (room to spare) -> insert D.
                    [B]
                   /   \
                [A]     [C D]

insert(E):  E > B -> descend right into [C D] (room to spare) -> insert E.
                    [B]
                   /   \
                [A]     [C D E]

insert(F):  F > B -> would descend into [C D E], but it is FULL (3 keys).
            Split it first: median D promotes into the root, which has room
            (only 1 key) -- the split stops here, no further propagation needed.
                    [B D]
                  /   |   \
               [A]  [C]   [E]
            F > D -> descend into the new rightmost child [E] -> insert F.
                    [B D]
                  /   |   \
               [A]  [C]   [E F]

insert(G):  G > D -> descend into [E F] (room to spare) -> insert G.
                    [B D]
                  /   |   \
               [A]  [C]   [E F G]
```

`insert(D)` shows a split that grows the tree's height (a new root is promoted). `insert(F)` shows a split whose promoted median propagates into its parent (here the root, which happened to have room, so the propagation stops after one level — exactly the same mechanism that would keep climbing through additional internal nodes in a taller tree). Every leaf above is still at depth 1, and the root never exceeds 2t-1 = 3 keys.

### Deletion, briefly: borrow or merge — and where B-trees show up today

Deletion is the trickier, mirror-image operation, and — unlike insertion's overflow — it worries about UNDERFLOW: a node dropping below its minimum of t-1 keys. Cormen's B-TREE-DELETE handles it with the same proactive, single-downward-pass discipline as insertion, just running the logic backward:

- If the search lands on a leaf, simply delete the key from it (the easy case).
- If the search finds the key in an internal node, replace it with a predecessor or successor pulled from an adjacent child that has a key to spare, and recursively delete that key from the leaf it actually came from.
- Before descending into any child that holds only the bare minimum (t-1 keys), the algorithm tops it up first: either **borrow** a key from an immediate sibling that has one to spare (rotating a key down from the parent and one up from the sibling), or, if no sibling has a spare key, **merge** the child with a sibling and pull the separating key down from the parent into the merged node.

Borrowing is deletion's answer to insertion's rotation-free recoloring; merging is deletion's mirror image of a split, run in reverse — where a split pushes a median key *up* and breaks one node into two, a merge pulls a key *down* and combines two nodes into one. And just as a split's promoted key can propagate all the way to the root and grow the tree, a merge can propagate all the way to the root and — if the root ends up with zero keys because its last key was pulled down into a merge — the empty root is discarded and the tree shrinks by one level. Insertion and deletion are the same split/merge machinery running in opposite directions.

This is also where the concept pays off in practice. Most production database engines — PostgreSQL, MySQL/InnoDB, SQL Server, Oracle — implement their default index type as a member of the B-tree family, precisely because an index lookup is a disk-bound operation and a B-tree's height directly bounds how many blocks that lookup touches. Filesystems reach for the same structure for the same reason: NTFS directories, HFS+'s catalog file, and XFS's extent and directory maps are all B-tree-family structures managing metadata that is too large to keep fully in memory. Every time a `WHERE` clause resolves through an index in milliseconds instead of scanning a table row by row, a B-tree (or its close relative, the B+-tree) is why.

## Trade-offs

- **A large minimum degree t trades CPU work for disk accesses, not the other way around** — a bigger t means fewer levels (fewer disk seeks), but more keys to scan inside each node once it's in memory; B-TREE-SEARCH's linear scan of a node costs O(t) CPU time, for O(t log_t n) total. Real implementations often binary-search *within* a node once t is large enough to matter, cutting that per-node cost to O(lg t) without changing which children get visited or how many disk blocks get read.
- **A B-tree is provably, perfectly height-balanced — not just "roughly" balanced the way a red-black tree is.** Every leaf sits at exactly the same depth (property 3 above); a red-black tree only bounds the longest root-to-leaf path at twice the shortest one. That stronger guarantee is precisely what makes bounding disk accesses at a hard O(log_t n) — with no worst-case surprises — possible in the first place.
- **Real production B-trees are usually B+-trees, not the plain structure described here.** Cormen's own chapter notes a common variant that stores all satellite data in the leaves and keeps internal nodes as pure key/pointer indexes, maximizing branching factor for a given block size — this is what PostgreSQL, MySQL, and most filesystem directory structures actually implement under the name "B-tree." A second named variant, the B*-tree, requires nodes to stay at least 2/3 full instead of a plain B-tree's 1/2, trading slightly costlier inserts/deletes for better space utilization.
- **Deletion's underflow handling is real implementation work, not a footnote** — the borrow/merge logic has to run correctly at every level a merge propagates through, symmetric to insertion's split propagation. Skipping it (or getting a case wrong) quietly leaves nodes below the minimum-fill invariant that the height bound — and therefore every disk-access guarantee above — depends on.
- **No JDK collection is backed by a B-tree.** `TreeMap`/`TreeSet` use a red-black tree (see that concept) because the JVM's in-memory collections don't have a disk-latency problem to solve. B-trees show up only where the underlying storage genuinely is slow relative to compute — an embedded or server database engine, a filesystem, or a custom-built storage index — never as a general-purpose in-memory Java collection.

## Documentation Links

- Cormen, Leiserson, Rivest, Stein, *Introduction to Algorithms*, 4th Edition (MIT Press, 2022) — Chapter 18 "B-Trees", Sections 18.1-18.3, pp. 501-516 — book
- [PostgreSQL Documentation — Index Types (B-Tree)](https://www.postgresql.org/docs/current/indexes-types.html) — doc
- [MySQL 8.4 Reference Manual — Comparison of B-Tree and Hash Indexes](https://dev.mysql.com/doc/refman/8.4/en/index-btree-hash.html) — doc
