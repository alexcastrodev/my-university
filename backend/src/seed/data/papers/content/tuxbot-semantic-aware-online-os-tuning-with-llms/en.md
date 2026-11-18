---
title: "TuxBot: Semantic-Aware Online OS Tuning with LLMs"
summary: TuxBot tunes Linux scheduler, power, memory and I/O knobs on a live host with language models that read what knobs and telemetry mean, using a fast and a slow loop, memory of earlier sessions and a typed validator between the model and the kernel, and avoids the degraded regions that Bayesian and reinforcement-learning tuners enter.
researchArea: Operating Systems
keywords: os tuning, llm, linux kernel, online optimization, bayesian optimization, telemetry, performance engineering
version: 1.0
updatedAt: 2026-11-18
---

## Overview

A modern operating system exposes a large control surface for scheduling, power management, memory and I/O, and the best setting depends on the workload, the hardware and the moment. Linux alone exposes more than 1,200 tunables. Tuning by hand needs a performance engineer for each workload on each server, so the common automation is Bayesian optimization or reinforcement learning (RL), which treat each knob as a number and search for a better scalar reward.

The authors, from Columbia University and IBM Research, study tuners that run out of band and in steady state: a host-side controller that, while a service keeps running, adjusts knobs such as the scheduler time slice or the network polling budget over seconds to minutes. They argue that classic tuners fail on live systems for one reason, which is that they ignore what the knobs mean. Using MLOS, the strongest classical baseline in the paper, as a running example, they describe three failures. The tuner makes semantically unsound changes: for Memcached under high load it repeatedly sets a minimum frequency above the maximum, or combines extreme busy polling, shallow idle states and very long scheduler windows, with tail latency up to 47 times worse. It fails when application metrics are not exposed: on PostgreSQL running the Wikipedia benchmark, replacing the application's latency with instructions per cycle or cache misses gives p99 latency 2 times worse. And it gets worse as the control surface grows: on TPC-C, p99 degrades sharply from 1 to 32 knobs.

This SOSP 2026 paper (Prague) answers with TuxBot, a framework that puts a language model inside the tuning loop as an online semantic reasoner, under bounds on cost, latency and authority.

Terms to keep apart: a knob is a tunable OS parameter (a sysctl, sysfs or debugfs value), a tuning window is a short measurement interval followed by at most one decision, semantically unsound covers both contradictory settings and valid-looking but nonsensical combinations for the workload, and a metastable regime is one where a system stays degraded after the trigger is gone.

Worth knowing first: Bayesian optimization with a surrogate model, how CFS, DVFS and idle states interact, and what p99 latency measures. Two library papers relate closely. [Xkernel](/papers/xkernel-principled-performance-tunability-of-os-kernels), which TuxBot cites, argues for turning fixed kernel constants into safely tunable runtime knobs, and [Metastable Failures in Distributed Systems](/papers/metastable-failures-in-distributed-systems) is the source for the metastable regime that traps the baselines on Xapian. A third link is mine and not the paper's: [cache_ext](/papers/cache-ext-customizing-the-page-cache-with-ebpf) shares the author Hubertus Franke and is also a Columbia and IBM work on making kernel policy customizable.

## Contribution

