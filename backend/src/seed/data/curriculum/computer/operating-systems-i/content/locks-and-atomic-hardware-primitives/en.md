---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- Define a lock's interface (`acquire`/`release`) and what it guarantees: only one thread holds the lock at a time.
- Explain why a lock's own implementation cannot be built from ordinary load/store instructions, and what test-and-set provides instead.
- Trace how test-and-set, as a single hardware-guaranteed atomic instruction, correctly implements mutual exclusion where the naive flag from the previous concept failed.
- Distinguish a spin lock (busy-waiting) from the cost of spinning, and connect this cost to why condition variables (the next concept) are needed for longer waits.

## Context & Motivation

The previous concept showed that a lock built from ordinary load and store instructions cannot correctly provide mutual exclusion — the check-then-set sequence is itself not atomic, so two threads can both slip through the check at the same time. The fix isn't a cleverer arrangement of ordinary instructions; it's a fundamentally different building block: hardware manufacturers provide special **atomic instructions** — operations the CPU itself guarantees complete as a single, indivisible step, with no other core able to observe or interfere partway through. **Locks** are built directly on top of these atomic primitives, and understanding that foundation is what makes it clear why a lock actually works where a naive flag did not.

## Core Theory

### The lock interface

A lock provides exactly two operations: `acquire()`, which a thread calls before entering a critical section (blocking, if necessary, until the lock is available), and `release()`, called after leaving the critical section, making the lock available to some other waiting thread. Code between a matched `acquire()`/`release()` pair is, by construction, a critical section protected by that lock — at most one thread can be executing between its own `acquire()` and `release()` on the same lock at any time, which is precisely the mutual-exclusion property the previous concept required.

```text
acquire(&lock);
    counter++;          // critical section: protected by the lock
release(&lock);
```

### Test-and-set: one hardware instruction, done atomically

**Test-and-set** is a single CPU instruction that, as one indivisible hardware-guaranteed step, reads the old value of a memory location *and* writes a new value into it, returning the old value to the caller. Because the CPU guarantees no other core can observe or interleave with this instruction partway through, it closes exactly the gap that broke the naive flag from the previous concept — there, "check the flag" and "set the flag" were two separate, interruptible instructions; test-and-set does both as one instruction the hardware itself protects.

```text
// Conceptual behavior of test-and-set(ptr, new_value):
int test_and_set(int *ptr, int new_value) {
    int old_value = *ptr;   // these two steps happen as ONE
    *ptr = new_value;       // atomic, indivisible hardware operation
    return old_value;
}
```

A simple spin lock built on test-and-set:

```c
void acquire(int *lock) {
    while (test_and_set(lock, 1) == 1) {
        // lock was already held (old value 1) -- keep spinning
    }
    // test_and_set returned 0: lock was free, and we just set it to 1
    // atomically, so we now correctly hold it
}

void release(int *lock) {
    *lock = 0;
}
```

The key correctness argument: exactly one thread's call to `test_and_set` can be the one that observes the old value `0` (lock was free) — because the instruction is atomic, no two threads can both see `0` and both proceed as if they'd acquired the lock, unlike the naive check-then-set flag from the previous concept.

### Compare-and-swap: a more general atomic primitive

**Compare-and-swap (CAS)** generalizes test-and-set: it atomically checks whether a memory location currently holds an *expected* value, and if so, replaces it with a *new* value, again as one indivisible hardware step, returning whether the swap succeeded. CAS is more flexible than test-and-set because the "expected value" can be anything, not just a fixed constant — it is the primitive many lock-free data structures and higher-level synchronization tools are built from, and it is the same atomic-instruction family already introduced from the hardware side in this platform's `computer/computer-architecture` discipline's coverage of multicore memory coherence.

### Spinning: correct, but potentially wasteful

The lock implementation above **spins** — a thread that can't immediately acquire the lock loops, repeatedly retrying, rather than giving up the CPU. On a single core, spinning while another thread holds the lock is pure waste: the spinning thread makes no progress and prevents the *lock-holding* thread from running at all (until a timer interrupt eventually forces a switch), delaying exactly the thing the spinning thread is waiting for. On multiple cores, spinning can make sense for very short critical sections (the lock will likely be released very soon, and spinning avoids a comparatively expensive context switch) — but for critical sections that might hold the lock for a long time, or for waiting on conditions other than "is this lock free," spinning becomes wasteful in a different way, motivating the next concept's alternative: condition variables let a thread genuinely go to sleep (not spin) and be woken only when the condition it's waiting for is actually true.

## Worked Examples

### Example 1: Why test-and-set succeeds where the naive flag failed

Recall the previous concept's failure: `while (flag == 1) {}` then `flag = 1` are two separate instructions, letting two threads both observe `flag == 0` before either sets it. With test-and-set:

