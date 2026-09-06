---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- Describe first-come-first-served (FCFS) scheduling and compute turnaround times for a concrete set of jobs run under it.
- Describe the convoy effect: how one long job running before several short ones inflates average turnaround time under FCFS.
- Describe shortest-job-first (SJF) scheduling and explain why it provably minimizes average turnaround time when all jobs arrive together.
- Explain the practical limitation of SJF (needing to know run times in advance) that motivates the later policies in this cluster.

## Context & Motivation

With the scheduling metrics from the previous concept fixed, the simplest possible policy is also the fairest-sounding one: run jobs in the order they arrive, exactly like a line at a store. This is **first-come-first-served (FCFS)**, and it has real virtues — it's simple to implement, and it never lets a job "cut in line." But OSTEP's own worked example shows a concrete scenario where this fairness-by-arrival-order actively produces terrible average turnaround time, a failure mode with a specific name: the **convoy effect**. The fix — **shortest-job-first (SJF)** — trades "fairness by arrival order" for "fairness by amount of work," and provably wins on average turnaround time under this concept's still-simplified assumptions, at a cost that becomes the running theme for the rest of this cluster.

## Core Theory

### First-come-first-served: simple, but vulnerable to one bad case

Under FCFS, jobs run strictly in arrival order, each to completion, before the next one starts. When jobs happen to be similar in length, FCFS performs reasonably — as the previous concept's Example 2 showed, equal-length jobs give the same average turnaround regardless of order. The trouble is entirely about what happens when job lengths differ.

### The convoy effect

Suppose one very long job happens to arrive just before several short ones. Under strict arrival-order scheduling, every one of those short jobs must wait for the entire long job to finish first — even though, individually, each short job needs only a tiny fraction of that time to complete on its own. OSTEP names this the **convoy effect**, drawing the analogy to a slow-moving vehicle on a highway forcing a long line of faster traffic to crawl along behind it, unable to pass. The short jobs are not slow — they are stuck behind something slow, purely because of when it happened to arrive.

### Shortest-job-first: fixing the convoy effect by reordering

SJF's rule is simple: among the jobs currently available to run, always run whichever one has the shortest remaining run time next. Under the simplified assumption that all jobs arrive at once and run to completion, this policy provably minimizes average turnaround time — a fact that follows from a general exchange argument (the same style of reasoning already used to prove greedy algorithms correct in this platform's `algorithms-software/algorithms` discipline): swapping any two adjacent jobs so the shorter one runs first can only decrease, never increase, the sum of turnaround times, because it decreases every job's wait time behind it in the queue while adding equally little in front. Repeating this swap until no shorter job is running after a longer one produces the shortest-first order, which must therefore be optimal for the sum (and hence the average).

### SJF's real limitation: it needs to know the future

SJF's optimality proof assumes the scheduler already knows each job's exact run time in advance. In practice, the OS usually does not know how long a process will run before it actually finishes or blocks — a process could be about to do one more millisecond of work, or an hour's worth, and nothing about the process itself declares this up front. This single limitation — not any flaw in the reasoning above — is what motivates every scheduling policy covered next in this discipline: round-robin sidesteps the need to know run times at all, and multi-level feedback queues later *estimate* likely job length from a process's recent, observed behavior rather than requiring it up front.

## Worked Examples

### Example 1: The convoy effect, with real numbers

Three jobs arrive together at time 0: A takes 100 units, B and C each take 10 units. Run under FCFS in arrival order A, B, C:

```text
Job   Run time   Starts   Completes   Turnaround
A     100        0        100         100
B     10         100      110         110
C     10         110      120         120

Average turnaround = (100 + 110 + 120) / 3 = 110
```

B and C, despite needing only 10 units of work each, end up with turnaround times of 110 and 120 — almost entirely spent waiting behind A, which had nothing to do with either of their actual workloads. This is the convoy effect made concrete.

### Example 2: The same three jobs under SJF

