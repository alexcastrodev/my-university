---
title: "The Working Set Model for Program Behavior"
summary: Denning defines the working set W(t, tau) as the pages a process referenced in its last tau seconds of execution, and uses it as a measure of memory demand: a program should run only if its working set fits in memory, which ties memory management to scheduling and avoids thrashing.
researchArea: Operating Systems
keywords: working set, virtual memory, paging, page replacement, thrashing, multiprogramming, memory management, scheduling
version: 1.0
updatedAt: 2026-11-20
---

## Abstract

Probably the most basic reason behind the absence of a general treatment of resource allocation in modern computer systems is an adequate model for program behavior. In this paper a new model, the "working set model," is developed. The working set of pages associated with a process, defined to be the collection of its most recently used pages, provides knowledge vital to the dynamic management of paged memories. "Process" and "working set" are shown to be manifestations of the same ongoing computational activity; then "processor demand" and "memory demand" are defined; and resource allocation is formulated as the problem of balancing demands against available equipment.

## Overview

The paper was presented at the ACM Symposium on Operating System Principles in Gatlinburg in October 1967 and published in Communications of the ACM, volume 11, number 5, May 1968, pages 323 to 333. It comes from MIT Project MAC, in the age of the "computer utility": time-shared machines with a segmented, paged virtual memory in which many programs compete for a small main memory. Paging was already common, but Denning argues that process scheduling and core memory management had advanced "independently along both these lines", with no model of how programs behave.

The problem is to decide which pages of each program should occupy main memory. The paper assumes the operating system must find this out on its own: it judges user advice inadvisable and argues that compilers cannot predict the needs of modular programs whose parts are chosen at run time. It sets the question in a two-level memory with a traverse time T for moving a page, and aims to minimize page traffic. Worth knowing first: demand paging, page tables with use bits, and the page-replacement policies of the time (random, FIFO, LRU).

Later papers in this catalog meet the same idea from other sides. [ESX Server](/papers/memory-resource-management-in-vmware-esx-server) estimates each virtual machine's working set by random sampling, and [HeMem](/papers/hemem-scalable-tiered-memory-management-for-big-data-applications-and-real-nvm) and [Memtis](/papers/memtis-efficient-memory-tiering-with-dynamic-page-classification) classify pages as hot or cold to place them in tiers. These are my pairings, not citations of the paper, which is 1968 and cites none of them.

## Contribution

- **The working set.** W(t, tau) is the collection of information a process referenced in the process-time interval (t - tau, t). The parameter tau is called the working set parameter, and omega(t, tau) is the number of pages in the set. Time is process time, as seen by a process unaware of its suspensions.
- **Four properties.** Size, prediction, reentry rate and tau-sensitivity (P1 to P4), stated for "typical" programs, with a probabilistic model of the interreference interval of a page.
- **A way to detect the set.** A hardware timer per page (Appendix), or in software a sampling of the use bits of the page table entries every tau/K seconds, keeping a page if any of its last K use bits is on.
- **Memory demand and scheduling.** Memory demand is the working set size over the memory size (capped at 1), processor demand comes from a model of how long a process runs between interactions, and a "balance" policy admits jobs whose demand moves the system toward a chosen fraction of memory and processor.
- **Process and working set as one computation.** A process is its demand for a processor, the working set its demand for memory, so memory management and scheduling "must be closely related activities".

## Methodology

The paper is a model and an argument. It first reviews paging policies (random, FIFO, LRU, the ATLAS loop detector) and argues that paging in must be on demand, because look-ahead may be futile: in the interface-and-handlers program of Figure 6, a block for user interaction signals that the working set is about to change. The central question is then which page to remove.

The model assumes the interreference intervals of a page are independent and identically distributed, and derives the reentry probability from their distribution function F. For the properties the paper assumes the working set stays in memory, the process is interrupted only by page faults, a page leaves memory the moment it leaves W(t, tau), and working sets do not overlap. Section 4 sketches an implementation (ready, running and blocked lists, a cyclic running list and a special "checker" process that samples page tables and keeps a counter of each working set size). Section 6 gives definitions of demand and balance, and the Appendix a hardware design with a timer and an alarm bit per page.

## Findings

The paper reports derivations, not measurements of its own. The statements below are what it establishes.

- **Size (P1).** omega(t, 0) = 0, omega is monotonically increasing in tau and concave downward, and on average omega(t, 2 tau) is at most 2 omega(t, tau).
- **Prediction (P2).** For a small separation alpha, W(t, tau) is a good predictor of W(t + alpha, tau); for alpha much larger than tau it is not.
- **Reentry rate (P3).** The mean process time between reentries of a page is the mean interreference time divided by 1 - F(tau). With traverse time T, the real-time reentry rate is lambda/(1 + lambda T). In memory balance, where working sets use a fraction beta of the M pages, the total return traffic is beta M lambda/(1 + lambda T) and the channel must carry twice that.
- **Choice of tau.** Too small a tau removes useful pages, too large wastes memory. A page whose interreference time is just above tau is resident only tau/(tau + 2T) of the time, so to keep that near 50 percent the paper says tau is about 2T, and recommends a tau comparable to T.
- **Memory allocation.** Knowing only omega(t, tau) with demand paging is enough: before running a process the system ensures enough free pages for its working set.
- **Thrashing.** The paper names it: when too many working sets occupy memory, each displaces the pages of the others, many programs stall in page wait, and the channel to auxiliary memory congests. Hence the advice to balance memory first, then the processor.
- **Evidence it cites.** Experiments by Fine and by Varian and Coffman show references scattered over many pages and heavy paging when core is short; simulations of the RCA Spectra 70/46 time-sharing system by Oppenheimer and Weizer are said to show marked gains from related ideas. The conclusion states that random selection brings the highest page traffic and working set the lowest, without a table of numbers.

## Critical Analysis

The idea of using recent history to size each program's memory is clear and its definitions are precise, which helps explain why the term entered the vocabulary of operating systems. Limits that the paper itself shows:

- **No empirical test of its own.** The comparison of random, FIFO, LRU and working set rests on argument and on other people's studies, and no page-traffic numbers are given for the working set policy.
- **The word "locality" does not appear.** The model relies on references clustering in time, and the properties are said to hold for "typical programs" and "need not hold in special cases". A program without that behavior is outside the model.
- **Choice and measurement are only discussed.** tau is recommended near the traverse time T, but the reentry estimates start from the distribution of interreference intervals, which the paper does not measure, and the software sampling is described, not built or timed. The hardware design is a proposal, and the paper says adding hardware to existing systems is not practical.
- **Open items it states.** How to charge shared pages when working sets overlap is "still an open question", the balance policy is "under investigation" as doctoral research, and the interactions between balance and good service are "not yet fully understood".
- **Later literature, marked as later and not read for this note.** Crossref metadata confirms Denning's [Thrashing (AFIPS 1968)](https://doi.org/10.1145/1476589.1476705), Carr and Hennessy's WSCLOCK (SOSP 1981, a clock-style replacement based on working sets) and Denning's "Working Sets Past and Present" (IEEE TSE, 1980). I checked only titles, authors and venues, so I make no claim about their contents. The replacement policies of modern kernels are outside what I read.

## Further Research

- Estimating tau and the working set size automatically, and its sensitivity to the traverse time and the page size.
- The balance policy: how to pick the constants alpha and beta, how it trades utilization against response time, and which job to admit when memory is out of balance.
- Charging for pages shared between working sets, and scheduling processes that share information together.
- Building the sampling checker and the hardware timers, and measuring their overhead on a real system.
- Testing the model on real reference traces, including programs with weak clustering, since the paper reports no traces of its own.
