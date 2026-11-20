---
title: "Lightweight Remote Procedure Call"
summary: Bershad, Anderson, Lazowska and Levy measure that most RPC traffic in operating systems stays on one machine and carries small arguments, then build LRPC for the Firefly, which transfers control directly through the kernel on the client's own thread and passes arguments on a shared stack, cutting a null cross-domain call from 464 to 157 microseconds.
researchArea: Operating Systems
keywords: lightweight remote procedure call, cross-domain communication, small-kernel operating systems, A-stack, linkage record, domain caching, Firefly
version: 1.0
updatedAt: 2026-11-20
---

## Abstract

Lightweight Remote Procedure Call (LRPC) is a communication facility designed and optimized for communication between protection domains on the same machine. In contemporary small-kernel operating systems, existing RPC systems incur an unnecessarily high cost when used for the type of communication that predominates (between protection domains on the same machine). This cost leads system designers to coalesce weakly related subsystems into the same protection domain, trading safety for performance. By reducing the overhead of same-machine communication, LRPC encourages both safety and performance. LRPC combines the control transfer and communication model of capability systems with the programming semantics and large-grained protection model of RPC. LRPC achieves a factor-of-three performance improvement over more traditional approaches based on independent threads exchanging messages, reducing the cost of same-machine communication to nearly the lower bound imposed by conventional hardware. LRPC has been integrated into the Taos operating system of the DEC SRC Firefly multiprocessor workstation.

## Overview

The text analyzed here is the ACM Transactions on Computer Systems version (volume 8, number 1, February 1990, pp. 37-55), from the University of Washington. The paper says it was nominated for TOCS by the program committee of the ACM Symposium on Operating Systems Principles of December 1989; Crossref lists the conference version in the 12th SOSP proceedings (pp. 102-113, DOI 10.1145/74850.74861), which I did not read.

The setting is the small-kernel operating system (Accent, Mach, V, Amoeba, Taos), which splits the system into domains that talk by messages, in contrast to a large monolithic kernel such as UNIX (see [The UNIX Time-Sharing System](/papers/unix-time-sharing-system)). The RPC model came from distributed computing, where [Implementing Remote Procedure Calls](/papers/implementing-remote-procedure-calls) (cited as reference 1) made a remote call look like a procedure call. The authors argue that this model is mostly used between domains on one machine, that implementations treat that case as the remote one, and that the resulting cost pushes designers to merge subsystems into a single domain, which defeats the point of a small kernel. They say the conventional approach "violates a basic tenet of system design by failing to isolate the common case", citing Lampson's hints paper (the 1984 IEEE Software version; the catalog's [Hints for Computer System Design](/papers/hints-for-computer-system-design) is the 1983 SOSP version, which I did not check for this phrase).

Worth knowing first: what a protection domain and a kernel trap are, and what a TLB is. The paper was written on the DEC SRC Firefly, the same platform as in [Scheduler Activations](/papers/scheduler-activations-user-level-management-of-parallelism) with the same four authors (I link them for that shared setting, not because either cites the other).

## Contribution

- **A measured case for the common case.** Section 2 counts calls in three systems and the argument sizes in Taos (see Findings).
- **Four techniques.** Simple control transfer (the client's thread runs the procedure in the server's domain), simple data transfer (a shared argument stack), simple stubs and design for concurrency.
- **Binding.** The server's clerk gives the kernel a procedure descriptor list. For each procedure the kernel allocates, pairwise in client and server, as many A-stacks (argument stacks, mapped read-write in both) as simultaneous calls allowed, plus a linkage record per A-stack that only the kernel can touch and that holds the caller's return address. The client receives a Binding Object it must present at every call.
- **The call path.** The stub pushes the arguments on an A-stack and traps. The kernel validates the binding and the A-stack, records the return address in the linkage record, finds an E-stack (execution stack) in the server's domain, switches the address space and upcalls into the server stub. The return needs no new validation, since the right was granted at call time.
- **Fewer copies.** A call argument is copied once, from the client stub's stack to the A-stack, against four copies in message-based RPC. For a call and return with immutable parameters, Table III counts three copies for LRPC, seven for message passing and five for restricted message passing.
- **Assembly stubs and multiprocessor design.** Stubs generated in assembly from Modula2+ definition files, one lock per A-stack queue, and domain caching on idle processors.

## Methodology

For frequency, the authors instrumented or counted three systems: the V System (a figure from C. Williamson, personal communication), Taos on a Firefly during a five-hour work period, and a diskless Sun-3 with UNIX and NFS over four days. For parameters they examined SRC RPC as used by Taos: 28 services, 366 procedures, over 1,000 parameters, and 1,487,105 calls in a four-day period.

LRPC was implemented in Taos on the Firefly and compared with SRC RPC, Taos's native system. Table II mixes the authors' measurements with published numbers for six systems. Table IV runs four tests on a C-VAX Firefly, each as 100,000 cross-domain calls in a tight loop divided by 100,000. Table V comes from timing and hand calculation of TLB misses. Throughput was measured with several processors calling at once and domain caching disabled.

## Findings

