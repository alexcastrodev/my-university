---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

Understand `BlockingQueue`: a `Queue` whose `put()` and `take()` block instead of failing — `put()` waits for room when the queue is full, `take()` waits for an element when it's empty. That single property is what makes the producer-consumer pattern — code that identifies work and places it on a queue, decoupled from code that removes it and does the work — trivial to implement correctly, with no hand-written `wait()`/`notify()` anywhere.

## Use Cases

- Handing work items from one or more producer threads to one or more consumer threads without either side knowing anything about the other.
- Building a bounded work queue that pushes back on producers once consumers fall behind, instead of letting memory use grow without limit.
- Processing items in priority order rather than arrival order, while still using the same blocking put/take model.
- Implementing a direct handoff — a producer's item goes straight to a waiting consumer, with no intermediate storage at all.
- Safely transferring a mutable object from one thread to exactly one other thread without adding a lock around the object itself.

## Deep Dive

### The producer-consumer pattern and why BlockingQueue makes it trivial

A producer identifies work; a consumer executes it. Wiring them together with a `BlockingQueue` means neither side calls the other directly — both only ever talk to the queue:

```java
import java.util.concurrent.*;

class ProducerConsumerDemo {
  public static void main(String[] args) {
    BlockingQueue<String> queue = new LinkedBlockingQueue<>(10);

    Runnable producer = () -> {
      try {
        for (int i = 0; i < 5; i++) {
          String item = Thread.currentThread().getName() + "-item-" + i;
          queue.put(item); // blocks here if the queue is already full
        }
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
      }
    };

    Runnable consumer = () -> {
      try {
        while (true) {
          String item = queue.take(); // blocks here until an item exists
          System.out.println("processed " + item);
        }
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
      }
    };

    new Thread(producer, "producer-1").start();
    new Thread(producer, "producer-2").start();
    new Thread(consumer, "consumer").start();
  }
}
```

