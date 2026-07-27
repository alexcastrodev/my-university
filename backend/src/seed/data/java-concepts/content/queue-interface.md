---
version: 1.0
updatedAt: 2026-07-27
---
## Objective

Understand `Queue`: a `Collection` that declares the behavior of a queue — often first-in, first-out, though some implementations order elements by other criteria (a `PriorityQueue`, for instance, orders by priority, not arrival order). `Queue` is built around two parallel method pairs: one family throws on failure, the other reports it through a return value.

## Use Cases

- Modeling a work queue where items are processed in the order they arrive.
- Peeking at the next item without committing to removing it, before deciding how to handle it.
- Working with a bounded or fixed-length queue, where "the queue is full" is an expected condition to handle, not an exceptional one.
- Choosing between an operation that throws on an empty queue and one that returns `null`, depending on whether "empty" is a bug or a normal state for the caller.
- Building a priority-ordered or otherwise custom-ordered processing pipeline while still working against the generic `Queue` type.

## Deep Dive

### Queue extends Collection

```java
interface Queue<E>
```

`E` specifies the type of objects the queue will hold. Several of `Queue`'s methods throw `ClassCastException` when an object is incompatible with the elements already in the queue, `NullPointerException` when `null` isn't allowed, and `IllegalArgumentException` if an invalid argument is used — the same exception vocabulary `Collection` uses elsewhere.

### Adding: add() vs. offer()

`add()` (inherited from `Collection`) throws if it can't add the element. `offer()` is `Queue`'s own method for the same job, but it reports failure instead of throwing:

```java
Queue<Integer> q = new ArrayBlockingQueue<>(1); // fixed capacity: 1
q.add(10);          // true, added
q.add(20);           // IllegalStateException: queue full
```

```java
Queue<Integer> q = new ArrayBlockingQueue<>(1);
q.add(10);
boolean added = q.offer(20); // false — reports the failure instead of throwing
```

### Looking without removing: element() vs. peek()

Both return the element at the head of the queue without removing it. They differ only in how they handle an empty queue:

```java
Queue<String> q = new LinkedList<>();
q.element(); // NoSuchElementException — queue is empty
q.peek();    // null — queue is empty
```

### Removing: remove() vs. poll()

Both remove and return the element at the head of the queue. Same split on empty:

```java
Queue<String> q = new LinkedList<>();
q.remove(); // NoSuchElementException — queue is empty
q.poll();   // null — queue is empty
```

### Choosing a pair based on how "empty" or "full" should be handled

The two families exist so a caller can pick the failure mode that fits the situation: `add()`/`remove()`/`element()` are appropriate when an empty or full queue is a bug the caller wants surfaced immediately; `offer()`/`poll()`/`peek()` are appropriate when it's an expected outcome the caller will branch on.

```java
if (queue.offer(item)) {
    // handle success
} else {
    // queue full — handle without a try/catch
}
```

## Trade-offs

- **The exception-throwing pair and the null/false-returning pair aren't interchangeable** — swapping `element()`/`remove()` for `peek()`/`poll()` (or vice versa) changes how an empty queue is reported, from an exception to a sentinel value:

  ```java
  Queue<String> q = new LinkedList<>();
  q.element(); // NoSuchElementException
  q.peek();    // null
  ```
- **A fixed-length queue makes add() throw where offer() would just report false** — this only shows up once the queue is actually bounded (e.g., `ArrayBlockingQueue`), not with an unbounded one like `LinkedList`:

  ```java
  Queue<Integer> q = new ArrayBlockingQueue<>(1);
  q.add(1);
  q.add(2); // IllegalStateException: queue full
  ```
- **null doubles as the "empty queue" sentinel for peek()/poll()**, so a queue that actually stored `null` as an element would make "empty" indistinguishable from "head is null." Most `Queue` implementations sidestep the ambiguity by disallowing `null` outright:

  ```java
  Queue<String> q = new LinkedList<>();
  q.add(null); // NullPointerException — null elements are not allowed
  ```
- **FIFO is a convention some implementations choose, not a guarantee `Queue` itself makes** — a `PriorityQueue` implements the same interface but orders elements by priority rather than insertion order, so code that assumes strict first-in-first-out behavior from the `Queue` type alone is assuming more than the interface promises.

## Documentation Links

- [Queue — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Queue.html) — doc
- [Collection — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Collection.html) — doc
