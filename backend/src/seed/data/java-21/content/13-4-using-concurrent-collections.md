# Using Concurrent Collections

> **OCP Exam Topic** — Use thread-safe collection classes from `java.util.concurrent`: `ConcurrentHashMap`, `CopyOnWriteArrayList`, blocking queues, and the `Collections.synchronized*` wrappers. Covered in Chapter 13 of *OCP Java SE 21 Developer Study Guide* (Selikoff & Boyarsky).

---

## Why Standard Collections Are Not Thread-Safe

Standard collections (`ArrayList`, `HashMap`, etc.) are not designed for concurrent access. Using them from multiple threads without external synchronization leads to race conditions and corrupted internal state — including infinite loops caused by a corrupted `HashMap`.

The `java.util.concurrent` package provides collections designed from the ground up for multi-threaded use.

---

## `ConcurrentHashMap`

`ConcurrentHashMap` is the thread-safe alternative to `HashMap`. It uses **lock striping** — the map is divided into segments, each with its own lock — so multiple threads can read and write to different segments simultaneously.

```java
import java.util.concurrent.ConcurrentHashMap;

ConcurrentHashMap<String, Integer> map = new ConcurrentHashMap<>();

// Thread-safe operations
map.put("apples", 5);
map.putIfAbsent("bananas", 3);      // atomic: only inserts if key absent
map.replace("apples", 5, 10);       // atomic: only replaces if current value matches
map.computeIfAbsent("cherries", k -> k.length()); // atomic compute
```

Key differences from `Collections.synchronizedMap(new HashMap<>())`:

| Feature | `ConcurrentHashMap` | `synchronizedMap` |
|---|---|---|
| Locking | Fine-grained (segment-level) | Coarse-grained (entire map) |
| `null` keys/values | Not allowed | Allowed (in `HashMap`) |
| Iteration | Weakly consistent (no `ConcurrentModificationException`) | Must synchronize externally |
| Compound atomics | `putIfAbsent`, `replace`, `compute` | Must synchronize externally |

> **Exam tip:** `ConcurrentHashMap` does **not** allow `null` keys or `null` values. Attempting to insert `null` throws `NullPointerException`.

---

## `CopyOnWriteArrayList`

`CopyOnWriteArrayList` is a thread-safe `List` where every **write** operation creates a fresh copy of the underlying array. Reads are lock-free.

```java
import java.util.concurrent.CopyOnWriteArrayList;

CopyOnWriteArrayList<String> list = new CopyOnWriteArrayList<>();
list.add("alpha");
list.add("beta");

// Safe iteration — iterators work on a snapshot
for (String s : list) {
    System.out.println(s); // won't throw ConcurrentModificationException
    list.add("gamma");     // modifies a NEW copy; this iterator sees the old one
}
```

Best used when:
- Reads vastly outnumber writes.
- Iteration must be safe without external locking.

Not suitable for high write throughput — every mutation allocates and copies the entire array.

---

## `CopyOnWriteArraySet`

`CopyOnWriteArraySet` is built on top of `CopyOnWriteArrayList`. It provides thread-safe `Set` semantics with the same copy-on-write behaviour.

```java
import java.util.concurrent.CopyOnWriteArraySet;

CopyOnWriteArraySet<String> set = new CopyOnWriteArraySet<>();
set.add("x");
set.add("y");
set.add("x"); // duplicate — ignored

// Safe concurrent iteration
for (String item : set) {
    System.out.println(item);
}
```

---

## Blocking Queues

Blocking queues implement `BlockingQueue<E>` and are designed for **producer-consumer** patterns. They block the calling thread when the queue is full (on put) or empty (on take).

### `ArrayBlockingQueue`

A bounded blocking queue backed by an array. Once the capacity is reached, `put()` blocks until space is available.

```java
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.BlockingQueue;

BlockingQueue<String> queue = new ArrayBlockingQueue<>(10); // capacity = 10

// Producer thread
queue.put("task-1");   // blocks if queue is full

// Consumer thread
String task = queue.take(); // blocks if queue is empty
```

