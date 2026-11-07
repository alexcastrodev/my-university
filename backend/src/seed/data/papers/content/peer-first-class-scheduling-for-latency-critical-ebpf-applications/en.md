---
title: "PeeR: First-Class Scheduling for Latency-Critical eBPF Applications"
summary: PeeR makes eBPF programs on the packet fast path preemptable and visible to the Linux scheduler, by yielding at helper-call boundaries and letting sched_ext decide how much CPU they get and in what order they resume.
researchArea: Operating Systems
keywords: ebpf, scheduling, sched_ext, preemption, tail latency, xdp, linux kernel
version: 1.0
updatedAt: 2026-11-07
---

## Overview

eBPF lets applications such as key-value stores, load balancers and transaction systems run inside the kernel, on hooks like XDP that fire in softirq context right after an I/O event. That context was designed for tiny packet filters: each invocation runs to completion in arrival order, cannot be preempted, and has its CPU time charged to whichever userspace process the interrupt happened to hit, so the scheduler never sees it.

This OSDI 2026 paper (20th USENIX Symposium, Seattle, July 2026), from MIT CSAIL and Tufts University, argues that this fast-path assumption, that eBPF work is short and uniform, no longer holds, because modern programs are large and data dependent. It presents PeeR, a runtime that turns each eBPF invocation into a schedulable task without changing the programs, so that a long scan no longer blocks a short lookup and an eBPF application can no longer starve a colocated job.

Terms to keep apart: a helper (or kfunc) call is how an eBPF program talks to the kernel, the verifier is the static checker that proves programs safe before they load, sched_ext is Linux's extensible scheduler class whose policies are written in eBPF, and a PeeR-kthread is the per-CPU worker thread where yielded programs resume.

Worth knowing first: how the eBPF verifier and JIT compiler work, what XDP and softirq are, and [ghOSt](/papers/ghost-user-space-delegation-of-linux-scheduling), which delegates thread scheduling to userspace but, as the PeeR authors note of such frameworks, does not schedule in-kernel eBPF execution.

## Contribution

- **A measurement of the broken assumption.** The authors analyze seven eBPF applications (Katran, Cilium, BMC Memcached, Redis-KFlex, DINT, eTran, XRP RocksDB). The largest Cilium program has 7,622 instructions and 233 helper calls, and p50 and p99 execution times of the same program differ by up to 500×.
- **Cooperative preemption at helper calls.** The JIT inserts a budget check before every helper or kfunc call, where the verifier already guarantees a clean state. Nothing is interrupted mid-instruction, and the check is cheap when it does not fire.
- **A hybrid softirq and worker model.** Tasks within budget run in softirq in arrival order. A task over budget saves its state (a 512-byte stack, 11 registers and the hook context) into a continuation buffer and resumes later on a PeeR-kthread. For XDP the packet is kept as an `xdp_frame` and the driver is told `XDP_YIELD`, which it treats as a consumed packet.
- **Safe resumption.** Pointers in the saved state are rebased using the verifier's type information (`PTR_TO_CTX` and `PTR_TO_STACK`), control returns through trampolines that satisfy CFI, and PeeR never yields while an RCU-protected pointer is live or a spin lock is held.
- **Two-level scheduling.** sched_ext is the macro-scheduler, working at millisecond granularity on aggregate CPU per application, fed by a per-CPU `runtime_event` ring buffer and a `set_budget` quantum (5 µs by default in the evaluation). Inside each PeeR-kthread a micro-scheduler orders continuations through `enqueue` and `requeue` callbacks, FIFO by default, with shortest-remaining-processing-time (SRPT) as an example policy.
- **A hook audit.** A design-time table classifies hooks: native XDP and tc/TCX direct-action fit the model, while act_bpf, tracing and LSM do not. Only native XDP is implemented.

## Methodology

PeeR is implemented in Linux 6.16 with about 5000 lines of C, and its scheduler extends Meta's scx_layered. Experiments use two servers with 28-core Xeon Gold 5420+ CPUs and 256 GB of RAM, connected by 400 Gbps ConnectX-7 NICs through a Tofino 2 switch, with an open-loop Poisson load generator and NIC flow steering spreading load across cores. Redis-KFlex runs a lightweight TCP stack inside XDP.

The baselines are default eBPF, userspace KeyDB and Memcached, BMC, and a cpumap deferral variant that tests whether the application can fix head-of-line blocking itself. The workloads are a bimodal Redis mix (99.5% GET of 0.2 µs, 0.5% SCAN of 200 µs), a 50/50 Memcached mix (0.2 µs and 30 µs), a TPC-C mix emulated by an XDP echo server that spins for transaction-profile durations, colocation with a compute-bound batch job, and microbenchmarks of overhead and budget size.

