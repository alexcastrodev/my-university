---
title: "Scheduler Activations: Effective Kernel Support for the User-Level Management of Parallelism"
summary: The paper argues that user-level threads are fast but break under I/O, page faults and multiprogramming, and that kernel threads are the wrong abstraction to fix it. It proposes a kernel interface, scheduler activations, that gives each address space a virtual multiprocessor and tells its user-level scheduler about every kernel event through upcalls.
researchArea: Operating Systems
keywords: scheduler activations, user-level threads, upcalls, kernel threads, virtual multiprocessor, processor allocation, critical sections
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

Threads are the vehicle for concurrency in many approaches to parallel programming. Threads can be supported either by the operating system kernel or by user-level library code in the application address space, but neither approach has been fully satisfactory. This paper addresses this dilemma. First, we argue that the performance of kernel threads is inherently worse than that of user-level threads, rather than this being an artifact of existing implementations; managing parallelism at the user level is essential to high-performance parallel computing. Next, we argue that the problems encountered in integrating user-level threads with other system services is a consequence of the lack of kernel support for user-level threads provided by contemporary multiprocessor operating systems; kernel threads are the wrong abstraction on which to support user-level management of parallelism. Finally, we describe the design, implementation, and performance of a new kernel interface and user-level thread package that together provide the same functionality as kernel threads without compromising the performance and flexibility advantages of user-level management of parallelism.

## Overview

By the early 1990s, shared-memory multiprocessors were becoming common, and programmers expressed parallelism with threads instead of heavy UNIX-style processes. Threads could live in the kernel (Mach, Topaz, V) or in a library inside the application (PCR, FastThreads). The paper starts from the observation that each choice fails in a different way, and it sets out to get the speed of the library with the behavior of the kernel. It appeared at SOSP 1991 (pp. 95-109) and in an extended form in ACM Transactions on Computer Systems in February 1992 (vol. 10, no. 1, pp. 53-79). This analysis follows the TOCS text, which is the one with an open copy.

Its idea, that the kernel should allocate processors while each application decides what to run on them, comes back several times in this catalog. The [Exokernel](/papers/exokernel-os-architecture-application-level-resource-management) pushes resource management into applications for the whole operating system, and later user-space scheduling work such as [ghOSt](/papers/ghost-user-space-delegation-of-linux-scheduling) and [Skyloft](/papers/skyloft-general-scheduling-framework-in-user-space) revisits the split between kernel and user scheduler on modern hardware. Both came decades after this paper.

Worth knowing first: the difference between a thread and a process, what a page fault and a blocking system call do to the running thread, and what a spin-lock is.

## Contribution

- **A diagnosis, not just a design.** User-level threads see the kernel's processors only as "virtual processors" that the kernel multiplexes obliviously. When a thread blocks in the kernel on I/O or a page fault, or the kernel preempts a processor, the user level is not told, and the physical processor is lost or the wrong thread runs.
- **A virtual multiprocessor per address space.** The kernel decides how many processors each address space gets. The address space decides which of its threads run on them, and knows exactly how many processors it has.
- **Scheduler activations.** An activation is a vessel (execution context) for running user-level threads, a way to notify the user level of a kernel event, and kernel space to save the context of a stopped thread. A stopped thread is never resumed by the kernel directly: a fresh activation reports it, and the user-level scheduler decides what to do. The kernel keeps exactly as many running activations as processors assigned.
- **Four upcalls and two downcalls.** The kernel calls "Add this processor", "Processor has been preempted", "Scheduler activation has blocked" and "Scheduler activation has unblocked". The address space calls "Add more processors" and "This processor is idle", and only on the thread operations that can change processor allocation.
- **Recovery for critical sections**, instead of preventing preemption (see Methodology).

## Methodology

The authors implemented the design on the DEC SRC Firefly multiprocessor workstation by modifying Topaz, its native kernel, and FastThreads, a user-level thread package. They added about 1200 lines to Topaz (the original Topaz kernel thread code was over 4000 lines) and a few hundred lines to FastThreads. Topaz kernel threads and UNIX binaries still run, so address spaces using kernel threads and those using activations compete for processors without static partitioning.

The kernel upcalls into the address space on a fresh activation at every point where it would otherwise have to make a scheduling decision, and passes the saved register state of any stopped thread. Preempting a processor is also reported through another processor of the same address space. If an address space has no processor when an I/O completes, the upcall waits until one is allocated. Allocation uses a space-sharing policy in the style of Zahorjan and McCann that respects priorities and never leaves a processor idle if there is work. FastThreads uses per-processor ready lists, scanned in last-in-first-out order for cache locality.

