---
version: 1.0
updatedAt: 2026-09-06
---
## Objective

Recursion doesn't only apply to shrinking numbers like `n - 1` — it applies just as naturally to a value's *shape*: a string is a first character followed by the rest of the string, and a nested list is a first element followed by the rest of the list. Recursing on structure means the base case is "nothing left to process" (an empty string, an empty list) rather than "the number reached zero," and the recursive case peels off one piece of the structure and recurses on what remains.

## Use Cases

- Processing a string one character at a time when a loop would work just as well, but the recursive formulation matches how the problem is naturally described (e.g. checking if a string is a palindrome).
- Walking a list that may contain other lists nested inside it, to any depth, without knowing that depth in advance.
- Any problem where "the answer for this structure" is naturally defined in terms of "the answer for a smaller piece of the same structure."
- Building intuition for tree and graph traversal later in the curriculum, which are structural recursion problems at heart.

## Deep Dive

### Recursing on a string

```python
def is_palindrome(s):
    if len(s) <= 1:                  # base case — 0 or 1 characters is always a palindrome
        return True
    if s[0] != s[-1]:                # first and last characters must match
        return False
    return is_palindrome(s[1:-1])    # recursive case — check the smaller, inner string

is_palindrome("racecar")   # True
is_palindrome("hello")      # False
```

The base case here isn't a number reaching zero — it's the string shrinking to length 0 or 1, at which point there's nothing left to compare. Each recursive call strips off both ends and checks a strictly shorter string, guaranteeing the base case is eventually reached, exactly like `n - 1` guarantees `factorial` reaches 0.

### Recursing on a nested list

```python
def flatten(nested):
    if not nested:                      # base case — empty list, nothing to flatten
        return []
    first, rest = nested[0], nested[1:]
    if isinstance(first, list):
        return flatten(first) + flatten(rest)   # first is itself a list — recurse into it
    return [first] + flatten(rest)               # first is a plain value — keep it, recurse on rest

flatten([1, [2, 3], [4, [5, 6]], 7])   # [1, 2, 3, 4, 5, 6, 7]
```

This handles nesting to *any* depth without knowing that depth ahead of time, because the recursion itself discovers it: whenever `first` turns out to be a list, `flatten` calls itself on that nested list before moving on, and however deep that nesting goes, each call is on a structurally smaller piece.

## Trade-offs

- **String slicing (`s[1:-1]`) creates a new string on every recursive call**, which costs time and memory proportional to the string's length at each level — for a very long string, an iterative approach (or recursing on an index into the original string, rather than slicing) avoids that repeated copying.
- **Structural recursion on a deeply nested list can hit the same recursion-depth limit covered in the previous concept** — a list nested a few thousand levels deep would raise `RecursionError`, a failure mode a loop-based traversal (using an explicit stack) wouldn't hit.
- **Recognizing that a problem is "recurse on the shape" rather than "recurse on a shrinking number" is itself a skill** — a beginner used to numeric recursion (`n - 1`) can get stuck trying to force a shape-based problem into that mold instead of recognizing "the rest of the sequence" as the smaller subproblem.

## Documentation Links

- [Python Tutorial — Data Structures](https://docs.python.org/3/tutorial/datastructures.html) — doc
- [MIT 6.100L — Materials by Lecture](https://ocw.mit.edu/courses/6-100l-introduction-to-cs-and-programming-using-python-fall-2022/pages/material-by-lecture/) — doc
