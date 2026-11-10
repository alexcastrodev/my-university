---
title: "OZZ: Identifying Kernel Out-of-Order Concurrency Bugs with In-Vivo Memory Access Reordering"
summary: OZZ emulates store and load reordering inside a running Linux kernel and fuzzes pairs of system calls under the assumption that one memory barrier is missing, so ordering bugs that normally need ARM-class hardware can be found on ordinary x86-64 machines.
researchArea: Operating Systems
keywords: memory barriers, out-of-order execution, kernel fuzzing, concurrency bugs, weak memory, lkmm, syzkaller
version: 1.0
updatedAt: 2026-11-07
---

## Overview

Kernel developers lean on lock-free techniques such as RCU, reference counters and lock-free structures, and with them come memory barriers: instructions that stop a processor from reordering memory accesses that must stay ordered. A missing or misplaced barrier gives an out-of-order (OoO) bug, which shows up only when two non-deterministic things line up, thread interleaving and processor reordering. The authors cite denial of service, crashes, data loss and memory corruption as consequences. Weak-memory CPUs such as Apple Silicon reorder stores with stores and loads with loads, while x86-64 does not, so these bugs mostly hide on the x86-64 machines where most kernel fuzzing runs.

The paper's running example (Figure 1) is a Linux ring buffer in the notification code. One thread fills an entry and then increments `head`, and the reader checks `head > tail` and then reads the entry. Without a write barrier on one side and a read barrier on the other, the reader can see the new `head` and an uninitialized `buf->ops`. The paper simplifies the real fix, which used release and acquire operations.

This SOSP 2024 paper (the 30th ACM Symposium on Operating Systems Principles, Austin) comes from Georgia Tech, KAIST, Seoul National University and Fluiz. It asks how to test for OoO bugs systematically when reordering happens inside the processor, where no breakpoint can reach it.

Key terms: OEMU is the in-vivo out-of-order execution emulation, compiled into the kernel. OZZ is the fuzzer built on OEMU and on Syzkaller. The hypothetical memory barrier test assumes a barrier is absent and forces the order it would have forbidden. LKMM is the Linux Kernel Memory Model.

Worth knowing first: the Linux barrier API (`smp_wmb`, `smp_rmb`, acquire and release), the LKMM, and how a coverage-guided kernel fuzzer like Syzkaller works. For another route to repeatable kernel testing, see [kSTEP](/papers/kstep-deterministic-testing-of-linux-cpu-scheduler-bugs), which makes scheduler behavior deterministic. It is an OSDI 2026 paper that OZZ cannot cite, and the pairing is mine.

## Contribution

- **In-vivo emulation.** An LLVM pass replaces each kernel memory access with a callback (`store_value`, `load_value`, Figure 2). The callbacks run in program order but ask OEMU when a store becomes visible and which value a load returns. Earlier "in-vitro" tools record accesses and analyze them offline, so they lose kernel runtime context such as freed objects or held locks. OEMU keeps that context, so KASAN, lockdep and kernel assertions work as bug oracles.
- **Delayed stores and versioned loads.** Each thread has a virtual store buffer. Stores commit at once by default, and userspace can request a delay for one instruction through a custom system call (`delay_store_at`). Delayed stores flush at a store, full or release barrier, or on an interrupt, and later loads of the same thread read from the buffer. This emulates store-store and store-load reordering. For load-load reordering, a global store history keeps each overwritten value and a timestamp, and `read_old_value_at` lets a load return an old value. A versioning window, from the last load, full or acquire barrier to now, keeps a load from reading anything older than that barrier.
- **LKMM compliance and scope.** OEMU follows the model's five barrier rules and two dependency rules, and treats `READ_ONCE` and atomic reads as load barriers, because the LKMM allows load-load reordering across an address dependency (an Alpha legacy). Load-store reordering is left out, since the authors cite that only two old ARMv8 implementations do it and no Power hardware does.
- **Hypothetical memory barrier test.** For two system calls, OZZ assumes a barrier is missing at some position and runs the accesses in the order it would forbid. For stores, it delays the stores before the position, interleaves just before the real barrier and lets the other thread read. For loads, it first runs the other thread to build the store history, then reorders the first load of a group with the loads after it: the first reads the updated value and the later ones read old values. The report names the position of the missing barrier, but not which barrier type fixes it, since `smp_mb()` would hide the bug at needless cost.
- **Pipeline.** Single-threaded inputs come from Syzlang templates, with KCov coverage and a profile of every access and barrier. For each pair of calls, Algorithm 1 keeps only accesses to shared locations, groups them by barrier, and moves the hypothetical barrier one instruction at a time, ordering hints by how many accesses they reorder. The interleaving point goes to a custom scheduler in QEMU that uses breakpoints and suspended vCPUs, and the reordering goes to OEMU.
- **Size and availability.** The LLVM 12.0.1 pass is 834 lines of C++ and the kernel callbacks 1,797 lines of C. OZZ adds 7,694 lines of Go and 913 of C++ to Syzkaller, and the scheduler is 2,167 lines of C in QEMU. The code is public at github.com/casys-kaist/ozz.

