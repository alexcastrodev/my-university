---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- Implement quick-find, an array-based union-find where `find` is O(1) and `union` relabels an entire group.
- Implement quick-union, a parent-pointer forest where `union` repoints a single root and `find` walks up to a root.
- Analyze the worst-case cost of `union` under quick-find and of `find` under quick-union, and construct concrete input sequences that trigger each worst case.
- Explain why neither naive implementation is acceptable on its own for a long sequence of mixed operations.
- Compare the two approaches' trade-offs precisely enough to motivate the optimizations (union by rank/size, path compression) developed in the concepts that follow.

## Context & Motivation

Having settled on the union-find ADT's two-operation contract in the previous concept, the natural next question is: what is the simplest possible implementation? Sedgewick and Wayne's Princeton "Algorithms, Part I" — the course that opens with union-find precisely to teach this lesson — deliberately presents two "obvious" first attempts, quick-find and quick-union, before touching any optimization, because the pedagogical payoff of seeing both fail in complementary ways is worth more than jumping straight to the efficient version. Each of these two approaches gets one of the two operations essentially free, and pays dearly for the other; neither one is a strictly better default, and understanding exactly *how* each one fails is what makes the subsequent fixes (union by rank and path compression) feel inevitable rather than arbitrary.

This matters beyond pedagogy. It is a genuinely common instinct, when first implementing any two-operation interface, to optimize the operation that seems more "natural" to write quickly and let the other one be however it ends up — and union-find is a clean, small enough example to see precisely why that instinct, applied naively here, produces a structure whose worst-case behavior is unacceptable for any workload with many operations. Both quick-find and quick-union are worth implementing in full, by hand, specifically because their failure modes are concrete and easy to construct — not asymptotic hand-waving, but an actual small sequence of operations that visibly goes wrong.

## Core Theory

### Quick-find: an array of group labels

Quick-find represents the partition with a single array `id`, where `id[i]` is a label for the group containing element `i`. Two elements `p` and `q` are connected exactly when `id[p] == id[q]`.

```python
class QuickFind:
    def __init__(self, n):
        self.id = list(range(n))  # each element starts in its own group, labeled by itself

    def find(self, p):
        return self.id[p]

    def connected(self, p, q):
        return self.find(p) == self.find(q)

    def union(self, p, q):
        pid, qid = self.id[p], self.id[q]
        if pid == qid:
            return
        for i in range(len(self.id)):
            if self.id[i] == pid:
                self.id[i] = qid
```

`find` is a single array lookup — O(1), as fast as it is possible for any implementation to be. But `union` must scan the *entire* array and relabel every element currently sharing `p`'s old label, which costs O(n) in the worst case, no matter how small the two groups being merged actually are.

**Concrete failure mode.** Take n = 8 elements, all singletons, and perform `union(0,1)`, `union(0,2)`, `union(0,3)`, …, `union(0,6)` — repeatedly growing one group by one element at a time. Each `union` call scans the full array of 8 elements looking for the old label to relabel, even though only one element is actually being added to the group each time. Over `n − 1` such unions, the total work is proportional to `n + (n-1) + (n-2) + \dots \approx n^2/2` — quadratic total cost for what is, in terms of the number of *elements* ultimately merged, a linear amount of "real" work. This is quick-find's core weakness: even a union that logically merges one tiny group into another pays for a full-array scan regardless.

### Quick-union: a forest of parent pointers

Quick-union instead represents each group as a tree, using an array `parent` where `parent[i]` is `i`'s parent, or `i` itself if `i` is a root (the group's canonical representative). `find` walks up parent pointers until it reaches a root.

```python
class QuickUnion:
    def __init__(self, n):
        self.parent = list(range(n))  # each element starts as its own root

    def find(self, p):
        while self.parent[p] != p:
            p = self.parent[p]
        return p

    def connected(self, p, q):
        return self.find(p) == self.find(q)

    def union(self, p, q):
        root_p, root_q = self.find(p), self.find(q)
        if root_p == root_q:
            return
        self.parent[root_p] = root_q  # attach one root under the other
```

