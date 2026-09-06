---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- Define a critical section as any code that accesses shared state in a way that must not be interleaved with another thread's access to that same state.
- State the three properties any correct solution to the critical section problem must guarantee: mutual exclusion, progress, and bounded waiting.
- Trace, at the instruction level, how an unsynchronized increment of a shared variable can produce a wrong final result.
- Explain why "just don't context-switch during a critical section" is not, by itself, a complete or sufficient solution.

## Context & Motivation

The previous concept established that threads genuinely share memory, and that this sharing is exactly what makes race conditions physically possible rather than hypothetical. This concept gives that hazard its formal name: the **critical section problem** — identifying precisely which code is dangerous (any code touching shared state whose interleaving with another thread's access could produce a wrong result) and precisely what a correct fix must guarantee. Every synchronization tool covered later in this cluster — locks, condition variables, semaphores — exists to solve this one formally-stated problem; naming it precisely here is what lets the later concepts be evaluated against a clear standard rather than vague intuition.

## Core Theory

### What is a critical section

A **critical section** is a piece of code that accesses one or more pieces of shared state (a shared variable, a shared data structure, a shared file) in a way where two threads executing it *at overlapping times* could interfere with each other's results. The `counter++` line from the previous concept's worked example is a textbook critical section: it reads a shared variable, computes a new value, and writes it back — three separate steps at the machine level, any of which could be interrupted by another thread doing the same three steps to the same variable.

### The three required properties

A correct solution to the critical section problem — whatever specific mechanism is used to build it — must guarantee all three of the following simultaneously:

1. **Mutual exclusion.** At most one thread may be executing inside the critical section at any given time. This is the core safety property: it directly prevents the interleaving that causes race conditions.
2. **Progress.** If no thread is currently in the critical section, and one or more threads want to enter, the decision of who enters next cannot be postponed indefinitely by threads that are *not* trying to enter — in other words, the system as a whole must keep making progress, not deadlock or livelock over the question of who goes next.
3. **Bounded waiting.** There must be a limit on how many times other threads can enter the critical section after a given thread has requested entry but before that request is granted — no thread can be forced to wait forever while other threads repeatedly cut in front of it. This is exactly the starvation concern already met in the scheduling cluster, now stated as a formal requirement for synchronization correctness rather than a scheduling nicety.

A synchronization mechanism that provides mutual exclusion but permits indefinite starvation of some thread has only solved part of the problem — all three properties together define full correctness here.

### Why "just prevent context switches" isn't the whole answer

One instinct is to eliminate the danger by disabling interrupts (or otherwise preventing a context switch) for the duration of a critical section — if the running thread can't be paused mid-way through `counter++`, no other thread can interleave with it. This genuinely works on a single-CPU machine for very short critical sections, and real kernels do use exactly this trick internally in narrow, controlled circumstances. It fails as a general-purpose solution for two real reasons: it does nothing on multi-core hardware, where a *different* thread can be genuinely executing on a different core at the same physical instant, with no context switch involved at all (as the previous concept's Example 3 showed); and letting arbitrary user-level code disable interrupts is a serious safety hazard — a buggy or malicious program could disable interrupts and never re-enable them, freezing the entire machine. This is exactly why the next concept turns to hardware-provided **atomic instructions** instead: mechanisms that work correctly on multiple cores simultaneously, without handing any single thread the power to halt the whole system.

## Worked Examples

### Example 1: `counter++` traced at the instruction level

The single line `counter++` typically compiles to three separate machine steps:

```text
LOAD  R1, counter     ; read the shared variable into a register
ADD   R1, R1, 1       ; increment the register's value
STORE counter, R1     ; write the new value back to memory
```

If thread A executes `LOAD` and `ADD` (now holding `counter + 1` in its own register) and is then interrupted before its `STORE`, and thread B runs the *entire* sequence to completion in between, then A resumes and executes its own `STORE` — A's `STORE` overwrites B's update using a stale value A had computed before B ever ran, silently losing B's increment.

### Example 2: A concrete interleaving that loses an update

Starting with `counter = 0`, both threads intend to increment it once:

