---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- Describe round-robin scheduling: fixed time slices, cycling through ready jobs, with no need to know run times in advance.
- Compute response time and turnaround time for a concrete set of jobs under round-robin, and compare against SJF on the same jobs.
- Explain the tradeoff round-robin makes: excellent response time, at the cost of worse turnaround time than SJF for equivalent workloads.
- Explain how the choice of time-slice length itself trades response time against context-switch overhead.

## Context & Motivation

SJF's core weakness — needing to know each job's run time before it even starts — rules it out as a complete answer for a real, general-purpose scheduler. Round-robin (RR) sidesteps the problem entirely by asking a different question: instead of "which job is shortest?", it asks "how do we make sure every ready job gets *some* CPU time soon?" The answer is a fixed time slice — a scheduling quantum — and a rotation through every ready job, giving each one that slice before moving to the next. No job needs to declare its length up front; the scheduler simply keeps cycling.

This is the first policy in this discipline explicitly optimized for **response time** rather than turnaround time, and OSTEP's own numbers make the tradeoff vivid: round-robin can turn response time from something terrible under SJF into something close to instantaneous, while making average turnaround time measurably worse for the identical set of jobs. Neither policy is simply better — they optimize for different things, exactly as the goals-and-metrics concept predicted.

## Core Theory

### The round-robin rule

Round-robin runs each ready job for one fixed **time slice** (also called a scheduling quantum — commonly a few to tens of milliseconds in real systems), then, whether or not the job has finished, moves it to the back of the ready queue and gives the CPU to the next job in line. This cycle repeats until every job eventually finishes. Unlike SJF, round-robin needs no information about how long any job will take — it treats every ready job identically, one slice at a time, regardless of length.

### Why round-robin wins on response time

Because every ready job gets a turn within, at worst, one full pass through the entire ready queue, no job waits arbitrarily long before its *first* slice of CPU time — which is exactly what response time measures. Compare this to SJF (or FCFS), where a job could in principle sit in the queue for the entire duration of every job scheduled ahead of it before receiving any CPU time at all, if those jobs run all the way to completion first.

### Why round-robin loses on turnaround time

Running every job in small slices, rotating rather than completing one job before starting the next, means most jobs *finish* later than they would under a policy that ran short jobs to completion first (SJF). Rotating jobs also adds real overhead: each switch between jobs costs a context switch (the exact save/restore mechanism already covered), and that overhead is pure loss — time spent switching is time not spent computing any job's actual work. The shorter the time slice, the more total switches occur for the same total work, and the more of that overhead accumulates.

### The time-slice length tradeoff

Choosing the time slice itself is a tradeoff, independent of which jobs are running:

- **Too short** a slice makes response time excellent (every job gets a turn almost immediately), but the fraction of total time spent on context-switch overhead grows large relative to actual work done — amortization suffers, in the same spirit as the amortized-cost reasoning already covered for data structures in this platform's earlier disciplines, but working in the *wrong* direction here: too many switches means too little actual work gets done per switch.
- **Too long** a slice reduces overhead (fewer switches for the same total work) but starts to look more like FCFS — a job with a very long slice can make every other ready job wait nearly that entire slice before its own turn, degrading response time back toward FCFS's worst case.

Real systems pick a slice length — commonly in the low tens of milliseconds — as a practical middle ground between these two failure modes, informed by how long a typical context switch actually costs relative to how responsive the system needs to feel to a human.

## Worked Examples

### Example 1: Response time — round-robin vs. SJF, three equal-ish jobs

Three jobs A, B, C, each needing 5 units of CPU time, all arrive at time 0. Under SJF (equal lengths, so order is arbitrary — say A, B, C run to completion in that order):

```text
SJF-style (run to completion, in order A, B, C):
  A: starts 0,  completes 5,  response time 0
  B: starts 5,  completes 10, response time 5
  C: starts 10, completes 15, response time 10
  Average response time = (0 + 5 + 10) / 3 = 5
```

Under round-robin with a time slice of 1 unit, cycling A, B, C, A, B, C, ...:

```text
Round-robin (slice = 1):
  A: starts 0, response time 0
  B: starts 1, response time 1
  C: starts 2, response time 2
  Average response time = (0 + 1 + 2) / 3 = 1
```

Round-robin drops average response time from 5 to 1 for this workload — every job gets its very first slice of CPU time within the first three time units, rather than waiting for entire jobs ahead of it to finish completely.

