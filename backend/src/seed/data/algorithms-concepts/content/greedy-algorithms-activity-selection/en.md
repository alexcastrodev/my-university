---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

Understand the activity-selection problem — scheduling the largest possible set of non-overlapping activities onto a single shared resource — and the specific greedy rule (earliest finish time) that provably solves it, contrasted with plausible-sounding greedy rules that don't, and with the dynamic-programming approach the same problem could use but doesn't need.

## Use Cases

- Booking a single conference room, court, or piece of shared equipment for as many non-overlapping reservations as possible.
- Scheduling a machine, CPU core, or exclusive lock to maximize the number of compatible jobs it can run back-to-back.
- Recognizing, in an interview or a design discussion, when a scheduling-shaped problem is a greedy problem in disguise — and when a small twist (e.g., activities carrying different *values*) breaks the greedy rule and pushes you back toward dynamic programming.

## Deep Dive

### The activity-selection problem and greedy-by-earliest-finish-time

Given `n` activities, each with a start time `s[i]` and a finish time `f[i]`, activity `i` occupies the half-open interval `[s[i], f[i])`. Two activities are *compatible* if their intervals don't overlap — that is, `a[i]` and `a[j]` are compatible if `s[i] >= f[j]` or `s[j] >= f[i]`. The goal: pick the largest possible subset of mutually compatible activities.

The greedy algorithm sorts by finish time, then repeatedly takes the next activity whose start time is at or after the finish time of the most recently selected one:

```java
record Activity(String name, int start, int finish) {}

static List<Activity> selectActivities(List<Activity> activities) {
    List<Activity> sorted = new ArrayList<>(activities);
    sorted.sort(Comparator.comparingInt(Activity::finish)); // the one sort that makes the rest Θ(n)

    List<Activity> selected = new ArrayList<>();
    int lastFinish = Integer.MIN_VALUE;
    for (Activity a : sorted) {
        if (a.start() >= lastFinish) {   // compatible with every activity chosen so far
            selected.add(a);
            lastFinish = a.finish();
        }
    }
    return selected;
}
```

This is a direct translation of CLRS's iterative `GREEDY-ACTIVITY-SELECTOR(s, f, n)`. Because `lastFinish` always tracks the maximum finish time among selected activities, checking `a.start() >= lastFinish` is enough to confirm compatibility with *every* previously selected activity, not just the most recent one — no need to re-scan the whole selected set.

Worked example, seven activities already sorted by finish time:

