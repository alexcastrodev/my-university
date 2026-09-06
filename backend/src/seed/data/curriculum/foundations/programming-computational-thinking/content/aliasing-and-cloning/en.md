---
version: 1.0
updatedAt: 2026-09-06
---
## Objective

When one variable is assigned to another (`b = a`) and both refer to a mutable object like a list, they don't get two independent copies — they become two names for the *same* object in memory. This is aliasing, and it means a mutation performed through either name is visible through the other. Cloning creates an actual independent copy, so mutating one no longer affects the other. Python's data model is explicit about this: assignment binds a name to an object, it never copies the object itself.

## Use Cases

- Passing a list into a function, understanding whether the function is expected to mutate the caller's list or work on an independent copy.
- Deliberately sharing one mutable structure between two parts of a program so that a change in one place is visible in the other.
- Deliberately cloning a list before handing it to code that might mutate it, to protect the original from unwanted changes.
- Debugging a mysterious bug where a variable that "should have stayed the same" changed — often traceable to an alias, not a mistaken value.

## Deep Dive

### Two names, one object

```python
a = [1, 2, 3]
b = a              # b is now another name for the SAME list, not a copy
b.append(4)
print(a)           # [1, 2, 3, 4] — a "changed" too, because a and b are the same object
print(a is b)      # True — confirms they refer to the identical object
```

`is` checks object identity (same object in memory), while `==` checks whether two objects have equal *contents* — two different lists with the same elements would be `==` but not `is`. Aliasing only becomes visible when a *mutation* happens; if `b = a` is followed only by `b = [9, 9, 9]` (a reassignment, not a mutation), `a` is untouched, because that line just makes `b` refer to a brand-new list instead.

### Cloning breaks the alias

```python
a = [1, 2, 3]
b = a[:]           # slicing the whole list creates a new, independent list
# equivalently: b = list(a) or b = a.copy()
b.append(4)
print(a)           # [1, 2, 3] — untouched
print(b)           # [1, 2, 3, 4]
print(a is b)      # False — two distinct objects now
```

This distinction matters directly when passing a list to a function: Python passes the reference, not a copy, so a function that mutates a parameter mutates the caller's original list too, unless the function (or the caller, before calling it) explicitly clones it first.

```python
def add_bonus(scores):
    scores.append(100)   # mutates the CALLER's list

original = [88, 92]
add_bonus(original)
print(original)          # [88, 92, 100] — the caller's list changed
```

## Trade-offs

- **Aliasing is invisible until a mutation happens, which makes it a common source of "spooky action at a distance" bugs** — a list that changes somewhere the reading code never touched is a classic symptom of an unnoticed alias.
- **Cloning avoids aliasing bugs but costs memory and time proportional to the size of what's copied** — cloning a very large list on every function call just to be safe is wasteful when the function was never going to mutate it in the first place.
- **`a[:]`, `list(a)`, and `.copy()` all make a *shallow* copy** — if the list contains other mutable objects (like nested lists), the outer list is independent, but the inner ones are still shared, so a mutation to a nested list is visible through both copies:

  ```python
  a = [[1, 2], [3, 4]]
  b = a[:]
  b[0].append(99)
  print(a)   # [[1, 2, 99], [3, 4]] — the shared inner list changed
  ```

## Documentation Links

- [Python Data Model](https://docs.python.org/3/reference/datamodel.html) — doc
- [Python Tutorial — Data Structures](https://docs.python.org/3/tutorial/datastructures.html) — doc
