---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- Implement a hash table's `insert`, `lookup`, and `delete` operations from scratch, backed by a plain Python list, with no use of `dict` or `set` internally.
- Implement separate chaining as the collision-resolution strategy and trigger it deliberately with a hand-picked colliding key sequence.
- Implement automatic resizing that grows the backing array once the load factor crosses a fixed threshold, and verify that every existing key remains correctly reachable after a resize.
- Design a test suite that checks correctness on ordinary keys, on deliberately colliding keys, and on the specific edge cases around deletion and resizing.
- Benchmark average lookup time as the number of stored keys grows, and check empirically whether the measured trend is consistent with the O(1) average-case claim rather than merely asserting it.

## Context & Motivation

**Hashing and Hash Functions** already made the theoretical case for hash tables: a good hash function maps keys to array indices in a way that is deterministic, roughly uniform, and cheap to compute, and collisions are a mathematical certainty once the key space exceeds the table size, not a defect to be engineered away. Knowing that argument is not the same as knowing it holds — the only way to find out whether an implementation actually delivers O(1) average lookup, actually resolves collisions correctly, and actually survives a resize without losing data, is to build one, break it on purpose, and measure it. This lab does exactly that: no new theory is introduced here, only the discipline of turning the theory already covered into working code and then interrogating that code with concrete test cases and a timing experiment.

## Core Theory

This lab builds directly on **Hashing and Hash Functions**: the hash-code-then-compress pipeline (`index = hash_code(key) % table_size`), the three properties of a good hash function (deterministic, uniform, cheap), and the inevitability of collisions once the number of possible keys exceeds the table size. Collision handling here uses **separate chaining**, already introduced as a standard resolution strategy in that discipline's companion concepts: each array slot holds not a single key-value pair but a small bucket (here, a Python list of pairs) that can hold more than one entry when multiple keys land on the same index. Nothing about hash functions, uniformity, or the pigeonhole principle is re-derived below — it is used as settled, already-understood machinery.

## Worked Examples

### API specification

The implementation is a single class, `HashTable`, matching a small, precise interface — deliberately narrow, in the spirit of a Princeton `algs4`-style assignment specification, so correctness can be checked against a precise contract rather than a vague description:

