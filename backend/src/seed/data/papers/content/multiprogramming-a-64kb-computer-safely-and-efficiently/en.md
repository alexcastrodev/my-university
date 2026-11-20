---
title: "Multiprogramming a 64kB Computer Safely and Efficiently"
summary: Levy and colleagues present Tock, a Rust embedded operating system for Cortex-M microcontrollers that isolates kernel components (capsules) with the language and applications (processes) with the memory protection unit, and splits the kernel heap across processes with grants, at a baseline RAM cost of about 1 kB for a minimal system.
researchArea: Operating Systems
keywords: Tock, embedded operating system, Rust, capsules, memory protection unit, grants, microcontrollers
version: 1.0
updatedAt: 2026-11-20
---

## Abstract

Low-power microcontrollers lack some of the hardware features and memory resources that enable multiprogrammable systems. Accordingly, microcontroller-based operating systems have not provided important features like fault isolation, dynamic memory allocation, and flexible concurrency. However, an emerging class of embedded applications are software platforms, rather than single purpose devices, and need these multiprogramming features. Tock, a new operating system for low-power platforms, takes advantage of limited hardware-protection mechanisms as well as the type-safety features of the Rust programming language to provide a multiprogramming environment for microcontrollers. Tock isolates software faults, provides memory protection, and efficiently manages memory for dynamic application workloads written in any language. It achieves this while retaining the dependability requirements of long-running applications.

## Overview

A general-purpose process leans on hardware: privilege levels, and an MMU that gives each program its own address space. A low-power microcontroller usually has neither. The paper says such chips run at tens of megahertz with tens of kilobytes of RAM, and its Table 1 shows RAM growing from 10 kB (TelosB, 2004) to 64 kB (Signpost, 2017). The newer 32-bit Cortex-M parts do have a memory protection unit (MPU) that guards physical regions, but no virtual addressing. Embedded operating systems therefore tend to merge application and OS into one image, allocate memory statically, and trust all code.

The authors argue that a new class of devices needs more: sports watches, USB authentication keys and city sensing nodes run several independent, updatable applications, some from other parties. The paper lists five needs (concurrency, dependability, fault isolation, memory efficiency, loadable applications) and uses Table 2 to claim that no earlier system had all five. A reading of mine, not the paper's: unlike the [Exokernel](/papers/exokernel-os-architecture-application-level-resource-management), which keeps the kernel minimal and moves management into application libraries, Tock keeps a large extensible kernel and isolates its pieces from each other. Related work in the paper sets the design against [seL4](/papers/sel4-formal-verification-of-an-os-kernel), SPIN, Singularity and verified systems such as [FSCQ](/papers/using-crash-hoare-logic-for-certifying-the-fscq-file-system).

Worth knowing first: what an MPU can and cannot do compared with an MMU, how Rust ownership and lifetimes work, and the TinyOS run-to-completion event model.

## Contribution

The paper's architecture has two classes of code, each trusted for different things.

- **Capsules.** Units of composition inside the kernel, written in Rust. They are isolated by the Rust type and module system at compile time and scheduled cooperatively on one shared stack. Most capsules are untrusted: they cannot touch other capsules' private fields or process memory. They are trusted only for liveness: a capsule can starve the CPU or force a restart, but cannot make unauthorized peripheral accesses.
- **A trusted core.** A small number of capsules must do things outside the type system, such as casting memory-mapped registers to typed structs or manipulating CPU registers in the scheduler. These, plus the core kernel, are where `unsafe` code lives.
- **Processes.** Written in any language, scheduled preemptively and isolated by the MPU, they use five system calls (Table 3): `command`, `allow`, `subscribe`, `memop` and `yield`. System calls are non-blocking, and `subscribe` registers a callback that the kernel queues for the process (Table 3 calls these upcalls), serviced at the next `yield`.
- **Grants.** A kernel heap partitioned across processes, living inside each process's own memory block but forbidden to the process by the MPU. Capsules reach grant memory only through `enter` and `each`, with closures and Rust lifetimes so references cannot escape. When a process dies, its grants are freed with its memory block.

## Methodology

The implementation targets Cortex-M, mainly the Atmel SAM4L (48 MHz, 512 kB flash, 64 kB SRAM) on a board called imix. The core kernel is 3,554 lines of Rust and the SAM4L layer 6,824 lines, with 295 lines of mostly assembly for Cortex-M details and 21 untrusted capsules in 12,925 lines for sensors, radios and multiplexers. The kernel needs 8.4 kB of SRAM plus a 4 kB stack, and 87 kB of flash.

