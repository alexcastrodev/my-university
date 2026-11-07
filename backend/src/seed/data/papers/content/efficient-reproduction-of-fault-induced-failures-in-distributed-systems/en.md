---
title: "Efficient Reproduction of Fault-Induced Failures in Distributed Systems with Feedback-Driven Fault Injection"
summary: Anduril reproduces production failures caused by external faults by searching exception sites and injection timings, using a static causal graph to propose candidates and the log of each unsuccessful injection to reorder what to try next.
researchArea: Distributed Systems
keywords: failure reproduction, fault injection, static causal analysis, feedback-driven search, log analysis, debugging, anduril
version: 1.0
updatedAt: 2026-11-07
---

## Overview

Reproducing a failure is usually the first step of debugging it, and in a distributed system it is often the hardest. This SOSP 2024 paper (Austin), by Jia Pan and Haoze Wu (Johns Hopkins University), Tanakorn Leesatapornwongsa and Suman Nath (Microsoft Research) and Peng Huang (University of Michigan), targets failures that a workload alone cannot trigger because the bug only fires when an external fault, such as a disk error, a network fault or a broken dependency, strikes at a specific moment. The authors cite an earlier study in which developers spent 69% of resolution time reproducing the failure.

Existing fault injectors are built to find bugs, so they chase coverage. The search space is huge, since a fault can hit many execution points and each point can run many times. Record and replay tools need production instrumentation and add overhead, and Pensieve, the closest prior work, reconstructs inputs, not faults.

Five terms carry the paper. A **fault site** is a program point that can throw an exception, and a **fault instance** is one execution of it. The **failure oracle** is a user-written check of the symptom (a log message, a stack trace, a corrupted file). **Observables** are log messages that appear in the production failure log but not in a normal run. Anduril is the tool.

Worth knowing first: Java exceptions and logging, and the ZooKeeper, HDFS, HBase, Kafka and Cassandra stack that the evaluation draws from. A pairing of mine, not the paper's: [Metastable Failures in Distributed Systems](/papers/metastable-failures-in-distributed-systems) describes outages sustained by feedback loops after a trigger ends. Anduril targets faults that surface as exceptions and the authors list delays and silent error codes as out of reach, so a failure sustained by retries or overload would need a different tool.

## Contribution

- **Problem setting.** The inputs are the system code (analyzable, instrumentable, runnable offline), an unfiltered failure log from an uninstrumented production system, a driving workload (an existing test, one from a ticket, or one built from the symptoms) and the oracle. The output is the root-cause fault, its site and its timing, plus a script that injects it deterministically. The scope is JVM systems and failures with a single root-cause exception. The authors sampled 50 failures from the five systems and found 41 triggered by external faults, 39 of those by exactly one.
- **Key idea.** Faults have correlated effects, such as reaching the same catch block or printing the same log, so the log of one failed injection says which untried faults are probably futile. The authors treat reproduction as a search problem, and distinguish their feedback from the coverage feedback of fuzzing.
- **Static causal graph.** The Instrumenter, built on Soot, starts from the relevant log messages and walks backward through location, condition and invocation nodes, using the jumping strategy of Pensieve. The authors add handler nodes and three exception node kinds (internal, new, external), and cross-thread analysis for futures. The sources of the graph are the fault sites. It is conservative and imperfect: for the HBase motivating case it has 357,816 vertices and 868,373 edges. The Instrumenter also adds tracing and injection code at each site.
- **Relevant observables.** The Explorer runs the workload once with no fault and diffs that log against the failure log per thread name, after removing timestamps (Myers diff). Messages only in the failure log become observables. Because the failure log is fixed, the same graph serves every round.
- **Feedback.** Each observable has a counter, starting at zero, where smaller means higher priority. After a failed injection, every observable present in that run has its counter raised by one, so faults tied to still-missing observables rise. A site's priority is the minimum, over the observables it reaches, of graph distance plus counter, since distant observables are less certain.
- **Instances and window.** An instance is ranked by logical time, the number of log messages between it and the observable, with the normal run's timeline aligned to the failure log by longest common subsequence. The site is chosen first and then its instance. A flexible window holds the top k candidates (k starts at 10) and doubles after a round where nothing was injected, bounding wasted rounds by O(log n).
- **Implementation.** Java, with about 3,700 lines for the Instrumenter and 5,600 for the Explorer, a Scala log parser and the diff in C. Log formats need two regex configurations across the five systems. The code is open source.

## Methodology

The authors searched the JIRA trackers of ZooKeeper, HDFS, HBase, Kafka and Cassandra for fault-related issues, collected 40 that needed non-trivial reasoning, randomly chose 22 and report every attempt. The systems range from 120K to 1,649K lines (ZooKeeper 4 failures, HDFS 7, HBase 6, Kafka 3, Cassandra 2). Workloads are existing tests for 13 failures, ticket-provided for 6, and written by the authors for 3, averaging 185 lines, and none triggers its failure without an injected fault. Oracles come from the known ground truth of these resolved issues, and where a ticket had no log the authors reproduced the failure first to obtain one.

Runs used servers with 20 cores at 2.20 GHz, 64 GB and Ubuntu 18.04, on CloudLab. The metrics are wall-clock time and injection rounds, with a 24-hour cap. Comparisons are CrashTuner and FATE, five ablation variants inside Anduril (exhaustive over the causal graph, fault-site distance, the same with a 3-instance limit, fault-site feedback, and a multiply-feedback combination), and a stacktrace injector the authors wrote. Pensieve was not available. Further experiments vary k and the observable adjustment, and measure Explorer and static-analysis cost.