### `LinkedBlockingDeque`

An optionally bounded deque (double-ended queue) backed by linked nodes. It supports adding and removing from both ends.

```java
import java.util.concurrent.LinkedBlockingDeque;

LinkedBlockingDeque<String> deque = new LinkedBlockingDeque<>();
deque.putFirst("high-priority");
deque.putLast("low-priority");

String item = deque.takeFirst();
```

### `ConcurrentLinkedQueue`

An unbounded, non-blocking, thread-safe queue based on a lock-free algorithm. `poll()` returns `null` when empty instead of blocking.

```java
import java.util.concurrent.ConcurrentLinkedQueue;

ConcurrentLinkedQueue<String> queue = new ConcurrentLinkedQueue<>();
queue.offer("item-1");
queue.offer("item-2");

String item = queue.poll(); // returns null if empty — does NOT block
```

Use `ConcurrentLinkedQueue` when you want a highly concurrent queue and can tolerate non-blocking semantics.

---

## Blocking Queue Method Summary

| Method | Full | Throws exception | Returns special value | Blocks | Times out |
|---|---|---|---|---|---|
| Insert | `add(e)` | `offer(e)` | `put(e)` | `offer(e, t, u)` | |
| Remove | `remove()` | `poll()` | `take()` | `poll(t, u)` | |
| Examine | `element()` | `peek()` | — | — | |

> **Exam tip:** `put()` and `take()` are the blocking methods. `offer()` and `poll()` return `false`/`null` without blocking. `add()` and `remove()` throw exceptions on failure.

---

## `Collections.synchronized*` Wrappers

The `Collections` utility class provides wrapper methods that add synchronization to any collection. Each method call is individually synchronized, but **compound operations are not atomic**.

```java
import java.util.Collections;
import java.util.ArrayList;
import java.util.List;

List<String> syncList = Collections.synchronizedList(new ArrayList<>());
syncList.add("alpha"); // thread-safe individual call

// Iteration MUST be synchronized externally
synchronized (syncList) {
    for (String s : syncList) {
        System.out.println(s);
    }
}
```

**Limitation:** Compound operations like check-then-act are **not** atomic:

```java
// NOT atomic — another thread can insert between contains() and add()
if (!syncList.contains("x")) {
    syncList.add("x"); // race condition!
}
```

Use `ConcurrentHashMap` and `CopyOnWriteArrayList` for better concurrent performance and true atomic compound operations.

---

## Choosing the Right Concurrent Collection

| Scenario | Collection |
|---|---|
| Concurrent key-value store | `ConcurrentHashMap` |
| Mostly-read list, safe iteration | `CopyOnWriteArrayList` |
| Mostly-read set, safe iteration | `CopyOnWriteArraySet` |
| Bounded producer-consumer queue | `ArrayBlockingQueue` |
| Unbounded double-ended blocking queue | `LinkedBlockingDeque` |
| Lock-free unbounded queue | `ConcurrentLinkedQueue` |
| Wrap legacy collection (simple cases) | `Collections.synchronizedList/Set/Map` |

---

## Key Points to Remember

- `ConcurrentHashMap` uses segment-level locking for high throughput; it does not allow `null` keys or values.
- `CopyOnWriteArrayList` is ideal for read-heavy, write-rare lists; each mutation copies the array.
- `ArrayBlockingQueue` blocks on `put()` when full and on `take()` when empty — the backbone of producer-consumer patterns.
- `ConcurrentLinkedQueue` is non-blocking; `poll()` returns `null` when empty.
- `Collections.synchronized*` wrappers synchronize individual method calls but do not make compound operations atomic. External synchronization is required for iteration.

---

## References

- [Oracle Docs — ConcurrentHashMap](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/ConcurrentHashMap.html)
- [Oracle Docs — BlockingQueue](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/BlockingQueue.html)
- OCP Study Guide, Chapter 13 — Concurrency
