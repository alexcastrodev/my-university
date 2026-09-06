---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- Explain what a lock alone cannot do: let a thread wait efficiently for some condition other than "is this lock free" to become true.
- Describe a condition variable's two operations, `wait()` and `signal()`, and how `wait()` atomically releases the lock while going to sleep.
- Trace the classic producer-consumer problem and explain why checking the condition in a `while` loop, not an `if`, is required for correctness.
- Explain why a signaled thread must re-check its condition after waking, rather than assuming it is now true.

## Context & Motivation

Locks solve mutual exclusion, but they solve nothing about a different, equally common need: a thread that must wait until some *condition* becomes true — a queue is no longer empty, a buffer has room, a counter reaches zero — before it can usefully proceed. The previous concept's spin lock could technically be repurposed for this by spinning on the condition itself, but the worked example there already showed the real cost of spinning: burning CPU cycles doing nothing useful, potentially for a long time if the condition takes a while to become true. A **condition variable** is the tool built specifically for this case: it lets a thread go genuinely to sleep — consuming no CPU at all — until another thread explicitly signals that the condition might now hold.

## Core Theory

### The condition variable interface

A condition variable supports two core operations, always used together with an associated lock:

- **`wait(cv, lock)`** — called while holding `lock`. Atomically releases `lock` and puts the calling thread to sleep on `cv`, in one indivisible step; when the thread is later woken, it re-acquires `lock` before `wait()` returns.
- **`signal(cv)`** — wakes up one thread currently sleeping on `cv` (if any are waiting), allowing it to proceed once it can re-acquire the lock.

The atomicity of `wait()`'s release-and-sleep step is essential: if releasing the lock and going to sleep were two separate steps, a signal could arrive in the gap between them and be lost entirely, since nothing would yet be listening for it — precisely the kind of interleaving hazard the critical section problem concept already warned about, now reappearing in the waiting mechanism itself if it weren't built correctly.

### Why `wait()` must release the lock, and why atomically

A thread calling `wait()` is, by definition, already holding the lock protecting the shared state it's checking (that's how it safely checked the condition in the first place). If `wait()` simply blocked the thread *without* releasing the lock, no other thread could ever acquire that lock to change the shared state and eventually call `signal()` — the system would deadlock immediately, with the waiting thread holding a lock that nothing else can ever get to make progress on the condition it's waiting for. `wait()` therefore releases the lock as part of going to sleep, letting other threads proceed and eventually change the condition, then automatically re-acquires the lock once woken, so the thread resumes holding the lock again, exactly as if it had just returned from an ordinary `acquire()`.

### The producer-consumer problem

A classic scenario condition variables solve directly: one or more **producer** threads add items to a shared, bounded buffer; one or more **consumer** threads remove items from it. A producer must wait if the buffer is full; a consumer must wait if the buffer is empty. Two condition variables are typically used — one for "buffer not full" (producers wait on it), one for "buffer not empty" (consumers wait on it) — each paired with the single lock protecting the shared buffer state.

```mermaid
sequenceDiagram
    participant P as Producer thread
    participant L as Lock + buffer state
    participant C as Consumer thread
    P->>L: acquire(lock)
    P->>L: while (buffer full) wait(notFull, lock)
    P->>L: add item; signal(notEmpty)
    P->>L: release(lock)
    C->>L: acquire(lock)
    C->>L: while (buffer empty) wait(notEmpty, lock)
    C->>L: remove item; signal(notFull)
    C->>L: release(lock)
```

### Why the condition check must be a `while` loop, not an `if`

A subtle but critical correctness rule: after `wait()` returns (the thread has been woken and has re-acquired the lock), the thread must **re-check** the condition it was waiting for, using a `while` loop rather than a one-time `if` check — because being woken does not guarantee the condition is still true by the time this particular thread actually gets to run. Between the `signal()` call and this thread resuming, some *other* thread might have raced in, acquired the lock first, and changed the shared state back (a consumer might have grabbed the newly available item before this consumer got its turn, say). A `while` loop re-verifies the condition and goes back to sleep if it no longer holds; an `if` check would proceed incorrectly on a now-false assumption.

## Worked Examples

### Example 1: A correct producer, using a `while` loop

```c
void producer(void *arg) {
    while (1) {
        int item = produce_item();

        acquire(&lock);
        while (buffer_is_full()) {
            wait(&not_full, &lock);   // atomically: release lock, sleep;
                                       // on wake: re-acquire lock, then
                                       // loop back and re-check the condition
        }
        add_to_buffer(item);
        signal(&not_empty);           // wake a consumer, if any are waiting
        release(&lock);
    }
}
```

