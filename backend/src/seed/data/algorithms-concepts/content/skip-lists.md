---
version: 1.0
updatedAt: 2026-08-18
---
## Objective

Understand skip lists: a sorted linked list augmented with randomized "express lane" levels, where an element promoted to level `i+1` lets a search skip past everything below it. Unlike the sibling AVL and red-black tree concepts, which guarantee O(log n) height through deterministic rebalancing logic (rotations, recoloring) triggered on every insert, a skip list gets its O(log n) *expected* search/insert/delete time from randomness alone — no rotation code, no color bits, no rebalancing pass ever runs.

## Use Cases

- Any ordered map/set implementation where the *implementer's* cost of correctly writing and testing rotation logic matters as much as the *user's* runtime cost — a skip list's insert/delete code is a fraction of the size of an AVL or red-black tree's, because there are no structural invariants to repair after a modification, only forward pointers to splice.
- Concurrent/lock-free ordered structures — Redis's sorted set (`ZSET`) is implemented internally as a skip list paired with a hash table specifically because a skip list insert only touches the handful of nodes directly linked to the new node, whereas a balanced tree's rebalancing can touch a large, unpredictable portion of the tree and would need much coarser locking.
- Search-engine postings lists (e.g. Apache Lucene), where a sorted list of document IDs is augmented with skip pointers so that intersecting two long postings lists doesn't require walking every element of the shorter one.
- Range queries and order-statistics on already-sorted or mostly-sorted key streams, where a skip list's simplicity-to-implement often outweighs an AVL tree's marginally better worst-case guarantee.

## Deep Dive

### The core idea: a hierarchy of increasingly sparse linked lists

A skip list is built in layers. Level 0 is an ordinary sorted linked list containing every element. Each higher level is an "express lane": an element present at level `i` is *also* present at level `i+1` with some fixed probability `q = 1/d` (the **fan-out factor** `d > 1` controls this; `d = 2` is the classic choice, giving `q = 1/2` — literally a coin flip per element per level). An element that "wins the coin flip" at level `i` gets promoted to level `i+1` and the flip repeats there, so higher levels contain exponentially fewer elements: level `k` holds an expected `n/d^k` elements out of `n` total. The head of the list is a sentinel node present at every level, tall enough to reach the current maximum level in use.

```
level 2:  head ------------------------------------> 17 --------------------------> NIL
level 1:  head --------------> 6 ------> 9 --------> 17 --------> 21 --------------> NIL
level 0:  head -> 3 -> 6 -> 7 -> 9 -> 12 -> 17 -> 19 -> 21 -> 25 -> 26 -> NIL
```

Each node is a key plus a `forward[]` array of references, one per level the node participates in — a node at level 2 has a 3-slot `forward[]` (indices 0, 1, 2), each slot pointing to the next node that also exists at that level:

```java
class SkipListNode<K> {
    K key;
    SkipListNode<K>[] forward;   // forward[i] = next node at level i, or null (NIL)

    @SuppressWarnings("unchecked")
    SkipListNode(K key, int level) {
        this.key = key;
        this.forward = (SkipListNode<K>[]) new SkipListNode[level + 1];
    }
}
```

### No rotations, no recoloring — the balance is probabilistic, not structural

This is the fundamental contrast with the sibling `avl-trees` and `red-black-trees` concepts. Both of those structures make a *deterministic* promise ("height never exceeds `X`") and pay for it with rebalancing logic that runs on every insert and delete: AVL trees track a balance factor per node and rotate the instant it drifts outside `{-1, 0, 1}`; red-black trees track a color bit per node and run a multi-case fixup after every insert. A skip list makes no deterministic promise at all — a run of exceptionally bad coin flips could, in principle, produce a skip list that degenerates to a single unbroken level-0 list, giving O(n) search. What it guarantees instead is *probabilistic*: with each element's level chosen independently at random, the **expected** search cost is O(log n), and the probability of a search costing significantly more than that shrinks exponentially as `n` grows — bad enough behavior is possible but so unlikely in practice that no fixed input sequence can reliably trigger it (contrast this with a plain unbalanced BST, where a specific, easy-to-construct input — sorted-order insertion — *always* degrades it to a linked list).

The practical payoff: a skip list's insert and delete are just "search, then splice a few pointers" — no case analysis, no rotation, no color propagation up the tree. Pugh's own comparison, from the paper that introduced skip lists, makes the concurrency implication explicit:

> "The most frequently used implementation of a binary search tree is a red-black tree. The concurrent problems come in when the tree is modified — it often needs to rebalance. The rebalance operation can affect large portions of the tree, which would require a mutex lock on many of the tree nodes. Inserting a node into a skip list is far more localized — only nodes directly linked to the affected node need to be locked."

### Search: start at the top express lane, drop down when you can't go right

Search begins at the head, at the *current maximum level* — the sparsest lane — and repeats one rule: move right while the next node's key is still less than the target; the moment it isn't (because the next key is too large, or there is no next node at this level), drop down one level and try again. Reaching level 0 with nowhere left to go means checking whether the node you landed just before is actually the target.