`union` is now fast: once the two roots are found, merging is a single pointer write, `parent[root_p] = root_q` — O(1) beyond the cost of the two `find` calls it needs to locate the roots. But `find` now has to walk potentially the entire height of a tree, and nothing in this naive version controls that height.

**Concrete failure mode.** Suppose unions arrive in this order, always attaching the most recently formed root under the newest element: `union(0,1)`, `union(1,2)`, `union(2,3)`, `union(3,4)`, `union(4,5)`. If each `union(a, b)` call happens to make `a`'s root the child of `b`'s root (a plausible outcome depending on which argument is treated as "the tree to attach"), the resulting structure degenerates into a single long chain:

```mermaid
graph BT
    N0((0)) --> N1((1))
    N1 --> N2((2))
    N2 --> N3((3))
    N3 --> N4((4))
    N4 --> N5((5))
```

Now `find(0)` must walk 0 → 1 → 2 → 3 → 4 → 5, five hops to reach the root, for a tree of only six elements. In general, a chain of length n forces `find` on the deepest element to take O(n) steps — no better, asymptotically, than quick-find's worst-case `union`. The problem is entirely self-inflicted: nothing in the naive `union` above considers which root is "better" to attach under which — it always attaches `root_p` under `root_q`, regardless of which tree is taller, so an adversarial or even just unlucky sequence of union calls can chain every element into a single degenerate path.

### Side-by-side comparison

| | `find` cost | `union` cost | Underlying structure |
|---|---|---|---|
| Quick-find | O(1) | O(n) worst case | flat array, `id[i]` = group label |
| Quick-union | O(n) worst case (degenerate tree) | O(1) beyond two `find` calls | forest, `parent[i]` = parent or self |

Neither is acceptable as a general-purpose structure for a long mixed sequence of `union` and `find` calls: quick-find guarantees fast lookups but can force every single union to touch the whole array; quick-union guarantees fast merges but can silently build a tree so tall that every subsequent lookup crawls up a near-linear chain. Both weaknesses trace back to the same root cause — neither implementation exercises any control over *how* groups get combined; quick-find always does a full scan regardless of group size, and quick-union always attaches one specific root under the other regardless of tree height. The next concept, union by rank and size, fixes exactly this by making that attachment choice deliberately.

## Worked Examples

### Example 1 — quick-find's wasted work, traced step by step

**Problem:** With n = 5 and quick-find, trace `id` through `union(0,1)`, `union(0,2)`, `union(0,3)`, `union(0,4)`, and count how many array cells are actually inspected in total (not just written).

**Trace.** Start: `id = [0,1,2,3,4]`.

- `union(0,1)`: `id[0]=0`, `id[1]=1`. Scan all 5 cells looking for value 0, relabel to 1. `id = [1,1,2,3,4]`. Cells inspected: 5.
- `union(0,2)`: `find(0)=1` (its current label), `find(2)=2`. Scan all 5 cells for value 1, relabel to 2. `id = [2,2,2,3,4]`. Cells inspected: 5.
- `union(0,3)`: `find(0)=2`, `find(3)=3`. Scan all 5 cells for value 2, relabel to 3. `id = [3,3,3,3,4]`. Cells inspected: 5.
- `union(0,4)`: `find(0)=3`, `find(4)=4`. Scan all 5 cells for value 3, relabel to 4. `id = [4,4,4,4,4]`. Cells inspected: 5.

**Total:** 4 unions × 5 cells scanned each = 20 cell inspections, to merge 5 elements into one group — a group that could, in principle, have been built with only 4 "real" merge facts recorded. This is the quadratic blow-up pattern: each union costs a full O(n) scan regardless of how much the group actually grows.

### Example 2 — quick-union building a bad chain, then paying for it

**Problem:** With n = 6 and quick-union (always attaching `find(p)`'s root under `find(q)`'s root, per the `union(p, q)` code above), trace `parent` through `union(0,1)`, `union(1,2)`, `union(2,3)`, `union(3,4)`, `union(4,5)`, then compute the cost (number of pointer hops) of `find(0)`.