Neither producer knows the other exists, and the consumer knows nothing about either producer — all three only interact with `queue`. There is no shared counter, no `synchronized` block, and no manual `wait()`/`notify()` pair to get wrong; `put()` and `take()` already contain whatever internal coordination is needed. (The consumer's `while (true)` loop never exits on its own — a real program needs a way to stop it, such as an interrupt or a sentinel "poison pill" item, which is a separate concern from the queue itself.)

### Choosing an implementation

`BlockingQueue` is an interface; which class to construct depends on ordering and capacity needs:

```java
// Bounded FIFO, fixed-size array backing — good when the capacity is known
// up front and shouldn't grow, e.g. a buffer between a fast producer and a
// slower consumer.
BlockingQueue<Task> fixed = new ArrayBlockingQueue<>(256);

// FIFO, optionally bounded, linked-node backing — the general-purpose default;
// omit the capacity argument for an effectively unbounded queue.
BlockingQueue<Task> linked = new LinkedBlockingQueue<>(256);

// Orders by priority (Comparable or a Comparator), not arrival order — for
// processing urgent tasks before older, lower-priority ones.
BlockingQueue<Task> byPriority = new PriorityBlockingQueue<>(256, Comparator.comparingInt(Task::urgency));

// Zero capacity: put() doesn't return until a take() is there to receive the
// item directly, and vice versa — a pure handoff with no storage at all.
BlockingQueue<Task> handoff = new SynchronousQueue<>();
```

`SynchronousQueue` only makes sense when consumers are plentiful enough that a `put()` will nearly always find one already waiting — otherwise the producer just blocks with nothing queued to show for it.

### Why bounded queues matter

An unbounded queue never rejects a `put()`, which sounds convenient but just delays the real problem: if producers consistently outrun consumers, the queue grows without limit until the JVM runs out of heap.

```java
BlockingQueue<Task> unbounded = new LinkedBlockingQueue<>(); // no capacity argument
unbounded.put(task); // never blocks — if consumers can't keep up, this queue
                      // keeps growing until an OutOfMemoryError, later, elsewhere
```

A bounded queue turns that same imbalance into backpressure instead — the producer blocks the moment there's no more room, which is a form of self-regulation, not just a memory-saving detail:

```java
BlockingQueue<Task> bounded = new ArrayBlockingQueue<>(100); // capacity fixed at 100
bounded.put(task); // blocks here once 100 items are already queued, until a
                    // consumer take()s one and frees a slot — the producer
                    // literally cannot get further ahead of the consumers
```

`offer()` (with or without a timeout) is the non-blocking alternative on the same queue — it reports failure instead of waiting, useful for shedding load rather than pausing the producer.

### Serial thread confinement

Passing a mutable object through a blocking queue's `put()`/`take()` pair transfers ownership from the producer thread to the consumer thread. As long as the producer never touches the object again after `put()` returns, only one thread ever has access to it at a time — so the object needs no lock of its own, even though it isn't itself thread-safe.

```java
class MutableTask {
  private final StringBuilder log = new StringBuilder();
  void appendStep(String step) { log.append(step).append('\n'); }
}

BlockingQueue<MutableTask> queue = new LinkedBlockingQueue<>();

// producer thread
MutableTask task = new MutableTask();
task.appendStep("collected");
queue.put(task);          // ownership transfers to whichever thread take()s it
// the producer must not call task.appendStep(...) again after this line

// consumer thread
MutableTask received = queue.take();
received.appendStep("processed"); // safe: this thread now has exclusive access
```

`BlockingQueue`'s internal synchronization guarantees the consumer sees every write the producer made before the handoff — the same visibility guarantee safe publication always requires — without either side needing `synchronized` on `MutableTask` itself. `Deque` has a blocking cousin too — `BlockingDeque`, implemented by `LinkedBlockingDeque` — which supports the same put/take model at both ends and underlies work-stealing designs, where each consumer owns its own deque and only reaches into another's tail when its own is empty.

## Trade-offs

- **Unbounded queues trade blocking now for an `OutOfMemoryError` later** — nothing about `LinkedBlockingQueue()` (no-arg) stops a runaway producer; the mismatch between production and consumption rates doesn't disappear, it just becomes invisible until the heap fills:

  ```java
  BlockingQueue<Task> q = new LinkedBlockingQueue<>();
  // put() always succeeds immediately — the imbalance is silently accumulating
  ```
- **`SynchronousQueue` only works when a consumer is already waiting** — with no consumers ready, `put()` blocks with zero items stored anywhere, which is a very different failure mode than a queue that at least holds work while it waits:

  ```java
  BlockingQueue<Task> handoff = new SynchronousQueue<>();
  handoff.put(task); // blocks indefinitely if no thread is currently in take()
  ```
- **`PriorityBlockingQueue` is unbounded and gives up FIFO ordering** — items with equal priority have no guaranteed relative order, and like any unbounded queue it can still grow without limit if producers outpace consumers.
- **`put()` and `take()` declare `InterruptedException`, so every caller must decide how to respond to it** — swallowing the exception silently (an empty `catch` block) throws away the information that the thread was asked to stop; restoring the interrupt (`Thread.currentThread().interrupt()`) or propagating the checked exception are the two sound options, not ignoring it.
- **A consumer loop built on `take()` never exits by itself** — `while (true) { queue.take(); ... }` has no natural termination condition, so a real shutdown needs an explicit signal (interrupting the consumer thread, or having producers enqueue a recognizable "poison pill" item) that the queue itself does not provide.

## Documentation Links

- [BlockingQueue — java.util.concurrent](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/BlockingQueue.html) — doc
- [ArrayBlockingQueue — java.util.concurrent](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ArrayBlockingQueue.html) — doc
- [LinkedBlockingQueue — java.util.concurrent](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/LinkedBlockingQueue.html) — doc
- [PriorityBlockingQueue — java.util.concurrent](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/PriorityBlockingQueue.html) — doc
- [SynchronousQueue — java.util.concurrent](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/SynchronousQueue.html) — doc
- [BlockingDeque — java.util.concurrent](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/BlockingDeque.html) — doc
- [LinkedBlockingDeque — java.util.concurrent](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/LinkedBlockingDeque.html) — doc
