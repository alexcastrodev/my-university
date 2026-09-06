---
version: 1.0
updatedAt: 2026-09-06
---
## Objective

An exception is Python's mechanism for signaling that something went wrong while a program was running — it can be raised deliberately with `raise` and caught with `try`/`except`, letting a caller handle a problem instead of the program simply crashing. An assertion (`assert`), by contrast, checks a condition that the programmer believes can *never* be false if the code is correct; it exists to catch a programmer's own logic errors during development, not to handle expected, recoverable conditions a caller might legitimately trigger. Mixing the two up — asserting on user input, or silently swallowing exceptions that should stop the program — is a common source of confusing bugs.

## Use Cases

- Catching an exception that a caller can reasonably trigger (bad user input, a missing file) and responding gracefully instead of crashing.
- Raising a specific exception with a clear message when a function receives an argument it can't work with.
- Asserting an internal invariant (a helper function's precondition, a value that should always be positive at this point) that would indicate a bug in the code itself if violated.
- Distinguishing, when reading unfamiliar code, whether a check is defending against bad *input* (exception) or bad *code* (assertion).

## Deep Dive

### Raising and catching exceptions

```python
def divide(a, b):
    if b == 0:
        raise ValueError("cannot divide by zero")
    return a / b

try:
    result = divide(10, 0)
except ValueError as e:
    print("Handled:", e)
    result = None
```

`raise` stops normal execution and starts searching outward for a matching `except` block; if none is found anywhere up the call chain, the program terminates with a traceback. `except ValueError as e` catches specifically a `ValueError` (and nothing else), binding the exception object to `e` so its message can be inspected. Catching a broader class than intended — a bare `except:` that catches everything — is a common mistake, because it also silently swallows real bugs (a typo causing `NameError`) that should have been allowed to crash and be noticed.

### Assertions for conditions that should never happen

```python
def average(numbers):
    assert len(numbers) > 0, "average() requires a non-empty list"
    return sum(numbers) / len(numbers)
```

`assert` checks its condition and raises `AssertionError` with the given message if it's `False`. The key difference from `raise ValueError(...)`: an assertion documents an assumption the *function's own logic* depends on — here, that the caller has already ensured the list isn't empty — rather than a condition the function is designed to handle gracefully. Assertions can be globally disabled with Python's `-O` optimization flag, which is exactly why they must never be used to validate untrusted input (like data from a user or a network request) — code that only works because an assertion caught a bad case would silently stop checking anything the moment assertions are turned off.

## Trade-offs

- **A bare `except:` (or `except Exception:`) catches far more than intended**, including bugs like a `NameError` from a typo, silently hiding them instead of surfacing them:

  ```python
  try:
      result = compute(dataa)   # typo: NameError
  except:
      result = 0                 # the typo is now invisible — "result" is just 0
  ```
- **Assertions can be stripped out entirely at run time (`python -O`)** — a program that relies on an assertion to validate something a caller could actually get wrong will silently stop checking it under that flag, which is why user-facing validation belongs in an explicit `if`/`raise`, not an `assert`.
- **Catching an exception too far from where it happened makes it harder to know what actually went wrong** — a `try` wrapped around a large block of unrelated code can catch an exception from any of several very different failure points, losing the specificity that makes an error message useful.

## Documentation Links

- [Python Tutorial — Errors and Exceptions](https://docs.python.org/3/tutorial/errors.html) — doc
- [Python Library Reference — Built-in Exceptions](https://docs.python.org/3/library/exceptions.html) — doc