## Methodology

The evaluation has four parts: finding unknown bugs, reproducing known ones, measuring overhead, and comparing with OFence. The setup is a two-socket Xeon E5-2683 v4 machine (32 physical cores, 512 GB) with a host on Linux 5.4.143 and a modified KVM that accepts hypercalls from userspace. The authors run 32 VMs with four vCPUs and 8 GB each, using Syzkaller's kernel configurations and seeds, on kernels from 6.5-rc6 to 6.8 for six weeks. They triage the crashes by hand to find the ones caused by reordering.

No public benchmark of OoO bugs exists, so the authors built one. They filtered Linux git history with keywords such as "missing.*barrier" and "reordering", inspected the patches by hand, and kept those whose barrier location Syzkaller's public dashboard shows as reachable. They reverted each patch and fed the dashboard's system calls to OZZ as single-threaded inputs, which gave nine bugs. Overhead comes from LMBench on kernels with and without OEMU (mean of five runs) and from fuzzing throughput against Syzkaller on a separate kernel without OEMU. For OFence, a static tool that matches paired-barrier patterns, they gathered patches credited to its authors through Reported-by tags and counted which OZZ bugs fall outside its patterns.

## Findings

These are the authors' reported results.

- **New bugs.** OZZ produced 61 unique crash titles, including some Syzkaller also finds, and 11 were identified as OoO bugs. They sit in RDS, watchqueue, VMCI, XDP (two), TLS (two), BPF, SMC (two) and GSM. Table 3 lists 6 as Fixed, 3 as Confirmed and 2 as Reported.
- **TLS case.** `tls_init` stores `ctx->sk_proto` and then replaces `sk->sk_prot`, with no store barrier between them, so a concurrent `setsockopt` can hit a NULL pointer. Developers had spotted a data race on `sk_prot` earlier and added `READ_ONCE` and `WRITE_ONCE`, which silence the race detector but do not order the other accesses, so the bug survived that patch.
- **RDS lock case.** A hand-made try-lock releases with `clear_bit`, which does not order earlier accesses, so the critical section can leak past the release. The fix is `clear_bit_unlock`. The lock has no data race, so race detectors miss it, while OZZ reorders accesses inside the critical section.
- **Known bugs.** OEMU reproduced 8 of 9 (five by store-store and three by load-load reordering), after 12 to 342 tests per bug, which the authors summarize as tens of runs on average. One case (a TLS bug) ran the buggy reordering but returned a wrong value instead of crashing. The miss is an sbitmap bug that needs a thread to migrate between CPUs, which OZZ prevents by pinning threads. After a manual kernel change it reproduced.
- **Search heuristic.** Of 19 bugs in the evaluation set, 11 were triggered by the hint that reorders the most accesses and 6 by the second largest.
- **Overhead.** LMBench slowdowns run from 3.0x (context switch) to 59.0x (mmap), with 24.9x for the null call (1.74 to 43.3 µs) and 19.2x for fork. Fuzzing throughput is 0.92 tests per second against 7.33 for Syzkaller, 7.9x lower, which the authors trace to userspace copies and hypervisor operations.
- **Comparisons.** All OFence patches fell in submodules OZZ cannot generate inputs for, such as hardware-dependent ones, so no head-to-head was possible. In the other direction the authors judge 8 of OZZ's 11 bugs hardly detectable by OFence's patterns. Against KCSAN they argue OZZ reorders several accesses, across function boundaries, deterministically. A synthetic Rust example with `Ordering::Relaxed` triggers its assertion.