- **Semantic view of the system.** The model receives knob names and metadata, subsystem context, current telemetry and recent history, so it can reject contradictory combinations before trying them, infer application progress from a joint telemetry signature (CPU saturation, run-queue growth, memory pressure, power state, I/O wait) when the real metric is missing, and focus on the knobs that relate to the current bottleneck.
- **Dual-loop control.** An Instant loop with a fast, cheap model runs every tuning interval (1 to 5 seconds) for local exploration and corrections. A Reasoning loop with a stronger model runs every tens of seconds over a longer history and revises the strategy. Both read one shared context with a replacement policy: reasoning entries persist and instant entries are dropped once the next reasoning result lands, so the unbounded part of the context grows with the number of reasoning calls rather than instant ones.
- **Typed, validated actuation.** The model never gets a shell. Its reply follows a schema built from the active knob set, and a host-side Parameter Validator accepts only knobs in that set, checks numeric and categorical domains, expands per-core settings, and writes through sysctl, sysfs, debugfs, cpufreq and intel_pstate under a lock. A failed write keeps the previous configuration, and original settings are restored when the session ends. The authors motivate this with a terminal-enabled agent that, in their TPC-C runs, took CPU cores offline, wrote large dirty ratios, changed tuned profiles and rewrote block schedulers.
- **Memory at two timescales.** Within a run, a trace of actions, configurations and measurements feeds back into prompts. Across runs, each session is stored in a vector store (Gemini Embedding and ChromaDB), and a new session retrieves the top 3 earlier runs by first-window signature, which the reasoning model condenses into a short prior used as a soft hint. They found k=1 brittle and larger k averaging away relevant evidence.
- **Optional trimming mode.** The same machinery can first narrow the active knobs and ranges for a few live iterations and then hand a smaller space to MLOS (TuxBot-Trim).
- **Implementation.** A Python control plane with 6,374 lines for the core loop, telemetry and sessions and 3,775 lines for baselines, typed metadata for 41 Linux knobs, and backends for OpenAI, OpenRouter and Gemini models. Attaching application metrics to a new workload usually takes under 30 minutes, and system metrics need no change.

## Methodology

All runs use bare-metal CloudLab hosts with two Intel Xeon Silver 4114 processors (40 hardware threads), 192 GiB of memory, Ubuntu 22.04.2 and Linux 5.15, one benchmark at a time with the workload pinned to CPUs 0 to 9. The default tuned set has eight coupled knobs over CFS (`min_granularity_ns`, `latency_ns`, `wakeup_granularity_ns`, `migration_cost_ns`), idle state (`cstate_max`), NAPI polling and DVFS bounds (`min_perf_pct`, `max_perf_pct`). Scaling studies grow the set to 41 knobs.

There are 13 workloads from five suites (Mutilate for Memcached, BenchBase on PostgreSQL 14, Tailbench, Sysbench and DCPerf): ten latency-sensitive ones minimizing p99 (including TPC-C, Wikipedia, YCSB, Twitter, Masstree, Silo and Xapian) and three throughput ones. TuxBot uses Gemini 2.5 Flash for Reasoning and Flash-Lite for Instant at temperature 0.7. Baselines are the default configuration, MLOS with SMAC3, a Bayesian optimizer, tabular Q-learning, DQN, and the Trim variant, plus single-loop LLM tuners. A window is 5 seconds of measurement, a session is 30 tuning windows followed by a 20-window stable phase, each configuration runs five times, and the aggregate is the geometric mean of improvement factors over the default with standard deviation across reruns. For TuxBot the stable phase means no further changes after the last accepted action, while the continuously searching baselines keep tuning in windows 31 to 50.

## Findings

These are the authors' reported results.

