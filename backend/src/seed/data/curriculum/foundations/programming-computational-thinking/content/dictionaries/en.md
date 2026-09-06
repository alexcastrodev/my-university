---
version: 1.0
updatedAt: 2026-09-06
---
## Objective

A dictionary stores key-value pairs and, backed by a hash table, looks up a value by its key in roughly constant time — regardless of how many pairs it holds — instead of the linear-time scan a list would need to find something by content. Where a list is naturally suited to "the 3rd item," a dictionary is suited to "the value associated with this key," and reaching for the right one of the two is one of the first real data-structure decisions a beginner has to make deliberately.

## Use Cases

- Counting occurrences of items (word frequencies, votes, inventory counts) keyed by the item itself.
- Looking up a record by a natural identifier (a username, a product code) instead of remembering its position in a list.
- Grouping related values under a single name, like a simple record with named fields (`{"name": "Ada", "age": 30}`).
- Building a lookup table once so that repeated queries against it are fast, instead of re-scanning a list on every query.

## Deep Dive

### Creating, reading, and updating

```python
ages = {"Ada": 30, "Bob": 25}
ages["Ada"]              # 30 — lookup by key
ages["Cid"] = 40          # adds a new key-value pair
ages["Ada"] = 31          # updates the existing value for "Ada"
"Bob" in ages             # True — membership check by key
ages.get("Zoe", 0)        # 0 — .get returns a default instead of raising an error
```

`ages["Zoe"]` would raise `KeyError` if `"Zoe"` isn't a key — `.get(key, default)` is the safe alternative when a missing key shouldn't crash the program. Iterating a dictionary walks its keys by default:

```python
for name in ages:
    print(name, ages[name])

for name, age in ages.items():   # iterate keys and values together
    print(name, age)
```

### Why lookup is fast: hashing

A dictionary computes a hash of each key — a number derived from the key's value — and uses that number to decide roughly where in memory to store or look for the corresponding value. This is why lookup doesn't need to scan every entry: given a key, the dictionary jumps close to directly to where its value lives, rather than checking each pair in turn the way `key in some_list` would. It's also why dictionary keys must be immutable (hashable) — if a key's contents (and therefore its hash) could change after being stored, the dictionary would no longer know where to find it. This is exactly why a list can't be a dictionary key but a tuple can.

```python
counts = {}
for word in ["a", "b", "a", "c", "b", "a"]:
    counts[word] = counts.get(word, 0) + 1
print(counts)   # {'a': 3, 'b': 2, 'c': 1}
```

## Trade-offs

- **Looking up a missing key with `[]` raises `KeyError` instead of returning something like `None`** — this surfaces a bug (a typo'd key, an assumption that didn't hold) immediately rather than letting it propagate silently:

  ```python
  ages = {"Ada": 30}
  ages["Bob"]   # KeyError: 'Bob'
  ```
- **Dictionaries trade memory for speed** — the hash table backing a dictionary uses more memory per entry than a plain list would for the same data, which rarely matters at this scale but is a real cost as data grows.
- **A dictionary has no guaranteed order for lookup purposes** (Python does preserve insertion order for iteration since 3.7, but that's a historical accident of the implementation, not something to design around) — if the order elements were added in matters to the logic, that should be made explicit rather than relied on implicitly.

## Documentation Links

- [Python Tutorial — Data Structures](https://docs.python.org/3/tutorial/datastructures.html) — doc
- [Python Library Reference — Built-in Types](https://docs.python.org/3/library/stdtypes.html) — doc
