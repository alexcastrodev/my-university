---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- Define a semaphore as an integer counter with two atomic operations, `wait` (decrement) and `signal` (increment), that blocks a thread when the counter would go negative.
- Show how a binary semaphore (initialized to 1) implements exactly the same mutual exclusion a lock provides.
- Show how a counting semaphore (initialized to N) implements a bound on how many threads may proceed at once, generalizing beyond simple mutual exclusion.
- Use a semaphore to solve the producer-consumer problem, and compare the result to the lock-plus-condition-variable solution from the previous concept.

## Context & Motivation

Locks solve mutual exclusion; condition variables solve waiting for an arbitrary condition — but using them correctly together, as the producer-consumer example showed, requires care (a lock, two condition variables, and while-loop rechecking, all coordinated by hand). Edsger Dijkstra's **semaphore**, introduced decades before locks and condition variables were formalized as separate primitives, is a single tool general enough to express both jobs: an integer counter with two atomic operations, traditionally named `P` (from the Dutch *proberen*, "to test," now more commonly called `wait`) and `V` (*verhogen*, "to increase," now more commonly `signal`). The remarkable thing about the semaphore, as this concept shows concretely, is that the *same* two operations, differing only in the counter's initial value, can implement either a lock or a producer-consumer buffer's bounded-waiting logic.

## Core Theory

### The semaphore's two operations

A semaphore holds a single integer value and supports:

- **`wait(s)`** (decrement): atomically decrements the semaphore's value; if the resulting value is negative, the calling thread blocks until some other thread calls `signal`.
- **`signal(s)`** (increment): atomically increments the semaphore's value; if any threads are blocked waiting, one of them is woken.

Both operations are guaranteed atomic by the semaphore's own implementation (built, ultimately, on the same kind of hardware atomic instructions or lock-protected internal state already covered for locks) — a thread never needs to worry about its own call to `wait` or `signal` being interrupted partway through.

### Binary semaphores: exactly a lock

Initialize a semaphore to `1` and use it around a critical section exactly like a lock:

```c
sem_t lock;
sem_init(&lock, 1);   // initial value 1

wait(&lock);      // decrements to 0 if free; if already 0, decrements
                   // to -1 and blocks (someone else holds it)
    counter++;     // critical section
signal(&lock);     // increments back toward 1, waking a blocked thread if any
```

