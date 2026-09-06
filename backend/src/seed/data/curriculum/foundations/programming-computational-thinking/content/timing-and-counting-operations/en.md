---
version: 1.0
updatedAt: 2026-09-06
---
## Objective

Before reasoning about an algorithm abstractly, it helps to measure it concretely: how does a program's actual running time change as its input grows? There are two complementary ways to do this — timing it directly with a clock, and counting the number of basic operations it performs — and comparing the two is what motivates the machine-independent notation (Big-O) introduced next. MIT's 6.100L uses exactly this progression: measure first, then abstract.

## Use Cases

- Confirming a suspicion that a piece of code is slow before spending time optimizing it.
- Comparing two different implementations of the same function to see which one actually runs faster on realistic input sizes.
- Predicting how a program's running time will change if the input is doubled, before it becomes a problem in production.
- Building the intuition that "how many times does this loop run relative to the input size" is a more portable measure than "how many seconds did it take on my machine."

## Deep Dive

### Timing a function directly

```python
import time

def sum_to_n(n):
    total = 0
    for i in range(n):
        total += i
    return total

start = time.time()
sum_to_n(10_000_000)
end = time.time()
print(end - start, "seconds")
```

Wall-clock timing is easy to do and directly meaningful, but it's tied to the specific machine, its current load, and even Python's own interpreter overhead — running the same code on a faster machine, or with other programs competing for the CPU, gives a different number for the exact same algorithm. It answers "how long did this take, here, today" — not "how does this scale."

### Counting operations independent of the machine

A more portable measure counts how many times a specific operation (say, the loop body) executes, independent of any particular machine's speed:

```python
def sum_to_n_counted(n):
    total = 0
    steps = 0
    for i in range(n):
        total += i
        steps += 1
    return total, steps

_, steps = sum_to_n_counted(10)
print(steps)   # 10 — the loop body ran exactly n times
```

Doubling `n` from 10 to 20 doubles `steps` from 10 to 20 — the operation count grows *linearly* with the input, a relationship that holds regardless of which machine runs the code. This operation count, not the wall-clock time, is what the next concept's Big-O notation is actually describing.

## Trade-offs

- **Wall-clock timing is affected by everything else happening on the machine at the time**, so a single measurement can be noisy — running a timing experiment several times and comparing typical results is more reliable than trusting one run.
- **Counting operations requires deciding which operation to count**, and a careless choice can miss the actual bottleneck — counting loop iterations misses the cost of an expensive operation buried inside the loop body, like a hidden nested search.
- **Neither timing nor counting alone tells you how an algorithm behaves on inputs far larger than anything you tested** — both are empirical measurements on specific sizes; Big-O is what lets you reason about growth *beyond* what was actually measured.

## Documentation Links

- [MIT 6.100L — Materials by Lecture](https://ocw.mit.edu/courses/6-100l-introduction-to-cs-and-programming-using-python-fall-2022/pages/material-by-lecture/) — doc
- [MIT 6.100L — Syllabus](https://ocw.mit.edu/courses/6-100l-introduction-to-cs-and-programming-using-python-fall-2022/pages/syllabus/) — doc
