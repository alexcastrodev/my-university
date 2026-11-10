---
title: "The Design and Implementation of a Virtual Firmware Monitor"
summary: Miralis runs unmodified vendor firmware in user mode on RISC-V by trapping and emulating its privileged instructions, so a security monitor no longer has to trust that firmware, and key parts of the emulator are checked automatically against the official ISA model.
researchArea: Operating Systems
keywords: virtual firmware monitor, risc-v, trusted execution environments, trap and emulate, firmware isolation, lightweight formal methods
version: 1.0
updatedAt: 2026-11-07
---

## Overview

Trusted execution environments (TEEs) such as enclaves and confidential VMs rely on a security monitor that protects applications from an untrusted kernel or hypervisor. On RISC-V that monitor usually runs in machine mode (M-mode), the highest privilege level of the application CPU, right next to the vendor firmware, which can be tens or hundreds of thousands of lines of code and is often a closed binary. The whole firmware image therefore sits inside the monitor's trusted computing base (TCB). Arm separates the two with extra modes such as TrustZone, but the firmware is still more privileged than the monitor.

This SOSP 2025 paper (Seoul), from EPFL and ETH Zurich with Cornell and Jane Street on the author list, asks whether the principle of least privilege can be applied to firmware itself. Its answer is a new class of system software, the virtual firmware monitor (VFM), and its first implementation, Miralis.

Key terms: vM-mode is the virtual M-mode in which the firmware runs, physically in user mode. Trap and emulate is the classical virtualization technique that Miralis applies to it. Fast path offloading is an optional subsystem that handles the most frequent firmware requests inside Miralis. PMP (physical memory protection) is the RISC-V mechanism for memory protection without an MMU, and SBI is the standard interface between the OS and M-mode software.

Worth knowing first: the RISC-V privilege levels (M, S and U), the Popek and Goldberg condition that all sensitive instructions must be privileged, and what a security monitor does in a TEE. The paper cites [Spectre](/papers/spectre-attacks-exploiting-speculative-execution) only to place transient execution attacks outside its threat model.

## Contribution

- **Firmware virtualization.** The authors claim that RISC-V M-mode is classically virtualizable, while Arm EL3 is not, based on a manual review. Their example is the `cpsid` instruction, which depends on the privilege level but silently does nothing in user mode instead of trapping. The host OS runs natively, so a VFM adds no cost during OS execution, only when the OS enters the firmware.
- **CPU and memory virtualization in Miralis.** Miralis is written in Rust and keeps a shadow copy of the CSRs. It emulates 12 privileged instructions and 84 CSRs. On each trap it emulates, injects virtual interrupts that are both pending and enabled, and performs a world switch when needed. PMP registers are multiplexed: Miralis keeps its own entries at higher priority, gives the firmware virtual PMP entries, and uses three extra entries to imitate M-mode access, the Top of Range addressing mode and the `mstatus.MPRV` bit.
- **Devices, DMA and fast path.** Only the CLINT interrupt controller needs emulation on the studied platforms. Because IOPMP support is rare, Miralis blocks firmware access to MMIO regions of DMA-capable devices. In a Linux boot on one board, the authors find that five causes explain 99.98% of traps into the firmware: reading the time register, setting the timer, misaligned loads and stores, IPIs and remote fences. They implement these in Miralis, each in 10 to 100 lines, since they are specified by the open RISC-V standard.
- **Policy modules.** An isolation policy is a Rust struct with seven optional hooks, plus PMP entries that take priority over the firmware's. Three policies exist. The firmware sandbox denies the firmware the OS memory, PCIe space and most MMIO devices, and saves and restores registers, with an SBI allow-list generated from the specification. The Keystone policy is a Rust rewrite of the Keystone enclave monitor. The ACE policy ports the ACE confidential-VM monitor, co-located with Miralis.
- **Lightweight verification.** The VFM specification is expressed as a function of the official RISC-V Sail model, through two criteria. Faithful emulation says trapped privileged instructions give the same state as a reference machine. Faithful execution says the host hardware is configured so unprivileged code behaves as on that machine. The authors translate Sail to Rust (a 2K-line OCaml backend they wrote) and check Miralis with the Kani model checker.

## Methodology

Miralis was ported to StarFive's VisionFive 2 (in-order U74 cores, 4 cores at 1.5 GHz, 4 GB, Linux 5.15) and SiFive's HiFive Premier P550 (out-of-order cores with the H extension, 4 cores at 1.8 GHz, 16 GB, Linux 6.6). It is inserted between the two stages of each vendor's M-mode firmware. Unless stated otherwise the sandbox policy is on, results are averaged over 5 runs, and a remote client with 8 cores at 3.5 GHz drives network tests. The configuration "Miralis no-offload" turns the fast path off.

The evaluation answers four questions: can unmodified vendor firmware be virtualized, does a VFM slow the OS, is the fast path needed on current CPUs, and can policies for enclaves and confidential VMs be built. Firmware tested: the vendor OpenSBI-based second stages (31.8k and 24.7k lines), RustSBI, Zephyr, and the closed 164 kB image of a third board, the Star64. Measurements: the cost of one emulated instruction (`csrw mscratch, x0`) and of a world switch with a minimal firmware and kernel, 100k time reads and IPIs in a loop, CoreMark-Pro, IOzone with O_DIRECT, Memtier against Memcached with 32 connections, boot time, Redis and Memcached under YCSB workload A, MySQL under Sysbench OLTP with 128 clients, and compiling Redis with GCC. Keystone is checked with RV8, ACE with a confidential Linux VM on QEMU.

## Findings

These are the authors' reported results.

