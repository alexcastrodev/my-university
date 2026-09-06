---
version: 1.0
updatedAt: 2026-09-06
---
## Objective

In Python, a function is a value like any other — it can be assigned to a variable, stored in a list, passed as an argument to another function, or returned from one. Python's data model treats functions as ordinary objects: `def` creates a function object and binds it to a name, exactly the same way `x = 5` binds a name to an integer object. Being able to pass a function *itself* around — not just call it — is what makes patterns like "apply this operation to every element" or "sort using this comparison rule" possible without writing a separate loop for every case.

## Use Cases

- Passing a function as an argument to another function that decides when and how to call it — the built-in `sorted(items, key=...)` is the most common example.
- Storing a small set of related operations (e.g. `{"add": add, "sub": subtract}`) and picking one to call at run time based on user input.
- Writing a short, throwaway function inline with `lambda` instead of a full `def`, when a name would only be used once, right where it's defined.
- Returning a function from another function to produce a specialized version of it (a simple form of parameterizing behavior).

## Deep Dive

### Functions as values

```python
def square(x):
    return x * x

operation = square       # no parentheses: this assigns the FUNCTION, not its result
print(operation(5))      # 25 — calling through the new name works identically

funcs = [square, abs, len]
for f in funcs:
    print(f(-4))          # 16, 4, 1 — each name refers to a callable object
```

Leaving off the parentheses is the key distinction: `square` refers to the function object itself, while `square()` calls it and refers to whatever it returns. This is exactly what makes passing a function as an argument possible:

```python
def apply_twice(f, x):
    return f(f(x))

apply_twice(square, 3)   # square(square(3)) = square(9) = 81
```

### lambda: a function written as an expression

For a small function used once, right where it's needed, `lambda` writes it inline without a `def` and a name:

```python
sorted([3, -2, 5, -1], key=lambda x: abs(x))   # [-1, -2, 3, 5], sorted by absolute value
```

`lambda x: abs(x)` is a function taking one parameter, `x`, and returning `abs(x)` — equivalent to a full `def abs_key(x): return abs(x)`, just without a name of its own. A `lambda` can only contain a single expression (no statements, no multiple lines), which is precisely why it's suited only to small, throwaway logic.

## Trade-offs

- **`square` and `square()` look almost identical but mean very different things** — passing `square()` where a callable was expected passes the function's *return value* instead of the function, and the bug often only surfaces as a confusing `TypeError` when that value is later called as if it were a function.
- **`lambda` is limited to a single expression, which keeps it readable for small cases but makes it the wrong tool once logic needs more than one line** — reaching for a nested `lambda` to force multi-step logic into one expression usually hurts readability rather than helping it; a regular named function is clearer past a certain point.
- **Passing functions around is powerful but can make a program's control flow harder to trace by just reading top to bottom** — knowing *which* function will actually run at a given call site sometimes requires tracing back through where a variable holding a function was last assigned.

## Documentation Links

- [Python Data Model](https://docs.python.org/3/reference/datamodel.html) — doc
- [Python Tutorial — More Control Flow Tools](https://docs.python.org/3/tutorial/controlflow.html) — doc