## Critical Analysis

The paper is candid about the edges of the method. It concedes the following.

- **Covered cases.** Load-store reordering is excluded, and only one hypothetical barrier is tested at a time, so bugs needing reordering across two or more threads are out of reach. The authors have not met such bugs and think they are rare. Redundant barriers (performance bugs) are not covered either, and the exact barrier type is left to developers.
- **Cost and reach.** The overhead is heavy, and device drivers that need real hardware are hard to test. The sbitmap miss shows a behavior (migration) that the pinning scheme cannot reproduce. Hardware-side OoO bugs, such as an RDMA patch the authors found, would need to know which instructions are shared with a device.

The following points are a reading of the evidence, not claims of the paper.

- **Abstract versus table.** The abstract and introduction say the bugs were confirmed and patched, yet Table 3 marks only 6 as Fixed, 3 as Confirmed and 2 as Reported. The body figures are the ones to trust.
- **Unmeasured baseline.** The claim that Syzkaller on x86-64 would miss these bugs rests on architecture reasoning (the text cites a "Type" column that Table 3 does not have, so the reordering type of each new bug is not given). No Syzkaller run of equal length is reported, and 61 crash titles include ones Syzkaller also finds.
- **Manual triage.** Eleven of 61 crashes were attributed to reordering by hand, with no stated criteria, and nothing is said of the other 50. No false-positive rate is given, and no reproduction on real ARM hardware is reported. Maintainer acceptance is the validation for the confirmed and fixed ones.
- **A self-built benchmark.** Only bugs whose barrier Syzkaller already reaches were kept, and inputs came from its dashboard, so this tests reordering control, not input generation. Nine bugs is a small sample. The table's counts average about 65 tests per reproduced bug (my arithmetic), led by 342 for one, so "tens" understates it.
- **Heuristic evidence.** The set of 19 is not defined in the text, though 8 reproduced plus 11 new makes 19 (my inference). The heuristic is validated on the same bugs used to evaluate the tool, and the two figures account for 17 of the 19, so the remaining two needed lower-ranked hints.
- **OFence is a judgment, not a run.** The authors could not get OFence's source, so "8 of 11 hardly detectable" is their reading of its patterns, and the reverse test found no overlapping bugs testable by OZZ. The comparison therefore shows different scopes more than relative strength.
- **Cost claim.** The pitch is that OZZ saves buying ARM fleets, but no cost comparison is given against a 7.9x throughput loss. The setup runs 128 vCPUs on 32 physical cores, with no discussion of the effect. LMBench has no variance, and selective instrumentation is proposed but not evaluated.
- **Rust is synthetic.** Only a hand-written example is tested, not a real Rust kernel module.

## Further Research

- Load-store reordering, multi-barrier and cross-thread reordering, and detection of redundant barriers, all named by the authors as future work.
- Fuzzing drivers together with hardware, which needs a way to know which instructions are shared with a device.
- Cutting OEMU's overhead, for example by instrumenting only lockless submodules as the authors suggest, and measuring what that costs in bugs found.
- Inferring the weakest barrier that fixes a bug, and checking the reported bugs on real ARM machines and in real Rust modules.
