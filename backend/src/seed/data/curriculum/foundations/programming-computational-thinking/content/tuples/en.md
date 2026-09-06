---
version: 1.0
updatedAt: 2026-09-06
---
## Objective

A tuple is an ordered, fixed-size sequence, written with parentheses: `(1, 2, 3)`. It behaves like a list in almost every way that doesn't involve changing its contents — you can index into it, iterate over it, and check its length — but it is immutable: once created, its elements can't be reassigned, and nothing can be added or removed. Python's built-in types reference documents tuples alongside lists precisely because they share the sequence protocol; the difference is entirely about mutability.

## Use Cases

- Returning more than one value from a function, when those values naturally belong together (e.g. a coordinate pair, a min and a max).
- Representing a fixed-shape record (a date as `(year, month, day)`) where the number and meaning of positions is fixed by convention.
- Using a value as a dictionary key or a set member, which requires immutability — a list can't be used this way, but a tuple can.
- Unpacking multiple values in a single assignment for cleaner code than repeated indexing.

## Deep Dive

### Creating and unpacking a tuple

```python
point = (3, 4)
point[0]        # 3
len(point)       # 2

point[0] = 5    # TypeError: 'tuple' object does not support item assignment
```

Attempting to mutate a tuple raises an error immediately, rather than allowing a silent change — the same safety a `str`'s immutability provides, extended to a sequence of arbitrary values. Unpacking lets you assign each element of a tuple to its own name in one line:

```python
x, y = point            # x = 3, y = 4

def min_and_max(values):
    return min(values), max(values)   # returns a tuple: (min, max)

lo, hi = min_and_max([4, 1, 9, 2])    # lo = 1, hi = 9
```

`return min(values), max(values)` is returning a tuple — the commas, not the parentheses, are what create it; `(1, 2)` and `1, 2` are the same tuple. Unpacking on the receiving end (`lo, hi = ...`) reads far more clearly than indexing a returned tuple by position (`result[0]`, `result[1]`).

### Tuples as dictionary keys

```python
distances = {}
distances[(0, 0), (3, 4)] = 5.0   # a tuple of tuples used as a single key
```

A list could never be used this way — dictionary keys must be immutable (specifically, hashable), and a list's mutability disqualifies it. A tuple's immutability is exactly what makes this legal.

## Trade-offs

- **A tuple's fixed size and immutability make it a poor fit for data that needs to grow or be edited** — reaching for a tuple to hold a collection that will later need `.append()` just means switching to a list once that requirement shows up; picking the wrong one up front costs a rewrite later.
- **A tuple used as a fixed-position record (like `(year, month, day)`) has no field names**, unlike a dictionary — reading `point[1]` months after writing it requires remembering what position 1 means, which hurts readability compared to a named alternative.
- **Because tuples are immutable, they can be used as dictionary keys and set members while lists cannot** — this is a real advantage, not a trade-off with a downside, but it only becomes useful once dictionaries and sets are in the picture.

## Documentation Links

- [Python Library Reference — Built-in Types](https://docs.python.org/3/library/stdtypes.html) — doc
- [Python Tutorial — Data Structures](https://docs.python.org/3/tutorial/datastructures.html) — doc