```java
K search(K key) {
    SkipListNode<K> x = head;
    for (int i = level; i >= 0; i--) {
        while (x.forward[i] != null && less(x.forward[i].key, key)) {
            x = x.forward[i];
        }
        // x is now the last node at level i with a key strictly less than `key`
    }
    x = x.forward[0];                 // candidate: the successor at the base level
    return (x != null && x.key.equals(key)) ? x.key : null;
}
```

### Worked trace: searching for 21

Take the 10-element skip list `3, 6, 7, 9, 12, 17, 19, 21, 25, 26` with this level assignment (the result of each element's own coin flips): `head` and `17` reach level 2 (the current maximum); `6`, `9`, and `21` reach level 1; every other element — `3`, `7`, `12`, `19`, `25`, `26` — exists only at level 0. That produces exactly the three-level diagram shown above. Searching for `21`:

1. **Level 2, at `head`.** `head.forward[2] = 17`. Is `17 < 21`? Yes — move right. Now at `17`. `17.forward[2] = NIL`. Nothing less than 21 to move to — drop to level 1, still at `17`.
2. **Level 1, at `17`.** `17.forward[1] = 21`. Is `21 < 21`? No (equal isn't "less than") — can't move right. Drop to level 0, still at `17`.
3. **Level 0, at `17`.** `17.forward[0] = 19`. Is `19 < 21`? Yes — move right. Now at `19`. `19.forward[0] = 21`. Is `21 < 21`? No — can't move right. No more levels to drop to.
4. **Final check.** `x = x.forward[0] = 21`. `21.key == 21` — found.

Four comparisons total, and the single level-2 hop from `head` straight to `17` is the entire point: it skipped past `3, 6, 7, 9, 12` — five base-list nodes — in one step. A plain linked-list search for `21` would have walked all ten nodes one at a time; this search only ever touched three (`17`, `19`, `21`).

### Watch it happen: the same search, level by level

Each element is drawn as one node per level it participates in (e.g. "17" appears three times — once per level it reaches), stacked in a column and linked by a vertical "tower" edge, exactly like the ASCII diagram above. A horizontal edge is a real `forward[]` pointer at that level; a vertical edge is only ever used here to represent *dropping down* a level at the same element, never an actual pointer a search follows sideways.

```viz
type: graph
node H_L2 H 0 0
node H_L1 H 0 1
node H_L0 H 0 2
node n3_L0 3 1 2
node n6_L1 6 2 1
node n6_L0 6 2 2
node n7_L0 7 3 2
node n9_L1 9 4 1
node n9_L0 9 4 2
node n12_L0 12 5 2
node n17_L2 17 6 0
node n17_L1 17 6 1
node n17_L0 17 6 2
node n19_L0 19 7 2
node n21_L1 21 8 1
node n21_L0 21 8 2
node n25_L0 25 9 2
node n26_L0 26 10 2
edge H_L0 n3_L0 directed
edge n3_L0 n6_L0 directed
edge n6_L0 n7_L0 directed
edge n7_L0 n9_L0 directed
edge n9_L0 n12_L0 directed
edge n12_L0 n17_L0 directed
edge n17_L0 n19_L0 directed
edge n19_L0 n21_L0 directed
edge n21_L0 n25_L0 directed
edge n25_L0 n26_L0 directed
edge H_L1 n6_L1 directed
edge n6_L1 n9_L1 directed
edge n9_L1 n17_L1 directed
edge n17_L1 n21_L1 directed
edge H_L2 n17_L2 directed
edge H_L2 H_L1
edge H_L1 H_L0
edge n6_L1 n6_L0
edge n9_L1 n9_L0
edge n17_L2 n17_L1
edge n17_L1 n17_L0
edge n21_L1 n21_L0
---
visit H_L2 | Start at the head, at the current top level (2) -- the sparsest express lane.
traverse H_L2 n17_L2 | forward[2] = "17", and 17 < 21 -- move right.
visit n17_L2 | Now at "17" on level 2.
traverse n17_L2 n17_L1 | forward[2] = NIL at "17" -- nothing left to move to. Drop down to level 1 (still at "17").
visit n17_L1 | Now at "17" on level 1.
traverse n17_L1 n17_L0 | forward[1] = "21", but 21 < 21 is false (equal isn't "less than") -- can't move right. Drop down to level 0 (still at "17").
visit n17_L0 | Now at "17" on level 0 -- the base list, nothing left to skip past.
traverse n17_L0 n19_L0 | forward[0] = "19", and 19 < 21 -- move right.
visit n19_L0 | Now at "19".
traverse n19_L0 n21_L0 | forward[0] = "21", and 21 < 21 is false -- no more levels to drop to. The successor is "21" itself.
visit n21_L0 | x = x.forward[0] = "21" -- keys match. Found, after touching only "17", "19", "21".
```

### Insertion: search first, then splice at every level up to a random height

Insertion runs the same descending search to find, at every level, the last node whose key is still less than the new key — Pugh's algorithm calls this the `update[]` array, one entry per level, and it is exactly the set of nodes whose `forward[]` pointers must be rewired. Once the insertion point is found, a height is drawn for the new node — independently of its key, using the same coin-flip process that built every other node's height — and the node is spliced into every level from 0 up to that height by rewiring exactly the `update[i]` pointers at each of those levels.

```
RandomLevel(q):                       # q = 1/d, the promotion probability
    level = 1
    while random() < q and level < maxLevel:
        level = level + 1
    return level
```

With `q = 0.5`, this is literally "keep flipping a coin; every head bumps the level by one; stop at the first tail (or at `maxLevel`)" — which is exactly why the expected number of nodes at level `i` is `n / 2^i`. If the drawn level exceeds the list's current maximum, the head node's own `forward[]` array grows to match, with the new higher slots initialized to point directly at the new node (there is nothing else at that level yet).

Because the coin flips are independent every time, inserting the same *set* of keys twice, in two different runs, produces two different-shaped skip lists — there is no canonical "the" skip list for a given key set, only a family of equally-likely shapes.

### Complexity: why O(log n) falls out of the geometry, not a proof about rotations

The expected number of levels a skip list needs for `n` elements follows directly from the promotion rule: level `k` has an expected `n/d^k` elements, and the list needs enough levels that the top one is expected to hold just one node (the head) — solving `n/d^k = 1` gives `k = log_d(n)`, so an `n`-element skip list has an expected `1 + log_d(n)` levels. A search visits some number of nodes per level before dropping down; because each level has (on average) `d` times fewer nodes than the one below it, the expected number of rightward moves *per level* is a small constant (`d/2`), independent of `n`. Multiplying "expected levels" by "expected moves per level" gives the total expected search cost: `(d/2) · (1 + log_d(n)) = O(log_d n)` — logarithmic, for any fixed `d`.

Expected space follows a similar geometric-series argument: summing `n + n/d + n/d^2 + ...` (level 0's `n` nodes, level 1's `n/d`, and so on) is a geometric series that converges to `n·d/(d-1)` — linear in `n`, i.e. O(n), the same asymptotic space a plain linked list needs, just with a constant-factor overhead for the extra `forward[]` slots.

### Tuning the fan-out factor `d`: a direct time/space knob

`d` is a real, quantifiable dial between search speed and memory: with `d = 2`, expected time is `log_2(n)` and expected space is `2n`. With `d = 10`, expected time becomes `(10/2)·log_10(n) = 5·log_10(n) ≈ 1.5·log_2(n)` — about 50% slower — but expected space drops to `10n/9 ≈ 1.11n`, barely more than a plain linked list. There is no free lunch here: a larger `d` means fewer elements get promoted to express lanes, so the lanes save less time but also cost less memory to maintain. This is a deliberate, tunable trade-off in a way that AVL and red-black trees don't expose — those structures' balance is all-or-nothing (either the invariant holds or it's actively repaired), not a dial.

## Trade-offs

- **Probabilistic guarantee, not a worst-case one.** Every operation is O(log n) *expected*; a run of unlucky coin flips can in principle produce O(n) behavior. In practice this risk is not a serious concern — no fixed sequence of keys can be constructed in advance to reliably trigger it, unlike a plain BST's sorted-input worst case — but it's a real distinction from AVL/red-black trees' unconditional O(log n) height bound.
- **Dramatically simpler insert/delete code, at the cost of that guarantee.** There is no case analysis to get wrong — no rotation direction to pick, no color to propagate — which is exactly why skip lists are a common choice for concurrent ordered structures (Redis's `ZSET`) where a red-black tree's rebalancing would demand locking a large, unpredictable slice of the tree.
- **The fan-out factor `d` is a genuine, tunable time/space trade-off** (see above) — there is no equivalent single knob in a balanced tree; AVL/red-black trees fix their balance invariant by definition.
- **Deletion has one edge case worth knowing**: removing a node that was the *only* element at the current top level empties that level entirely, and the list's tracked maximum level must shrink by one (or more) to match — skipping this bookkeeping leaves dangling, permanently-empty top levels.
- **AVL trees can still win on delete-heavy, non-ordered workloads.** Empirically, skip lists tend to outperform AVL trees when keys arrive already sorted (or nearly so) and when queries lean toward "how many elements are less than X" or range deletion; AVL trees remain preferable when search is the dominant operation over unordered key arrivals, since their worst-case bound is unconditional.

## Documentation Links

- [William Pugh, "Skip Lists: A Probabilistic Alternative to Balanced Trees," *Communications of the ACM*, Vol. 33, No. 6 (June 1990), pp. 668–676](https://dl.acm.org/doi/10.1145/78973.78977) — doc
- [Skip Lists: A Probabilistic Alternative to Balanced Trees — free-hosted copy of Pugh's original paper (cs.umd.edu)](https://ftp.cs.umd.edu/pub/skipLists/skiplists.pdf) — doc
- [Skip list — Wikipedia](https://en.wikipedia.org/wiki/Skip_list) — doc
