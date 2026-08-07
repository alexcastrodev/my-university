---
version: 1.0
updatedAt: 2026-08-07
---
## Objective

Understand `HashSet`, the default `Set` implementation: elements are stored in a hash table, giving average constant-time `add`/`remove`/`contains` at the cost of any guaranteed iteration order.

## Use Cases

- Fast membership testing (`contains`) when order genuinely doesn't matter.
- Deduplicating a collection of values quickly.
- Pre-sizing the table via the capacity/fill-ratio constructor when the eventual element count is roughly known, to avoid rehashing during a large batch of inserts.

## Deep Dive

### HashSet extends AbstractSet

```java
class HashSet<E>
```

`HashSet` implements `Set<E>` and defines no additional methods beyond what `AbstractSet`/`Set`/`Collection` already provide — its contribution is entirely in *how* elements are stored, not in new API surface. Four constructors:

```java
HashSet<String> a = new HashSet<>();                        // default capacity 16, load factor 0.75
HashSet<String> b = new HashSet<>(List.of("x", "y"));        // initialized from a collection
HashSet<String> c = new HashSet<>(64);                       // initial capacity 64
HashSet<String> d = new HashSet<>(64, 0.5f);                  // capacity 64, load factor 0.5
```

The load factor (also called fill ratio) controls how full the table can get, as a fraction of capacity, before it's resized upward — 0.75 by default, meaning the table roughly doubles once it's three-quarters full.

### Lookup relies on hashCode() and equals()

An element's hash code determines which bucket it lands in; `equals()` then distinguishes elements that share a bucket. Both must be correct and consistent with each other for `add`/`contains`/`remove` to behave correctly — this is the same `Object` contract every hash-based structure in the JDK depends on.

### Iteration order is unspecified

```java
HashSet<String> hs = new HashSet<>();
hs.add("Beta"); hs.add("Alpha"); hs.add("Eta");
hs.add("Gamma"); hs.add("Epsilon"); hs.add("Omega");
System.out.println(hs); // [Gamma, Eta, Alpha, Epsilon, Omega, Beta] — order is table-layout dependent, not insertion order
```

The exact order depends on each element's hash code and the table's current capacity, not the order elements were added.

## Trade-offs

- **No iteration-order guarantee, and it can change between runs or after resizing** — if a stable order matters, use `LinkedHashSet` (insertion order); if a sorted order matters, use `TreeSet`.
- **Mutating a field involved in an element's `hashCode()` after it's already in the set breaks lookups silently** — the element sits in the bucket its *old* hash code pointed to, so `contains()`/`remove()` with an equal-looking object can return `false`/no-op instead of finding it:

  ```java
  class Point { int x; /* hashCode() based on x */ }
  Point p = new Point(1);
  HashSet<Point> set = new HashSet<>();
  set.add(p);
  p.x = 2;              // mutated after insertion
  set.contains(p);      // may return false — p is now in the wrong bucket
  ```
- **Average O(1) operations assume a reasonably distributed `hashCode()`** — a poor hash function that collides heavily degrades `add`/`contains`/`remove` toward O(n), since every colliding element has to be checked with `equals()`.
- **`HashSet` is not synchronized** — same caveat as `ArrayList`/`LinkedList` for concurrent or in-loop structural modification.

## Documentation Links

- *Java: The Complete Reference*, 12th Edition (Herbert Schildt) — Chapter 20, pp. 590–591 — book
- [HashSet — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/HashSet.html) — doc
- [Set — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Set.html) — doc
