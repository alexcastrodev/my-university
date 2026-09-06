---
version: 1.0
updatedAt: 2026-09-06
---
## Objective

Big-O notation describes how an algorithm's running time grows as its input size grows, in the worst case, ignoring machine-specific constants — it answers "if I double the input, roughly how much longer does this take?" rather than "how many seconds did it take on this laptop." This abstracts away exactly the machine-dependence that made wall-clock timing unreliable for comparison, letting two algorithms be compared purely by their growth rate.

## Use Cases

- Predicting whether an algorithm that works fine on a small test input will still be usable on a much larger real-world input.
- Comparing two different algorithms for the same problem by their growth rate rather than by a single benchmark run.
- Recognizing common growth rates by sight — a single loop over the input is typically O(n); a loop nested inside another loop, each over the input, is typically O(n²).
- Explaining *why* an algorithm is too slow for a given input size, in terms independent of any specific machine.

## Deep Dive

### Reading growth rate off the code

```python
def contains(items, target):        # O(n)
    for item in items:               # runs at most n times
        if item == target:
            return True
    return False

def has_duplicate(items):            # O(n^2)
    for i in range(len(items)):
        for j in range(len(items)):
            if i != j and items[i] == items[j]:   # inner loop runs n times, for each of n outer iterations
                return True
    return False
```

`contains` does at most `n` comparisons for a list of `n` items — doubling the list roughly doubles the worst-case work, which is what "O(n)," linear time, means. `has_duplicate` runs the inner loop fully for every iteration of the outer loop — roughly `n * n` comparisons — so doubling the list roughly *quadruples* the worst-case work, which is what "O(n²)," quadratic time, means. Big-O describes this worst case and drops constant factors and lower-order terms: an algorithm that does `3n + 7` operations is still O(n), because what matters for growth is the `n`, not the `3` or the `7`.

### Why the constant factor doesn't matter, but the shape does

```python
def slow_but_linear(items):     # does 100 * n operations — still O(n)
    total = 0
    for item in items:
        for _ in range(100):
            total += 1
    return total
```

`slow_but_linear` does 100 times more work than `contains` for the same input, and will be measurably slower in wall-clock time — but both are O(n): doubling the input still roughly doubles the work for *either* one. Big-O is deliberately blind to that constant factor, because it's describing how the algorithm *scales*, not how fast any one run is; for a large enough input, an O(n) algorithm always eventually outpaces an O(n²) one, no matter how large the O(n) algorithm's hidden constant is.

## Trade-offs

- **Big-O describes the worst case, which can be pessimistic for typical, well-behaved input** — an algorithm that's O(n²) in the worst case might run close to O(n) on inputs that are already mostly sorted or otherwise favorable; Big-O alone doesn't capture that nuance.
- **Dropping constant factors is deliberate, but it means Big-O alone can't tell you which of two same-order algorithms is faster in practice** — an O(n) algorithm with a large hidden constant can be slower than an O(n log n) algorithm on every input size that actually occurs in practice, even though the O(n log n) one is "worse" asymptotically.
- **The comparisons contains and has_duplicate make are simple to eyeball, but nested loops don't always mean O(n²)** — if the inner loop's range depends on the outer loop's current position rather than running the full `n` every time, the total work can come out closer to O(n²)/2 or even O(n log n); reading growth rate off code correctly takes practice, not just counting `for` keywords.

## Documentation Links

- [MIT 6.100L — Materials by Lecture](https://ocw.mit.edu/courses/6-100l-introduction-to-cs-and-programming-using-python-fall-2022/pages/material-by-lecture/) — doc
- [ACM/IEEE CS2013 — Software Development Fundamentals KA](https://csed.acm.org/wp-content/uploads/2023/09/SDF-Version-Gamma.pdf) — doc
