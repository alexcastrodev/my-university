---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

Understand three performance-relevant defaults in the Java Collections and Streams APIs: why collections are unsynchronized by default, why sizing a collection up front matters, and why a chain of `Stream` operations processes far less data than it looks like it does.

## Use Cases

- Deciding between `Collections.synchronizedList()` and a plain `ArrayList` for a collection that's currently single-threaded but might not stay that way.
- Explaining why constructing a `HashMap` or `ArrayList` with an accurate initial capacity measurably reduces GC pressure on a hot path.
- Understanding why chaining several `Stream.filter()` calls followed by `findFirst()` can be dramatically cheaper than it looks, instead of assuming each filter scans the whole collection.

## Deep Dive

### Unsynchronized by default, on purpose

Almost every Java collection class is unsynchronized by default — `Hashtable`, `Vector`, and their relatives are the historical exceptions, dating from before the Collections Framework existed, when Java tried to make thread safety the default. That approach turned out to cost real performance even when nothing was actually contending for the lock, so every collection class added since has defaulted the other way: fast and unsynchronized, with `Collections.synchronizedList()` and friends available when you actually need the safety. Measured single-threaded, the gap between an unsynchronized method call, a `synchronized` one, and a CAS-based one is a handful of nanoseconds — real, but usually dwarfed by everything else a typical request does. The actual decision isn't really about that gap: it's whether the collection might ever be touched by more than one thread, now or later.

### Sizing matters because collections are backed by arrays

An `ArrayList` is, underneath, an `Object[]`. A `HashMap` is an array of entries indexed by hash. Any collection class whose constructor accepts an initial-size argument is telling you it's array-backed, and that its performance depends on getting that size roughly right. An unsized `ArrayList` starts with capacity 10 and grows by roughly 50% each time it fills (10 → 15 → 22 → 33 → …), and every resize means allocating a new backing array and copying every existing element into it — wasted memory (which becomes GC work later) and a real, repeated copy cost. Constructing the collection with a decent estimate of its final size — `new ArrayList<>(expectedSize)` — skips both costs entirely. The same reasoning applies to `StringBuilder`, `StringBuffer`, and `ByteArrayOutputStream`, all of which double their backing array on resize rather than growing by 50%, but pay the same category of cost if never sized up front.

### Streams are lazy — a filter chain does less work than it looks like

```java
Stream<String> stream = symbols.stream();
Optional<String> t = stream
    .filter(s -> s.charAt(0) != 'A')
    .filter(s -> s.charAt(1) != 'A')
    .filter(s -> s.charAt(2) != 'A')
    .filter(s -> s.charAt(3) != 'A')
    .findFirst();
```

Each `filter()` call doesn't scan anything — it just chains a predicate onto the stream pipeline. No actual comparison happens until `findFirst()` pulls a value, and even then, elements are pulled and tested **one at a time, filter by filter**, only as far downstream as needed: the first filter grabs one element and tests it; if it fails, it immediately grabs the next one itself rather than passing anything downstream. Compare that to the eager equivalent — building a whole new `ArrayList` after each filter step — which must fully materialize every intermediate list before the next filter can even start. Over 456,976 sorted four-letter symbols, the lazy version only has to actually inspect 18,278 of them before finding a match; the eager version processes the entire list at every one of the four stages.

## Trade-offs

- **Choosing an unsynchronized collection is a bet that concurrent access will never happen** — cheaper today, but "will this ever be touched by more than one thread" is a question about the future of the code, not just its current call sites; when in doubt, the small synchronization cost is usually the safer default to pay for.
- **Under-sizing a collection costs memory and copy time; over-sizing wastes memory for nothing** — the win from accurate sizing only exists if the estimate is actually close; a wildly-oversized initial capacity trades the resize cost for permanently wasted heap instead.
- **Laziness is a win for short-circuiting operations (`findFirst`, `anyMatch`, `limit`) and a non-issue for ones that must see everything anyway (`collect`, `count` without `limit`, `forEach`)** — don't expect a lazy pipeline to magically save work on an operation that was always going to process the entire stream regardless of how the intermediate steps are written.

## Documentation Links

- Scott Oaks, *Java Performance: The Definitive Guide*, 2nd Edition (O'Reilly, 2020) — Chapter 12 "Java SE API Tips", "Java Collections API" and "Stream and Filter Performance", pp. 392-401 — book
- [Collections — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Collections.html) — doc
- [Stream — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Stream.html) — doc
