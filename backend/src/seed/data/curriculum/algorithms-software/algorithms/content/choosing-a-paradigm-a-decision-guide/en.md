---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- State the defining structural difference between divide-and-conquer, greedy, and dynamic programming in terms of how each treats subproblems.
- Recognize the tell-tale signs, in a new problem statement, that point toward each of the three paradigms.
- Explain why greedy requires a correctness proof that divide-and-conquer and DP don't need in the same way, and why DP is the fallback when that proof fails or doesn't exist.
- Work through unfamiliar problem statements and justify, with reference to structural properties rather than surface resemblance, which paradigm each one calls for.
- Name, for each paradigm, at least one canonical algorithm already covered in this discipline that anchors it concretely.

## Context & Motivation

This discipline has now built three genuinely different ways of turning a problem into an algorithm: divide-and-conquer, which splits a problem into independent pieces and combines their answers; greedy, which commits to one locally-best choice at a time and never looks back; and dynamic programming, which solves overlapping subproblems once each and reuses their answers. Each paradigm was introduced with its own canonical example — merge sort for divide-and-conquer, activity selection for greedy, Fibonacci and then a run of practical problems (LCS, 0/1 Knapsack, LIS) for dynamic programming — and each earned its place with a real proof or demonstration of when it applies and when it doesn't: merge sort's recurrence solved exactly; activity selection's greedy choice validated by a full exchange argument; 0/1 Knapsack's greedy ratio-strategy shown, concretely, to fail.

What this closing concept adds is not a new technique, but the skill that actually matters once all three are in hand: given a brand-new problem statement, with no paradigm named in advance, recognizing which one it calls for — and, just as importantly, recognizing when the answer isn't obvious and a proof or a counterexample is needed before trusting a specific approach. This is the single most transferable skill in a course on algorithmic paradigms, because real problems never arrive labeled "use dynamic programming here." They arrive as a description of inputs and a goal, and the tell-tale structural signs — does the problem split into pieces that never share work? does a locally-best choice provably never need to be revisited? does a naive recursive solution redo identical work across many different call paths? — are what this concept trains directly.

## Core Theory

### The structural distinction, precisely

**Divide-and-conquer** splits a problem into smaller subproblems that are solved *independently* — no subproblem's solution is needed by another subproblem at the same stage, and no two subproblems ever turn out to be identical. Merge sort's two halves share no data and are never recombined until the final merge step; the recursion tree has no repeated nodes anywhere. The combine step (merging two sorted halves) is where all the real cleverness typically lives.

**Greedy** builds a solution incrementally, making one choice at each step that looks best *right now*, and — critically — never reconsidering that choice afterward. This is fast and simple whenever it's correct, but its correctness is never something to assume: it requires an actual proof (typically an exchange argument, as activity selection's earliest-finish-time rule received) showing that the locally-best choice is always part of *some* globally optimal solution. Without that proof, greedy is just a guess that happens to run fast.

**Dynamic programming** applies when a problem has overlapping subproblems — a naive recursive solution would solve the identical smaller problem many times over different branches of its recursion — combined with optimal substructure, so that solving each distinct subproblem once (via memoization or tabulation) and combining those answers yields the correct global optimum. DP is reached for specifically in the situation greedy fails: when no single locally-best choice can be proven safe to commit to irrevocably, but trying every combination via brute-force recursion would be too slow — DP's table (or cache) is what makes exploring all the relevant combinations tractable.

### Comparison table

| | Divide-and-Conquer | Greedy | Dynamic Programming |
|---|---|---|---|
| **Subproblem relationship** | Independent — never overlap | N/A — no subproblems kept; one running partial solution | Overlapping — same subproblem recurs across many branches |
| **Core mechanism** | Split, solve each recursively, combine | Make one irrevocable locally-best choice per step | Solve each distinct subproblem once, cache/tabulate, reuse |
| **Correctness requires** | Correct combine step (often provable by induction) | A specific structural proof (e.g., exchange argument) — not automatic | Confirming both overlapping subproblems and optimal substructure hold |
| **When it fails / doesn't apply** | Subproblems that actually share work (redundant recursion) | No proof exists — a locally-best choice can block the true optimum | Subproblems don't actually recur (no redundancy to exploit) |
| **Typical complexity payoff** | Matches recurrence (e.g., O(n log n) for merge sort) | Often O(n log n) or better — very fast when valid | Polynomial via table/cache, vs. exponential naive recursion |
| **Canonical example (this discipline)** | Merge sort | Activity selection (proven), 0/1 Knapsack's ratio-greedy (disproven) | Fibonacci, LCS, 0/1 Knapsack, LIS |

### Tell-tale signs, as a diagnostic checklist

- **Does the problem naturally split into pieces that don't share information or work?** → likely divide-and-conquer. Ask: if I solved each half completely independently, would combining the two answers give the correct whole answer, with nothing lost? Merge sort: yes. Minimum spanning tree, considered piece by piece: generally no — pieces interact through shared vertices/edges, which is why MST algorithms use greedy strategies over subgraphs instead.
- **Can I articulate, and then actually prove, that committing to one "obviously best right now" choice never forecloses a better overall solution?** → greedy, but only once that proof exists. Activity selection's earliest-finish rule survived this test with a real exchange argument. If the proof doesn't come together — or worse, a small counterexample surfaces instead, as it did for 0/1 Knapsack's ratio-greedy — greedy is the wrong tool, whatever its superficial appeal.
- **Does a naive recursive solution keep recomputing the exact same smaller subproblem, reached via different sequences of decisions?** → dynamic programming. This is the overlapping-subproblems check from earlier in this discipline, and it's a mechanical, checkable property: trace a few levels of the naive recursion and look for repeated arguments to the same function.

