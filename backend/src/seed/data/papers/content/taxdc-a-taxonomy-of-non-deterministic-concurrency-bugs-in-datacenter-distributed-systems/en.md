---
title: "TaxDC: A Taxonomy of Non-Deterministic Concurrency Bugs in Datacenter Distributed Systems"
summary: An ASPLOS 2016 study of 104 distributed concurrency bugs in Cassandra, HBase, Hadoop MapReduce and ZooKeeper, classified by hand along triggering, error and fix, finding that most are caused by one untimely message, that 63% need a fault, and that most are fixed by ignoring, delaying or accepting the message.
researchArea: Distributed Systems
keywords: distributed concurrency bugs, bug taxonomy, order violation, atomicity violation, message timing, fault timing, model checking, bug study
version: 1.0
updatedAt: 2026-11-20
---

## Abstract

We present TaxDC, the largest and most comprehensive taxonomy of non-deterministic concurrency bugs in distributed systems. We study 104 distributed concurrency (DC) bugs from four widely-deployed cloud-scale datacenter distributed systems, Cassandra, Hadoop MapReduce, HBase and ZooKeeper. We study DC-bug characteristics along several axes of analysis such as the triggering timing condition and input preconditions, error and failure symptoms, and fix strategies, collectively stored as 2,083 classification labels in TaxDC database. We discuss how our study can open up many new research directions in combating DC bugs.

## Overview

