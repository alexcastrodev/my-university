---
title: "The Structure of the “THE”-Multiprogramming System"
summary: Dijkstra reports a small batch multiprogramming system for the Electrologica X8, built as a society of sequential processes arranged in six hierarchical levels, and argues that this structure made its logical soundness provable a priori and its implementation testable level by level; an appendix defines the P and V semaphore operations.
researchArea: Operating Systems
keywords: operating system structure, layered design, hierarchical levels, semaphores, sequential processes, synchronization, level-by-level testing, multiprogramming
version: 1.0
updatedAt: 2026-11-20
---

## Abstract

A multiprogramming system is described in which all activities are divided over a number of sequential processes. These sequential processes are placed at various hierarchical levels, in each of which one or more independent abstractions have been implemented. The hierarchical structure proved to be vital for the verification of the logical soundness of the design and the correctness of its implementation.

## Overview

Edsger Dijkstra's paper in Communications of the ACM (volume 11, number 5, May 1968, pages 341 to 346) was presented at an ACM Symposium on Operating System Principles in Gatlinburg, Tennessee, October 1 to 4, 1967. It is a progress report from a group of six people working on average half time at the Department of Mathematics of the Technological University of Eindhoven, who wanted to learn system design "including all the stages of conception, construction, and verification". The system ran on an Electrologica X8: 27-bit core memory (32K words at the time, 2.5 microsecond cycle), a drum of 512K words with a revolution time of 40 msec, and ten low-capacity peripheral channels.

The goal was to process a continuous flow of user programs as a service to the university: shorter turn-around for short programs, economical use of peripherals, automatic control of backing store, and use of the machine for jobs needing flexibility rather than power. The author is explicit that it is not a multi-access system and that it does not cater for user programs in machine language. Worth knowing first: what an interrupt is, what a process is, and why timing-dependent bugs cannot be reproduced on demand. Dijkstra's fear of exactly those bugs (he had written interrupt-driven software since 1958) is the paper's stated motive.

The same CACM issue (11(5)) has [The Working Set Model for Program Behavior](/papers/the-working-set-model-for-program-behavior), from the same 1967 symposium. THE answers how segments move between core and drum (the segment controller, level 1); Denning asks which pages of a program should be in main memory, defined by the pages it referenced in its last tau seconds. The pairing is mine, I did not find that either note discusses the other.

The pairings below are mine, the 1968 paper cannot cite later work. [The UNIX Time-Sharing System](/papers/unix-time-sharing-system) is the opposite design temperament: a small interactive system built on one uniform file abstraction rather than strict levels. [The Protection of Information in Computer Systems](/papers/protection-of-information-in-computer-systems) is a 1975 tutorial on protection that asks what a supervisor must enforce, a question the 1968 paper does not take up. [The Exokernel](/papers/exokernel-os-architecture-application-level-resource-management), [seL4](/papers/sel4-formal-verification-of-an-os-kernel) and [The Multikernel](/papers/multikernel-new-os-architecture-scalable-multicore-systems) each take a different position on what the lowest layer of an OS should be.

## Contribution

- **A society of sequential processes.** The whole system is arranged as sequential processes "progressing with undefined speed ratios": one per accepted user program, one per input and output peripheral, a "segment controller" for the drum and a "message interpreter" for the console keyboard. Only the order of states matters logically, not speed, so the processes cooperate through explicit mutual synchronization, and the system is independent of how many processors execute them.
- **Six levels.** Level 0 allocates the processor among processes whose progress is logically permitted, handles the real-time clock interrupt (so no process monopolizes the processor) and applies a priority rule. Level 1 is the segment controller, with the bookkeeping of the automatic backing store. Level 2 is the message interpreter that shares the operator console. Level 3 holds the processes that buffer input streams and unbuffer output streams, and abstracts the physical peripherals. Level 4 is the independent user programs, and level 5 is the operator ("not implemented by us"). Each level hides a resource: above level 0 the processors, above level 1 the core and drum pages, above level 2 the console.
- **Segments apart from pages.** Information units ("segments", each just fitting a page) get their own identifiers, far more numerous than core and drum pages. A segment dumped from core can go to any free drum page, and the one with minimum latency is chosen, so the system has no drum allocation problem.
- **Semaphores (appendix).** Integer variables initialized to 0 or 1, touched only by the P-operation (decrease by 1, block if the result is negative) and the V-operation (increase by 1, release one waiting process if the result is nonpositive). Dijkstra distinguishes semaphores for mutual exclusion from "private semaphores", each waited on by one process only.
- **Structure to bound testing.** The design aims at a mechanism "so effectively structured" that at each testing stage "the number of relevant test cases will be so small that he can try them all".

## Methodology

The paper is a design and experience report, with no benchmark. The author describes the construction in three stages. Conception took a long time and produced the concepts above plus "the art of reasoning" to deduce, from requirements such as "no information can be used before it has been produced" and "no peripheral can be set to two tasks simultaneously", how processes must synchronize. Construction was "rather traditional, perhaps even old-fashioned": plain machine code. Verification used short shots with the bare machine and no debugging aids.

