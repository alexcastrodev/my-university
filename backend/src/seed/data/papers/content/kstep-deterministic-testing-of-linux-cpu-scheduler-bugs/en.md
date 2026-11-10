---
title: "kSTEP: Characterization and Deterministic Testing of Linux CPU Scheduler Bugs"
summary: A study of 232 Linux scheduler bug fixes shows that most bugs are silent and rarely reproduced, and kSTEP answers with a framework that replays hand-written event sequences on isolated CPUs with mocked clocks, so scheduler behavior becomes repeatable and fuzzable.
researchArea: Operating Systems
keywords: linux scheduler, scheduler bugs, deterministic testing, fuzzing, eevdf, cfs, policy bugs
version: 1.0
updatedAt: 2026-11-07
---

## Overview

The Linux CPU scheduler decides which runnable thread each CPU runs next, and it has grown from about 15k to 50k lines of code in 15 years. This OSDI 2026 paper (the 20th USENIX Symposium on Operating Systems Design and Implementation, Seattle), from the University of Wisconsin-Madison and Purdue University, asks why its bugs survive so long and how to test them better.

The authors separate two kinds of defects. Functionality bugs break strict guarantees (a task runs on a CPU outside its affinity, a task starves, the kernel panics). Policy bugs leave the scheduler working but misaligned with its intended policy, hurting fairness, balance, locality or energy use without any error. Policy bugs are hard to even recognize from outside, because a slow wakeup may be a defect or a deliberate trade-off.

Key terms: scheduler-invoking events (fork, wakeup, cgroup changes, ticks, CPU attributes), the driver program that lists them, `tick_until` (inject ticks until a predicate on scheduler state holds), and the determinism module that removes noise.

Worth knowing first: Linux scheduling classes and cgroups, plus EEVDF and its delayed-dequeue feature, which appears in several bugs. [ghOSt](/papers/ghost-user-space-delegation-of-linux-scheduling) moves scheduling policy into userspace agents, whereas kSTEP tests the policies that live in the kernel, and the study excludes sched_ext.

## Contribution

- **A characterization study.** The authors collected bug-fix commits touching kernel/sched/ since 2020 from mainline and stable branches, ending with 232 bugs, and report twelve findings on observability, consequences, discovery, root causes and triggers.
- **Controlled execution.** A driver is a C function in a kernel module that issues events for userspace tasks, cgroups, kthreads, any exported kernel function, CPU attributes (topology, capacity, frequency) and explicit ticks. The driver cannot edit scheduler state directly, only reach it through normal code paths.
- **Deterministic execution.** The kernel runs unmodified. kSTEP mocks `sched_clock` and `jiffies`, advancing both after each tick on all controlled CPUs. It sends interrupts, RCU callbacks and workqueue workers to CPU 0, runs a minimal init as PID 1, and resets scheduler state that depends on boot.
- **Tools on top.** A tracer records the program counters each event triggers, split per participating task. A fuzzer uses edge coverage, tracks task states to generate valid events, replays a prefix up to a point that gave new coverage, and mutates what follows.
- **Implementation.** About 1.5k lines of kernel module and 150 lines of userspace code, run in QEMU on x86_64 and arm64. The authors test it on LTS kernels v5.15, v6.1, v6.6, v6.12 and v6.18, and on v7.0. It is open source.

## Methodology

For the study, each commit was classified as a bug fix by a `Fixes:` trailer or defect keywords, and each bug was examined and classified by one of the authors. Their stated limits are that unreported or unfixed bugs are missed, that the result describes Linux rather than schedulers in general, and that classification involves judgment.

For the evaluation, the authors sampled seven bugs spanning components, observability and triggers. For each, they checked out the commit before the fix, ran a hand-written driver in a fresh QEMU instance, then repeated on the fix commit. The machine had two 10-core Intel Xeon Silver CPUs and ran Ubuntu 24.04.

The fuzzer ran for 24 hours per bug with an invariant encoded for each one (for example, only one designated CPU per scheduling group invokes load balancing), and every violation was inspected by hand. Four new bugs were then sought on the latest kernel.

