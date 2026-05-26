# Concurrent Collections and Parallel Streams

---

## Overview

Standard collections (`ArrayList`, `HashMap`, etc.) are **not thread-safe**. The `java.util.concurrent` package provides collections designed for concurrent access without requiring external synchronization.

---

## ConcurrentHashMap

A thread-safe `Map` that allows concurrent reads and fine-grained locked writes (segment-level, not the whole map).

```java
ConcurrentHashMap<String, Integer> map = new ConcurrentHashMap<>();

map.put("a", 1);
map.get("a");                            // 1

// atomic conditional operations
map.putIfAbsent("b", 2);                 // adds only if key absent
map.computeIfAbsent("c", k -> k.length()); // compute only if absent
map.merge("a", 1, Integer::sum);         // atomic read-modify-write
```

> **Exam tip:** `ConcurrentHashMap` does not allow `null` keys or `null` values. `HashMap` allows one `null` key and multiple `null` values.

---

## CopyOnWriteArrayList

Every write (`add`, `set`, `remove`) creates a **fresh copy** of the underlying array. Reads are lock-free and always see a consistent snapshot.

```java
CopyOnWriteArrayList<String> list = new CopyOnWriteArrayList<>();
list.add("a");
list.add("b");

// safe to iterate while another thread modifies
for (String s : list) {
    System.out.println(s);   // iterates over the snapshot at iteration start
}
```

| Operation | Cost |
|-----------|------|
| Read / iterate | Very cheap — no locking |
| Write (add/remove) | Expensive — full array copy |

Best for read-heavy, write-rare scenarios (e.g., listener lists).

---

## BlockingQueue

A queue that blocks on `take()` when empty and on `put()` when full. Foundation for the producer-consumer pattern.

| Implementation | Capacity |
|----------------|---------|
| `LinkedBlockingQueue` | Optionally bounded (default: `Integer.MAX_VALUE`) |
| `ArrayBlockingQueue` | Always bounded — capacity specified at creation |
| `PriorityBlockingQueue` | Unbounded; elements ordered by priority |

```java
BlockingQueue<String> queue = new ArrayBlockingQueue<>(10);

// producer thread
queue.put("task");         // blocks if full

// consumer thread
String task = queue.take(); // blocks if empty

// non-blocking alternatives
queue.offer("task");        // returns false if full
queue.poll();               // returns null if empty
queue.offer("task", 1, TimeUnit.SECONDS);   // timed offer
queue.poll(1, TimeUnit.SECONDS);            // timed poll
```

---

## ConcurrentLinkedQueue

A non-blocking, unbounded, thread-safe queue based on CAS operations. Does not block — `poll()` returns `null` if empty.

```java
ConcurrentLinkedQueue<String> clq = new ConcurrentLinkedQueue<>();
clq.offer("a");
clq.offer("b");
String head = clq.poll();   // "a" — or null if empty
```

Suitable for high-throughput queues where blocking is undesirable.

---

## Collections.synchronizedList() vs Concurrent Collections

`Collections.synchronizedList()` wraps an existing list with a single mutex. **All operations** use the same lock, including iteration — which must be manually synchronized.

```java
List<String> syncList = Collections.synchronizedList(new ArrayList<>());

// iteration MUST be manually synchronized
synchronized (syncList) {
    for (String s : syncList) {
        System.out.println(s);
    }
}
```

| Feature | `synchronizedList` | `CopyOnWriteArrayList` |
|---------|-------------------|----------------------|
| Thread safety | Yes (coarse lock) | Yes (copy-on-write) |
| Safe iteration without lock | No | Yes |
| Write performance | Better than COW | Expensive (full copy) |
| Read performance | Requires lock | Lock-free |

---

## Summary: Concurrent Collection Choices

| Need | Use |
|------|-----|
| Thread-safe key-value store | `ConcurrentHashMap` |
| Iterable list, few writes | `CopyOnWriteArrayList` |
| Producer-consumer with blocking | `LinkedBlockingQueue` / `ArrayBlockingQueue` |
| High-throughput non-blocking queue | `ConcurrentLinkedQueue` |
| Quick wrap of existing list | `Collections.synchronizedList()` |

---

## Parallel Streams and Thread Safety

Parallel streams distribute work across the common `ForkJoinPool`. The pipeline itself is safe, but **lambdas must not write to non-thread-safe shared state**.

```java
// WRONG — ArrayList is not thread-safe; concurrent add causes corruption
List<Integer> result = new ArrayList<>();
IntStream.range(0, 1000).parallel().forEach(result::add);

// CORRECT — use collect(); standard collectors are thread-safe
List<Integer> result = IntStream.range(0, 1000)
    .parallel()
    .boxed()
    .collect(Collectors.toList());
```

For aggregation, use thread-safe collectors or reduce with an identity:

```java
int sum = IntStream.range(0, 1000).parallel().sum();   // safe — no shared state

Map<Boolean, List<Integer>> partitioned = IntStream.range(0, 100)
    .parallel()
    .boxed()
    .collect(Collectors.partitioningBy(n -> n % 2 == 0));   // safe
```

> **Exam tip:** `Collectors.toList()`, `groupingBy()`, and other standard collectors are safe for parallel streams. Using `forEach` to accumulate into a mutable non-thread-safe collection is a bug.

---

## Atomic Accumulators in Parallel Streams

When a custom accumulation is needed:

```java
AtomicInteger counter = new AtomicInteger();

IntStream.range(0, 1000)
    .parallel()
    .forEach(i -> counter.incrementAndGet());   // atomic — safe

System.out.println(counter.get());   // 1000
```

---

## Key Rules

- `ConcurrentHashMap` disallows `null` keys and values; `HashMap` allows them.
- `Collections.synchronizedList()` requires explicit synchronization on the list object during iteration.
- `CopyOnWriteArrayList` iterators reflect the snapshot at iterator creation time — they never throw `ConcurrentModificationException`.
- `BlockingQueue.put()` and `take()` block indefinitely; `offer()` and `poll()` return immediately (or after a timeout).
- Parallel stream collectors from `java.util.stream.Collectors` are designed to be thread-safe in parallel pipelines.

---

## References

- [Oracle Docs — ConcurrentHashMap (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ConcurrentHashMap.html)
- [Oracle Docs — CopyOnWriteArrayList (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/CopyOnWriteArrayList.html)
- [Oracle Docs — BlockingQueue (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/BlockingQueue.html)