The authors say a quantitative comparison with existing systems is hard because no benchmark suite fits this design point. They offer two case studies (a city-scale sensing platform called Signpost and a USB security key prototype from a large software organization) and four questions: the cost of capsule isolation, capsules versus process-only isolation, memory saved by grants, and the cost of grants. Comparisons use TinyOS (on a predecessor board with the same MCU), FreeRTOS, and a modified TOSThreads built to isolate processes.

## Findings

- **Latency (Table 5).** Handling a pin interrupt: 0.87 us directly in an interrupt service routine, 2.03 us from a capsule, 36.8 us from a process. From deep sleep the three cost 2.29 ms, 2.29 ms and 2.34 ms, so wake-up dominates.
- **Blink footprint (Table 6).** Total RAM 916 B for Tock, 72 B for TinyOS and 2,984 B for FreeRTOS. Flash text is 3,208 B, 5,296 B and 4,848 B.
- **Sensing app (Table 7).** RAM 9,704 B for Tock and 10,460 B for TinyOS, both including a 4 kB stack; flash text 41,744 B and 39,604 B.
- **Capsules versus processes.** A capsule reference costs a word (12 bytes in the light-sensor driver in Figure 7). Calling between capsules costs 0 to 4 cycles, pessimistically 25 (0.5 us at 48 MHz); a Tock context switch costs 340 cycles (7 us). For the 26-capsule Signpost ambient kernel, process-only isolation would need 13 kB (512 B stacks, RIOT's 14-byte metadata) to 110 kB (4 kB stacks, Tock's 164-byte metadata), against 12 kB with capsules.
- **Grants versus static allocation (Table 8).** A TOSThreads variant with isolation spends 710 to 712 bytes of kernel RAM per thread, of which at most 158 bytes (22%) can be in use, wasting 554 bytes (78%). With grants, the paper says there is no wasted memory.
- **Grant cost.** A grant reference is 4 bytes, each allocation adds a two-word hash table entry, and an `Owned` value adds one word. In the timer driver one process costs 387 cycles (8 us) and each additional timer 44 cycles, about 900 processes before 1 ms. The optimized driver is constant at 360 cycles, and an unsafe pointer-based version 305 cycles.

## Critical Analysis

The paper is open about its scope, and several things people may assume are not in it.

- **No count of unsafe code.** The paper does not report lines of `unsafe` or a measure of the trusted base, and it never uses the term TCB. It names what must be trusted (the core kernel and the few hardware capsules) and gives line counts for the kernel pieces only.
- **No quantitative Contiki or RIOT comparison.** The measured systems are TinyOS, FreeRTOS and TOSThreads. Contiki and RIOT appear in Table 2 and related work, and RIOT's 14-byte metadata is used as an input to the 13 kB estimate.
- **Isolation rests on trust in tools and people.** Capsule isolation depends on the Rust compiler being correct and on the trusted capsules being right. The paper assumes kernel source is audited by board integrators, says auditing will not catch all bugs, and does not verify anything formally. It calls verification complementary and suggests verifying the trusted core.
- **Capsules are isolated only by type.** A capsule can starve the CPU, force a restart and hold up other capsules. The paper describes no mechanism limiting a capsule's CPU use, and the kernel's liveness depends on capsules yielding.
- **Narrow evaluation.** Everything runs on Cortex-M, mainly one SAM4L board. The comparisons are different applications and one modified TOSThreads. The authors expect fewer than 10 processes, and grant iteration cost grows with process count. The text says two grants cost "two bytes" while an entry is two words, probably a slip. Figure 8 numbers above are from the text, not from reading the chart.
- **Later literature (catalog summaries only, not re-read for this note).** [Atmosphere](/papers/atmosphere-practical-verified-kernels-with-rust-and-verus) and [CortenMM](/papers/cortenmm-efficient-memory-management-with-strong-correctness) use Rust with [Verus](/papers/verus-practical-foundation-for-systems-verification) proofs, and [RustBelt](/papers/rustbelt-securing-foundations-of-rust) addresses what makes `unsafe` code sound. [Biscuit](/papers/the-benefits-and-costs-of-writing-a-posix-kernel-in-a-high-level-language) uses Go for a POSIX kernel instead, and [Unikernels](/papers/unikernels-library-operating-systems-for-the-cloud) also fold the application and OS into one image, but on a hypervisor.

## Further Research

- Verifying the trusted core with methods like [Hyperkernel](/papers/hyperkernel-push-button-verification-of-an-os-kernel) or [CertiKOS](/papers/certikos-extensible-architecture-for-certified-concurrent-os-kernels), as the authors suggest, while keeping capsules and processes for unverified code.
- Finer-grained MPUs or I/O register interfaces, which the paper says could let processes access peripherals directly without DMA side channels.
- Measuring the trusted code in the kernel and the effect of CPU limits on capsules (my suggestion, not the paper's).