The `while (buffer_is_full())` loop, not a single `if`, is what guarantees correctness: even after being signaled and waking up, this producer re-checks whether the buffer is *actually* not full right now before proceeding to add its item — protecting against the case where another producer raced in and filled the buffer again in the meantime.

### Example 2: Tracing why `if` instead of `while` breaks under multiple consumers

Suppose two consumers, C1 and C2, are both waiting on `not_empty` because the buffer is empty, and a single producer adds exactly one item and calls `signal(&not_empty)`:

```text
t0: Producer adds 1 item, calls signal(not_empty) -- wakes ONE waiting consumer (say C1)
t1: C1 is woken, but before C1 actually runs and re-acquires the lock,
    suppose the OS instead schedules C2 first for some other reason
    (signal() only promises to wake a waiter -- not a specific execution order)
t2: If C2 uses "if (buffer_is_empty()) wait(...)" instead of "while", and C2
    somehow gets to check the buffer AFTER C1 already removed the item
    (a genuine race, depending on implementation details), C2 could proceed
    to remove_from_buffer() on an EMPTY buffer -- undefined/incorrect behavior.

With "while (buffer_is_empty()) wait(...)": C2 would re-check the condition
after any wake-up and correctly go back to sleep if the buffer is, in fact,
already empty again by the time C2 gets its turn.
```

This is precisely why OSTEP and virtually every real synchronization guide insist on re-checking the condition in a loop after `wait()` returns — a signal is only ever a hint that the condition *might* now be true, never a guarantee that it still is by the time a specific woken thread resumes.

### Example 3: The deadlock `wait()`'s atomicity prevents

Suppose, incorrectly, `wait()` were implemented as two separate steps — release the lock, *then* separately go to sleep — instead of one atomic operation:

```text
Consumer:  acquire(lock)
           check: buffer is empty
           release(lock)              <- lock released
           -- [GAP: a producer could add an item AND signal here] --
           go to sleep on not_empty   <- but the signal already happened
                                          and is now lost; nothing is
                                          listening for it anymore
```

If a producer's `signal()` lands exactly in that gap, the consumer sleeps forever, having missed the only wake-up call that would ever have been sent for that particular item — a classic **lost wake-up** bug. Because real `wait()` implementations perform the release-and-sleep as one atomic step (no gap exists in which a signal could be lost), this specific failure cannot happen — it is exactly what the atomicity requirement in this concept's Core Theory section is protecting against.

## Common Misconceptions & Pitfalls

- **"A condition variable is a substitute for a lock."** A condition variable is always used *together with* a lock, never instead of one — `wait()` requires the lock to already be held (so it can safely check the shared condition) and manages releasing/re-acquiring that same lock as part of its own operation.
- **"After `wait()` returns, the condition it was waiting for is guaranteed true."** It is not guaranteed — another thread may have changed the shared state again before this particular thread got scheduled after waking, which is exactly why the condition must be re-checked in a `while` loop, not assumed true from an `if` check.
- **"`signal()` wakes every thread waiting on the condition variable."** `signal()` (sometimes called `notify` in other APIs) wakes at most one waiting thread; waking *every* waiting thread is a different operation (often called `broadcast` or `notifyAll`), used when more than one waiter's condition might now hold simultaneously.
- **"Releasing the lock and going to sleep in `wait()` could just as well be two separate steps, for simplicity."** Splitting them creates a real window for a lost wake-up, as Example 3 traces concretely — the atomicity of that release-and-sleep step is a correctness requirement, not an implementation convenience.

## Summary

A condition variable lets a thread sleep — consuming no CPU, unlike the spinning already covered as locks' real cost — until another thread signals that some condition might now be true, always used together with a lock: `wait(cv, lock)` atomically releases the lock and sleeps, then re-acquires the lock once woken, and `signal(cv)` wakes one waiting thread. The classic producer-consumer problem shows the pattern in full: producers and consumers each wait on their own condition variable, always inside a `while` loop rather than a single `if`, because a woken thread's condition is not guaranteed still true by the time it actually resumes — another thread may have raced in first. The atomicity of `wait()`'s release-and-sleep step specifically prevents a lost wake-up, where a signal sent in the gap between releasing the lock and actually sleeping would otherwise vanish unheard. The next concept, semaphores, introduces a single, more general primitive that can express both mutual exclusion and this kind of condition-based waiting with one unified tool.

## Documentation Links

- [Arpaci-Dusseau — Operating Systems: Three Easy Pieces, "Condition Variables"](https://pages.cs.wisc.edu/~remzi/OSTEP/threads-cv.pdf) — the canonical treatment of condition variables, the producer-consumer problem, and the while-loop correctness rule this concept is built from.
- [UC Berkeley CS162 — Operating Systems and Systems Programming](https://cs162.org/) — course covering condition variables as the standard tool for condition-based thread coordination.
