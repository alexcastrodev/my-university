---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- Explain, in one sentence, why the industry-wide shift to multicore chips (already covered in Computer Architecture) does not automatically make any existing program faster.
- State the scope of this discipline: programming models and design techniques for using many processors at once, as distinct from the hardware that provides those processors.
- Distinguish this discipline's tightly-coupled, synchronous parallelism from the loosely-coupled, failure-tolerant world of distributed systems (a later discipline).
- List the two families of hardware this discipline programs against: shared-memory multicore machines and distributed-memory clusters of machines.

## Context & Motivation

Computer Architecture ended its own story with a very specific historical fact: around 2004-2005, chipmakers hit a real physical wall (Pollack's Rule — performance scales only with the square root of added transistor logic, while power scales linearly with it) and pivoted, industry-wide, from making one core faster every year to putting more, simpler cores on the same chip. That discipline covered the hardware consequences of that pivot in detail: how multiple cores share memory, how cache coherence keeps their views of memory consistent, how false sharing turns a correctness protocol into a performance bug, and how SIMD lanes and GPU streaming multiprocessors push data-parallelism even further inside a single chip.

None of that hardware, by itself, makes a single-threaded program run any faster. A program written as one sequential stream of instructions uses exactly one of those cores, no matter how many others sit idle next to it. Herb Sutter's 2005 essay, cited in Computer Architecture's own capstone, named this precisely: "the free lunch is over" — for decades, software got faster for free as clock speeds rose, and that free ride ended the moment clock speed growth ended. Getting a program to actually use more than one core requires the programmer to explicitly say which parts of the computation can happen at the same time, and that explicit act — decomposing a problem into pieces that can run concurrently, and coordinating those pieces correctly — is what this discipline is entirely about.

This discipline sits between two others in the curriculum. On one side, `computer-architecture` already answered "what hardware exists to run things in parallel?" — multicore, cache coherence, SIMD, GPUs. On the other side, a later discipline, `distributed-systems-i`, will answer a related but genuinely different question: how do independent machines, connected by an unreliable network, that can each fail on their own, coordinate correctly? This discipline occupies the middle ground: a fixed, known set of processors — either the cores of one machine, sharing memory, or a small cluster of machines a programmer directly controls — cooperating synchronously on one computation, without the failure modes (partial failure, unbounded network delay, needing consensus about who's even still alive) that define distributed systems proper.

## Core Theory

### Two kinds of hardware to program against

The two memory architectures Computer Architecture already introduced set up the two programming worlds this discipline covers:

- **Shared memory**: every processor can directly read and write the same address space. Communication between processors is as simple as one writing a variable and another reading it — but that same simplicity is exactly what makes cache coherence and synchronization necessary, since two processors can now race to touch the same memory location.
- **Distributed memory**: each processor (in practice, each machine in a cluster) has its own private memory that no other processor can touch directly. Communication has to happen through explicit messages sent over a network — slower and more deliberate than a shared write, but with no possibility of two processors racing on the same memory location, because there is no such location.

This discipline's two major programming models map directly onto these two worlds: OpenMP, covered in the second half, targets shared memory; MPI, covered in the third, targets distributed memory. The next concept develops this hardware distinction — and a third, hybrid case — in more detail before either programming model is introduced.

### What "parallel" adds on top of "concurrent"

`programming-paradigms` already introduced concurrency at the concept level: shared-state versus message-passing, and race conditions as a hazard of the former. This discipline is not a re-teach of that material — it takes concurrency as already understood and asks a narrower, more concrete question: given a specific computational problem and a specific number of available processors, how should the work actually be split up, and what does splitting it up cost in communication and coordination? "Parallel" here specifically means multiple processors making simultaneous progress on one problem, which is a stronger and more specific claim than "concurrent," which only requires that operations can be interleaved correctly, without necessarily running at the same physical instant.

### What this discipline will build toward

The rest of this discipline follows a deliberate arc, matching how real parallel programming courses (Berkeley's CS267, LLNL's own training materials) are actually structured: first, the design vocabulary for splitting work (decomposition, granularity, load balancing); then the mathematics of how much splitting the work can actually help (Amdahl's Law, Gustafson's Law, strong and weak scaling); then two concrete, real, widely-used programming models that put that design vocabulary into practice — OpenMP for shared memory, MPI for distributed memory — ending with a capstone that ties the choice between them, and the GPU model already covered in Computer Architecture, into one real decision.

## Worked Examples

### Example 1: The same loop, sequential vs. thread-parallel

Consider a loop that computes the sum of squares of a large array:

```c
double sum_sequential(double *a, int n) {
    double sum = 0.0;
    for (int i = 0; i < n; i++) {
        sum += a[i] * a[i];
    }
    return sum;
}
```

On a single core, this runs in time proportional to `n`, using exactly one processor, no matter how many others the machine has. Later concepts in this discipline (OpenMP work-sharing) will show precisely how a one-line change to this same loop lets multiple threads compute partial sums concurrently and combine them — the transformation from "correct sequential code" to "correct parallel code" is the entire subject of this discipline's second cluster, not something that happens automatically just because the hardware has more cores.

### Example 2: Classifying a problem by its hardware target

Given three computational scenarios, classify which memory architecture (and later, which programming model) each one naturally targets:

```text
Scenario                                          Target
-------------------------------------------------  ------------------
Numerically simulate airflow over a wing, split    Distributed memory
  across 512 machines in a cluster, none sharing    (MPI)
  memory
Sum a 10-million-element array on one workstation  Shared memory
  with 16 cores                                     (OpenMP)
Apply the same brightness adjustment to every       SIMD / GPU
  pixel of a 4K image, independently                (already covered
                                                      in Computer
                                                      Architecture)
```

The pattern to notice: the hardware available (one machine's cores vs. a cluster of machines) and the shape of the problem (many small independent operations vs. a smaller number of coarser tasks) together determine which of this discipline's tools is the natural fit — a decision this discipline's capstone will return to directly, with the reasoning made explicit rather than assumed.

## Common Misconceptions & Pitfalls

- **"More cores automatically means a faster program."** A program has to be explicitly rewritten to use more than one core; a purely sequential program uses exactly one core regardless of how many sit idle next to it.
- **"Parallel and concurrent are the same thing."** Concurrency is about correctly interleaving operations that may or may not run at the same physical instant; parallelism specifically means multiple processors making literal simultaneous progress. A single-core machine can run concurrent code (via time-slicing) but cannot run anything in true parallel.
- **"This discipline is about distributed systems."** It is not — a small, fixed cluster under one programmer's control, communicating synchronously, is a fundamentally easier problem than the partial failures, unbounded delays, and consensus questions that define distributed systems, covered in a later, separate discipline.
- **"Shared memory means no coordination is needed."** The opposite is true — shared memory makes uncoordinated access easy to write and easy to get wrong (races, as already introduced in `programming-paradigms`); distributed memory forces coordination to be explicit through messages, which is more verbose but harder to get silently wrong.

## Summary

This discipline picks up exactly where Computer Architecture's multicore/SIMD/GPU material left off: given hardware capable of doing many things at once, how does a programmer actually decompose a problem, communicate between the pieces, and reason about how much speedup is even achievable? It targets two concrete hardware worlds — shared memory (one machine, many cores, a single address space) and distributed memory (many machines, no shared address space, explicit messages) — and stops short of the harder, failure-prone world of distributed systems proper, covered separately. The discipline builds in order: decomposition and design vocabulary, the performance mathematics that bounds what parallelism can achieve, then two real programming models (OpenMP, MPI) that put both into practice.

## Documentation Links

- [LLNL — Introduction to Parallel Computing Tutorial](https://hpc.llnl.gov/documentation/tutorials/introduction-parallel-computing-tutorial) — the primary source for this discipline's design vocabulary and performance concepts.
- [ACM/IEEE CS2013 — Parallel and Distributed Computing Knowledge Area](https://csed.acm.org/knowledge-areas-parallel-and-distributed-computing-pd-cs2013-version/) — curriculum guidelines confirming the scope and the parallel/distributed/concurrent terminology distinction used throughout.
