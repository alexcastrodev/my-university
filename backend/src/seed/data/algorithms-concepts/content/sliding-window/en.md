---
version: 1.0
updatedAt: 2026-09-01
---
## Objective

Understand the sliding window technique: maintaining a contiguous range over an array or string with two pointers that only ever move forward, expanding to absorb new elements and contracting to drop invalid ones — turning "recompute every window from scratch" (O(n·k) or O(n²)) into a single O(n) amortized pass, because no element is ever examined more than a constant number of times across the whole run.

Unlike binary search or DFS, this isn't a technique from a numbered textbook chapter — the name crystallized in competitive-programming and interview culture to describe a recurring shape. The O(n) guarantee behind it, though, is exactly [Amortized Analysis](amortized-analysis)'s aggregate method, transplanted from a growable array onto a pair of array indices.

## Use Cases

- **Longest Substring Without Repeating Characters** — variable-size window, contract when a duplicate enters.
- **Minimum Window Substring** — variable-size window searching for the *smallest* valid range instead of the largest.
- **Maximum Sum Subarray of Size K** — fixed-size window, the simplest case.
- **Longest Substring with At Most K Distinct Characters** — variable-size window with a frequency-map validity check.

## Deep Dive

### Fixed-size window: one in, one out

The simplest case never resizes the window, only slides it. Maintain a running sum (or count, or whatever the metric is) incrementally: adding the new right-hand element and removing the element that just fell off the left is O(1) per slide, versus O(k) to resum a fresh k-element window every step.

```java
public static int maxSumFixedWindow(int[] a, int k) {
    int windowSum = 0;
    for (int i = 0; i < k; i++) windowSum += a[i];
    int best = windowSum;
    for (int i = k; i < a.length; i++) {
        windowSum += a[i] - a[i - k];   // one in, one out — never resummed
        best = Math.max(best, windowSum);
    }
    return best;
}
```

### Variable-size window: expand, then contract

The general shape has a `right` pointer that only ever grows the window, and a `left` pointer that only ever shrinks it, with a validity check between them:

1. Advance `right`, absorbing one more element into the window's running state.
2. While the window is invalid (or, for a minimization problem, while it's still valid and can be shrunk further), advance `left`, removing its element's contribution and dropping it from the window.
3. Record the answer once the window is in the state the problem asks for.

```java
public static int lengthOfLongestSubstring(String s) {
    int[] lastSeen = new int[128];
    Arrays.fill(lastSeen, -1);
    int left = 0, best = 0;
    for (int right = 0; right < s.length(); right++) {
        char c = s.charAt(right);
        if (lastSeen[c] >= left) left = lastSeen[c] + 1;   // contract past the duplicate
        lastSeen[c] = right;
        best = Math.max(best, right - left + 1);
    }
    return best;
}
```

### Watch it happen: longest substring without repeating characters, on "abcabcbb"

| right | char | left before | duplicate? | left after | window length |
|---|---|---|---|---|---|
| 0 | a | 0 | no | 0 | 1 |
| 1 | b | 0 | no | 0 | 2 |
| 2 | c | 0 | no | 0 | 3 |
| 3 | a | 0 | yes (a at 0) | 1 | 3 |
| 4 | b | 1 | yes (b at 1) | 2 | 3 |
| 5 | c | 2 | yes (c at 2) | 3 | 3 |
| 6 | b | 3 | yes (b at 4) | 5 | 2 |
| 7 | b | 5 | yes (b at 6) | 7 | 1 |

`left` only ever moves forward — across all eight steps it advances a total of 7 positions, never more than the string length, which is exactly why this is O(n) rather than O(n) *per step*.

### Why this is O(n): the same argument as a growable ArrayList

`left` never moves backward, so across the entire scan it can advance at most n times total, no matter how the advances are distributed across iterations — some steps move it zero times, one step near the end could move it many times, but the *sum* is capped at n. That is precisely the aggregate-method argument [Amortized Analysis](amortized-analysis) uses to show `ArrayList.add` is O(1) amortized despite occasional expensive resizes: charge the cost to the total budget, not to the single worst step.

The most common bug is defeating this guarantee by accident: recomputing the window's sum, character-frequency map, or validity check from scratch inside the loop turns an incremental O(1) update back into an O(k) one, silently degrading the whole algorithm back to O(n·k).

## Trade-offs

- **Only correct when validity is monotonic in the window's contents** — shrinking from the left must never need to reconsider an element already dropped. If a problem's "valid" condition doesn't have that property, sliding window silently produces a wrong answer rather than an error; a different formulation (or explicit re-scanning) is needed instead.
- **Handles contiguous ranges only** — a *subsequence* constraint (elements don't need to be adjacent) is a fundamentally different problem; see [Longest Common Subsequence](longest-common-subsequence) for the DP tool that one calls for.
- **Requires an O(1)-reversible running state** — a sum or a frequency count can be un-added in O(1) when the window shrinks; a metric that can't be cheaply undone (e.g., a running median) loses the O(n) guarantee and needs a different auxiliary structure.

## Documentation Links

- Cormen, Leiserson, Rivest, Stein — Introduction to Algorithms, 4th Edition, Chapter 16 "Amortized Analysis," Section 16.1 (the aggregate method this technique's O(n) bound relies on) — book
- Jon Bentley, *Programming Pearls*, 2nd Edition (Addison-Wesley, 2000) — Column 8, "Algorithm Design Techniques" — the maximum-subarray problem's evolution from a cubic brute force to a single linear scan, the direct intellectual ancestor of the sliding-window shape — book