Same three jobs, same arrival time, reordered by SJF to run shortest-first: B, C, A.

```text
Job   Run time   Starts   Completes   Turnaround
B     10         0        10          10
C     10         10       20          20
A     100        20       120         120

Average turnaround = (10 + 20 + 120) / 3 = 50
```

Average turnaround drops from 110 (FCFS) to 50 (SJF) — more than half — using the exact same three jobs and the exact same total amount of work, purely by reordering to run short jobs first. A's own turnaround time is unchanged (it was always going to take 100 units once it starts, and it still finishes at 120 either way) — the entire improvement comes from B and C no longer being stuck behind it.

### Example 3: Why the exchange argument works, traced concretely

Take any schedule with a longer job immediately followed by a shorter one, and swap them. Before the swap, with job lengths 100 then 10, starting at time 0:

```text
Before swap:  100 first, then 10
  Job1 (100): turnaround 100
  Job2 (10):  turnaround 110
  Sum = 210

After swap:   10 first, then 100
  Job2 (10):  turnaround 10
  Job1 (100): turnaround 100
  Sum = 110
```

Swapping strictly decreased the sum of turnaround times (210 → 110) — the shorter job's own turnaround dropped sharply (110 → 10), while the longer job's turnaround stayed exactly the same (100 → 100, since it still needs to run for its full 100 units regardless of what ran before it). Repeating this argument for every adjacent inversion in any schedule shows shortest-first can never be beaten by a schedule containing even one "longer-before-shorter" adjacent pair — which is exactly the exchange-argument proof technique.

## Common Misconceptions & Pitfalls

- **"FCFS is unfair because it doesn't run jobs in a good order."** FCFS is fair in one specific, legitimate sense (never lets any job cut ahead of one that arrived earlier) — its problem is not unfairness but that this particular fairness rule can produce very poor *average* turnaround time when job lengths differ sharply, as the convoy effect shows.
- **"The convoy effect is about the long job itself running slowly."** The long job's own turnaround time is unaffected by what runs before or after it (it always needs its full run time). The convoy effect is specifically about *short* jobs being forced to wait behind a long one they have nothing to do with.
- **"SJF is provably optimal, so real operating systems should just use it."** SJF's optimality proof depends on knowing every job's exact run time in advance — information a real OS generally does not have for a process that hasn't finished (or even started) running yet. This practical gap, not a flaw in the math, is why real schedulers use different policies.
- **"Shortest-job-first is the same as round-robin with very short time slices."** They are different policies with different assumptions: SJF runs a chosen job to completion once selected and requires knowing run times up front; round-robin (the next concept) runs every job for a bounded slice and cycles through them, needing no advance knowledge of run time at all.

## Summary

First-come-first-served scheduling is simple and preserves arrival-order fairness, but is vulnerable to the **convoy effect**: a single long job arriving before several short ones forces every short job to wait out the long one's entire run time, dramatically inflating average turnaround time even though the short jobs individually need very little work. Shortest-job-first fixes this by always running whichever available job has the least remaining work, and — under the assumption that all jobs arrive together — provably minimizes average turnaround time via an exchange argument: swapping any longer-before-shorter adjacent pair can only reduce the total. SJF's real limitation is needing to know each job's run time in advance, information a real scheduler rarely has — a gap the next two concepts address directly, first by discarding the need for foreknowledge entirely (round-robin), then by inferring likely job behavior from what's actually been observed (multi-level feedback queues).

## Documentation Links

- [Arpaci-Dusseau — Operating Systems: Three Easy Pieces, "Scheduling: Introduction"](https://pages.cs.wisc.edu/~remzi/OSTEP/cpu-sched.pdf) — the canonical treatment of FCFS, the convoy effect, and SJF this concept is built from.
- [UC Berkeley CS162 — Operating Systems and Systems Programming](https://cs162.org/) — course covering the same scheduling policy comparisons as part of its systems foundations.
