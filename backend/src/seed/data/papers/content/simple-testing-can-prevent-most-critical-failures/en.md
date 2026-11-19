---
title: "Simple Testing Can Prevent Most Critical Failures: An Analysis of Production Failures in Distributed Data-Intensive Systems"
summary: An OSDI 2014 study of 198 real failures in Cassandra, HBase, HDFS, MapReduce and Redis finds that 92% of the catastrophic ones come from incorrect handling of non-fatal errors, many of them trivial, and builds Aspirator, a static checker for three such patterns that found 121 new bugs in 9 systems.
researchArea: Distributed Systems
keywords: failure study, error handling, exception handling, static analysis, Aspirator, catastrophic failures, failure reproduction, testing
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

Large, production quality distributed systems still fail periodically, and do so sometimes catastrophically, where most or all users experience an outage or data loss. The authors present the result of a comprehensive study of 198 randomly selected, user-reported failures that occurred on Cassandra, HBase, HDFS, Hadoop MapReduce and Redis, with the goal of understanding how one or multiple faults eventually evolve into a user-visible failure. From a testing point of view, almost all failures require only 3 or fewer nodes to reproduce. However, multiple inputs are needed to trigger the failures, with the order between them being important. The error logs of these systems typically contain sufficient data on both the errors and the input events that triggered the failure. The majority of catastrophic failures could easily have been prevented by simple testing on error handling code, the last line of defense. The authors extracted three simple rules from the bugs behind some of the catastrophic failures and built a static checker, Aspirator, that locates them. Over 30% of the catastrophic failures would have been prevented had Aspirator been used and the bugs fixed. Running it on 9 distributed systems located 143 bugs and bad practices that were fixed or confirmed by the developers.

## Overview

Systems like HDFS and HBase are designed to survive node failures, yet they still have outages. This OSDI 2014 paper (Broomfield), by Ding Yuan, Yu Luo, Xin Zhuang, Guilherme Renna Rodrigues, Xu Zhao, Yongle Zhang, Pranay U. Jain and Michael Stumm of the University of Toronto, asks how a fault becomes a failure that users see. Earlier studies looked at one link of that chain (root causes, bug types, symptoms). The authors say theirs is, to their knowledge, the first to study the end-to-end manifestation sequence.

Terms, as the paper uses them: a **fault** is the root cause (hardware, bug or misconfiguration); an **error** is abnormal behavior such as a Java exception or a failed system call; a **failure** is a malfunction noticed by users or operators. A failure is **catastrophic** when it prevents all or a majority of users from normal access: a cluster-wide outage, a hung cluster, or loss of all or most user data.

Catalog context, my pairing and not the paper's: the studied systems are open-source relatives of [MapReduce](/papers/mapreduce-simplified-data-processing-large-clusters), [Bigtable](/papers/bigtable-distributed-storage-system-structured-data), [Dynamo](/papers/dynamo-amazons-highly-available-key-value-store) and [The Google File System](/papers/google-file-system). The paper's concern with failure causes is complementary to [Gray Failure](/papers/gray-failure-achilles-heel-cloud-scale-systems), which is about failures that detectors miss, and to [Metastable Failures in Distributed Systems](/papers/metastable-failures-in-distributed-systems), about outages sustained by feedback loops. Here the weak link is the error handler.

## Contribution

- **A failure corpus with a full manifestation sequence per case.** For each ticket the authors read the report, the developer discussion, the logs, the code and the patch, and manually reproduced 73 of the 198 failures.
- **Twelve findings** on complexity, input events, nodes, timing, logs, reproducibility and catastrophic failures.
- **The error-handling result.** 92% of the catastrophic failures come from incorrect handling of non-fatal errors that the software explicitly signaled. 35% are trivial mistakes (empty or log-only handler, abort in an over-broad catch, a "TODO" or "FIXME" in the handler), and another 23% would be exposed by 100% statement coverage of the handler.
- **Aspirator**, a rule-based static checker for the three trivial patterns, built on the Chord analysis framework over Java bytecode.
- **A recommendation** of a bottom-up approach: start from error-handling code and reverse engineer test cases, instead of only injecting faults top-down.

## Methodology

Failures come from the issue trackers of the five systems. The authors kept tickets with priority Blocker, Critical or Major, dated 2010 or later, confirmed by developers and with a patch or configuration fix, dropped duplicates, filtered out testing-system failures heuristically (reporter equals assignee), and sampled at random. Table 1 gives reported, sampled and catastrophic counts: Cassandra 3,923 / 40 / 2, HBase 5,804 / 41 / 21, HDFS 2,828 / 41 / 9, MapReduce 3,469 / 38 / 8, Redis 1,192 / 38 / 8; total 17,216 / 198 / 48. Every failure was investigated by two inspectors with a written classification method.