This paper (ASPLOS '16, Atlanta, April 2016, pages 517 to 530) is by Tanakorn Leesatapornwongsa, Jeffrey F. Lukman, Shan Lu and Haryadi S. Gunawi, from the University of Chicago and Surya University. The problem is a kind of bug that single-machine tools do not see. A local concurrency (LC) bug comes from the interleaving of threads on one node. A distributed concurrency (DC) bug comes from the non-deterministic timing of distributed events: message arrivals, node crashes, reboots and timeouts, on machines with no common clock. The authors argue that testing, model checking and verification had little real data about these bugs, because earlier cloud studies did not separate them from LC bugs.

The paper is a direct sequel of [What Bugs Live in the Cloud?](/papers/what-bugs-live-in-the-cloud-a-study-of-3000-issues-in-cloud-systems): it starts from that study's public database, filters the concurrency issues and goes deeper on one class. The four systems are open-source relatives of designs in the catalog: [Cassandra](/papers/cassandra-decentralized-structured-storage-system), [ZooKeeper](/papers/zookeeper-wait-free-coordination-internet-scale-systems), [MapReduce](/papers/mapreduce-simplified-data-processing-large-clusters) and HBase, which follows [Bigtable](/papers/bigtable-distributed-storage-system-structured-data). Its method of reading real failures by hand also appears in [Simple Testing Can Prevent Most Critical Failures](/papers/simple-testing-can-prevent-most-critical-failures) and, for network partitions, in [Network-Partitioning Failures in Cloud Systems](/papers/analysis-of-network-partitioning-failures-in-cloud-systems).

## Contribution

- **A taxonomy with three stages** (Table 1): triggering (timing condition, input preconditions, scope), errors and failures, and fixing.
- **The TaxDC database**: 2,083 classification labels and 4,528 lines of re-description written by the authors, with the re-enumerated steps of each bug. The authors present it as the first large-scale DC-bug benchmark.
- **Six findings** on how DC bugs trigger, surface and get fixed, plus a list of common developer misconceptions behind them.
- **Lessons for tools** (section 8): model checkers, specifications, detection, diagnosis, prevention and fixing, verifiable frameworks, and a comparison of LC and DC bugs.

## Methodology

Over 30,000 issues exist in the JIRA trackers of the four systems, and few use words such as "race". So the authors start from the Cloud Bug Study (CBS) database, which already labels concurrency issues, remove LC bugs, drop DC bugs without a clear description, and randomly pick 104 of the rest: 19 Cassandra, 30 HBase, 36 MapReduce (including Yarn) and 19 ZooKeeper bugs, reported from January 2011 to 2014.

For each bug they check that developers marked it as real, re-enumerate the steps into a short sequence, and have every author review each classification. The authors' own caveats: only fixed bugs with clear descriptions are covered, and the statistics should not be generalized because each system has its own purpose and design. The paper reports no agreement statistic.

A DC bug is described by the smallest set of concurrent events whose order guarantees the failure (the timing condition) and by the inputs and faults needed to reach it (the input preconditions).

## Findings

- **Finding 1, timing (Table 2, Figure 3a).** Untimely messages trigger 64% of the bugs: order violations 44% (46 bugs only) and atomicity violations 20% (21 bugs only). Untimely faults or reboots trigger 32%, and 4% need both. The order to atomicity ratio is 2:1 overall, 1:2 in ZooKeeper and 6:1 in MapReduce. Order violations are races between two messages or between a message and a local computation.
- **Finding 2, preconditions.** 63% of the bugs need at least one fault, 80% involve several protocol initiations and 81% involve background protocols. The bugs touch 39 distinct protocols (10, 13, 10, 6 per system). Only 18 bugs need no fault and one protocol, 8 of them in foreground protocols (section 8.1).
- **Finding 3, scope.** More than 90% involve one to three messages, nodes and protocols, and 92% need a single untimely event. Maximum 7 messages. Only eight bugs need more than one untimely event; Cassandra bug c6023 needs three message races.
- **Finding 4, errors (Table 3).** First errors are local in 46% and global in 54%; 53% are explicit and 47% silent. Local: memory exception 5, semantic error 21, hang 10, silent 15. Global: wrong message 33, missing message 10, silent 18 (Table 3 counts; the text percentages match a base of 112 first errors, my computation). Failures: operation failure 47%, data loss or corruption 28%, node downtime 17%, slowdown 8%.
- **Finding 5, fixes (Tables 4 and 5).** 30% are fixed by changing the timing (Figure 3p) and 40% by handling the message: retry later 4, ignore 12, accept with an existing handler 18, other 11. For fault timing bugs: 3 global and 5 local synchronization, cancel operation 13 (Table 5).
- **Finding 6, misconceptions.** "One hop is faster than two", "no hop is faster than one hop", "atomic blocks cannot be broken", "interactions between multiple protocols seem to be safe", "enough states are maintained".
- **Other (section 7).** Median: 9 re-enumerated steps, 172 lines of patch, 14 days to resolve, 18 comments. 46% were found in deployment and 10% by failed unit tests.

## Critical Analysis

Strengths: the manual reading of every bug, the per-system tables and a database others can reuse. Weak points the paper admits: it covers only fixed, well-described bugs, and the authors suggest the small triggering scope may reflect that complicated bugs are harder to fix and so less often included. One internal detail to know: section 5.1 says "only one fifth" of message timing bugs are fixed by changing timing, but Table 4 lists 4 global and 19 local timing fixes. I could not reconcile that with about 67 message timing bugs, so I rely on the 30% of Figure 3p.

What the paper does not claim: the bugs are reported and fixed ones from four open-source systems, classified by hand, so it gives no incidence in production and no result for other systems. It does not claim that the taxonomy is covered by any detector. Section 8 discusses implications for model checkers (MaceMC, MoDist, Demeter, SAMC), specification inference, record and replay, and runtime prevention, but it does not run or measure any of them, so those are suggestions and not results.

Later literature (read from catalog entries, not from the originals, and I did not check whether they cite TaxDC): [Efficient Reproduction of Fault-Induced Failures](/papers/efficient-reproduction-of-fault-induced-failures-in-distributed-systems) reproduces failures by injecting faults, [Metastable Failures in the Wild](/papers/metastable-failures-in-the-wild) and [Chaos Engineering](/papers/chaos-engineering-basiri) study the production side, and [Elle](/papers/elle-inferring-isolation-anomalies-from-experimental-observations) is a black-box checker for isolation. These pairings are mine, not the authors'.

## Further Research

The authors list directions: model checkers that control all the needed events (messages, crashes, reboots, timeouts, storage faults) and scale through the small scope of Finding 3; timing specifications inferred from explicit errors or learned invariants; pairwise testing of message orderings and protocols; failure diagnosis with statistical debugging and dependence analysis across nodes; runtime prevention by delaying messages; automatic fixing by reordering sends, ignoring or delaying messages; verification of whole systems including background protocols; and new DC bugs from 2014 and 2015 added to TaxDC.

Open question, my reading and not the paper's: how much of the taxonomy holds for systems built after 2014 on deterministic or verified protocol stacks.