```text
Thread A: test_and_set(&lock, 1)  -- atomically reads 0, writes 1, returns 0
          A sees return value 0 -> A holds the lock

Thread B (even if it calls test_and_set at nearly the same instant):
          test_and_set(&lock, 1) -- atomically reads whatever A just wrote (1),
                                    writes 1 again (no-op), returns 1
          B sees return value 1 -> B knows the lock was already held, keeps spinning
```

Because the read-and-write inside test-and-set cannot be split by another core's interleaved access, there is no possible timing where both A and B observe the "lock was free" outcome — exactly the guarantee the naive flag could not provide.

### Example 2: A correctly protected `counter++` using the lock above

```c
int counter = 0;
int lock = 0;

void *increment(void *arg) {
    for (int i = 0; i < 100000; i++) {
        acquire(&lock);
        counter++;        // now provably safe: only one thread at a time
        release(&lock);
    }
    return NULL;
}
```

Unlike the unprotected version from the previous two concepts, every `counter++` here happens strictly between one thread's `acquire` and `release` — no other thread's `test_and_set` can succeed in acquiring the lock until this thread calls `release`, so the three-instruction `LOAD`/`ADD`/`STORE` sequence can never be interleaved with another thread's identical sequence. Running this version with two threads reliably produces exactly 200000, every time.

### Example 3: Spinning cost on a single core, concretely

Suppose thread A holds the lock and is about to be preempted by a timer interrupt after using its full time slice, and thread B is spinning, waiting for that same lock, on the identical single core:

```text
t=0..10:  A holds the lock, doing useful work inside the critical section
t=10:     Timer interrupt -- scheduler picks B next (round-robin, say)
t=10..20: B runs, but B is just spinning (test_and_set keeps failing,
          since A still holds the lock) -- ZERO useful work gets done
          during this entire slice
t=20:     Timer interrupt -- scheduler picks A again
t=20..25: A finishes its critical section, calls release()
```

B's entire time slice from t=10 to t=20 accomplished nothing except burning CPU cycles that could have gone to A (who actually holds the lock and would finish sooner if simply left running) — a full 10 units of pure waste, directly motivating why a thread with a potentially long wait should sleep rather than spin, the subject of the next concept.

## Common Misconceptions & Pitfalls

- **"A lock is just a shared boolean variable, checked and set with ordinary code."** The previous concept showed exactly why ordinary load/store cannot implement a correct lock — a real lock's `acquire()` is built on a hardware-guaranteed atomic instruction (test-and-set or compare-and-swap), not on an unprotected check-then-set sequence.
- **"Test-and-set and compare-and-swap are software techniques."** Both are specific CPU instructions, guaranteed atomic by the hardware itself — no software-only sequence of ordinary instructions can provide the same guarantee, which is exactly why dedicated hardware support exists.
- **"Spinning is always wasteful and should never be used."** For very short critical sections, especially on multi-core hardware where the lock is likely to be released almost immediately, spinning can outperform the overhead of a full context switch to sleep and later be woken — the tradeoff depends on how long the wait is likely to be, not a blanket rule.
- **"Once a thread acquires a lock via test-and-set, the lock guarantees fairness (bounded waiting) automatically."** The simple spin lock shown here guarantees mutual exclusion, but says nothing about *which* waiting thread gets the lock next when it's released — a naive implementation can, in principle, let some threads wait much longer than others; guaranteeing bounded waiting typically requires additional structure (such as a queue of waiters), not just an atomic instruction.

## Summary

A lock provides `acquire()`/`release()`, guaranteeing mutual exclusion for whatever code runs between them — but a correct lock cannot be built from ordinary load/store instructions, because the previous concept showed exactly how a check-then-set sequence lets two threads both slip through. The fix is a hardware-guaranteed **atomic instruction** — test-and-set, which atomically reads and overwrites a memory location as one indivisible step, or the more general compare-and-swap — closing the gap that broke the naive flag. A lock built this way genuinely works, as traced in the worked examples, but a thread that can't immediately acquire it must decide how to wait: **spinning** (busy-looping) wastes CPU cycles that could go to the lock's actual holder, especially costly on a single core or for potentially long waits — motivating the next concept, condition variables, which let a thread sleep instead of spin and be woken precisely when the condition it needs is true.

## Documentation Links

- [Arpaci-Dusseau — Operating Systems: Three Easy Pieces, "Locks"](https://pages.cs.wisc.edu/~remzi/OSTEP/threads-locks.pdf) — the canonical treatment of lock implementation and atomic hardware primitives this concept is built from.
- [UC Berkeley CS162 — Operating Systems and Systems Programming](https://cs162.org/) — course covering test-and-set, compare-and-swap, and spin locks as the hardware foundation of synchronization.