## Worked Examples

### Example 1 — "Given n jobs each with a deadline and a profit, and only one job can run per time slot, schedule jobs to maximize total profit, giving up any job that misses its deadline entirely."

This resembles activity selection at first glance (scheduling under constraints), but look closer: unlike activity selection, jobs here don't have start/end times that overlap in a simple line — the constraint is purely "one job per slot, must finish by its deadline." A greedy strategy (sort by profit descending, assign each job to the latest available slot before its deadline) does turn out to have a genuine exchange-argument proof of correctness for this specific variant — so this is a greedy problem, but the resemblance to activity selection is only surface-level; the actual justification has to be worked out for this problem's own constraint structure, not borrowed wholesale from activity selection's proof. The broader lesson: recognizing "this looks like a scheduling problem, so it's probably greedy" is a reasonable hypothesis, but the tell-tale sign that actually confirms it is the existence (or construction) of a real proof, not the surface resemblance alone.

### Example 2 — "Given a set of items with weights and values and a knapsack capacity, choose a subset (each item fully included or excluded) maximizing value without exceeding capacity."

This is 0/1 Knapsack, already covered in full. The tell-tale sign pointing away from greedy and toward DP is exactly the counterexample this discipline built concretely: items `(w=10,v=60)`, `(w=20,v=100)`, `(w=30,v=120)` at capacity 50, where the best-ratio-first greedy choice (`A`, then `B`) achieves value 160, while the true optimum (`B + C`) achieves 220. Because a locally-best choice (take `A` first) can be shown to actively block a better global solution, no exchange-argument proof for greedy can exist here — this is not "greedy might work, unproven," it's "greedy is disproven, concretely." A naive recursive solution to this problem also visibly overlaps subproblems (the same "first `i` items, remaining capacity `c`" pair recurs across many item-inclusion decisions), confirming DP is the right tool, with its table computing the true 220 directly.

### Example 3 — "Given a weighted, connected, undirected graph, find a subset of edges connecting all vertices with minimum total edge weight" and "Given an array, sort it using the fewest comparisons in the worst case, guaranteed."

Two anchoring examples in one, deliberately chosen to contrast: the minimum spanning tree problem is solved, in this discipline, by both Kruskal's and Prim's algorithms — both genuinely greedy (always add the cheapest safe edge; always extend the tree via the cheapest edge leaving it), and both correct specifically because the "cut property" gives exactly the kind of structural proof greedy needs, applied to this problem's specific structure — a different proof from activity selection's, but a proof nonetheless, which is the actual tell-tale sign, not a coincidence that "graph problems tend to be greedy." Merge sort, by contrast, is a divide-and-conquer answer to the sorting question: split the array in half, sort each half completely independently (no shared work, no overlap between the two halves' recursions), and combine via a linear merge — the independence of the two halves, with nothing computed twice, is exactly what marks this as divide-and-conquer rather than DP, even though sorting could in principle be approached many other ways.

## Common Misconceptions & Pitfalls

- **"If a problem involves choosing a subset to optimize something, it's always a knapsack-style DP problem."** Activity selection also chooses a subset (which activities to keep) to optimize something (count of non-overlapping activities), and is provably a greedy problem, not a DP one — the deciding factor is whether a proof of the locally-best choice's safety exists (it does, via the exchange argument), not the surface shape "choose a subset."
- **"Greedy and DP are interchangeable — if greedy seems to give a good answer on a few test cases, it's probably fine."** 0/1 Knapsack's counterexample shows greedy can look completely reasonable and still be provably, concretely wrong — a few passing test cases prove nothing; only a real proof (for greedy) or a demonstrated overlapping-subproblems-plus-optimal-substructure pair (for DP) provides an actual guarantee.
- **"Divide-and-conquer and DP are the same thing, since both use recursion and break problems into smaller pieces."** The distinguishing question is whether the subproblems actually overlap. Merge sort's recursive halves never repeat; Fibonacci's, LCS's, and Knapsack's subproblems do, which is exactly why the latter benefit from a cache or table and the former does not.
- **"Once you've picked a paradigm for a problem that resembles a known one, the known one's proof carries over automatically."** Example 1 shows this is risky — surface resemblance to activity selection doesn't hand over its exchange-argument proof for free; a genuinely different constraint structure needs its own justification, even when the same paradigm ultimately turns out to apply.

## Summary

Divide-and-conquer, greedy, and dynamic programming are distinguished by one structural question above all: how does the problem's subproblems relate to each other? Independent, non-overlapping subproblems combined by a correct merge step point to divide-and-conquer (merge sort, the anchoring example). A single locally-best choice, made once per step and never revisited, points to greedy — but only once a real proof (an exchange argument, as with activity selection, or the cut property, as with Kruskal's and Prim's MST algorithms) confirms that choice is always safe; absent such a proof, or in the face of an actual counterexample like 0/1 Knapsack's ratio-greedy failure (value 160 versus the true optimum of 220), greedy is not a fallback worth trusting. Overlapping subproblems — the same smaller instance recurring across many different decision paths in a naive recursive solution — combined with optimal substructure point to dynamic programming, the tool reached for specifically when brute-force recursion is correct but too slow, and greedy's shortcut isn't safe. Recognizing which of these three signs a new, unfamiliar problem exhibits — rather than pattern-matching it against a superficially similar problem already solved — is the transferable skill this entire discipline has been building toward.

## Documentation Links

- [MIT 6.006 — Lecture Notes (OCW)](https://ocw.mit.edu/courses/6-006-introduction-to-algorithms-spring-2020/pages/lecture-notes/) — doc
- [ACM/IEEE CS2013 — Algorithms and Complexity Knowledge Area](https://csed.acm.org/cs2013-version/) — doc
