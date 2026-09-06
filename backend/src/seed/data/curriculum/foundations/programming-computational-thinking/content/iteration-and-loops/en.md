---
version: 1.0
updatedAt: 2026-09-06
---
## Objective

A loop repeats a block of code, either a fixed number of times (`for`) or until a condition becomes false (`while`). What makes a loop trustworthy rather than a lucky accident is its *invariant*: a statement about the program's state that is true before the loop starts, stays true after every iteration, and — combined with the loop's exit condition — implies the correct result once the loop ends. Thinking in terms of invariants is what separates "I ran it and it looked right" from actually knowing a repeated computation is correct.

## Use Cases

- Processing every element of a sequence exactly once, in order (`for`).
- Repeating an action until a condition is met, when the number of repetitions isn't known in advance (`while`).
- Accumulating a running result (a sum, a count, a maximum) across repeated steps.
- Building up a search or approximation loop where each pass gets closer to an answer.

## Deep Dive

### for and while

```python
total = 0
for n in [1, 2, 3, 4]:
    total += n
print(total)   # 10
```

A `for` loop iterates over a known sequence, running the body once per element — there's no need to track a counter manually. A `while` loop instead re-checks a condition before every iteration and stops as soon as it's `False`:

```python
n = 1
while n <= 4:
    print(n)
    n += 1   # without this line, the condition never changes and the loop never ends
```

Forgetting to update the variable a `while` condition depends on is the single most common way to write an infinite loop.

### Loop invariants

Consider summing the first `n` positive integers with a loop, instead of the closed-form formula:

```python
total = 0
i = 1
while i <= n:
    total += i
    i += 1
```

The invariant here is: *"at the start of each iteration, `total` equals the sum of all integers from 1 up to `i - 1`."* Check it: before the loop runs at all, `total` is 0 and `i` is 1 — the sum of integers from 1 to 0 is indeed 0 (an empty sum), so the invariant holds before the first pass. Each iteration adds `i` to `total` and then increments `i`, which preserves the same statement for the next round. When the loop exits, `i` is `n + 1`, so the invariant says `total` equals the sum from 1 to `n` — exactly the answer wanted. Stating the invariant explicitly is what lets you argue the loop is correct for *every* `n`, not just the one you happened to test.

## Trade-offs

- **`while` loops can run forever if the condition never becomes false** — this is the most common beginner bug in loops, and it silently hangs the program rather than crashing it, which makes it harder to notice than a raised exception.

  ```python
  n = 1
  while n <= 4:
      print(n)   # missing n += 1 — this never terminates
  ```
- **`for` loops over a known sequence are usually clearer and less error-prone than a `while` loop simulating the same thing** — reaching for `while` when a `for` would do adds a manual counter that's one more thing to get wrong.
- **A loop that "looks right" on the one example you tried can still be wrong on an edge case** (an empty sequence, `n = 0`, a single-element list) — stating the invariant is what lets you check those edge cases by reasoning instead of by running every possible input.

## Documentation Links

- [Python Tutorial — More Control Flow Tools](https://docs.python.org/3/tutorial/controlflow.html) — doc
- [MIT 6.100L — Materials by Lecture](https://ocw.mit.edu/courses/6-100l-introduction-to-cs-and-programming-using-python-fall-2022/pages/material-by-lecture/) — doc
