---
version: 1.0
updatedAt: 2026-09-13
---
## Learning Objectives

- Implement the search procedure for a skip list precisely, including the "drop down" rule at each level.
- Describe insertion as two passes: a search that records, at every level, the last node visited before dropping down (the "update" array), followed by threading the new node in at each level it was randomly promoted to.
- Describe deletion as the mirror image of insertion: locate the node at every level it appears on using the same update array, then unlink it from each of those levels.
- Explain why a skip list never needs anything resembling a rotation, even though its shape does change with every insertion and deletion.
- Trace all three operations by hand on a small, concrete skip list.

## Context & Motivation

The previous concept established what a skip list looks like and where its levels come from: a stack of increasingly sparse sorted linked lists, with each element's height decided by an independent sequence of coin flips at insertion time. This concept works out the actual mechanics: given that shape, how does a search actually move through it step by step, and, more importantly, how does inserting or deleting an element update every level it touches without breaking the sorted order at any of them. The pleasant surprise, compared to AVL and red-black trees, is that there is no separate "fix-up" phase at all: the same single downward pass that a search performs is reused, almost unchanged, to perform both insertion and deletion.

## Core Theory

### Search: the mechanism made precise

Search starts at the head of the topmost non-empty level and repeats one rule until it reaches level 0: at the current node, look at the next node on the current level; if that next node's key is less than the target, move right to it; otherwise (the next node's key is greater than or equal to the target, or there is no next node), drop down one level from the current node and repeat. This is exactly the trace already worked through in the previous concept's Example 1, restated here as an explicit, mechanical rule rather than an illustrated walkthrough.

### Insertion: recording the path, then threading the new node in

Insertion reuses the search's downward pass with one addition: at every level, before dropping down, the current node (the last one whose key is still less than the value being inserted) is recorded into an array conventionally called `update`, indexed by level. By the time the search reaches level 0, `update[i]` holds, for every level `i` from 0 up to the topmost level searched, exactly the node that the new value needs to be linked in after, at that level.

With `update` fully populated, the new node's height is decided by the same coin-flip process from the previous concept (level 0 guaranteed, then repeated fair coin flips deciding further promotion). For every level `i` from 0 up to the new node's chosen height, the new node is spliced in immediately after `update[i]` at level `i`: its forward pointer at level `i` is set to whatever `update[i]`'s forward pointer at level `i` currently is, and `update[i]`'s forward pointer at level `i` is then set to the new node. If the new node's height exceeds every level that currently exists in the skip list, new empty levels are created first (with the head node's forward pointer at those new levels initially pointing to the new node directly, since there is nothing above the old top level yet).

Because `update[i]` was already recorded correctly during the downward search pass, this insertion is entirely local at each level: no other node above or below the splice point needs to be touched, and no comparison of "is this level too imbalanced now" is ever performed, because no such invariant exists to check.

### Deletion: the same `update` array, used to unlink instead of link

Deletion runs the identical downward search pass, populating the same `update` array, until it locates the target node at level 0 (or determines it is absent, in which case deletion is simply a no-op). For every level `i` on which the target node exists (from level 0 up to whatever level it happens to have been promoted to at insertion time), it is unlinked exactly as a singly linked list node is always unlinked: `update[i]`'s forward pointer at level `i` is set to skip over the target node, pointing directly to whatever the target node's own forward pointer at level `i` was.

If removing the node empties out the topmost level entirely (no elements remain at that level), that now-useless empty level is discarded, shrinking the skip list's height. Nothing else needs to happen: there is no rebalancing pass, no recoloring, no rotation, because deletion, like insertion, only ever touches the small, local set of pointers immediately surrounding the affected node at each level it existed on.

### Why there is no "fix-up" phase at all

AVL and red-black trees both require insertion and deletion to be followed by a second phase, climbing back up from the modified node and repairing whatever invariant the modification disturbed. A skip list has no such second phase because it has no invariant to disturb in the structural sense those trees mean: a node's level was already decided, once, by coin flips, before insertion even happens, and unlinking a node during deletion cannot possibly violate anything about any *other* node's level, since every node's level is independent of every other node's level by construction. The only structural bookkeeping insertion or deletion ever does is the ordinary singly-linked-list splice-in or splice-out, repeated once per level the affected node occupies, an O(log n)-levels operation with O(1) work at each level, and nothing more.