## Findings

These are the authors' reported results.

- **Bugs are silent.** 15% cause crashes or hangs, while 73% are silent functional faults or policy misalignments with no warning. 75% of root causes are wrong state updates or wrong logic, and the Fair class has 70% policy bugs.
- **Bugs live long and are not reproduced.** 45% stay hidden for years and 5% for over a decade. 61% of runtime-exposed bugs have no trigger sequence, only 22% of user-submitted fixes include developer validation, and fixes rarely add tests, warnings or tracepoints.
- **Triggers go beyond userspace.** 90% need specific workload behavior and 54% depend on scheduler attributes. About 19% need kernel events such as hotplug or kthreads, and 88% can be triggered on a multicore machine with SMT, the rest needing NUMA (5%), asymmetric cores (5%) or other hardware.
- **Reproducers are short.** For the seven studied bugs they take at most 20 events and 47 lines, use at most five tasks except one with 20k, and run in seconds. Three need `tick_until`.
- **Fuzzing finds most of them.** Bugs #3, #4, #5 and #7 were triggered in under an hour, Bug #1 in 2.13 hours and Bug #2 in 8.68 hours. Bug #6 needs 20k threads and stayed out of reach.
- **Traces are repeatable.** In Figure 16 buggy and fixed runs show identical behavior up to the trigger and divergence after it.
- **Four new bugs.** Reported to developers: an incomplete upstream fix of Bug #1 (`select_idle_sibling` still counted delayed-dequeue tasks), an idle-CPU imbalance formula that rounds to 0, a scheduling group labeled overloaded instead of imbalanced, and an idle-time estimate not scaled by CPU capacity. The last two came from the fuzzer, after 5.32 and 0.13 hours.

## Critical Analysis

The paper concedes three limits. Driver events are serialized, so kSTEP cannot expose concurrency bugs inside the scheduler, which are 12% of the study. The fuzzer could not reach Bug #6. The study may not represent bugs that were never reported or fixed.

The following points are a reading of the evidence, not claims of the paper.

- **Reproducers are written with the answer known.** The drivers were built from the bug and its fix commit, so "at most 20 events" measures the cost of expressing a known trigger, not of discovering one. The fuzzer addresses discovery, but its invariants also encode the known bug.
- **The sample leans on recent code.** Bugs #1, #2 and #3 all involve EEVDF's delayed dequeue, and #8 is a leftover of #1. Seven of 232 bugs were reproduced, and the paper does not say how many of the 232 the event model can express beyond excluding concurrency.
- **Claimed baselines are not run.** The comparison "20 events instead of hours-long benchmarks" is not measured, no benchmark or other tool (for example LinSched, or a fuzzer without kSTEP's determinism) is run on the same bugs, and the benefit of noise-free coverage is asserted without an ablation.
- **Fuzzing results are single runs.** Each time-to-trigger is one number from a 24-hour run, with no spread across seeds. Determinism is shown by comparing traces for seven reproducers, and the number of repetitions is not stated.
- **Impact comes from different evidence.** The paper measures some impacts (Figure 2, the rebalance cost of Bug #6) and describes or estimates others. kSTEP shows that a decision is wrong, and the cost to a real workload is a separate question.
- **Survivorship in lifetimes.** The 45% figure covers only bugs fixed since 2020, so recent bugs cannot yet be old and undiscovered ones are absent. Low maintenance effort is also stated without numbers.

## Further Research

- Combining kSTEP with controlled concurrency testing, which the authors call orthogonal, to cover the 12% of bugs that need races inside the scheduler.
- Oracles that detect misbehavior without a hand-written invariant per bug, which the paper lists as anomaly detection, alongside LLM agents that write drivers and policy comparisons across kernels.
- Turning drivers into regression tests, since the study finds fixes rarely add any.
- Whether the same event model can test policies loaded through sched_ext (excluded here) or delegated to userspace agents as in ghOSt, a gap the paper does not discuss.
