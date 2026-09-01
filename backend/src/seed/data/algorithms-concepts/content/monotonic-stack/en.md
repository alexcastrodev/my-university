---
version: 1.0
updatedAt: 2026-09-01
---
## Objective

Understand the monotonic stack: a stack kept in strictly increasing or strictly decreasing order by popping any element that would violate that order *before* pushing the new one. It turns "for every element, scan the rest of the array for the nearest larger (or smaller) value" from O(n²) into O(n) — and the O(n) bound is not a new argument, it's [Amortized Analysis](amortized-analysis)'s own stack-with-multipop example, applied to a real problem instead of a textbook toy.

## Use Cases

- **Daily Temperatures** — for each day, how many days until a warmer one.
- **Next Greater Element / Next Smaller Element** — the direct generalization of the above.
- **Largest Rectangle in Histogram** — the widest rectangle that fits under a skyline of bars.
- **Trapping Rain Water** — a stack-based alternative to the two-pointer solution, tracking bars that could form a container.

## Deep Dive

### The invariant: never let the stack stop being sorted

Scan the array once, left to right, keeping a stack of *indices*. Before pushing the current index, pop every index off the top whose value would break the stack's order (for "next greater element," pop while the top's value is ≤ the current value) — each popped index has just found its answer: the current element is exactly the "next greater" it was waiting for. Then push the current index. Whatever survives on the stack at any point is precisely the set of elements still waiting for their answer, in sorted order.

```java
public static int[] dailyTemperatures(int[] temps) {
    int[] answer = new int[temps.length];
    Deque<Integer> stack = new ArrayDeque<>();   // indices, decreasing temps
    for (int i = 0; i < temps.length; i++) {
        while (!stack.isEmpty() && temps[stack.peek()] < temps[i]) {
            int prev = stack.pop();
            answer[prev] = i - prev;
        }
        stack.push(i);
    }
    return answer;   // indices left on the stack never found a warmer day: answer stays 0
}
```

### Watch it happen: daily temperatures on [73, 74, 75, 71, 69, 72]

| i | temp | pops (index: gap recorded) | stack after |
|---|---|---|---|
| 0 | 73 | — | [0] |
| 1 | 74 | 0: 1−0=1 | [1] |
| 2 | 75 | 1: 2−1=1 | [2] |
| 3 | 71 | — | [2, 3] |
| 4 | 69 | — | [2, 3, 4] |
| 5 | 72 | 4: 5−4=1; 3: 5−3=2 | [2, 5] |

Index 2 (value 75) is never popped — there's no warmer day later, so its answer stays 0. That's the entire algorithm; no element is ever re-examined once it's popped.

### Why this is O(n): CLRS's multipop-stack argument, transplanted

Each index is pushed exactly once (in the main loop) and popped at most once (ever, by any iteration) — so the total number of pushes plus pops across the *entire* run is at most 2n, no matter how unevenly the pops are distributed across iterations (some iterations pop nothing, one could pop many). That is verbatim the aggregate-method proof [Amortized Analysis](amortized-analysis) gives for a stack supporting a `MULTIPOP` operation: a single expensive step is fine as long as the *total* work across all steps stays linear, and here it provably does.

### Harder relatives: same skeleton, different quantity per pop

`Largest Rectangle in Histogram` and `Trapping Rain Water` reuse the identical push/pop-while-violating skeleton; what changes is what gets computed at each pop. For the histogram problem, popping a bar computes the largest rectangle that bar could anchor, using the *current* index and the *new* stack top as its left/right boundaries — a direct payoff of storing indices rather than values, covered next.

## Trade-offs

- **One direction per pass** — a single left-to-right scan finds the nearest qualifying element to the *right* of each position; "nearest greater on both sides" needs either two passes (one from each direction) or careful bookkeeping in one pass, not a single stack alone.
- **Strict vs. non-strict comparison changes correctness with duplicates** — popping on `<` versus `<=` decides whether an equal-valued element counts as "greater," and picking the wrong one silently mishandles ties; this has to be decided per-problem, the same way binary search's `<` vs `<=` boundary conditions do.
- **Store indices, not values** — the value alone can't recover a position, gap, width, or span once other elements have been popped around it; nearly every real use of this technique needs the index precisely because the answer is a distance or an area, not the value itself.

## Documentation Links

- Cormen, Leiserson, Rivest, Stein — Introduction to Algorithms, 4th Edition, Chapter 16 "Amortized Analysis," Section 16.1 (the stack-with-MULTIPOP example this technique's O(n) bound is a direct application of) — book
- Robert Sedgewick, Kevin Wayne — Algorithms, 4th Edition (Addison-Wesley, 2011) — Section 1.3, "Bags, Queues, and Stacks" — book
