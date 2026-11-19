---
title: "Meltdown: Reading Kernel Memory from User Space"
summary: On many Intel CPUs, an unprivileged program can load a kernel address, take the permission fault, and still leak the value through the cache, because out-of-order execution runs the following instructions before the fault is handled. Mapping the kernel out of user page tables (KAISER, later KPTI) stops it.
researchArea: Security and Privacy
keywords: meltdown, out-of-order execution, kernel isolation, cache side channel, Flush+Reload, KAISER, KPTI
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

The security of computer systems fundamentally relies on memory isolation, e.g., kernel address ranges are marked as non-accessible and are protected from user access. In this paper, we present Meltdown. Meltdown exploits side effects of out-of-order execution on modern processors to read arbitrary kernel-memory locations including personal data and passwords. Out-of-order execution is an indispensable performance feature and present in a wide range of modern processors. The attack is independent of the operating system, and it does not rely on any software vulnerabilities. Meltdown breaks all security guarantees provided by address space isolation as well as paravirtualized environments and, thus, every security mechanism building upon this foundation. On affected systems, Meltdown enables an adversary to read memory of other processes or virtual machines in the cloud without any permissions or privileges, affecting millions of customers and virtually every user of a personal computer. We show that the KAISER defense mechanism for KASLR has the important (but inadvertent) side effect of impeding Meltdown. We stress that KAISER must be deployed immediately to prevent large-scale exploitation of this severe information leakage.

## Overview

Operating systems map the whole kernel, and with it all physical memory, into the address space of every process, and rely on a supervisor bit in the page tables to keep user code out. This is the kind of hardware-enforced protection discussed in [The Protection of Information in Computer Systems](/papers/protection-of-information-in-computer-systems). The paper, from twelve authors at Graz University of Technology, Cyberus Technology, G DATA, Google Project Zero, the University of Michigan, the University of Adelaide and Data61, and Rambus (the Cryptography Research Division), appeared at the 27th USENIX Security Symposium (Baltimore, August 2018). Several of the authors found the flaw independently and published together after a coordinated disclosure (CVE-2017-5754).

It is the sibling of [Spectre](/papers/spectre-attacks-exploiting-speculative-execution), published at the same time. The paper's own distinction: Meltdown breaks the privilege boundary and needs no tailoring to the victim, while Spectre applies to more CPUs but needs the victim's code and is not stopped by KAISER.

Worth knowing first: virtual memory and the page-table permission bits, how an out-of-order pipeline retires instructions in order, and what a cache timing side channel is.

## Contribution

- **Out-of-order execution as a software-reachable side channel.** The CPU executes instructions after a faulting load before it handles the fault, and the cache keeps a trace of that work.
- **An end-to-end attack** that reads arbitrary kernel and physical memory from an unprivileged process, on laptops, desktops, a phone and cloud VMs, with no software bug involved.
- **Two exception-handling strategies:** catch the fault (fork and crash, or a signal handler) or suppress it with Intel TSX transactions.
- **An evaluation of KAISER** as an accidental defense, plus a discussion of hardware fixes such as a hard split bit between user and kernel halves of the address space.

## Methodology

The attack assumes arbitrary unprivileged code on the machine, ASLR, KASLR, SMAP, SMEP and NX enabled, and a bug-free kernel. It has three steps. Step 1: load a byte from an inaccessible kernel address into a register. Step 2: a transient instruction uses that register to touch one line of a 256 x 4096-byte probe array, so the secret chooses the page. Step 3: Flush+Reload over the 256 pages shows which one is cached, which is the secret. The fault is only raised when the load retires, and the transient sequence races against it.

The paper manages the race with a retry loop (the load often returns 0, a bias the authors attribute either to a failed permission check masking the load or to a speculated value), by reading one bit per transmission (one Flush+Reload measurement instead of 256), by keeping the probe array's translation in the TLB, and by prefetching the kernel address. With KASLR the direct-physical map is randomized in 40 bits, but for 8 GB of RAM it takes at most 128 probes in 8 GB steps to find it.

