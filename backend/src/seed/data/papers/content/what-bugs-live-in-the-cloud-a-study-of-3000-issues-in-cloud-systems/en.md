---
title: "What Bugs Live in the Cloud? A Study of 3000+ Issues in Cloud Systems"
summary: A SoCC 2014 study that reads 21,399 issues from six Apache cloud systems (Hadoop MapReduce, HDFS, HBase, Cassandra, ZooKeeper, Flume), keeps 3,655 "vital" ones and classifies them by aspect, scope, hardware fault, software bug type and implication, finding new classes of bugs (consistency, scalability, topology), "killer bugs" that hit many nodes, and the public Cloud Bug Study database (CBS DB).
researchArea: Distributed Systems
keywords: cloud bug study, CBS DB, killer bugs, distributed concurrency bugs, error handling, scalability bugs, limpware, issue tracker analysis
version: 1.0
updatedAt: 2026-11-20
---

## Abstract

We conduct a comprehensive study of development and deployment issues of six popular and important cloud systems (Hadoop MapReduce, HDFS, HBase, Cassandra, ZooKeeper and Flume). From the bug repositories, we review in total 21,399 submitted issues within a three-year period (2011-2014). Among these issues, we perform a deep analysis of 3655 "vital" issues (i.e., real issues affecting deployments) with a set of detailed classifications. We name the product of our one-year study Cloud Bug Study database (CBS DB), with which we derive numerous interesting insights unique to cloud systems. To the best of our knowledge, our work is the largest bug study for cloud systems to date.

## Overview

This SoCC 2014 paper (Seattle, November 2014) is by Haryadi S. Gunawi and ten co-authors from the University of Chicago, Wisconsin-Madison and Surya University. Its starting point is a plain question: why are cloud systems not 100% dependable? Headline news about cloud downtime lacks the detail needed to answer it, but open-source systems come with public issue trackers holding reports, patches and developer discussion, which the authors call an "oasis" of insights.

The six systems stand for kinds of architecture: MapReduce for computing frameworks, HDFS for scalable storage, HBase and Cassandra for key-value stores, ZooKeeper for synchronization, Flume for streaming. They are the open-source relatives of designs in the catalog: [MapReduce](/papers/mapreduce-simplified-data-processing-large-clusters), [Google File System](/papers/google-file-system), [Bigtable](/papers/bigtable-distributed-storage-system-structured-data), [Dynamo](/papers/dynamo-amazons-highly-available-key-value-store) (the paper cites all four) and [Chubby](/papers/chubby-lock-service-loosely-coupled-distributed-systems), cited for synchronization services. For the systems themselves see [Cassandra](/papers/cassandra-decentralized-structured-storage-system) and [ZooKeeper](/papers/zookeeper-wait-free-coordination-internet-scale-systems). The paper is a sibling of [Simple Testing Can Prevent Most Critical Failures](/papers/simple-testing-can-prevent-most-critical-failures), which it cites for the point that error-handling flaws are testable, and it was written to show where bugs live, not to fix them.

## Contribution

- **CBS DB**: classification text files, data-mining scripts and graph utilities, with 25,309 annotations on the vital issues, released publicly.
- **A multi-label classification** of each vital issue: aspect, scope, hardware type and failure mode, software bug type, implication, plus a per-component label.
- **New bug classes** for cloud systems: data consistency, scalability and topology, and the "killer bugs" that affect many nodes or the whole cluster.
- **A set of lessons for tools**: dependability tools should be multi-dimensional, and race detectors should include fault injection.

## Methodology

The authors take issues submitted between 1/1/2011 and 1/1/2014 from the Apache issue trackers: 21,399 in total. For Hadoop MapReduce they use the MapReduce tracker, not the Hadoop one, which holds mostly development infrastructure. The raw labels (date, time to resolve, priority, patches, number of responses) come from the tracker's web API.

Each issue is read by hand, with its discussion and patches, and tagged "vital" or "miscellaneous". Vital issues are real problems of development and deployment that are marked as major priority. Miscellaneous ones are maintenance, refactoring, tests, documentation, and also real bugs that are easy to fix, which developers tend to mark minor. The paper reports 83% of the issues as miscellaneous on average, leaving 3,655 vital ones.

The labels (Table 1): aspect (reliability, performance, availability, security, consistency, scalability, topology, QoS); scope (single machine, multiple machines, entire cluster); hardware (core, disk, memory, network, node) with failure mode (corrupt, limp, stop); software bug type (logic, error handling, optimization, configuration, race, hang, space, load); implication (failed operation, performance, component downtime, data loss, staleness, corruption). An issue can carry several labels.