| Activity | Start | Finish | Selected? | Why |
|---|---|---|---|---|
| A1 | 1 | 4 | Selected | earliest finish time overall — always the greedy starting choice |
| A2 | 3 | 5 | Rejected | starts at 3, before A1 finishes at 4 → overlaps A1 |
| A3 | 0 | 6 | Rejected | starts at 0, before A1 finishes at 4 → overlaps A1 |
| A4 | 5 | 7 | Selected | starts at 5 ≥ 4 (A1's finish) → compatible; `lastFinish` becomes 7 |
| A5 | 5 | 9 | Rejected | starts at 5, before A4 finishes at 7 → overlaps A4 |
| A6 | 6 | 10 | Rejected | starts at 6, before A4 finishes at 7 → overlaps A4 |
| A7 | 8 | 11 | Selected | starts at 8 ≥ 7 (A4's finish) → compatible |

Result: `{A1, A4, A7}`, size 3 — the maximum possible for this instance. Each rejected activity was ruled out for the same reason: its start time fell before the finish time of the most recently *selected* activity, not necessarily the most recently *considered* one.

### Why earliest finish time is provably correct

It's tempting to just trust the intuition — "leave the resource free sooner, so more can fit after it" — but CLRS actually proves it (Theorem 15.1), and the argument is worth having precisely, not just as a slogan.

Take any point in the algorithm where a subproblem remains: some set of still-available, pairwise-unconsidered activities. Let `am` be the one among them with the earliest finish time. Claim: `am` belongs to *some* maximum-size compatible subset of that remaining set.

The proof is an exchange argument. Take any optimal solution to that subproblem, and let `aj` be its earliest-finishing member. If `aj` is already `am`, done. Otherwise, swap `aj` out for `am`: since `am` has the earliest finish time of *anything* in the subproblem, `f(am) <= f(aj)`. Every other activity kept in that optimal solution starts at or after `f(aj)` (that's what made the solution compatible in the first place), and since `f(am) <= f(aj)`, those same activities also start at or after `f(am)`. So the swap doesn't break any compatibility — and the solution is still the same size, just with `am` in place of `aj`. That means an optimal solution containing `am` always exists.

The consequence is what makes the algorithm work: once you've made the greedy choice, you never need to look back and reconsider it. The earliest-finishing compatible activity always leaves the resource free for the largest possible remainder of the timeline, so swapping it into whatever the optimal solution was already going to do never costs you anything — it only ever ties or wins.

### A plausible but wrong greedy rule: shortest duration first

CLRS explicitly warns (Exercise 15.1-3) that not every greedy rule for this problem works, even ones that sound just as reasonable as "earliest finish time" — "shortest duration first" and "fewest remaining conflicts first" are both named as rules that fail. Here's a small, verified counterexample for shortest-duration-first:

| Activity | Start | Finish | Duration |
|---|---|---|---|
| X | 0 | 4 | 4 |
| Y | 4 | 8 | 4 |
| Z | 3 | 5 | 2 |

`X` and `Y` are compatible with each other (`X` finishes exactly when `Y` starts, and `s >= f` counts as compatible under the half-open-interval definition), so `{X, Y}` is a valid schedule of size 2 — and it's optimal, since only 3 activities exist and `Z` conflicts with both of the others.

A greedy algorithm that always picks the shortest remaining activity picks `Z` first (duration 2, shorter than `X` or `Y`'s duration 4). But `Z`'s interval `[3, 5)` overlaps `X`'s `[0, 4)` (`Z` starts at 3, before `X` finishes at 4) *and* overlaps `Y`'s `[4, 8)` (`Z` finishes at 5, after `Y` starts at 4). Picking `Z` rules out both `X` and `Y` in one move, leaving a final answer of `{Z}` — size 1, half the optimum.

Earliest-finish-time greedy doesn't make this mistake: sorted by finish time, the order is `X` (4), `Z` (5), `Y` (8). It picks `X` first, then checks `Z` (start 3, before `X`'s finish 4 → rejected), then `Y` (start 4, at or after `X`'s finish 4 → accepted), landing correctly on `{X, Y}`.

The failure mode is structural, not a fluke: a short activity can sit in the *middle* of two longer, mutually compatible ones, blocking both at once — duration alone says nothing about how much of the timeline an activity blocks for others.

### Greedy-choice property, optimal substructure, and why DP would be overkill here

CLRS names two ingredients a problem needs for a greedy algorithm to be provably correct:

- **Greedy-choice property** — a globally optimal solution can be reached by a sequence of locally best choices, each made without revisiting earlier ones and without waiting on the solutions to subproblems. Theorem 15.1 in the section above is exactly the proof that activity selection has this property for "earliest finish time."
- **Optimal substructure** — an optimal solution to the problem contains optimal solutions to its subproblems. For activity selection, if `Sk` is the set of activities that start no earlier than the finish of the most recently chosen activity `ak`, then an optimal solution to the whole problem is `ak` plus an optimal solution to the subproblem `Sk`. This is the same property dynamic programming relies on — greedy and DP both stand on optimal substructure, which is precisely why it's easy to reach for the wrong one.

CLRS actually walks through a full DP formulation of this same problem before introducing the greedy algorithm, as a deliberate contrast. Define `c[i,j]` as the size of an optimal solution restricted to activities that start after `ai` finishes and finish before `aj` starts:

```
c[i,j] = 0                                      if that set is empty
c[i,j] = max( c[i,k] + c[k,j] + 1 )  over every candidate ak in that set,  otherwise
```

That recurrence is correct — activity selection does have overlapping subproblems, and you *could* memoize or tabulate `c[i,j]` the way you would for any DP problem. But it's needless overhead here: filling that table means comparing every candidate split point `k` at every subproblem, which costs far more than the greedy algorithm's single sorted pass. Once the greedy-choice property is proven, you know in advance which choice is optimal at every step (the earliest-finishing compatible one), so there's nothing left to compare — no table, no backtracking, just Θ(n) after an O(n log n) sort. DP explores; greedy commits.

## Trade-offs

- **Greedy is cheap only after the proof is done.** The runtime win — O(n log n) total (dominated by the sort), versus a DP table with O(n) subproblems each scanning up to O(n) split points — only exists because the greedy-choice property was proven first. Skipping that proof and just trying a rule that "seems right" is how you end up with the shortest-duration-first bug above: it can pass casual testing and still be wrong on some inputs.
- **Greedy commits and never looks back — which is also its blind spot.** The algorithm never reconsiders a choice once made:

  ```java
  // lastFinish only ever moves forward — there's no path back to an earlier decision
  if (a.start() >= lastFinish) {
      selected.add(a);
      lastFinish = a.finish();   // this activity is now locked in, permanently
  }
  ```

  That's what makes it fast, but it also means the rule is brittle to problem changes. Add a per-activity *value* and ask for the highest-value compatible subset instead of the largest count (CLRS Exercise 15.1-5) — earliest-finish-time greedy is no longer guaranteed optimal, and the weighted version of the problem needs a DP solution (weighted interval scheduling) instead.
- **Two named properties are a checklist, not a guarantee of ease.** Greedy-choice property and optimal substructure tell you *whether* a greedy algorithm can exist for a problem, but proving the greedy-choice property is still real work — usually an exchange argument like Theorem 15.1's, tailored to the specific rule you're proposing. A different rule for the same problem (fewest conflicts, earliest start) needs its own proof attempt, and for those two rules the proof attempt fails, which is discoverable only by trying to construct one — or a counterexample.

## Documentation Links

- Cormen, Leiserson, Rivest, Stein, *Introduction to Algorithms*, 4th Edition (MIT Press, 2022) — Chapter 15 "Greedy Algorithms", Sections 15.1 "An activity-selection problem" and 15.2 "Elements of the greedy strategy", pp. 415-430 — book
