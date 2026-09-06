---
version: 1.0
updatedAt: 2026-09-06
---
## Objective

Not every equation has a closed-form solution you can just compute directly — finding a square root or the root of an arbitrary equation often has no simple formula at all. MIT's 6.100L introduces successive approximation as the answer: start with a guess, check how close it is, and improve it, repeating until the guess is close enough. The crudest version, exhaustive guess-and-check, tries every candidate in order; bisection search improves on it by using the fact that the search space is ordered, cutting it in half on every step instead of moving through it one step at a time.

## Use Cases

- Finding an approximate square root or other root without a built-in function for it.
- Searching a large ordered range for a value satisfying some condition, when checking a candidate is cheap but trying every one would be too slow.
- Any "make a guess, check it, adjust" workflow where the direction of the error tells you which way to move the next guess.
- Building intuition for binary search over sorted data, which reappears constantly once real data structures are introduced.

## Deep Dive

### Exhaustive guess-and-check

To find an integer square root of `x` by brute force, try every candidate starting from 0 until one squares to at least `x`:

```python
x = 25
guess = 0
while guess * guess < x:
    guess += 1

if guess * guess == x:
    print(guess, "is the square root of", x)
else:
    print(x, "has no exact integer square root")
```

This works, but it's slow for large `x`: finding the square root of 1,000,000 takes on the order of 1,000 guesses, one at a time.

### Bisection search

Bisection search exploits the fact that the candidates are ordered: instead of trying `0, 1, 2, 3, ...`, keep a `low` and `high` bound and always try the midpoint, narrowing the range by half each time.

```python
x = 25
epsilon = 0.01
low = 0.0
high = max(1.0, x)
guess = (low + high) / 2

while abs(guess ** 2 - x) >= epsilon:
    if guess ** 2 < x:
        low = guess          # answer is in the upper half
    else:
        high = guess          # answer is in the lower half
    guess = (low + high) / 2

print(guess)   # approximately 5.0
```

Notice `epsilon`, not `==`, ends the loop — as covered in floating-point-and-approximation, `guess ** 2` will almost never land on `x` exactly, so the loop has to stop when the guess is *close enough* instead of waiting for exact equality. Each iteration halves the remaining search space, so bisection search finds an answer in roughly 20 steps for a range where exhaustive guess-and-check would need a million — the same kind of reduction that Big-O later gives a name to.

## Trade-offs

- **Bisection search requires the search space to be ordered and the "too high / too low" direction to be knowable from a single check** — it doesn't apply to a problem where checking a candidate doesn't tell you which direction to move next.
- **Exhaustive guess-and-check is simpler to write and reason about, and is fine when the search space is small** — reaching for bisection search on a range of 10 candidates adds complexity for no real benefit; the trade-off only pays off once the range is large.
- **Choosing `epsilon` too small can make the loop run far longer than needed (or never converge, given floating-point rounding), while choosing it too large gives an answer that's technically wrong for the caller's needs** — picking a workable tolerance is itself a design decision, not a fixed constant to copy everywhere.

## Documentation Links

- [MIT 6.100L — Materials by Lecture](https://ocw.mit.edu/courses/6-100l-introduction-to-cs-and-programming-using-python-fall-2022/pages/material-by-lecture/) — doc
- [MIT 6.100L — Syllabus](https://ocw.mit.edu/courses/6-100l-introduction-to-cs-and-programming-using-python-fall-2022/pages/syllabus/) — doc