Threats to validity, as the authors state them: each issue is reviewed in at least two passes, ambiguities are discussed until the team agrees, and each cited issue was discussed by 3 to 4 people. The paper reports no agreement statistic.

## Findings

- **Aspects (Figure 1b, text of section 3).** Reliability 45%, performance 22%, availability 16%, then consistency 5%, scalability 2%, topology 1% and QoS 1%. The text gives no number for security, which the authors skip for lack of expertise (graph reading only).
- **Consistency.** Root causes are logic bugs in operational protocols (43%), data races (29%) and failure handling (10%). The authors note that systems often detect an inconsistency and keep running.
- **Scalability.** Causes are optimization (29%), space (21%) and load (21%); implications are performance (52%), downtime (27%) and failed operations (16%). Examples: a Cassandra recalculation of complexity Omega(n^3) that made nodes flap at 100-300 nodes, a MapReduce recovery of 16,000 mappers that took more than 7 hours, a ZooKeeper stampede when 1000 clients disconnect.
- **Killer bugs: 139 issues.** Forms: positive feedback loops (recovery adds load that causes more failures), buggy failover (the HBase metadata region server failover appears four times), repeated bugs after failover (three times for HBase), a small window of single point of failure, buggy start-up, distributed deadlock.
- **Hardware: 13% of issues, software 87% (Figure 3a).** Failure modes are stop, corruption and "limp". The authors found no report of CPU failure. HDFS, for one, assumes disk I/O eventually finishes.
- **Software bug types.** Logic 29%, error handling 18% (over 500 issues), optimization 15%, configuration 14%, data race 12%, hang 4%, space 4%, load 4%. Distributed data races, from message reordering plus failures, are more than 50% of the data-race bugs.
- **Implications.** Failed operations 42%, performance 23%, downtime 18%, data loss 7%, corruption 5%, staleness 5%. The heat maps (Figures 2 and 5) show that almost every cause can lead to almost every implication; I did not extract their cell counts.
- **Other CBS DB uses.** Top components include Cassandra Get (95) and Compaction (93), HBase RegionServer (418) and Master (239), MapReduce AM (141) (Table 2). Within the top 1% most-responded software bugs, optimization problems are more than 50%. MapReduce issues spike from mid-2011 to mid-2012, which the authors tie to the move to Hadoop 2.0 (YARN).
- **The conclusion on priorities.** From cases such as ignored inconsistencies, the authors conclude that cloud systems "favor availability over correctness". This is an inference from examples, not a measured rate.

## Critical Analysis

Strengths: the scale, manual reading of patches and discussion instead of keyword counts, and a data release that lets others redo the cuts. A caveat on that release: the CBS DB address in the paper (ucare.cs.uchicago.edu) did not resolve from my environment on 2026-11-20, so I could not check the data itself.

What the paper does not claim: the issues are the ones reported and resolved in six open-source Apache systems between 2011 and 2014, so the results are not about closed systems or later versions. The classification is manual and the paper reports no agreement measure. The percentages count labelled issues, not incidents, and a tracker issue is not a production outage; an issue can have several labels. "Vital" is the authors' filter and excludes easy-to-fix bugs. It does not claim that a given bug type causes most of the downtime of a real deployment.

Companion work the paper cites: SAMC (model checking, OSDI 2014) and Limplock (SoCC 2013). I did not read either. Catalog context, my pairing and not the paper's: [Gray Failure](/papers/gray-failure-achilles-heel-cloud-scale-systems) looks at the "limp" failures section 5 describes, and [Chaos Engineering](/papers/chaos-engineering-basiri) is a practice close to the live drills the paper cites (it names Chaos Monkey). Later literature (marked as such, read from the catalog entries and not from the papers): [Network-Partitioning Failures in Cloud Systems](/papers/analysis-of-network-partitioning-failures-in-cloud-systems) and [Metastable Failures in the Wild](/papers/metastable-failures-in-the-wild) study single failure classes in more depth, and the retry study [Retry Bugs](/papers/retry-bugs-insights-and-llm-informed-tooling) revisits error handling.

## Further Research

The authors call for dependability tools that are not one-dimensional: tools that find error-handling mistakes should not look only at failed operations, and data-race detectors must include fault injection. They also ask for distributed model checking, reproduction of distributed bugs, live drills of operational protocols at scale, topology-aware testing, automated space management, end-to-end QoS across stacked systems, and further study of configuration and error-handling issues in CBS DB.

Open questions, my reading and not the paper's: how the mix of aspects and bug types has moved in the same systems since 2014, and how the findings carry over to proprietary cloud services that expose no public tracker.