- **Unmodified firmware runs.** Both vendor firmwares boot Linux under Miralis with no visible difference besides extra logs, RustSBI and Zephyr pass their test suites virtualized, and the Star64 binary ran without its sources. On the P550 Miralis allows writes to four non-standard CSRs that control speculation and error reporting.
- **Operation costs.** One emulated instruction costs 483 cycles on the VisionFive 2 and 271 on the P550, and a world switch round trip costs 2704 and 4098 cycles. A trap from the OS needs about 10 emulations, giving roughly 7,000 cycles or 5 µs. With the fast path, a time read takes 208 ns against 288 ns for native OpenSBI, and an IPI 3.65 µs against 3.96 µs. Without it they take 7.26 µs and 39.8 µs.
- **No overhead with the fast path.** Across the microbenchmarks there are 0.479 world switches per second on average, and 0.486 per second in the application benchmarks on the VisionFive 2 (none on the P550). On the network-heavy applications Miralis is up to 7.6% and 1.2% faster on the two boards, which the authors attribute to a slightly more efficient fast path. Boot takes 48.0 s against 47.5 s.
- **Without the fast path.** Overhead tracks the trap rate: 1.9% on CoreMark-Pro (11k traps per second), 10.6% on IOzone, 2× the Memcached latency (388k traps per second), 61.3 s of boot (29%), and up to 259% on Redis on the P550. Supporting the time CSR and the Sstc extension in hardware would remove 96.5% of world switches in the application benchmarks.
- **Policies.** Keystone enclaves running RV8 show 1% average overhead on the VisionFive 2, in line with the original Keystone. The ACE policy runs a confidential VM with 1 GB of RAM, but only on QEMU, so there is no performance comparison.
- **Size and verification.** Miralis has 6.2k lines in total, of which 190 are the fast path. The authors verify 2.7k lines, 43% of the code, with 6.9k lines of translated Sail model and 1.1k lines of proofs. Model checking takes from 28 s for `wfi` to 9 minutes for CSR writes and 118 minutes for end-to-end emulation. It found 21 bugs during development, including a virtual PC overflow, a flawed `mret`, and three in PMP virtualization (writes beyond the allowed number of entries, the reserved W=1, R=0 combination accepted, and a misplaced parenthesis in a legalization mask).

## Critical Analysis

The paper is open about several limits. It concedes the following.

- **DMA.** The evaluated boards have no IOPMP, so Miralis only stops the firmware's DMA, and it remains vulnerable to device accesses initiated by the OS.
- **A partly verified TCB.** Assembly, device drivers and the fast path are in the TCB and not verified, nor are the sandbox and Keystone policies. The Keystone policy lacks attestation, and the ACE policy was ported from verified code.
- **Scope of the threat model.** Physical attacks, denial of service, auxiliary cores and transient execution are excluded. The sandbox also trusts the vendor's documentation of platform-specific CSRs and MMIO regions, and leaves OS memory open to the firmware until the first jump to S-mode, where it then locks memory and hashes the S-mode image.
- **Arm.** EL3 is not virtualizable, and the proposed fixes (paravirtualization or a new trapping register) are not built.

The following points are a reading of the evidence, not claims of the paper.

- **No adversarial test.** Questions Q1 to Q4 measure compatibility, speed and policy support. The security case rests on argument and verification, with no run of a deliberately malicious firmware against the sandbox. The four non-standard speculation CSRs are simply allowed on the P550, consistent with excluding Spectre-style attacks but leaving that surface open.
- **Small evidence base for "no overhead".** Two 4-core boards, both running OpenSBI-derived firmware, plus a third board where only the closed firmware was run. The trap breakdown comes from one Linux boot on the VisionFive 2. Results are 5-run averages with no spread given, and a rate near 0.5 world switches per second says little about workloads that call firmware often. The paper motivates the work with server-class RISC-V but evaluates no such machine, nor many-core PMP synchronization.
- **The fast path carries part of the claim.** The introduction calls it optional, but Q3 concludes it must live in the VFM on current CPUs, and the abstract's "no degradation" holds only with it. Miralis therefore reimplements timer, IPI, fence and misaligned-access handling in unverified code, which fits "unmodified firmware" yet enlarges the TCB.
- **Verification is relative.** It checks Miralis against the Sail model through a translator the authors wrote, and the text does not say how that translator is validated. Faithful execution is shown only for loads and stores, and a 118-minute end-to-end run raises the question of re-verifying on every ISA or code change. The 21 bugs have no baseline of what ordinary testing would have caught.
- **Inconsistent sizes.** Section 4.1 and the verification section give the instruction emulator as 2.1k lines (34% of the code base), while the start of Section 6 and Table 1 give 2.7k for the emulator, and 2.7k (43%) is also quoted as the verified total. Both fit if the table row includes other verified code, which the paper does not say. This note uses the table for the 6.2k total.
- **Asserted comparisons.** "Drastically simpler than hypervisors" and the maintenance claim of O(N+M) against O(N×M) come from the authors' experience. Dorami is compared qualitatively, and no hypervisor or Dorami port is measured. The first boot stage appears in the trusted row of Figure 9, and the text does not say how the S-mode image hash is used.

## Further Research

- A Miralis for Arm, through paravirtualized firmware or a trap-on-sensitive-instruction control in the architecture, as the authors outline.
- Server-class RISC-V hardware with IOPMP, to test many-core scaling, DMA isolation and hardware that makes the fast path unnecessary (RVA23).
- Adversarial evaluation: real firmware vulnerabilities, fuzzed or malicious firmware, and verification of the sandbox and Keystone policies and of the Sail-to-Rust translator.
- Extending faithful execution beyond loads and stores and making re-verification incremental, so it keeps pace with new ISA extensions.