## Findings

These are the authors' reported results, compared with the default eBPF runtime unless stated.

- **Headline.** p99 latency for latency-sensitive requests falls by 3× to 19.8×, without starving long requests in the same application.
- **Redis-KFlex.** GET p99 is 19.8× lower, throughput is 3.77× that of userspace KeyDB and 10.3% above default eBPF (a drained receive queue means fewer drops), and below 1000 krps SCAN latency also improves.
- **Memcached.** GET p99 is 4.5× lower, and KFlex with or without PeeR has 3.46× the throughput of the userspace server, though PeeR's throughput is slightly below default eBPF.
- **cpumap deferral.** At 1.5 Mrps GET p99 is 403 µs, against 581 µs for default eBPF and 31 µs for PeeR. Near saturation its SCAN p99 reaches 350 ms, against 4 ms for PeeR.
- **Policies on TPC-C.** FIFO with preemption beats the baseline, SRPT cuts mean latency 3× at 300 krps, and weighted round-robin is a practical choice when execution time is unknown.
- **Colocation.** Without PeeR, the batch job beside BMC (under a 50/50 fair-share policy) drops to 30.9% of its fair share in throughput, and beside Memcached its CPU collapses to 7%. With PeeR it keeps its share, and a Redis-KFlex target varied from 0% to 75% is tracked within 6%.
- **Overhead.** A preemption-resumption cycle costs 247 ns (77 ns to preempt, 170 ns to resume), and the always-on check adds one cycle per helper call, two while the scheduler writes the flag.
- **Budget size.** The effect is U-shaped. For 5 µs requests a 500 ns budget saturates at 275 krps while 10 µs matches the no-preemption 330 krps. For a bimodal mix, short-request p99 bottoms out at 31 µs with a 2 µs budget and reaches 565 µs at 200 µs.

## Critical Analysis

The central idea is a good fit: the verifier's helper boundaries turn out to be exactly where preemption is safe. The paper concedes several limits.

- **One hook is implemented.** Only native XDP exists. The tc/TCX and XRP cases are argued by audit (the authors state they did not implement the XRP adapter), and LWT and netfilter are left as future work.
- **Granularity depends on helper density.** Preemption can only happen at helper calls, and the longest gaps are 484 instructions in Katran and 286 in eTran. XRP's block scan runs a roughly 100-instruction loop up to 2,000 times with no helper call. A program holding an RCU pointer across a helper also forgoes that yield point, which sleepable RCU could lift.
- **Semantics change.** Invocations can now interleave, so programs that assumed atomic access to shared state or per-core completion order must synchronize explicitly.
- **The deep tail pays.** SCAN p99.9 is 2.3× the baseline near saturation (5952 µs against 2562 µs at 3.1 Mrps), and StockLevel p99.9 is 1.5× to 1.7× higher. The best budget is workload dependent, and tasks are never migrated between CPUs.

The following points are a reading of the evidence, not claims of the paper.

- **The headline ratios are single points.** The 19.8× is stated without the load at which it is taken, and default eBPF's p99 grows with load (Figure 1), so the ratio depends on the operating point. The text ties the low end of the 3× to 19.8× range to no named experiment: the stated ratios are 19.8×, 4.5×, and 3× for mean TPC-C latency under SRPT.
- **The workloads are synthetic or emulated.** TPC-C is an echo server spinning for durations taken from earlier measurements, and the bimodal mixes have two request classes. Katran, Cilium, DINT, eTran and XRP are characterized in Table 1 but are not part of the evaluation.
- **SRPT leans on a good estimate.** The sample policy takes an application-provided remaining-work estimate, and the paper does not test wrong estimates. Weighted round-robin is offered as the fallback.
- **Colocation is narrow.** Each experiment pairs one eBPF application with one batch job. Two eBPF tenants competing, or skewed load across cores when tasks cannot migrate, are not shown.
- **Overhead is an average.** The 247 ns comes from an echo server preempted once per packet, averaged over more than a million measurements, with no distribution reported.
- **Cooperation has a ceiling.** The verifier bounds loops, so a long helper-free loop finishes, but the paper does not measure how long such a program can hold a core.

## Further Research

- Sleepable RCU, to remove the rule against yielding with live RCU pointers, as the paper proposes.
- More hooks: the tc and XRP adapters, LWT and netfilter, and I/O-bound programs that suspend mid-execution while waiting for disk, which the discussion suggests could bring file serving into the kernel.
- Choosing the budget automatically, since the U-shaped curve puts the best value at 2 µs for one workload and the default is 5 µs.
- Multi-tenant eBPF: several eBPF applications contending, cross-CPU migration of continuations, and SRPT under noisy estimates.