Testing started at level 0 and each higher level was added only after the previous one was thoroughly tested. Each shot included testing processes that forced the system into all relevant states and checked that it kept reacting as specified. The appendix was added at the request of the program committee, who asked for more on the synchronizing primitives and for justification of the claim to prove logical soundness a priori. It gives a prose proof in three stages: a single task cannot cause an infinite chain of task generations (tasks go only to lower levels, with a precaution to avoid "page flutter" at the segment controller); no generated task can stay pending while all processes are at rest; and no circular wait, the "Deadly Embrace", can occur. For more general systems the proof is by induction on the level, as A. N. Habermann showed in his doctoral thesis.

## Findings

All numbers below are from the paper, and the paper reports no performance figures.

- **Errors found.** The only errors during testing were trivial coding errors, "occurring with a density of one error per 500 instructions", each located within 10 minutes of inspection at the machine.
- **Status when written.** Testing "had not yet been completed", yet the author writes that the resulting system "is guaranteed to be flawless" and that its correctness will have been proved "with a rigor and explicitness that is unusual for the great majority of mathematical proofs".
- **Why levels help testing.** Testing level 0 needed only sequential testing processes on top of it. At level 1 the real-time clock, although "interrupting all the time", was so immaterial that one tester forgot its existence. Without the separate levels, the number of "relevant states" from arbitrary orderings of clock and drum interrupts "would have exploded" so that exhaustive testing "would have been an illusion".
- **Hardware failure absorbed.** While testing at level 2 or 3 the drum channel broke down for some time, and testing went on by restricting the number of segments to what fit in core, possible because pages had lost their identity above level 1.
- **Why the message interpreter sits above the segment controller.** Its vocabulary is stored in segments, so it can live on the drum, instead of taking a permanent reservation of core.
- **Mistakes admitted.** The group focused too long on "a perfect installation" and paid late attention to peripheral breakdowns (the "pathology"), which made its management rules more refined than needed. It also conceived most of the system with "scanty thought" for debugging, which Dijkstra says had no serious consequences and for which he declines credit.
- **Working conditions.** Half-time staffing slowed production "at least a factor of four", and he says the work needs the best people.

## Critical Analysis

- **"Proved" means a prose argument.** The paper gives a three-stage informal proof in an appendix, not a formal or machine-checked one, and the system itself was still in testing. The testing found coding errors, so the claim is about the design (logical soundness a priori) plus a tested implementation, not a verified program. The same text also says the testing programs were "a major intellectual effort" and that the relevant states were all generated only "as far as we know".
- **Scope is narrow.** Batch service for one university on one machine, no multi-access, no user machine-language programs, no shared database, no benchmark of throughput or response time. The conclusion mentions industrial skepticism that the techniques transfer outside "the sheltered atmosphere of a University". The author answers with an opinion ("the larger the project, the more essential the structuring!"), not with a larger system.
- **Costs of the structure.** The text does not discuss a run-time cost of layering. It lists costs elsewhere: a rigid ordering of dependencies (the message interpreter must sit above the segment controller), processes that can only generate tasks for lower levels, and a design effort in conception and in building the testing programs that the author calls major.
- **Later literature (marked as such, only a secondary source read).** A Wikipedia summary of THE, which I read but did not trace to its sources, credits it with early software paged memory and attributes to Silberschatz and Peterson's textbook (1988, not read) that it was mainly batch with a static process set. Its claims that Windows NT and macOS later used layering, and that the design resembles Multics rings, are uncited there, so I do not rely on them.

## Further Research

- Compare the layering with systems that keep a small trusted lowest layer, as in [seL4](/papers/sel4-formal-verification-of-an-os-kernel), [The Exokernel](/papers/exokernel-os-architecture-application-level-resource-management) and [The Multikernel](/papers/multikernel-new-os-architecture-scalable-multicore-systems), and ask what each one chooses to hide.
- Machine-checked layered designs: [CertiKOS](/papers/certikos-extensible-architecture-for-certified-concurrent-os-kernels) builds a kernel from certified abstraction layers (I have not checked whether it cites this paper), the verified counterpart of an informal level-by-level argument.
- The cost side: [Why Aren't Operating Systems Getting Faster as Fast as Hardware?](/papers/why-arent-operating-systems-getting-faster-as-fast-as-hardware) and [On Micro-Kernel Construction](/papers/on-micro-kernel-construction) measure what kernel crossings and IPC cost, a question this paper never raises.
- Synchronization beyond P and V: [Algorithms for Scalable Synchronization on Shared-Memory Multiprocessors](/papers/algorithms-for-scalable-synchronization-on-shared-memory-multiprocessors) studies busy-wait locks on shared-memory machines, a setting where the semaphores of an interrupt-driven single processor do not directly apply.