The evaluation (Table 1) lists nine lab Intel CPUs (Celeron G540, Core i5-3230M, i5-3320M, i7-4790, i5-6200U, i7-6600U, i7-6700K, i7-8700K and Xeon E5-1630 v3), two cloud Xeons (E5-2676 v3 and E5-2650 v4, on Amazon EC2 and DigitalOcean) and the Samsung Exynos 8890 phone SoC. Rates and errors were measured by leaking known kernel values.

## Findings

- **Reading rates.** The text says 3.2 KB/s to 503 KB/s in the introduction, Section 5 and the conclusion, but Section 6.2 reports up to 582 KB/s (mean 552.4, sigma 10.2) with error as low as 0.003% on the i7-8700K, 569 KB/s (mean 515.5) with 0.002% on the i7-6700K, and 491 KB/s (mean 466.3) with a minimum error of 10.7% on the Xeon E5-1630, where a 137 KB/s version reached zero error. Data in L3 but not L1 gave 12.4 KB/s on the i7-6700K; uncached data gave under 10 B/s on most systems and 3.2 KB/s with prefetching tricks. Per-CPU numbers are given only for these three CPUs, all with TSX.
- **Zero bias.** On the i5-6200U with exception handling, a 0 was read 5.25% of the time unoptimized and 0.67% with retries; on the i7-8700K 1.78%; with TSX 0.008%.
- **Linux, Windows, Android.** Linux 2.6.32 to 4.13.0 without KAISER leaks all physical memory. Windows 10 leaks any kernel-mapped memory, including the kernel binary, checked against the kernel debugger. On a Galaxy S7 (kernel 3.18.14) it worked on Samsung's custom cores, leaking a predefined string, but not on the Cortex-A53.
- **Containers.** Docker, LXC and OpenVZ share one kernel, so the authors leaked memory from a container of a different user under their own control.
- **Cloud.** Meltdown worked inside VMs on EC2 and DigitalOcean, but for ethical reasons they did not read other tenants' memory.
- **AMD and ARM.** No success on AMD or on other ARM cores. AMD stated it is not affected, and ARM names only the Cortex-A75, which the authors did not have. The toy example of an access after a fault still leaves a cache trace on both.
- **KAISER.** Verified on Linux to stop leakage of kernel and physical memory, except a few kilobytes that x86 requires in user mappings, which may hold pointers that break KASLR. Linux renamed it KPTI; Windows has KVA Shadow, and Apple added Double Map. The paper gives no measured KAISER slowdown.

## Critical Analysis

What the paper does not claim. It does not demonstrate a VM escape: the Xen paravirtualization case is argued in the introduction but no Xen experiment appears in the text. Cloud results show same-VM kernel reads only. AMD and most ARM cores were not breakable, and the introduction's "modern Intel microarchitectures since 2010" rests on the listed CPU models, which the paper does not tie to generations. Its costs are discussed qualitatively: serializing the permission check is called a significant overhead per fetch, the hard split bit is expected to cost little (an expectation, not a measurement), and container hosts are said to face significantly higher costs from full virtualization or KAISER. The 503 versus 582 KB/s mismatch is an internal inconsistency to keep in mind.

Later literature, not part of this paper. I read only the abstract of Canella et al., "A Systematic Evaluation of Transient Execution Attacks and Defenses" (arXiv 1811.05441, November 2018): it reports new Meltdown variants (Meltdown-PK on Intel, Meltdown-BND on Intel and AMD) and that most defenses, including deployed ones, cannot fully mitigate all variants. I did not read its body. A CACM version of Meltdown (2020, Crossref lists an added author) exists; I did not read it, nor any performance study of KPTI.

For context, [Xen and the Art of Virtualization](/papers/xen-and-the-art-of-virtualization) and [Firecracker](/papers/firecracker-lightweight-virtualization-for-serverless-applications) are the hypervisor and microVM designs that sit behind the isolation choices the paper discusses; neither is cited by it.

## Further Research

- Hardware fixes that check permissions before forwarding loaded data, such as the paper's hard split bit, and what they cost.
- Other microarchitectural state than the cache as a covert channel, which the paper notes (for example execution-port contention).
- The uncached-data question, which the authors suspect involves line fill buffers and leave open.
- The residual user-mapped kernel pages under KAISER, including the trampoline idea for hiding kernel pointers.