**Frequency (Table I).** The share of operations that cross machine boundaries is 3.0 percent in V, 5.3 percent in Taos (344,888 local RPCs against 18,366 network RPCs) and 0.6 percent in UNIX+NFS (over 100 million system calls against fewer than one million RPCs). The paper concludes that cross-domain activity will dominate, while noting that other workloads give other percentages.

**Parameters.** In Taos, 112 different procedures were called, 95 percent of calls went to 10 of them and 75 percent to 3, and byte copying sufficed for those 3. The most frequent calls moved fewer than 50 bytes and a majority fewer than 200. Statically, four of five parameters had a size known at compile time and 65 percent were 4 bytes or fewer.

**Existing cost (Table II).** The Null call takes, actual against theoretical minimum in microseconds, 464 and 109 in Taos, 754 and 90 in Mach, 2,300 and 444 in Accent, 730 and 170 in V, 800 and 170 in Amoeba, and 1,590 and 170 in DASH. The Null stubs alone take about 70 microseconds in SRC RPC.

**LRPC (Table IV, microseconds, LRPC/MP, LRPC, Taos).** Null 125, 157, 464. Add (two 4-byte arguments, one 4-byte result) 130, 164, 480. BigIn (one 200-byte argument) 173, 192, 539. BigInOut (200 bytes in and out) 219, 227, 636. LRPC/MP uses domain caching. By my division, the single-processor LRPC is 2.96, 2.93, 2.81 and 2.80 times faster than Taos RPC, and LRPC/MP is 3.7 times faster on Null.

**Breakdown (Table V).** The Null LRPC runs 120 instructions in 157 microseconds. The minimum is 109 (a procedure call 7, two traps 36, two context switches 66) and LRPC adds 48 (stubs 21, kernel transfer 27). About 25 percent of the time comes from an estimated 43 TLB misses at about 0.9 microsecond each. The authors say the assembly stubs are four times faster than Modula2+ stubs from the SRC RPC generator.

**Throughput.** One processor makes about 6,300 LRPCs per second and four make over 23,000, a speedup of 3.7. A five-processor MicroVax II Firefly showed 4.3. SRC RPC levels off at about 4,000 calls per second with two processors because of a global lock. Queue operations take under 2 percent of call time.

## Critical Analysis

The paper states a few limits. Its A-stacks sit in globally shared virtual memory because the Firefly lacked pairwise shared memory, and it says pairwise mapping would perform identically with more safety (not measured). A client or server can change arguments on the A-stack during a call, so copies happen only where that matters. The argument-passing trick needs a separate argument pointer and would not work if arguments had to live on the E-stack. Terminating a domain can leave a thread captured in a server, which it handles with a call-failed exception and by creating a replacement thread. It treats termination as an infrequent special case.

The following points are my reading, not claims of the paper.

- **One system.** Everything measured about LRPC is Taos on a C-VAX Firefly. The comparison with Mach, V, Amoeba and DASH comes from published numbers on other processors, though the theoretical minimum column helps.
- **A fast and unsafe baseline.** SRC RPC, by the paper's own account, shares buffers globally, uses one lock and skips access validation, so the 3x is against a design that already traded safety for speed.
- **Arithmetic.** The 5.3 percent for Taos equals 18,366 divided by 344,888, not by the 363,254 total, which gives about 5.1 percent. The difference does not change the argument.
- **Evidence for the premise is three workloads.** The authors say "we believe" the pattern will generalize. No application benchmark shows end-to-end gains, and the claim that cheaper calls encourage more modular systems is argued, not measured.
- **Domain caching.** Gains are shown only in Table IV, with no rate of finding an idle processor. Scaling stops at four or five processors, and the text itself says a few dozen would stress the transfer path more.
- **Security.** Beyond the Binding Object, kernel validation of the call and return, revocation on termination and pairwise channels, the text does not analyze isolation or abuse.

Later literature (not part of this paper; I did not read the originals and rely on the catalog's analyses): [On µ-Kernel Construction](/papers/on-micro-kernel-construction) reports an L3 one-byte RPC round trip of 10 microseconds against 230 for Mach on the same CPU, and [seL4](/papers/sel4-formal-verification-of-an-os-kernel) reports a 224-cycle one-way IPC. Those are other machines and metrics, so they are not comparable with Table IV.

## Further Research

- Pushing IPC out of the kernel: the [Exokernel](/papers/exokernel-os-architecture-application-level-resource-management) analysis reports a local RPC (lrpc) at 6.3 microseconds in a library operating system; I did not check whether it derives from this design.
- Isolating kernel components with the language instead of hardware domains, as [Tock](/papers/multiprogramming-a-64kb-computer-safely-and-efficiently) does with capsules, a different answer to what protection should cost.
- Message passing between cores, as in the [Multikernel](/papers/multikernel-new-os-architecture-scalable-multicore-systems), whose URPC channels carry messages between cores through shared memory (the catalog text does not tie it to this paper).
- Measuring domain caching hit rates and the pairwise-memory version the authors describe.
- Costs of argument copying and checking when arguments are not small.
