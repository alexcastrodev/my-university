---
version: 1.0
updatedAt: 2026-09-06
---
## Objective

A function packages a block of logic behind a name, so that calling it hides *how* the work happens and exposes only *what* it does. This is the concrete mechanism behind computational thinking's abstraction pillar: once `square(x)` exists, any code that needs a square just calls it, without needing to know or care that it's implemented as `x * x`. ACM/IEEE CS2013's Software Development Fundamentals knowledge area places exactly this — decomposing a problem into procedures — at the center of an introductory course, because it's the first tool that lets a program grow past a few dozen lines without becoming unreadable.

## Use Cases

- Naming a piece of logic used more than once, so it's written and fixed in exactly one place.
- Splitting a large problem into smaller named pieces that can each be understood, tested, and debugged on their own.
- Hiding an implementation detail from the rest of the program — the caller doesn't need to know *how* a function computes its result, only what it computes.
- Giving a self-contained, well-named block of code a home, instead of it living inline in the middle of unrelated logic.

## Deep Dive

### Defining and calling a function

```python
def square(x):
    return x * x

result = square(5)   # 25
```

`def` introduces a new function named `square`; the code between `def` and the end of the indented block only runs when `square` is *called*, not when it's defined. The caller (`result = square(5)`) doesn't need to know the body is `x * x` — it could be rewritten as a loop that adds `x` to itself `x` times, and every caller would keep working unchanged. That's abstraction in practice: the *interface* (a name plus what goes in and what comes out) is stable even when the *implementation* changes.

### Decomposing a bigger task into functions

Consider printing a simple report: a title, then a formatted line per item. Instead of one long block of code, split it by responsibility:

```python
def print_title(title):
    print("=" * len(title))
    print(title)
    print("=" * len(title))

def print_item(name, price):
    print(f"{name:<20}{price:>8.2f}")

def print_report(title, items):
    print_title(title)
    for name, price in items:
        print_item(name, price)

print_report("Groceries", [("Milk", 3.5), ("Bread", 2.25)])
```

`print_report` reads almost like the pseudocode plan for the task — decompose first, name each piece, then let the names do the explaining. Each function can be tested and understood on its own, independent of the others.

## Trade-offs

- **A function call has a small overhead compared to inlining the same code directly** — in practice this is negligible for almost every program at this level, and giving up readability to avoid it is very rarely worth it.
- **Splitting logic into too many tiny functions can make a program harder to follow, not easier** — jumping between five one-line functions to understand a single operation can cost more than it saves; how much to decompose is a judgment call, not a fixed rule.
- **A function hides its implementation, which is exactly the point — but that also means a caller can't tell whether it's efficient or safe just by reading the call site** — trusting a function's name and documentation instead of its internals is only sound once the function has been tested (covered later, in testing-and-debugging).

## Documentation Links

- [Wing, "Computational Thinking" — Communications of the ACM (2006)](https://dl.acm.org/doi/10.1145/1118178.1118215) — doc
- [ACM/IEEE CS2013 — Software Development Fundamentals KA](https://csed.acm.org/wp-content/uploads/2023/09/SDF-Version-Gamma.pdf) — doc