### Example 2: Turnaround time — the cost of that improvement (ignoring switch overhead)

Continuing the same three 5-unit jobs, round-robin with slice = 1, ignoring context-switch overhead for clarity (each job needs 5 total slices, interleaved A, B, C, A, B, C, ... A, B, C):

```text
Round-robin (slice = 1, no overhead):
  A finishes on its 5th slice, at time 13 (its slices land at t=0,3,6,9,12, finishing at 13)
  B finishes on its 5th slice, at time 14
  C finishes on its 5th slice, at time 15
  Average turnaround = (13 + 14 + 15) / 3 = 14
```

Compare this to the SJF-style average turnaround for the same three jobs run to completion in order:

```text
SJF-style: A completes 5, B completes 10, C completes 15
  Average turnaround = (5 + 10 + 15) / 3 = 10
```

Average turnaround time is worse under round-robin (14 vs. 10) for the exact same total workload — precisely the tradeoff this concept's Learning Objectives describe: much better response time, worse turnaround time, using identical jobs.

### Example 3: Time-slice length and context-switch overhead

Suppose each context switch itself costs a fixed 1 unit of pure overhead (no job's work gets done during a switch), and a job needs 10 units of total CPU work. Compare two slice lengths:

```text
Slice = 1:  10 switches needed -> 10 units of overhead for 10 units of work
            (50% of elapsed time is pure overhead)

Slice = 10: 1 switch needed    -> 1 unit of overhead for 10 units of work
            (about 9% of elapsed time is overhead)
```

A shorter slice multiplies the number of switches (and thus the total overhead) for the same amount of real work — the same amortization logic that showed up when the platform's Data Structures disciplines covered why doubling capacity, rather than growing by one element, keeps dynamic-array resizing cheap on average: paying a fixed cost too often, relative to the useful work done between payments, is expensive regardless of the specific mechanism.

## Common Misconceptions & Pitfalls

- **"Round-robin is simply worse than SJF, since its average turnaround time is higher."** Round-robin is worse *on turnaround time* for workloads like the ones above, but dramatically better on response time — which metric matters depends entirely on the workload (interactive vs. batch), not on some absolute ranking of policies.
- **"A shorter time slice is always better because it improves response time."** A shorter slice does improve response time, but multiplies the number of context switches for the same total work, increasing the fraction of time spent on pure overhead rather than useful computation — there is a real cost, not just a benefit, to shrinking the slice.
- **"Round-robin needs to know how long each job will run, just like SJF."** It needs no such information — every ready job is treated identically, one fixed slice at a time, regardless of how long it ultimately takes to finish. This is precisely round-robin's practical advantage over SJF.
- **"If a job finishes in less than a full time slice, that wastes the rest of the slice."** A job that finishes (or blocks) before its slice is up simply gives up the CPU immediately — the scheduler moves on to the next ready job right away rather than idling out the remainder of the slice.

## Summary

Round-robin scheduling gives every ready job a fixed time slice in rotation, requiring no advance knowledge of job length — directly solving SJF's central practical limitation. This makes response time excellent, since every job gets its first slice of CPU time within roughly one pass through the ready queue, but worsens average turnaround time compared to running jobs to completion in a well-chosen order, since rotating between jobs delays each individual job's actual finish and adds real context-switch overhead. Choosing the time-slice length is itself a tradeoff: too short, and overhead from frequent switching dominates; too long, and round-robin starts to resemble FCFS, with correspondingly worse response time. Neither SJF nor round-robin, by itself, is a complete answer for a general-purpose OS — the next two concepts address, respectively, how to let urgent work jump ahead safely (priority scheduling) and how to approximate SJF's benefits without SJF's need for foreknowledge (multi-level feedback queues).

## Documentation Links

- [Arpaci-Dusseau — Operating Systems: Three Easy Pieces, "Scheduling: Introduction"](https://pages.cs.wisc.edu/~remzi/OSTEP/cpu-sched.pdf) — the canonical treatment of round-robin scheduling and its response-time/turnaround-time tradeoff this concept is built from.
- [ACM/IEEE CS2013 — Operating Systems Knowledge Area](https://csed.acm.org/knowledge-areas-operating-systems-os-cs2013-version/) — curriculum guidelines covering time-slicing and preemptive scheduling policy comparison.