## Findings

These are the authors' reported results.

- **Reproduction.** All 22 failures are reproduced with the root-cause fault at the right time. The median is 8 minutes and 11 rounds, 12 cases take under 10 minutes and fewer than 20 rounds, and the longest is 445 minutes (281 rounds, HBase-16144). For six tickets that record it, the median manual reproduction took 136 hours.
- **Fault space.** The graph keeps few sites, for example a mean of 572 of 6,225 in ZooKeeper and 1,134 of 45,109 in Kafka. In the motivating HBase case, the root-cause site runs over 1,000 times and only 2 instances satisfy the oracle. Anduril reproduced it at round 18, from an initial rank above 130 and 53 relevant observables.
- **Versus other tools.** CrashTuner reproduces 4 failures and FATE 3, and the authors report that where they succeed they take 6× to 280× longer. The stacktrace injector reproduces 9, averaging 78 minutes and 230 rounds, and does well only when the root-cause fault appears in the log.
- **Ablation.** The best variant, multiply feedback, reproduces 15 failures in 88 minutes and 71 rounds on average. Exhaustive search over the same graph is much worse (6 failures in Table 2), which the authors read as dynamic feedback being essential, and the two-level site-then-instance order beating a simple product.
- **Hardest case.** HBase-16144 has 3,075 candidate sites and one nearby ABORT message tied to over 2,500 of them. The root-cause rank only improves from 342 to 187 through feedback, and instance ordering finishes the job at round 281.
- **Sensitivity.** Anduril still reproduces most failures under every setting and differences are small for most cases.
- **Cost.** Per-decision latency is 0.2 to 29.10 µs. Per-round initialization runs from 6.7 s (ZooKeeper) to 124 s (Cassandra), and static analysis from 11 s to 344 s.
- **New root causes.** For five cases Anduril found a different, deeper root cause than the developers' diagnosis. In four, the original patch does not cover the scenario, in a fifth the authors wrote a more efficient patch, and developers confirmed three as new bugs plus the patch.

## Critical Analysis

The paper is explicit about where Anduril stops working. It names these limits.

- **Unsupported failures.** Delays and silent error codes that throw no exception, failures needing several causally independent root-cause faults, workloads that miss the faulty path, and logs too weak to tell faulty from normal runs. The evaluated systems log enough, a point the authors state outright.
- **Concurrency and soundness.** Interleavings must be enforced by the workload, and if concurrency drops crucial log lines success becomes probabilistic. The static analysis is neither sound nor complete, and a reproduced symptom can come from a bug different from the production one.
- **Noisy production logs.** The logs used are small because they come from test workloads, and the authors note that real logs will be larger and noisier. Failures that are not fault-induced were not tried, and would run to a limit such as 2000 trials.

The following points are a reading of the evidence, not claims of the paper.

- **Cleaner inputs than production.** Every failure is a resolved ticket with known ground truth, which is how the oracle was written, and the paper does not say how many logs the authors regenerated themselves. The claim about production failures rests on logs and oracles that were easier than a real incident's.
- **One number per cell, no spread.** The text reports no repetitions or variance in Table 2, although the systems are nondeterministic and the window picks whatever candidate happens to occur. A case like HBase-19876 at 258 rounds could vary run to run.
- **Costs of the inputs are outside the clock.** The 8 minutes exclude building the workload and oracle (one of the authors' three workloads took longer because of a thread interleaving). The 136 hours come from six tickets that the paper does not say are among the 22, so the two numbers are not the same quantity.
- **Baselines are not like-for-like.** CrashTuner and FATE are bug finders and the authors say so. The text does not describe how they were adapted to the five systems, and Pensieve is absent. The ablations over one causal graph are the cleaner comparison.
- **Parameters are tuned on the test set.** The defaults and the sensitivity study use the same 22 failures. The spread is real: k=1 takes 715 rounds on HBase-19876 against 258, and raising the adjustment to 10 pushes HDFS-12248 from 16 to 649 rounds and leaves HBase-20583 and HBase-25905 unreproduced.
- **The fault model is narrow.** In Table 5, 19 of 22 injected faults are IOException, and an injection is a throw at a site. Machine crashes, partitions and slow nodes are not part of it.
- **Internal inconsistencies.** The introduction says CrashTuner and FATE reproduced "4 of 22 respectively", while Section 8.4 and Table 2 give 4 and 3, and the body figures are used here. Section 8.4 also gives 1,839 rounds and 634 minutes for HDFS-15032, while Table 5 gives them to Kafka-9374 (and 11 rounds, 22 minutes to HDFS-15032), which is the only reading that gives the stated averages. The five new-root-cause cases in the appendix (Table 6) carry IDs that are not among the 22 in Table 5.

## Further Research

- Exploring thread interleavings and faults together, for failures that combine a concurrency bug with a fault, which the authors name as future work.
- Failures with several root-cause faults. The authors suggest using Anduril's near-miss logs to fix one fault at a time in the workload and rerun.
- Faults that are not exceptions, such as delays, slow disks and silent error codes, and systems in languages beyond the JVM.
- A fuller evaluation with production-sized noisy logs, repeated runs, and the full cost of building the workload and oracle counted.