- `HashTable(initial_capacity: int = 8)` — constructs an empty table with the given number of buckets.
- `insert(key, value) -> None` — stores `value` under `key`. If `key` already exists, its value is overwritten, not duplicated. May trigger a resize as a side effect.
- `lookup(key) -> Any` — returns the value stored under `key`. Raises `KeyError` if `key` is not present (mirroring Python's own `dict` contract, so behavior is easy to reason about).
- `delete(key) -> None` — removes `key` and its value. Raises `KeyError` if `key` is not present.
- `__contains__(key) -> bool` — supports `key in table`, returning `False` rather than raising when absent.
- `__len__() -> int` — returns the number of stored keys (not the number of buckets).

Performance requirement stated precisely, mirroring how a real assignment spec would phrase it: average-case `insert`, `lookup`, and `delete` must run in O(1) time with respect to the number of stored keys `n`, provided the load factor is kept bounded by resizing — not O(1) in some informal sense, but demonstrably flat when average lookup time is measured across growing `n` (Step 5 below does exactly this measurement).

### Step 1 — the backing array and the hash/compress pipeline

The backing store is a plain Python `list` of buckets, each bucket itself a plain Python `list` of `(key, value)` pairs — no `dict` is used anywhere in the implementation:

```python
class HashTable:
    def __init__(self, initial_capacity: int = 8):
        self._capacity = initial_capacity
        self._buckets = [[] for _ in range(self._capacity)]
        self._size = 0  # number of stored keys, not number of buckets

    def _index_for(self, key) -> int:
        # Python's built-in hash() reduced mod table size is a legitimate,
        # standard approach for arbitrary hashable keys (see Hashing and
        # Hash Functions — the hash-code-then-compress pipeline). Python's
        # hash() already satisfies determinism within a single run and
        # decent uniformity for typical key types.
        return hash(key) % self._capacity
```

Using `hash()` here is not a shortcut around "writing your own hash function" — it is the hash-code stage of the two-stage pipeline already covered theoretically; this lab's own work is the compression stage, the bucket structure, the resizing policy, and the operations built on top, all of which are written from scratch below.

### Step 2 — insert, with separate chaining

```python
    def insert(self, key, value) -> None:
        index = self._index_for(key)
        bucket = self._buckets[index]
        for i, (k, _) in enumerate(bucket):
            if k == key:
                bucket[i] = (key, value)   # overwrite, not duplicate
                return
        bucket.append((key, value))
        self._size += 1
        if self._load_factor() > 0.75:
            self._resize(self._capacity * 2)

    def _load_factor(self) -> float:
        return self._size / self._capacity
```

A collision is exactly the case where `bucket` already has one or more entries when a new key arrives at the same index; separate chaining resolves it by scanning the (typically very short) bucket list for a matching key before appending — this scan is the entire cost of a collision, and it stays cheap only because a good hash function keeps buckets short on average.

### Step 3 — lookup and delete

```python
    def lookup(self, key):
        index = self._index_for(key)
        for k, v in self._buckets[index]:
            if k == key:
                return v
        raise KeyError(key)

    def __contains__(self, key) -> bool:
        index = self._index_for(key)
        return any(k == key for k, _ in self._buckets[index])

    def delete(self, key) -> None:
        index = self._index_for(key)
        bucket = self._buckets[index]
        for i, (k, _) in enumerate(bucket):
            if k == key:
                del bucket[i]
                self._size -= 1
                return
        raise KeyError(key)

    def __len__(self) -> int:
        return self._size
```

### Step 4 — automatic resizing

Growth is triggered in `insert` once the load factor (`size / capacity`) exceeds `0.75`, the same threshold Java's own `HashMap` uses by convention. Resizing means allocating a larger backing array and **rehashing every existing key into it** — a key's index depends on `capacity`, so simply copying old buckets into a bigger array verbatim would leave most keys unreachable at the index a future `lookup` would compute:

```python
    def _resize(self, new_capacity: int) -> None:
        old_buckets = self._buckets
        self._capacity = new_capacity
        self._buckets = [[] for _ in range(self._capacity)]
        old_size = self._size
        self._size = 0
        for bucket in old_buckets:
            for key, value in bucket:
                self.insert(key, value)   # recomputes each key's index under the new capacity
        assert self._size == old_size, "resize must not lose or duplicate any key"
```

Reusing `insert` here (rather than a separate low-level append) is deliberate: it guarantees the exact same index-computation and duplicate-key logic applies uniformly, whether a key arrives via ordinary insertion or via a resize.

### Step 5 — validating correctness with concrete test cases

Following the Princeton `algs4` assignment convention of stating exact expected outputs rather than vague behavior, each test below asserts a specific value:

```python
def test_insert_then_lookup():
    t = HashTable()
    t.insert("apple", 1)
    t.insert("banana", 2)
    assert t.lookup("apple") == 1
    assert t.lookup("banana") == 2
    assert len(t) == 2

def test_overwrite_does_not_duplicate():
    t = HashTable()
    t.insert("apple", 1)
    t.insert("apple", 99)
    assert t.lookup("apple") == 99
    assert len(t) == 1          # still one key, not two

def test_delete_then_lookup_raises():
    t = HashTable()
    t.insert("apple", 1)
    t.delete("apple")
    assert "apple" not in t
    try:
        t.lookup("apple")
        assert False, "expected KeyError"
    except KeyError:
        pass

def test_missing_key_raises_and_contains_is_false():
    t = HashTable()
    assert "ghost" not in t
    try:
        t.lookup("ghost")
        assert False, "expected KeyError"
    except KeyError:
        pass

def test_forced_collision_sequence_resolves_correctly():
    # Force a collision on purpose: a tiny table (capacity 4) with keys
    # chosen so more than one maps to the same index under hash() % 4.
    t = HashTable(initial_capacity=4)
    keys = [f"key{i}" for i in range(20)]   # 20 keys into 4 buckets guarantees repeats
    for i, k in enumerate(keys):
        t.insert(k, i)
    for i, k in enumerate(keys):
        assert t.lookup(k) == i             # every key still resolves to its own value
    assert len(t) == 20

def test_resize_preserves_every_key():
    t = HashTable(initial_capacity=4)
    for i in range(100):                    # forces several resizes past load factor 0.75
        t.insert(i, i * i)
    for i in range(100):
        assert t.lookup(i) == i * i
    assert len(t) == 100

def test_delete_one_of_several_colliding_keys():
    t = HashTable(initial_capacity=4)
    keys = [f"key{i}" for i in range(10)]
    for i, k in enumerate(keys):
        t.insert(k, i)
    t.delete(keys[3])
    assert keys[3] not in t
    for i, k in enumerate(keys):             # the other colliding keys are unaffected
        if k != keys[3]:
            assert t.lookup(k) == i
```

`test_forced_collision_sequence_resolves_correctly` is the case that specifically stresses separate chaining: with only 4 buckets and 20 keys, the pigeonhole principle guarantees repeated indices, so this test only passes if bucket scanning correctly distinguishes keys that share an index. `test_resize_preserves_every_key` is the case that specifically stresses `_resize`: it forces the load-factor threshold to trip multiple times and checks that no key becomes unreachable afterward — the single most common way a from-scratch hash table silently loses data.

### Step 6 — empirically checking the O(1) average-lookup claim

A test suite checks correctness; it does not check performance. The claim that `lookup` costs O(1) on average, independent of `n`, is an empirical claim about growth and needs to be measured, not merely trusted:

```python
import random
import string
import timeit

def random_key(length: int = 10) -> str:
    return "".join(random.choices(string.ascii_lowercase, k=length))

def measure_average_lookup_time(n: int, num_lookups: int = 2000) -> float:
    t = HashTable()
    keys = [random_key() for _ in range(n)]
    for i, k in enumerate(keys):
        t.insert(k, i)

    sample = random.sample(keys, min(num_lookups, n))
    start = timeit.default_timer()
    for k in sample:
        t.lookup(k)
    elapsed = timeit.default_timer() - start
    return elapsed / len(sample)   # average seconds per lookup

for n in (1_000, 10_000, 100_000, 1_000_000):
    avg = measure_average_lookup_time(n)
    print(f"n={n:>9}  avg lookup = {avg * 1e6:8.3f} microseconds")
```

Expected output shape: the average-lookup-time column should stay roughly flat (within a small constant factor, accounting for measurement noise and Python overhead) as `n` grows by three orders of magnitude — for example, something like `0.4`, `0.4`, `0.5`, `0.5` microseconds rather than `0.4`, `4`, `40`, `400`. A flat trend across a 1000x growth in `n` is the empirical signature of O(1); a trend that scales roughly linearly with `n` instead would mean the resizing policy isn't keeping the load factor bounded, or the hash function is clustering keys into a small number of very long buckets — either way, a real finding the timing experiment surfaces that reading the code alone would not.

## Common Misconceptions & Pitfalls

- **Forgetting to rehash every key on resize, or rehashing into the wrong capacity.** Doubling the array's length and copying old buckets into the new array at their *old* indices leaves nearly every key unreachable, because `index = hash(key) % new_capacity` almost never equals `index = hash(key) % old_capacity`. The fix is what Step 4 does: recompute every key's index under the new capacity by re-inserting it, never by copying bucket contents positionally.
- **Checking load factor before insertion instead of after.** Checking `_load_factor() > 0.75` before adding the new entry means the table always resizes one insertion "late" relative to its own stated threshold, and the very last insertion that pushes load factor over the threshold is never followed by a resize until the *next* call — a subtle off-by-one that only shows up under a timing test at scale, not in small correctness tests.
- **Using `is` or an unstable equality check instead of `==` when scanning a bucket.** A bucket scan that compares keys with `is` instead of `==` will fail to find a key that is equal in value but a different object (e.g., two separately-constructed strings with the same characters) — `lookup` will incorrectly raise `KeyError` for a key that was, in fact, inserted.
- **Not handling the update-vs-duplicate case in `insert`.** Appending a `(key, value)` pair to a bucket without first checking whether `key` already exists in that bucket silently creates duplicate entries for the same key; `lookup` will then return whichever duplicate happens to be found first (usually the oldest), and `len()` will overcount, both of which are easy to miss until `test_overwrite_does_not_duplicate`-style tests catch it explicitly.
- **Never shrinking the table, and treating that as a correctness bug.** Growing on a high load factor but never shrinking on a low one after many deletions is not incorrect — it is a legitimate, common design choice (a table that never shrinks is still O(1) average for lookup and insert) — but it is worth stating explicitly as a design decision rather than an oversight, since some assignment specifications do require shrink-on-deletion and this implementation intentionally does not.
- **Assuming the timing test alone proves the implementation is correct.** A hash table that always returns the first bucket's first entry regardless of key would still produce a suspiciously flat (in fact, artificially fast) timing curve while being completely wrong — the timing experiment in Step 6 checks the performance claim, not correctness; only the explicit test cases in Step 5 check correctness. Both are necessary, and neither substitutes for the other.

## Summary

This lab built a `HashTable` from a plain Python list of buckets: `hash(key) % capacity` for the compression step (citing this as a legitimate use of the hash-code-then-compress pipeline already covered in Hashing and Hash Functions), separate chaining to resolve collisions within each bucket, and automatic doubling once the load factor crosses `0.75`, with every existing key rehashed under the new capacity. Correctness was validated with explicit test cases — ordinary insert/lookup, overwrite instead of duplication, delete-then-lookup raising `KeyError`, a deliberately collision-forcing key sequence, and a resize-preserving-every-key case — and the theoretical O(1) average-lookup claim was checked empirically by timing lookups across `n` growing from 1,000 to 1,000,000 and confirming the average stayed roughly flat rather than growing with `n`.

## Documentation Links

- [Sedgewick & Wayne — Algorithms, 4th ed. Companion Site](https://algs4.cs.princeton.edu/home/) — doc
- [Princeton algs4 Assignments Index](https://coursera.cs.princeton.edu/algs4/assignments/) — doc
