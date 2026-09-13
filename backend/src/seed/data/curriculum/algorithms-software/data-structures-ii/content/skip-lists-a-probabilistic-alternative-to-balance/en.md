---
version: 1.0
updatedAt: 2026-09-13
---
## Learning Objectives

- Describe a skip list as a hierarchy of sorted linked lists, where each higher level "skips over" more elements than the level below it.
- Explain how a skip list achieves O(log n) expected search time using randomization instead of a maintained balance invariant.
- Contrast this design philosophy (accept randomness, get balance for free in expectation) with AVL and red-black trees (enforce an exact invariant, pay for it with rotations).
- State why William Pugh introduced skip lists in 1990 explicitly as an alternative to balanced trees, and name the trade-off that alternative makes.
- Identify at least one production system that chooses skip lists over a balanced tree for a sorted, ordered structure.

## Context & Motivation

The last several concepts in this discipline answered one question two different ways: how do you keep a binary search tree from degrading to O(n) height, using AVL's numeric balance factor or red-black's color invariant. Both answers share a common shape: track some piece of bookkeeping at every node, and run a bounded-but-nonzero amount of rotation logic after every insertion or deletion to keep that bookkeeping's invariant satisfied. That shape is not the only way to solve the underlying problem, and it is worth being honest about its cost: both schemes require a correct, fully worked-out case analysis for insertion and deletion, and getting that case analysis wrong is a genuine, well-documented source of bugs in from-scratch implementations.

In 1990, William Pugh published a short paper with a title that doubles as this concept's own: "Skip Lists: A Probabilistic Alternative to Balanced Trees." His observation was that a much simpler structure, built entirely out of ordinary singly linked lists, achieves the same O(log n) expected performance as a balanced tree, with no rotations, no color bits, and no case analysis at all, by paying with a single, well-understood cost: giving up the *worst-case* guarantee and settling for an *expected* one, backed by a probability so favorable that in practice it is not a real risk. This concept builds the structure itself; the next two derive why the randomization actually delivers that guarantee and work through the operations in detail.

## Core Theory

### The idea: a hierarchy of "express lanes"

A **skip list** starts from something already familiar: a single sorted singly linked list, level 0, holding every element in order. Searching that list alone costs O(n) in the worst case, exactly like an unbalanced BST degenerated into a line. The fix is to build additional linked lists on top of level 0, each one a *sparser* subset of the level below it, each still sorted, each connected to level 0 by vertical pointers at the elements it contains:

```
Level 3:  HEAD ------------------------------------> 40 --------------------> NIL
Level 2:  HEAD ----------------> 20 ----------------> 40 --------------------> NIL
Level 1:  HEAD ------> 10 ----->  20 ----------------> 40 --------> 55 ------> NIL
Level 0:  HEAD -> 5 -> 10 -> 15 -> 20 -> 25 -> 30 -> 35 -> 40 -> 45 -> 50 -> 55 -> NIL
```

Level 0 has every element. Level 1 skips some. Level 3 skips almost all of them, acting as an express lane straight to a handful of "checkpoint" elements. A search starts at the top-left corner (the head of the highest level) and repeats one simple rule: move right as long as the next element on the current level is still less than the target, and drop down one level as soon as moving right would overshoot it. Each level dropped down through has already ruled out everything to the left, so the search never has to backtrack, only move right and down, until it lands on level 0 at (or just before) the target.

This is the exact same idea as an index in the back of a book: level 0 is the full text, and each level above it is a coarser index pointing into the level below, letting a reader jump straight to the right neighborhood instead of scanning page by page.

### Where the levels come from: a coin flip per element

The diagram above is not built by any careful, deliberate planning. Each element, at the moment it is inserted, is assigned a **level** by flipping a fair coin: it always exists at level 0, and for as long as the coin keeps coming up "promote" (heads, say), it is added to the next level up as well, stopping the first time the coin comes up "stop" (tails). Concretely: level 0 always gets the element; a fair coin flip decides whether it also goes into level 1; if it does, another fair coin flip decides whether it also goes into level 2; and so on. This means, in expectation, half of all elements reach level 1, a quarter reach level 2, an eighth reach level 3, and so on: exactly the sparser-and-sparser structure the diagram shows, produced by nothing more than independent coin flips at insertion time, with no coordination between elements and no rebalancing step ever required.

Because every element's level is decided once, independently, and never revisited, a skip list never needs to "fix" anything after an insertion or deletion the way a rotation fixes a broken AVL or red-black invariant. There is no invariant to break in the first place, only a probability distribution that, in expectation, keeps the structure shaped the way the diagram shows.

### Why this is called "probabilistic," not "randomized data selection"

