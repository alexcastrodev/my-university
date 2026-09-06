---
version: 1.0
updatedAt: 2026-09-06
---
## Objective

A list is an ordered, growable sequence of values, written with square brackets: `[1, 2, 3]`. Unlike a number or a string, a list is *mutable* — its contents can be changed in place after it's created, without creating a new list. This single property (mutable vs. immutable) is one of the most consequential distinctions in Python's type system, and it's the reason the next concept, aliasing and cloning, exists at all.

## Use Cases

- Collecting a sequence of results built up over a loop (e.g. every value in a range that passes a test).
- Storing an ordered collection of items that needs to grow or shrink after creation — a shopping cart, a queue of tasks, a hand of cards.
- Modifying part of a collection in place rather than rebuilding the whole thing from scratch.
- Passing a list into a function that's expected to observe or add to it, relying on the fact that changes are visible after the call returns.

## Deep Dive

### Creating, indexing, and mutating a list

```python
scores = [88, 92, 79]
scores[0]              # 88 — indexing starts at 0
scores.append(95)      # scores is now [88, 92, 79, 95]
scores[1] = 100         # scores is now [88, 100, 79, 95] — mutated in place
scores.remove(79)       # scores is now [88, 100, 95]
len(scores)              # 3
```

Every one of these operations changes the *same* list object — no new list is created. This matters because of what "mutable" means concretely: if another name refers to this same list, it sees every one of these changes too (covered in aliasing-and-cloning).

### Mutable vs. immutable: why it matters

```python
name = "Ada"
name[0] = "E"     # TypeError: 'str' object does not support item assignment
```

A `str` is immutable — there is no way to change one character of an existing string in place; any "modification" (like `name.upper()`) actually produces a brand-new string, leaving the original untouched. A list has no such restriction:

```python
letters = ["A", "d", "a"]
letters[0] = "E"      # perfectly legal — letters is now ["E", "d", "a"]
```

Knowing which of your values are mutable and which aren't determines what you can safely do to them in place, and — just as importantly — what a function is allowed to do to a list it receives as an argument without the caller's explicit consent.

## Trade-offs

- **Mutability makes in-place updates cheap, but means a list handed to a function can be changed by that function, sometimes unintentionally** — a function that calls `.append()` on a list argument changes the caller's list too, which is easy to overlook if the function's name doesn't advertise that it mutates its input.
- **Indexing past the end of a list raises `IndexError` rather than silently returning something** — this is a deliberate design choice that surfaces bugs immediately instead of letting them propagate:

  ```python
  scores = [1, 2, 3]
  scores[5]   # IndexError: list index out of range
  ```
- **Choosing a list when the data shouldn't change (a fixed set of days of the week, a coordinate pair) gives up the safety immutability would have provided** — an accidental mutation of data that was supposed to stay fixed is a bug that an immutable type like a tuple would have caught at the point of the attempted change instead of much later.

## Documentation Links

- [Python Tutorial — Data Structures](https://docs.python.org/3/tutorial/datastructures.html) — doc
- [Python Library Reference — Built-in Types](https://docs.python.org/3/library/stdtypes.html) — doc
