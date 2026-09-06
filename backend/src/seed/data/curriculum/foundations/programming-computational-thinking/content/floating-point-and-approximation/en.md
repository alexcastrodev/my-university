---
version: 1.0
updatedAt: 2026-09-06
---
## Objective

A `float` in Python (and in almost every mainstream language) is stored as a fixed number of binary digits — a finite approximation of a real number, not the real number itself. Most decimal fractions, including ones as simple as `0.1`, have no exact finite representation in binary, the same way `1/3` has no exact finite representation in decimal. This one fact explains a whole category of surprising behavior: floats that "should" be equal compare as unequal, and small rounding errors accumulate over repeated arithmetic.

## Use Cases

- Representing measured or continuous quantities (temperature, distance, price with cents) where some imprecision is acceptable.
- Recognizing when a calculation needs `float` at all versus when `int` division or exact fractions would avoid the issue entirely.
- Deciding how to compare two computed floating-point values for "close enough" rather than for exact equality.
- Anticipating that a long-running accumulation (a loop that adds a small float many times) can drift from the mathematically exact answer.

## Deep Dive

### Why 0.1 + 0.2 != 0.3

```python
0.1 + 0.2            # 0.30000000000000004
0.1 + 0.2 == 0.3      # False
```

This isn't a Python bug — it's a direct consequence of binary floating-point representation. `0.1` in binary is a repeating fraction, just like `1/3` is a repeating decimal (`0.333...`); stored in a fixed number of bits, it has to be rounded to the nearest representable value. The tiny rounding error introduced by that approximation is why the sum doesn't land exactly on `0.3`.

Comparing floats for exact equality is therefore unreliable in general. The standard fix is to check that two values are within a small tolerance of each other instead:

```python
abs((0.1 + 0.2) - 0.3) < 1e-9   # True — "close enough" comparison
```

### Accumulated error over a loop

The same rounding error compounds when a float is added to itself repeatedly:

```python
total = 0.0
for _ in range(10):
    total += 0.1
print(total)          # 0.9999999999999999, not exactly 1.0
print(total == 1.0)   # False
```

Each individual addition introduces a tiny rounding error, and those errors don't cancel out — they accumulate. This matters directly for the next concept, bisection search: a search loop that stops on `guess == target` may never terminate if `target` was ever produced by floating-point arithmetic instead of an exact value; stopping when the guess is within a small tolerance of the target is the reliable alternative.

## Trade-offs

- **Exact equality (`==`) between two floats is almost never the right check** — use a tolerance comparison instead, or accept that two mathematically equal expressions may compare unequal after floating-point arithmetic.
- **Switching to `int` avoids the whole problem when the quantity is genuinely discrete** — money is a common case where storing cents as an `int` sidesteps floating-point rounding entirely, at the cost of extra conversion code when displaying a value as dollars and cents.
- **The rounding error from any single operation is tiny, but a loop that repeats an operation many times can accumulate a error large enough to matter** — this is a judgment call about how many iterations and how much precision a given calculation actually needs, not something with one universal threshold.

## Documentation Links

- [Python Library Reference — Built-in Types](https://docs.python.org/3/library/stdtypes.html) — doc
- [MIT 6.100L — Materials by Lecture](https://ocw.mit.edu/courses/6-100l-introduction-to-cs-and-programming-using-python-fall-2022/pages/material-by-lecture/) — doc
