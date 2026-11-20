---
title: "Consistency Tradeoffs in Modern Distributed Database System Design: CAP is Only Part of the Story"
summary: Abadi argues, in a six-page opinion and synthesis article, that CAP constrains a distributed database only while a network partition lasts, and that the tradeoff between consistency and latency present during normal operation explains more of the reduced-consistency designs of the 2000s. He proposes PACELC to state both choices at once and places Dynamo, Cassandra, Riak, PNUTS, MongoDB, HBase, VoltDB/H-Store and Megastore in its quadrants.
researchArea: Distributed Systems
keywords: PACELC, CAP theorem, consistency-latency tradeoff, data replication, network partitions, quorum replication, distributed database systems, PNUTS
version: 1.0
updatedAt: 2026-11-20
---

## Abstract

The CAP theorem's impact on modern distributed database system design is more limited than is often perceived. Another tradeoff, between consistency and latency, has had a more direct influence on several well-known DDBSs. A proposed new formulation, PACELC, unifies this tradeoff with CAP.

## Overview

Daniel J. Abadi (Yale University) published this in IEEE Computer, volume 45, number 2, February 2012, pages 37 to 42, as a cover feature. It is a short article for practitioners, not a research paper: it has no experiments of its own and leans on two studies by others. The setting is the decade after [Brewer's conjecture](/papers/brewers-conjecture-cap-feasibility-web-services) was proved, when systems such as [Dynamo](/papers/dynamo-amazons-highly-available-key-value-store) and [Cassandra](/papers/cassandra-decentralized-structured-storage-system) gave up consistency by default and CAP was the usual explanation.

Abadi says the explanation is wrong or at least incomplete. The consistency he discusses is the atomic or linearizable one that Gilbert and Lynch used in their proof (see [Linearizability](/papers/linearizability-correctness-condition-concurrent-objects)). Related catalog entries: [Eventually Consistent](/papers/eventually-consistent-vogels) for the N, W, R quorum settings the article relies on, and [Bigtable](/papers/bigtable-distributed-storage-system-structured-data), which the article lists together with HBase.

Worth knowing first: what a network partition is, the meaning of consistency, availability and partition tolerance in CAP, and quorum reads and writes with R + W > N.

## Contribution

- **A reading of CAP.** CAP posits limitations only in the face of certain failures. It is not partition tolerance alone but partition tolerance together with an actual partition that forces a choice between availability and consistency. In the baseline case CAP allows the full set of ACID guarantees together with high availability.
- **A second tradeoff, always present.** Any system that replicates data (needed for high availability) must trade consistency against latency, with or without partitions. The article treats availability and latency as arguably the same thing: an unavailable system essentially has extremely high latency.
- **PACELC.** If there is a partition (P), how does the system trade off availability and consistency (A and C); else (E), when running normally, how does it trade off latency and consistency (L and C).
- **A classification.** The article labels well-known systems with the four-letter code, and argues from PNUTS that the choice to reduce consistency in the baseline case is not attributable to CAP.

## Methodology

No measurement. The method is an argument by enumeration. The article first lists the contexts in which the systems were built (Amazon's shopping cart for Dynamo, Facebook's Inbox Search for Cassandra, LinkedIn's write-intensive features for Voldemort, Yahoo's page-view data for PNUTS, Amazon-like use cases for Riak) and cites Google's study that an extra 100 ms can dramatically reduce the probability that a customer keeps interacting or returns. It then claims there are only three ways to replicate: updates sent to all replicas at the same time, to an agreed-upon master node first, or to an arbitrary node first. Each is crossed with synchronous, asynchronous, or mixed replication and with where reads are served, and for every combination the article names the latency cost or the consistency loss. Two outside studies, on Cassandra and on SimpleDB, serve as evidence. Systems are then placed in PACELC from their default design, and the article says its focus is the original design, not settings made adjustable after the first releases.

## Findings

- **Why consistency costs latency.** All-replicas-at-once needs an agreement protocol or a preprocessing layer to avoid divergence, and either adds latency. A master node with synchronous replication waits for the slowest replica, especially over a WAN. With asynchronous replication, reading only from the master keeps consistency but loses the nearby replica and any load balancing, while reading from any node is fast but can return different versions. Sending updates to an arbitrary node first adds the cost of resolving simultaneous updates to the same item. With a quorum, R + W > N keeps consistency and R + W <= N allows inconsistent reads.
- **Evidence from others.** Rao, Shekita and Tata found in Cassandra that quorum reads against weak reads can differ in latency by a factor of four or more. Wada and colleagues found no significant extra latency for consistent reads in SimpleDB, but only inside one region, and the article suspects master-slave replication over a short distance.
- **PNUTS as the clearest case.** It masters each item, replicates asynchronously over a WAN, and serves reads from any replica, which is option (2)(b)(ii). In a partition that cuts off the master, the default is to make the item unavailable for updates, so by default it is CP.
- **Placement in PACELC.**

| System | Class |
|---|---|
| Dynamo, Cassandra, Riak | PA/EL |
| VoltDB/H-Store, Megastore | PC/EC |
| BigTable, HBase | PC/EC |
| MongoDB | PA/EC |
| PNUTS | PC/EL |

Dynamo, Cassandra and Riak use a combination of options (2)(c) and (3) and, per the article, switch more fully to (3) during a partition, with reconciliation code. Voldemort and SimpleDB are discussed but not given a class in the PACELC section. PC/EL does not mean fully consistent: PC means the system does not reduce consistency beyond its baseline level during a partition.

## Critical Analysis

- **Opinion, not evidence.** The article presents no measurement of its own. Its main empirical support is two third-party studies, which it says seem to contradict each other until the SimpleDB setting is considered. That the consistency/latency tradeoff is "arguably" more influential than CAP is the author's reading, as is the claim that Dynamo-style systems reused partition-handling code for the baseline choice.
- **Classification is interpretation.** The labels come from the default configuration at the time, and the text notes that consistency of some systems became adjustable after the first releases. I did not check how any of these products behave today, so the table should be read as a 2012 snapshot. The article itself calls PC/EL confusing and classifies MongoDB as PA/EC while noting it is technically not available under CAP's definition.
- **Not claimed.** The article does not say CAP is wrong, that partitions never matter, or that latency is the only reason systems relax consistency. It states neither the cost nor the frequency of partitions in numbers, only that they are "somewhat rare" and often less frequent than other failures, citing a blog post.
- **Later systems in the catalog (comparison made here, not in the article).** [Highly Available Transactions](/papers/highly-available-transactions-virtues-and-limitations) (2013) measures the latency gap between coordination-free and coordinated designs, and [COPS](/papers/dont-settle-for-eventual-scalable-causal-consistency-cops) (2011) aims at causal consistency with low latency. [Spanner](/papers/spanner-globally-distributed-database) (2012) appeared after this article and is not classified in it.

Later literature, not part of the article. Brewer's "CAP twelve years later: How the rules have changed" appears in Crossref in the same issue of Computer (volume 45, issue 2, pages 23 to 29, DOI 10.1109/mc.2012.37). I read only that metadata, not the text, and cannot say what it says about PACELC.

## Further Research

- Measure the consistency/latency tradeoff across regions for the same system and workload, which the article only argues from two studies.
- Quantify how rare partitions are in different deployments, since the article's premise rests on a general claim.
- Classify systems by their current configuration options, not only their original design.
- Relate PACELC to weaker consistency models that need no synchronous coordination, such as causal consistency.
