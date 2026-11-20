---
title: "Why Aren't Operating Systems Getting Faster As Fast as Hardware?"
summary: Ousterhout runs eight benchmarks on ten machines and six operating systems from 1989 and finds that kernel calls, context switches, memory copies and file operations improve less than raw integer speed, pointing to memory bandwidth and disk-bound file systems as the main causes.
researchArea: Operating Systems
keywords: operating systems, benchmarks, memory bandwidth, file systems, disk I/O, RISC
version: 1.0
updatedAt: 2026-11-20
---

## Abstract

This paper evaluates several hardware platforms and operating systems using a set of benchmarks that stress kernel entry/exit, file systems, and other things related to operating systems. The overall conclusion is that operating system performance is not improving at the same rate as the base speed of the underlying hardware. The most obvious ways to remedy this situation are to improve memory bandwidth and reduce operating systems' tendency to wait for disk operations to complete.

## Overview

John Ousterhout presented this paper at the USENIX Summer 1990 conference (Anaheim, June 1990, pp. 247-256); an earlier version is DEC Western Research Laboratory Technical Note TN-11, dated October 1989. It is a measurement paper with opinions, not a system design. Ousterhout was building Sprite, a UNIX-compatible research operating system at Berkeley, and wanted to compare it with vendor UNIX on similar hardware. The "fast" machines did not run the benchmarks as quickly as their processor speeds suggested, so he ran them on many configurations at DEC, Berkeley and Carnegie Mellon.

Worth knowing first: a MIPS rating (millions of instructions per second, with a VAX-11/780 at about 1.0), RISC versus CISC processors, a file buffer cache, and the fact that UNIX file systems of the time wrote metadata to disk synchronously. UNIX itself is described in [The UNIX Time-Sharing System](/papers/unix-time-sharing-system); Ultrix and SunOS are BSD descendants. The paper points to an earlier USENIX 1990 version of the log-structured file system work, whose journal version is [The Design and Implementation of a Log-Structured File System](/papers/log-structured-file-system).

## Contribution

- **A cross-machine benchmark suite.** Eight benchmarks, seven of them micro-benchmarks (getpid, cswitch, select, bcopy, read from the file cache, open-close, create-delete) plus the modified Andrew benchmark as the one large-scale test. The source was made available by FTP.
- **A normalization.** The "MIPS-relative speed" divides a machine's speed ratio against the Microvax II (MVAX2) by its MIPS ratio. A value of 1.0 means the benchmark ran as fast as the MIPS rating predicts; below 1.0 means the operating system function lagged raw integer speed.
- **Two diagnoses.** Memory bandwidth that does not keep pace with RISC CPUs, and file systems that wait for disk writes.
- **Four problem areas** for designers, two for hardware (memory bandwidth, context switching) and two for software (decoupling file system speed from disk speed, and network file protocols such as NFS).

## Methodology

Table 1 lists ten hardware configurations: MIPS M2000 and DECstation 5000 (20 and 18 MIPS), HP 9000-835CHX, DECstation 3100, SPARCstation-1, Sun-4/280, VAX 8800, IBM RT-APC, Sun-3/75 and Microvax II (0.9). The MIPS ratings are the author's own estimates. The six operating systems are Ultrix, SunOS, RISC/os, HP-UX, Mach and Sprite. Ultrix and SunOS descend from 4.3 BSD, RISC/os from System V, and Mach and Sprite are research systems. SunOS 4.0.3 (Sun-4, SPARCstation-1) and SunOS 3.5 (Sun-3) differ substantially.

The machines had ample memory and no significant paging, and file benchmarks fit in the buffer cache. The Andrew benchmark was modified to use one compiler (GNU C, targeting SPUR) so that times are comparable across architectures. It ran locally and over Sprite, NFS and AFS. Disk configurations varied, and the Mach DS3100 runs used slightly faster disks. The paper itself says its set of benchmarks may be incomplete and that other benchmarks might give different results.

## Findings

All numbers below are from the paper's tables and text.