**Trace.** Start: `parent = [0,1,2,3,4,5]`.

- `union(0,1)`: roots are 0 and 1. `parent[0] = 1`. `parent = [1,1,2,3,4,5]`.
- `union(1,2)`: `find(1)=1`, `find(2)=2`. `parent[1] = 2`. `parent = [1,2,2,3,4,5]`.
- `union(2,3)`: `find(2)=2`, `find(3)=3`. `parent[2] = 3`. `parent = [1,2,3,3,4,5]`.
- `union(3,4)`: `find(3)=3`, `find(4)=4`. `parent[3] = 4`. `parent = [1,2,3,4,4,5]`.
- `union(4,5)`: `find(4)=4`, `find(5)=5`. `parent[4] = 5`. `parent = [1,2,3,4,5,5]`.

Final `parent = [1,2,3,4,5,5]` — a chain 0→1→2→3→4→5.

**Cost of `find(0)`:** 0 → 1 → 2 → 3 → 4 → 5, five hops to reach the root (5, which points to itself). For n = 6 elements, this is O(n) for a single `find` — exactly the degenerate behavior the naive `union` permits, because it always attached the first argument's root under the second's without ever checking which tree was taller.

## Common Misconceptions & Pitfalls

- **"Quick-union is just strictly better than quick-find because its `union` is fast."** Quick-union's `union` is fast only in the sense of "O(1) beyond locating the roots" — but locating the roots via `find` is exactly what can degrade to O(n) in a bad tree, so a `union` call still pays that hidden `find` cost twice. Quick-union does not dominate quick-find; it simply relocates the worst case from `union` to `find`.
- **"The chain-degeneration failure mode requires an adversary; it won't happen with 'normal' data."** It requires no adversary at all — it only requires unions to consistently attach in the same directional pattern, which is exactly what the naive `union(p, q)` code above does every single time (always root of `p` under root of `q`), not as a rare edge case but as its unconditional behavior. Any sequence of unions that happens to chain elements in increasing order, as in Example 2, triggers it.
- **"Quick-find's O(n) union only matters for very large n."** The asymptotic label matters at any scale where many unions occur — the point of Example 1 is that the *pattern* (full-array scan per union, regardless of how small the actual group being merged is) is wasteful even for small n; it simply becomes intolerable as n and the number of operations grow, since the total cost compounds to roughly O(n²) over n − 1 unions.
- **"You can fix quick-union's degeneracy just by being 'careful' about union order in your own code."** In principle a programmer controlling every union call could avoid bad orderings by hand, but real workloads (arbitrary streams of connection events, arbitrary edge orderings in Kruskal's algorithm) do not offer that control — the fix has to live inside `union` itself, structurally, which is exactly what union by rank/size (the next concept) provides.

## Summary

Quick-find and quick-union are the two naive first attempts at implementing the union-find ADT, and each makes one operation essentially free at the cost of leaving the other with a bad worst case. Quick-find stores a group label per element in a flat array, giving O(1) `find` but forcing `union` to potentially relabel every element, an O(n) operation that compounds to roughly O(n²) total cost across n − 1 unions. Quick-union stores parent pointers forming a forest, giving fast O(1) merges (beyond locating roots) but leaving `find` to walk up to a root along a path whose length is entirely uncontrolled — a bad sequence of unions can chain n elements into a single path, making a single `find` cost O(n). Neither is acceptable for a long sequence of mixed operations, and both failures trace to the same cause: neither implementation makes any deliberate choice about *how* two groups get combined. That gap is exactly what the next two concepts, union by rank/size and path compression, close.

## Documentation Links

- [Sedgewick & Wayne — Algorithms Lectures (Princeton)](https://algs4.cs.princeton.edu/lectures/) — doc
- [Stanford CS166 — Data Structures](https://web.stanford.edu/class/cs166) — doc
