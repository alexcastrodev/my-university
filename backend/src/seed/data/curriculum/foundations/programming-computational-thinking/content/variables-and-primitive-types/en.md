---
version: 1.0
updatedAt: 2026-09-06
---
## Objective

A variable is a name bound to a value stored somewhere in memory, so a program can refer to that value by name instead of retyping it. Every value has a type, which determines what operations make sense on it and how it's stored; Python's core primitive types are `int` (whole numbers), `float` (numbers with a fractional part), `bool` (`True`/`False`), and `str` (text). Unlike some languages, Python doesn't require you to declare a variable's type up front — a name is bound to whatever value it's assigned, and the type lives with the value, not with the name.

## Use Cases

- Giving a meaningful name to a value used more than once, so a change only has to happen in one place.
- Storing user input, a computed result, or a running total for later use in the same program.
- Choosing `int` versus `float` deliberately — a loop counter should be an `int`; a measured temperature should be a `float`.
- Using `bool` to name the result of a comparison so later code reads as a decision, not a re-evaluated condition.

## Deep Dive

### Naming and binding

```python
age = 30            # int
price = 19.99        # float
is_student = False   # bool
name = "Ada"         # str
```

Each line *binds* a name to a value: `age` now refers to the integer `30`. Python figures out the type from the value on the right-hand side — this is why it's called *dynamically typed*: the type is checked as the program runs, not before. You can check a value's type directly:

```python
type(age)         # <class 'int'>
type(price)       # <class 'float'>
```

Rebinding a name to a value of a different type is legal — `age = "thirty"` would make `age` refer to a `str` instead — but doing so on purpose, rather than by accident, is what separates a program that stays understandable from one that becomes confusing to trace.

### The four primitive types

```python
count = 7            # int — whole numbers, arbitrary precision in Python
average = 7 / 2       # float — 3.5, has a fractional part
passed = average > 5  # bool — True or False, the result of a comparison
label = "quiz 3"      # str — a sequence of characters
```

`int` and `float` are both numeric, but they behave differently even in simple arithmetic: `7 / 2` is `3.5` (a `float`), while `7 // 2` is `3` (integer division, still an `int`). Mixing an `int` and a `float` in an expression always produces a `float` — Python promotes the less precise type up to the more precise one automatically.

## Trade-offs

- **No type declaration means a typo silently creates a new variable instead of raising an error** — assigning to `agee` instead of `age` doesn't fail; it just creates a second, unrelated variable, and the bug only shows up later when `age` is read and turns out to be missing or stale.
- **Dynamic typing catches type errors at run time, not before the program runs** — a function expecting a number will raise `TypeError` only when it actually receives a string, not when the line is written:

  ```python
  "5" + 3   # TypeError: can only concatenate str (not "int") to str
  ```
- **Choosing `float` for a value that should always be a whole count invites the approximation issues covered in floating-point arithmetic** — a loop counter, an index, or a quantity of discrete items should be `int`, not `float`, even when the difference seems cosmetic at first.

## Documentation Links

- [Python Tutorial — An Informal Introduction to Python](https://docs.python.org/3/tutorial/introduction.html) — doc
- [MIT 6.100L — Syllabus](https://ocw.mit.edu/courses/6-100l-introduction-to-cs-and-programming-using-python-fall-2022/pages/syllabus/) — doc