The authors list limits themselves. Only distributed data-intensive systems were studied (mixed master-slave and peer-to-peer, Java and C), so telecom or scientific systems may differ. Tickets document bugs, so misconfigurations are under-represented and the paper draws no conclusion on the distribution of faults. They estimate a 6.9% margin of error at 95% confidence for 198 samples.

Aspirator scans bytecode, finds the catch block for each instruction that can throw, and warns on an empty or log-only handler, a "TODO" or "FIXME", or a catch of Exception or Throwable that may hide several exceptions and calls abort or System.exit. Two heuristics cut false positives: it skips empty handlers when the try block sets a variable that is checked after the catch, and the authors configured it to ignore FileNotFound and exceptions from shutdown, close and cleanup methods.

## Findings

- **Complexity.** 77% of failures need more than one input event, 90% need no more than 3 (Table 3: 1 event 23%, 2 events 50%, 3 events 17%). Order matters in 88% of the multi-event ones. Starting a service is needed in 58%, a client write in 32%, an unreachable node in 24%, a configuration change in 23%, adding a node in 15%.
- **Nodes.** 98% manifest on at most 3 nodes and 84% on at most 2. One failure needed over 1,024 nodes.
- **Timing.** 74% (147 of 198) are deterministic. Of the 51 non-deterministic ones, 53% have timing constraints only on input events; the rest are atomicity violations (13), deadlocks (3), lock contention (4) and other (4).
- **Logs.** 76% print explicit failure messages and 84% log all triggering events, but logs are noisy: the median is 824 messages per failure.
- **Reproducibility.** 77% (153 of 198) can be reproduced by a unit test; Redis is lowest at 58% because its test framework is limited to commands.
- **Catastrophic failures.** 48 of 198 (24%). Symptoms: data loss or potential data loss 19 of 40, hung system 9 of 23, unexpected termination 17 of 74. Incorrect error handling appears in 92% of them but in only 25% of the non-catastrophic ones. Only four were not caused by it.
- **Breakdown of the 35%.** 25% ignored errors, 8% abort in an over-caught exception, 2% "TODO". Of the other 57%, 23% are easily detectable (statement coverage would expose them) and 34% are complex bugs.
- **Aspirator.** Applied to the studied failures, it would have prevented 33% of the catastrophic failures in Cassandra, HBase, HDFS and MapReduce. On 9 systems (36,745 handler blocks in Table 9) it reported 121 bugs and 379 bad practices plus 115 false positives (19% of warnings), in under 15 seconds per system. The authors reported 171 cases: 143 confirmed or fixed (73 fixed), 17 rejected. Cassandra had the lowest bug-to-handler ratio.

## Critical Analysis

What the paper does not claim. It does not say error handling causes most failures in general: the 25% figure for non-catastrophic ones is the contrast. It does not say distributed systems beyond data-intensive ones follow the same pattern. It does not claim Aspirator finds the complex 34%, and says detecting those needs system knowledge. It does not evaluate Aspirator on Redis, since it only handles Java bytecode. The title says "most", while the abstract says a majority (58% for the combined trivial and easily detectable classes).

My reading, not the paper's:
- The rules were extracted from the same failures that Aspirator is then scored against, so the 33% is a retrospective fit, not a prediction. The 9-system run is the independent evidence.
- The "easily detectable" 23% rests on the authors' manual judgment of each handler.
- Of the 87 "bad practices" they reported, 17 were rejected, and some developers objected to handling every exception. Value depends on the team's norms.
- Issue-tracker data over-represents confirmed software bugs, as the authors acknowledge.

Later literature, not part of this paper, and I only read abstracts: "Chaos Engineering" (Basiri et al., IEEE Software 2016, arXiv 1702.05843) argues for production experiments to verify reliability, which is a top-down approach in the sense used here. "Elle" (Kingsbury and Alvaro, arXiv 2003.10554) infers isolation anomalies from client-observed histories under fault injection, a different target (isolation violations, not error handlers). Both are my pairings, not claims by this paper.

## Further Research

- The authors leave open how bug age relates to code age (whether the buggy code was newly added) and note that tools like symbolic execution could be extended to reach error-handling blocks purposefully.
- Extending Aspirator beyond Java: they suggest system call error returns, switch fall-through and calls to abort as likely error conditions.
- Inter-procedural analysis, which the authors identify as the main source of false positives.
- Log analysis that filters the relevant error and input-event messages out of noisy logs.
- Catalog follow-ups on related themes: [Efficient Reproduction of Fault-Induced Failures](/papers/efficient-reproduction-of-fault-induced-failures-in-distributed-systems) (reproducing failures by fault injection, per its catalog entry) and [Retry Bugs](/papers/retry-bugs-insights-and-llm-informed-tooling) (a later study of one kind of error-handling code), both read here only through the catalog summaries.