Critical sections are the hard case. A thread preempted or blocked while holding a lock (including the ready-list lock, or an unlocked per-activation free list) could cause poor performance or deadlock. The authors reject prevention, because it makes the kernel give up processor allocation, conflicts with their fast lock implementation, and needs pages pinned in memory. They adopt recovery: the upcall checks, before taking any lock, whether the stopped thread was in a critical section. If so, it continues that thread through a user-level context switch until it leaves the section and hands control back. To avoid a flag set on every lock acquire, FastThreads makes an exact copy of each critical section, with a yield at the end of the copy only, and the upcall resumes a thread caught inside a section at the matching place in the copy.

## Findings

All figures below come from the paper's Firefly measurements.

- **Thread costs.** Table I compares Null Fork (create, schedule, run and complete a thread that calls a null procedure) and Signal-Wait: FastThreads 34 and 37 microseconds, Topaz kernel threads 948 and 441, Ultrix processes 11300 and 1840. A procedure call takes about 7 microseconds and a kernel trap about 19.
- **Cost of activations in the common case.** FastThreads on scheduler activations takes 37 microseconds for Null Fork and 42 for Signal-Wait, a 3 and 5 microsecond degradation. Removing the copied-critical-section optimization from FastThreads yielded 49 and 48.
- **Upcalls are slow.** Two threads signaling and waiting through the kernel take 2.4 milliseconds, a factor of five worse than Topaz threads. The authors expected parity, blame a quick modification of existing code and Modula-2+ instead of tuned assembler, and expect tuning to close the gap.
- **N-body, no I/O, no competitor.** Speedup of the O(N log N) N-body program on up to six processors is similar for both FastThreads versions. Topaz threads level off, which the authors attribute to kernel thread and lock overhead.
- **N-body with I/O.** With less memory, cache misses block a thread in the kernel for 50 ms. Original FastThreads degrades faster than the other two, because the blocked thread takes its processor with it. Modified FastThreads and Topaz threads have parallel curves, with modified FastThreads faster.
- **Multiprogramming.** Two copies on six processors give speedups of 1.29 (Topaz threads), 1.26 (original FastThreads) and 2.45 (scheduler activations), where 3 would be the maximum. The last is within 5% of the program running alone on three processors.

## Critical Analysis

The argument is clear and the mechanism is general: the kernel needs no knowledge of the user-level concurrency model. The evidence is thinner than the design.

- **One prototype, one machine, one program.** The six-processor CVAX Firefly, a single N-body application and simulated disk waits are acknowledged by the authors as "illustrative". Ports to C Threads and Mach were only in progress.
- **The upcall result does not support the headline.** The slow upcall path is measured, but its explanation and the claim that tuning would match Topaz are expectations, not measurements.
- **Honest reporting is argued, not tested.** The kernel trusts address spaces to report idle and needed processors. The paper suggests multi-level feedback, but does not evaluate it.
- **What the paper does not claim.** It does not show better performance in every case, does not report a production kernel, and says activations could be practical even on a uniprocessor only if their blocking and preemption cost matches kernel threads, which it did not achieve.
- **Later literature, not from this paper.** NetBSD added scheduler activations, then merged a 1:1 threading model in 2007 that [replaced them](https://www.netbsd.org/changes/changes-5.0.html) in NetBSD 5.0. A common summary, for example [on Wikipedia](https://en.wikipedia.org/wiki/Scheduler_activations), is that N:M schemes need changes in both kernel and user space and are harder to implement than 1:1 or user-only threads. The Go runtime multiplexes goroutines over OS threads in user space and, since [Go 1.14](https://go.dev/doc/go1.14), preempts them asynchronously, without an upcall interface like this one.

## Further Research

- Per-activation costs: a tuned kernel implementation to test the authors' expectation that upcalls can match kernel thread blocking.
- Multiprogrammed workloads with many applications and real I/O, to test the allocation policy and the honesty problem.
- Comparing the recovery approach to critical sections with other ways of dealing with a preempted lock holder.
- How a modern kernel-to-user scheduling interface, such as [ghOSt](/papers/ghost-user-space-delegation-of-linux-scheduling), compares in what it reports and what it lets the user level decide.
- How kernel scheduler bugs shown in [The Linux Scheduler: A Decade of Wasted Cores](/papers/linux-scheduler-decade-of-wasted-cores) interact with user-level schedulers that depend on accurate processor information.
