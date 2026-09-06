---
version: 1.0
updatedAt: 2026-09-06
---
## Objective

A recursive function solves a problem by calling itself on a smaller version of the same problem, until it reaches a **base case** simple enough to answer directly without recursing any further. Every recursive function needs both pieces: at least one base case that stops the recursion, and a recursive case that makes real progress toward that base case on every call — miss either one and the function either answers only the trivial case or never stops calling itself at all.

## Use Cases

- Computing a value defined in terms of a smaller instance of itself, like a factorial or a Fibonacci number.
- Any problem more naturally described as "solve it in terms of a smaller version of the same problem" than as an explicit loop.
- Traversing a structure whose size isn't known in advance, where the natural stopping point is "there's nothing left."
- Understanding how a language's call stack works, since each recursive call adds a new frame that must be resolved before the calls before it can complete.

## Deep Dive

### Base case and recursive case

```python
def factorial(n):
    if n == 0:               # base case — stops the recursion
        return 1
    return n * factorial(n - 1)   # recursive case — smaller problem, same shape

factorial(4)   # 4 * factorial(3) = 4 * 3 * factorial(2) = ... = 4 * 3 * 2 * 1 * 1 = 24
```

`factorial(0)` is answered directly, with no further recursive call — this is what stops the chain. Every other call reduces `n` by 1 and defers to `factorial(n - 1)`, which is a strictly smaller problem, guaranteeing the base case is eventually reached. Tracing the calls out makes the mechanism concrete: `factorial(4)` doesn't compute anything itself until `factorial(3)` returns, which doesn't compute anything until `factorial(2)` returns, and so on down to `factorial(0)` — then the multiplications unwind back up, in reverse order, to produce `24`.

### Why the base case must actually be reached

```python
def bad_factorial(n):
    return n * bad_factorial(n - 1)   # no base case at all

bad_factorial(4)   # RecursionError: maximum recursion depth exceeded
```

Without a base case, every call makes another call, with no way to stop — Python eventually raises `RecursionError` once the call stack (which has a finite, language-enforced limit) is exhausted. The same failure happens if the recursive case doesn't actually shrink the problem — for example, calling `factorial(n)` again instead of `factorial(n - 1)` — even though a base case exists, because that base case is never reached.

## Trade-offs

- **A missing or unreachable base case causes unbounded recursion, which Python stops with `RecursionError` rather than letting the program hang forever** — this is safer than an infinite loop in that sense, but the error message alone rarely points at *which* function is the culprit in a large program.
- **Recursion often reads more directly as "the problem, restated smaller" than the equivalent loop would, which is a real readability win for problems that are naturally self-referential** — but for problems that are just as naturally iterative (summing a list, say), forcing a recursive solution adds call-stack overhead and complexity for no real benefit.
- **Each recursive call adds a frame to the call stack, using memory proportional to the recursion depth** — a recursive function correct in its logic can still fail in practice on very large inputs, purely from exhausting the stack, in a way an equivalent loop would not.

## Documentation Links

- [Python Data Model](https://docs.python.org/3/reference/datamodel.html) — doc
- [MIT 6.100L — Materials by Lecture](https://ocw.mit.edu/courses/6-100l-introduction-to-cs-and-programming-using-python-fall-2022/pages/material-by-lecture/) — doc