- **End to end.** TuxBot improves the aggregate over default parameters by 59.36% during tuning and 72.49% in the stable phase. MLOS is at -33.79% and -31.91%, TuxBot-Trim at -30.62% and -26.14%, Bayesian at -45.77% and -37.46%, DQN at -40.41% and -44.49%. The headline figures are 72.5% over defaults and 153.3% over MLOS.
- **Catastrophic runs.** On Xapian and Memcached the baselines enter a queue-dominated metastable regime they cannot leave within the session. On the 11 other workloads TuxBot reaches +87.22% stable, against +50.52% for MLOS, +37.37% for Bayesian and +33.68% for DQN, and TuxBot-Trim reaches +63.93%.
- **Cost and loop design.** A 30-window session costs about $0.20 for TuxBot. A single Reasoning loop gets +89.7% for $0.42, a single Instant loop +25.4% for $0.12, and Trim +63.9% for $0.15 (all on the 11-workload subset, where the dual loop is +87.2%).
- **Missing metrics.** With system metrics only TuxBot reaches +21.7% while tuning and +31.9% stable, and with IPC alone +18.2% and +16.2%. On the 11-workload subset it keeps +64.0% with system metrics and +47.21% with IPC, while MLOS with application metrics gets +50.5% and falls to -24.1% on IPC and -22.8% on cache misses. The abstract reports 93.7 points of advantage over baselines given direct application metrics.
- **Safety.** Excluding catastrophic runs, the median fraction of windows worse than default is 16.9% for TuxBot against 28.8% for MLOS and 29.7% for Trim, and variability is 11.1% against 25.1% and 24.7%. On Xapian variability is 10.9% against 39120.2% for MLOS.
- **Scaling.** From 1 to 41 knobs on TPC-C, Sysbench OLTP-RW and Silo, TuxBot stays positive (+216.7% stable at 8 knobs, +213.4% at 16, +105% at 32, +155.9% at 41) while MLOS falls from +119.3% at 4 knobs to +19.6%, +28.3% and +13.0% at 16, 32 and 41 and is negative while tuning. MLOS median decision latency rises from 0.49 s to 5.73 s, TuxBot's Instant loop takes 1.01 to 2.55 s and its Reasoning loop 8.08 to 15.80 s.
- **Memory.** On three held-out workloads, a prior from the top 3 runs lifts the geometric mean from +86.3% and +144.7% (tuning and stable, application metrics) to +155.6% and +202.9% and cuts the error bars from 54.6 and 106.0 to 14.1 and 15.3. Top-1 is worse than no memory.

## Critical Analysis

The paper states several limits itself.

- **Steady state only.** TuxBot suits long-lived services with sustained demand, not short jobs, bursty workloads or overload episodes that need sub-second reactions, and it restarts after large drift.
- **One application per session.** Co-located applications would need reasoning about interference and partitioned control domains such as cgroups, which the authors leave to future work.
- **Trimming is not enough.** Narrowing the space helps MLOS but does not make the online path safe, since bad-window rates stay near MLOS's.

The following points are a reading of the evidence, not claims of the paper.

- **The headline numbers need care.** "153.3% over MLOS" is a ratio of geometric-mean factors (1.725 against 0.681), and MLOS is itself 31.9% worse than doing nothing, as are all the other baselines, so the comparison is to tuners that lose to the default. The abstract's "93.7 percentage points" matches the ratio 1.319 over 0.681 computed from the paper's own figures rather than a difference in points, which is 63.8.
- **The stable phase favors TuxBot by construction.** TuxBot stops changing after its last accepted action while the baselines keep exploring through windows 31 to 50, and exploration costs performance. A baseline frozen at its best configuration would be a fairer end-state comparison. The authors report tuning-phase numbers too, which show the same ordering.
- **The baselines are unconstrained.** MLOS is given no validity rules, and the authors argue that hand-written constraints do not generalize, but a simple one such as `min <= max` would remove one of the two failures shown in the running example. The 11-workload subset also excludes the workloads where baselines fail, a choice made after seeing the results, though both views are shown.
- **The validator is syntactic.** It enforces knob sets and domains, so the protection against numerically valid but nonsensical combinations, the Memcached failure, comes from the model's judgment, not from a check. The paper shows fewer bad windows, not a guarantee.
- **One model family and one testbed.** Results use Gemini 2.5 Flash and Flash-Lite at temperature 0.7 over a vendor API, five runs per cell, one CPU generation and one kernel version. How results move with another model, with a local model, or when telemetry cannot leave the host is not tested, and memory transfer is shown for three held-out workloads with memory built from the authors' own sessions.
- **Cost is the model bill only.** The $0.20 per session counts API calls, and the added host-side overhead of the controller and of 1 to 5 second decisions is not reported separately.

## Further Research

- Tuning several co-located applications, with cgroup-level knobs and multi-objective rewards.
- Detecting workload drift and deciding when to restart or resume a session, as the authors outline.
- Stronger guarantees on actuation than domain checks, for example learned or verified constraints on knob interactions.
- Testing other models, including local ones, other kernels and hardware, and sharing cross-run memory across machines.