The first thread to call `wait` decrements the semaphore from 1 to 0 and proceeds (no block, since the value didn't go negative). A second thread calling `wait` before the first calls `signal` decrements from 0 to −1 and blocks. When the first thread calls `signal`, the value increments from −1 back to 0, and the blocked thread is woken — exactly reproducing a lock's `acquire`/`release` mutual-exclusion behavior, with `wait` playing the role of `acquire` and `signal` playing the role of `release`.

### Counting semaphores: bounding how many threads proceed at once

Initialize a semaphore to some value `N > 1`, and the *same* two operations now bound how many threads may be "inside" simultaneously to at most `N`, rather than exactly 1:

```c
sem_t pool;
sem_init(&pool, 5);   // at most 5 threads may hold a connection at once

wait(&pool);      // proceeds if fewer than 5 are currently "checked out";
                   // blocks once the 5th is already out and a 6th tries
    use_connection();
signal(&pool);     // returns a slot, waking a blocked thread if any
```

This is a genuine generalization a plain lock cannot express on its own — a lock is inherently a "1 at a time" tool, while a counting semaphore with initial value `N` naturally limits concurrent access to a resource pool of size `N` (a fixed number of database connections, a fixed number of worker slots), using the identical `wait`/`signal` interface as the mutual-exclusion case, differing only in the starting count.

### Semaphores as condition-variable-style waiting

Because `wait` blocks a thread whenever the counter would go negative, a semaphore initialized to `0` can express "wait until someone else says this is ready" directly — a thread calls `wait` and blocks immediately (0 decrements to −1), until another thread's `signal` releases it. This is functionally similar to a condition variable's `wait`/`signal` pair, but with the counting built directly into the semaphore's own state rather than requiring a separately-tracked boolean condition checked under a lock.

## Worked Examples

### Example 1: Producer-consumer using two counting semaphores

```c
sem_t empty, full;
sem_init(&empty, BUFFER_SIZE);   // starts at N: N empty slots available
sem_init(&full, 0);               // starts at 0: no full slots yet

void producer() {
    while (1) {
        int item = produce_item();
        wait(&empty);          // block if buffer has 0 empty slots
        add_to_buffer(item);
        signal(&full);         // one more full slot now exists
    }
}

void consumer() {
    while (1) {
        wait(&full);           // block if buffer has 0 full slots
        int item = remove_from_buffer();
        signal(&empty);        // one more empty slot now exists
        consume_item(item);
    }
}
```

`empty` starts at `BUFFER_SIZE` and is decremented by producers (who need an empty slot to fill) and incremented by consumers (who free one up); `full` starts at `0` and is decremented by consumers (who need a full slot to remove) and incremented by producers (who create one). A producer blocks automatically once the buffer is completely full (`empty` has been decremented down to where it would go negative); a consumer blocks automatically once the buffer is completely empty (`full` would go negative) — the bounded-waiting logic that required an explicit `while`-loop condition check under a lock in the previous concept falls directly out of the semaphores' own counting here.

### Example 2: Tracing values through a small buffer (size 2)

Starting state: `empty = 2`, `full = 0`, buffer has 0 items.

```text
Producer adds item 1: wait(empty) -> empty=1; add item; signal(full) -> full=1
Producer adds item 2: wait(empty) -> empty=0; add item; signal(full) -> full=2
Producer tries item 3: wait(empty) -> would go to -1 -> BLOCKS (buffer full)

Consumer removes item 1: wait(full) -> full=1; remove item; signal(empty) -> empty=1
  -- this signal(empty) wakes the blocked producer from above, which
     now successfully completes its wait(empty), decrementing empty to 0
```

The producer's block and the consumer's eventual unblock of it happen purely through the semaphore counters crossing zero in each direction — no explicit shared "is the buffer full" flag needs to be separately checked, unlike the condition-variable version's `while (buffer_is_full())`.

### Example 3: Semaphore vs. lock-plus-condition-variable, side by side

```text
Lock + condition variables (previous concept):
  - 1 lock protecting shared buffer state directly
  - 2 condition variables (not_full, not_empty)
  - Explicit while-loop re-check of buffer_is_full()/buffer_is_empty()
    after every wait()

Semaphores (this concept):
  - 2 counting semaphores (empty, full) whose own internal counts
    directly represent "how many empty/full slots exist"
  - No separate while-loop condition check needed -- the semaphore's
    wait() operation itself blocks exactly when the count would go
    negative, which IS the condition
```

Both solve the identical producer-consumer problem correctly; the semaphore version folds the condition check directly into the counter's own semantics, while the lock-and-condition-variable version keeps the condition as an explicit, separately-checked boolean expression — a real design choice with implications for readability and for how naturally the solution generalizes (a counting semaphore capturing "N slots" is often a more direct fit than a boolean condition checked in a loop).

## Common Misconceptions & Pitfalls

- **"A semaphore is fundamentally different from a lock."** A binary semaphore (initial value 1) behaves exactly like a lock — `wait` and `signal` reproduce `acquire` and `release` precisely, as the first worked example traces. A semaphore is a generalization, not an unrelated alternative.
- **"Semaphores replace the need for locks in every situation."** Semaphores can express mutual exclusion, but a plain mutex lock is often simpler and clearer when that's genuinely all that's needed — semaphores earn their complexity specifically when counting (bounding concurrent access to N resources) is the actual requirement.
- **"`wait` always blocks the calling thread."** `wait` only blocks if decrementing the semaphore's value would make it negative — if the value is still zero or positive after decrementing, the thread proceeds immediately without blocking, exactly like the first successful call in the binary-semaphore lock example.
- **"Initializing a counting semaphore to a large number has no real effect."** The initial value directly determines how many threads can proceed concurrently before any of them block — initializing to 1 gives lock-like exclusive access; initializing to N genuinely allows up to N threads through at once, a real, consequential design decision, not a cosmetic detail.

## Summary

A semaphore is Dijkstra's single, general synchronization primitive: an integer counter with two atomic operations, `wait` (decrement, blocking if the result would be negative) and `signal` (increment, waking a blocked thread if any). Initialized to 1, it behaves exactly like a lock, providing mutual exclusion; initialized to N, the identical two operations bound concurrent access to at most N threads at once — a genuine generalization beyond what a plain lock can express. Applied to the producer-consumer problem, two counting semaphores (`empty` and `full`) fold the buffer's fullness/emptiness condition directly into the semaphores' own counts, avoiding the explicit while-loop condition-checking the lock-and-condition-variable solution required. With mutual exclusion (locks), condition-based waiting (condition variables), and this single general counting primitive (semaphores) all covered, the next concept turns to a failure mode that becomes possible only once multiple locks or semaphores are combined: deadlock, where threads wait on each other in a cycle, forever.

## Documentation Links

- [Arpaci-Dusseau — Operating Systems: Three Easy Pieces, "Semaphores"](https://pages.cs.wisc.edu/~remzi/OSTEP/threads-sema.pdf) — the canonical treatment of semaphores, their two forms, and the producer-consumer solution this concept is built from.
- [ACM/IEEE CS2013 — Operating Systems Knowledge Area](https://csed.acm.org/knowledge-areas-operating-systems-os-cs2013-version/) — curriculum guidelines covering semaphores as a core synchronization primitive.