It is worth being precise about what randomness is doing here, since it is easy to conflate with unrelated ideas like randomized quicksort's pivot choice. Randomized quicksort uses randomness to avoid an *adversarial* worst-case input; a skip list uses randomness to build the *entire shape of the structure itself*. The coin flips are not a defense against a hostile sequence of insertions (there is no comparison being randomized), they are the literal mechanism that decides, level by level, which elements exist where. A skip list built from the same set of elements, inserted in the same order, will look structurally different from one run to the next, purely because the coin flips came up differently, and that is by design: no adversary, no matter how carefully it chooses an insertion order, can force a bad shape, because the shape never depended on the order in the first place, only on independent coin flips the adversary cannot predict or control.

## Worked Examples

### Example 1: tracing a search by hand

**Problem:** Using the skip list diagrammed in Core Theory, search for the value `35`, listing every move.

**Trace:** Start at level 3, head. Next element at level 3 is `40`, which is greater than `35`, so drop to level 2 without moving right. At level 2, head's next is `20`, which is less than `35`, so move right to `20`. From `20` at level 2, next is `40`, greater than `35`, so drop to level 1. At level 1, from `20`, next is `40`, still greater than `35`, so drop to level 0. At level 0, from `20`, next is `25` (less than `35`, move right), then `30` (less than `35`, move right), then `35` : found.

**Total comparisons:** 6 (three "greater, drop down" checks and three "less, move right" checks), against a list of 12 elements, roughly on the order of log₂(12) ≈ 3.6 levels' worth of work rather than up to 12 comparisons a plain linear scan of level 0 alone could cost.

### Example 2: assigning levels by coin flip during insertion

**Problem:** A new element, `27`, is inserted. Simulate its level assignment given the coin flip sequence heads, heads, tails (reading each flip as "promote" for heads, "stop" for tails).

**Trace:** `27` always lands on level 0 (no coin flip needed for that). First flip (heads) promotes it to level 1. Second flip (heads) promotes it to level 2. Third flip (tails) stops the promotion: `27` does not reach level 3. Final level assignment: `27` exists at levels 0, 1, and 2, and the skip list's insert operation (detailed in the next concept) threads it into the sorted position at each of those three levels.

## Common Misconceptions & Pitfalls

- **"A skip list's height keeps growing unboundedly as more elements are inserted."** In expectation it grows as O(log n), the same as a balanced tree, because each additional level requires an exponentially less likely run of coin flips (a real, practical implementation also caps the maximum level at roughly log₂(n) to avoid wasting space on levels no element will realistically reach).
- **"Since the levels are random, a skip list has no real performance guarantee at all."** It has a *probabilistic* guarantee: expected O(log n) search, insert, and delete, with a worst case of O(n) that is possible in principle (every coin flip could come up "stop" immediately for every element) but so overwhelmingly unlikely for any realistic n that it is not a practical concern, in exactly the same sense that quicksort's O(n²) worst case is a real possibility that essentially never happens with randomized pivot selection.
- **"Skip lists and hash tables solve the same problem."** A hash table trades order for speed (O(1) expected lookup, but no meaningful notion of "the next largest key"); a skip list keeps elements fully sorted (supporting range queries, "find the next element after X," and ordered iteration) at the cost of O(log n) rather than O(1) expected lookup. They are not competitors for the same job, this discipline's closing concept revisits exactly this kind of "what is each structure actually good at" comparison.
- **"Every element that reaches level 1 was specially chosen to be a good checkpoint."** No selection happens at all beyond independent coin flips; there is no notion of choosing "important" elements, and a skip list built from the same elements in a different insertion order (or with different coin flip outcomes) will promote a different, still-effective, subset.

## Summary

A skip list solves the same problem as AVL and red-black trees, keeping search, insert, and delete at O(log n), using an entirely different mechanism: a hierarchy of sorted linked lists, where level 0 holds every element and each level above it holds a sparser, still-sorted subset, connected by vertical pointers. Which level an element reaches is decided once, at insertion, by a sequence of independent coin flips (promote on heads, stop on tails), producing a structure that is balanced in expectation with no invariant to maintain and no rotation logic to get right. This trades a worst-case guarantee for a probabilistic one backed by genuinely favorable odds, the same style of trade Pugh's 1990 paper made explicit in its title, and it is exactly the trade production systems like Redis's sorted sets make when they choose a skip list over a balanced tree for an ordered structure. The next concept works through search, insert, and delete in full mechanical detail; the one after that derives precisely why the expected height really is O(log n).

## Documentation Links

- [Pugh, W. (1990). "Skip Lists: A Probabilistic Alternative to Balanced Trees." Communications of the ACM.](https://epaperpress.com/sortsearch/download/skiplist.pdf): paper
- [Redis Documentation: Sorted Sets](https://redis.io/docs/latest/develop/data-types/sorted-sets/): doc