- **Overall.** Figure 1 plots the geometric mean of MIPS-relative speeds per machine. Only the VAX 8800 came close to 1.0, and even it was not consistent. Other machines ran from 10% to 10x slower than CPU power would suggest.
- **Kernel entry-exit and context switch.** RISC machines had MIPS-relative speeds of 0.5 to 0.8 on getpid (DS5000 Ultrix: 11 microseconds, 0.94) and 0.3 to 0.5 on cswitch, with exceptions for Ultrix on the DS3100 (0.81) and the DS5000 (1.02). Ousterhout writes that context switching looks about 2x more expensive on RISC and that he has no good explanation. On select, RISC/os on the M2000 took 10 ms for empty pipes, which he suspects is a faulty select emulation.
- **Memory.** Normalized by MIPS, copying large uncached blocks gave 2.7 to 3.7 for the CISC machines (8800, Sun3, MVAX2) and 1.0 or less for every RISC machine except the RT-APC. Relative copy performance fell almost monotonically with faster processors. Reading from the file cache (Table 6) tracked the same memory bandwidths. Exceptions: the Sun-4 did better thanks to a write-back cache, and the DS5000 was slower than expected, which the paper does not explain.
- **Andrew benchmark.** Faster machines had smaller local MIPS-relative speeds: Sprite 1.7, 0.93, 0.89 on Sun3, Sun4, DS3100; SunOS 1.4, 0.85, 0.66 on Sun3, Sun4, SS1; Ultrix 1.0, 0.93, 0.50 on MVAX2, 8800, DS3100. The NFS remote penalty rose from 21% (MVAX2) to 34% (Sun3) to 63% (Sun4). Sprite was typically 30-70% faster than the others remotely and ran almost as fast remotely as locally.
- **File system causes.** In open-close the UNIX derivatives beat Sprite, so that benchmark did not explain Andrew. Create-delete did: UNIX derivatives needed 35-100 ms to create and delete an empty file because metadata is forced to disk, while Sprite used one disk I/O (about one rotation, 16 ms on the DS3100) and a newer version would take 4 ms. The author concludes that UNIX temporary-file performance depends more on disk speed than CPU speed. DS3100 Ultrix NFS took 45 times as long as DS3100 Sprite diskless for a 100-kbyte file. SunOS 4.0.3 jumped from 67 ms (no data) to 842 ms (10 kbytes), which he guesses is tied to mapped files.

## Critical Analysis

What the paper does not claim: it gives no solution, no proof that the trend continues, and no breakdown of where kernel time goes inside any system. It also leaves two anomalies unexplained: file reads on the DS5000 and the slow Andrew result for Ultrix on the DS3100 (only partly accounted for by slower disks and tuning guesses).

- **A snapshot of 1989 machines.** The conclusions about the future are the author's predictions (memory bandwidth will be harder to improve than CPUs, partly because workstation cost limits encourage skimping on memory). He also notes that part of the RISC memory gap is a one-time effect of the architecture change.
- **Implementations differ.** The systems have different kernels, file systems and disks, and the MIPS ratings are estimates, so a MIPS-relative value mixes hardware and software effects. Several remarks are explicit guesses, for example about Ultrix tuning.
- **Author interest.** Ousterhout leads Sprite, which comes out ahead in the file benchmarks; the file-system advice (delay writes, use non-volatile memory, log-structured file systems, replace NFS "my first choice") is also his work and his opinion.
- **Later work (only from catalog papers; not part of this PDF).** [Exokernel](/papers/exokernel-os-architecture-application-level-resource-management) measures kernel primitives against Ultrix on DECstations, [The Multikernel](/papers/multikernel-new-os-architecture-scalable-multicore-systems) and [An Analysis of Linux Scalability to Many Cores](/papers/analysis-of-linux-scalability-to-many-cores) turn to multicore scaling, and [All File Systems Are Not Created Equal](/papers/all-file-systems-are-not-created-equal-crash-consistent-applications) studies which crash guarantees applications rely on from file systems. I read their catalog summaries, not a causal link to this paper.

## Further Research

- Repeating the suite on current hardware and kernels, and separating hardware, kernel and library effects.
- Reducing the cost of kernel entry and context switching, and finding out why it was higher on RISC.
- Delaying or buffering writes without losing reliability, for example with non-volatile memory or logs.
- Network file protocols that depend less on synchronous disk writes.