## Worked Examples

### Example 1: inserting a new node with a recorded `update` array

**Problem:** Using the skip list from the previous concept (levels 0-3, with checkpoints 20 and 40 on the higher levels), insert the value `27`, which was already determined (in the previous concept's Example 2) to be promoted to levels 0, 1, and 2.

**Downward pass, recording `update`:** At level 3, from head, next is `40` (greater than `27`), so `update[3] = head`, drop down. At level 2, from head, next is `20` (less than `27`, move right); from `20`, next is `40` (greater than `27`), so `update[2] = 20`, drop down. At level 1, from `20` (arrived at via the vertical pointer), next is `40` (greater than `27`), so `update[1] = 20`, drop down. At level 0, from `20`, next is `25` (less than `27`, move right); from `25`, next is `30` (greater than `27`), so `update[0] = 25`.

**Splicing `27` in:** At level 0, `27`'s forward pointer is set to `25`'s old forward pointer (`30`), and `25`'s forward pointer is set to `27`. At level 1, `27`'s forward pointer is set to `20`'s old forward pointer at level 1 (`40`), and `20`'s forward pointer at level 1 is set to `27`. At level 2, the same happens between `20` and `40` at level 2. `27` is not spliced in at level 3, since its coin flips stopped at level 2.

**Result:** `27` now appears at levels 0, 1, and 2, each splice done purely between `27` and its immediate `update[i]` neighbor, with no other node touched.

### Example 2: deleting a node that exists on multiple levels

**Problem:** Delete `40` from the resulting skip list, given that `40` exists on levels 0, 1, 2, and 3 (as shown in the original diagram).

**Downward pass, recording `update`:** The same style of search locates the node immediately before `40` at every level: `update[3] = head` (since `40` is the first node on level 3), `update[2] = 20`, `update[1] = 27` (after the insertion in Example 1), `update[0] = 35`.

**Unlinking `40`:** At each level from 3 down to 0, `update[i]`'s forward pointer is redirected to skip `40`, pointing instead to whatever `40`'s own forward pointer at that level was (`head` at level 3 now points to whatever came after `40` there, `20` at level 2 now points past `40`, and so on down to level 0). If level 3 had contained only `40`, it would now be empty and would be discarded, shrinking the skip list's height by one.

## Common Misconceptions & Pitfalls

- **"Insertion needs to re-flip a coin for every existing node to see if the structure is still balanced."** Only the new node being inserted gets a fresh coin-flip sequence to decide its own height; every other node's level, having already been decided at its own insertion time, is left completely untouched.
- **"The `update` array needs a second pass over the skip list to be built."** It is built during the exact same downward pass that locates the insertion or deletion point, at zero extra traversal cost, exactly as Examples 1 and 2 show.
- **"Deleting a node that exists on the top level shrinks every other node's level too."** Every node's level is independent; removing the one node on the top level only ever affects that empty level itself (which may then be discarded), never reassigns or recomputes any other node's height.
- **"Skip lists need rotations too, they are just called something else."** There is no operation in a skip list that plays the role of a rotation. The only structural work insertion and deletion do is standard singly-linked-list pointer splicing, at each level the affected node occupies, and nothing else.

## Summary

Search moves right while the next key on the current level is still less than the target and drops down a level otherwise, until it lands on level 0. Insertion reuses that exact downward pass, recording in an `update` array the last node visited at each level before dropping down, then splices the new node in immediately after `update[i]` at every level the new node's coin flips promoted it to. Deletion reuses the identical downward pass and `update` array to locate the target node, then unlinks it from every level it exists on by redirecting each `update[i]`'s pointer around it. Neither operation needs any fix-up phase, because no cross-node invariant is ever at risk: every node's level was decided once, independently, at its own insertion, so linking or unlinking one node can never require adjusting any other node's level. The next concept derives, rigorously, why this coin-flip process really does keep the expected height at O(log n).

## Documentation Links

- [Pugh, W. (1990). "Skip Lists: A Probabilistic Alternative to Balanced Trees." Communications of the ACM.](https://epaperpress.com/sortsearch/download/skiplist.pdf): paper
- [MIT 6.006 - Lecture Notes (OCW)](https://ocw.mit.edu/courses/6-006-introduction-to-algorithms-spring-2020/pages/lecture-notes/): doc
