---
version: 1.0
updatedAt: 2026-09-06
---
## Objective

Conditional control flow lets a program take different paths depending on whether a condition is true or false, using `if`, `elif`, and `else`. Every condition is an expression that evaluates to a `bool`, and Python runs exactly one branch of an `if`/`elif`/`else` chain — the first one whose condition is `True` — skipping the rest entirely. This is the first place a program stops running top-to-bottom in a straight line and starts making decisions.

## Use Cases

- Applying a discount only if an order total is above a threshold.
- Handling a small number of distinct cases (a grade letter from a numeric score) without repeating logic.
- Validating input before using it, taking one path for valid data and another for invalid data.
- Choosing between two or more mutually exclusive actions based on a computed condition.

## Deep Dive

### if / elif / else

```python
score = 82

if score >= 90:
    grade = "A"
elif score >= 80:
    grade = "B"
elif score >= 70:
    grade = "C"
else:
    grade = "F"

print(grade)   # "B"
```

Python evaluates the conditions top to bottom and stops at the first one that's `True` — here, `score >= 90` is `False`, but `score >= 80` is `True`, so `grade` is set to `"B"` and the remaining `elif`/`else` branches are never even evaluated. `else` is optional and catches whatever no earlier branch matched; leaving it out means that if none of the conditions is `True`, nothing in the chain runs at all.

Conditions can combine multiple boolean expressions with `and`, `or`, and `not`:

```python
age = 20
has_ticket = True

if age >= 18 and has_ticket:
    print("Allowed in")
```

Indentation is not a style choice in Python — it's how the language delimits which statements belong to which branch. A misaligned line either raises an `IndentationError` or, worse, silently attaches to the wrong branch.

## Trade-offs

- **A long `if`/`elif` chain checking many conditions runs each one in sequence, top to bottom** — ordering matters for both correctness and readability: putting a narrower condition after a broader one that already covers it means the narrower branch is never reached.

  ```python
  if score >= 70:
      grade = "C"
  elif score >= 80:     # unreachable: any score >= 80 already satisfied the first branch
      grade = "B"
  ```
- **Omitting `else` when every case should be handled leaves a silent gap** — if none of the `elif` conditions match and there's no `else`, the variable the branches were supposed to set may never get set, and the bug only appears later when that variable is used.
- **Deeply nested `if` inside `if` inside `if` becomes hard to read** — flattening nested conditions into a single `elif` chain, or extracting a helper function, is usually clearer than three levels of indentation, though this is a judgment call about readability rather than a correctness issue.

## Documentation Links

- [Python Tutorial — More Control Flow Tools](https://docs.python.org/3/tutorial/controlflow.html) — doc
- [CS50x 2025 — Weeks](https://cs50.harvard.edu/x/2025/weeks/) — doc