```text
Time  Thread A                    Thread B                    counter
t0    LOAD R1, counter (R1=0)                                 0
t1                                LOAD R1, counter (R1=0)     0
t2    ADD  R1, R1, 1  (R1=1)                                  0
t3                                ADD  R1, R1, 1  (R1=1)      0
t4    STORE counter, R1 (=1)                                  1
t5                                STORE counter, R1 (=1)      1
```

Both threads intended to increment `counter`, so the correct final result is 2 — but the actual result is 1, because both threads read the same stale value (0) before either one wrote back, and B's `STORE` simply overwrites A's identical result rather than building on it. Neither thread did anything individually wrong; the wrong result is purely a consequence of the interleaving.

### Example 3: Checking a proposed "fix" against all three properties

Suppose a naive fix uses a single shared flag: a thread sets `flag = 1` before entering the critical section and resets it to `0` on exit, with every thread spinning on `while (flag == 1) { }` before trying to set it.

```text
Mutual exclusion?  Broken -- the check (while flag==1) and the set
                   (flag = 1) are themselves two separate, non-atomic
                   steps, so two threads can both see flag==0 and both
                   proceed to set it and enter, at the same time.
```

This single flaw is enough to disqualify the whole scheme, regardless of how it performs on progress or bounded waiting — a correct solution must satisfy mutual exclusion unconditionally, which is exactly why the next concept turns to hardware-provided *atomic* instructions (test-and-set, compare-and-swap) rather than ordinary load/store pairs, which this example shows are not sufficient by themselves.

## Common Misconceptions & Pitfalls

- **"A critical section is any code that uses a shared variable at all."** A critical section specifically means code whose *interleaving* with another thread accessing the same shared state could produce an incorrect result — code that only ever *reads* a value that never changes, for instance, needs no such protection even though it touches shared state.
- **"Mutual exclusion alone is a complete solution to the critical section problem."** Mutual exclusion is necessary but not sufficient — a solution that grants exclusive access but lets one thread wait forever (violating bounded waiting) or that can deadlock entirely (violating progress) has not solved the full problem as formally defined here.
- **"Disabling interrupts is a general, sufficient solution to the critical section problem."** It does nothing to prevent interference from a thread genuinely running on a *different* physical core at the same instant, and handing ordinary programs the ability to disable interrupts is itself a serious hazard — this is a narrow, kernel-internal trick, not the general answer.
- **"If a race condition only shows up rarely in testing, the code is probably fine."** A critical section without correct protection is unsafe regardless of how rarely the dangerous interleaving actually manifests — Example 2's lost update can happen on some runs and not others, purely depending on unpredictable scheduling timing, which is exactly what makes concurrency bugs notoriously hard to catch through testing alone.

## Summary

A critical section is any code accessing shared state in a way where two threads' overlapping execution could interfere with each other's results, and a correct solution to this **critical section problem** must guarantee three properties together: **mutual exclusion** (at most one thread inside at a time), **progress** (the choice of who enters next can't be indefinitely postponed by uninterested threads), and **bounded waiting** (no thread can be starved by others repeatedly cutting in line). Tracing `counter++` at the instruction level shows exactly how an ordinary-looking increment is really three separate, interruptible steps, and a concrete interleaving can silently lose an update with neither thread doing anything individually wrong. Simple fixes built from ordinary load/store operations (like a shared flag) fail to guarantee mutual exclusion, because the check-then-set sequence is itself not atomic — motivating the next concept's turn to hardware-provided atomic instructions as the actual foundation locks are built on.

## Documentation Links

- [Arpaci-Dusseau — Operating Systems: Three Easy Pieces, "Concurrency: An Introduction"](https://pages.cs.wisc.edu/~remzi/OSTEP/threads-intro.pdf) — the canonical treatment of the critical section problem and its required properties this concept is built from.
- [ACM/IEEE CS2013 — Operating Systems Knowledge Area](https://csed.acm.org/knowledge-areas-operating-systems-os-cs2013-version/) — curriculum guidelines establishing mutual exclusion and atomic access to shared OS objects as core Operating Systems content.
