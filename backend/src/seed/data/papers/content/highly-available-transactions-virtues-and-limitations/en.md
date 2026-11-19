---
title: "Highly Available Transactions: Virtues and Limitations"
summary: Bailis and colleagues classify which transactional isolation levels and replica consistency models can be offered with high availability, meaning no synchronous coordination between replicas even under partition, and which cannot, then measure a prototype on EC2 to show the latency gap against coordinated designs.
researchArea: Distributed Systems
keywords: highly available transactions, sticky availability, weak isolation, Read Committed, Monotonic Atomic View, causal consistency, CAP theorem, geo-replication
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

To minimize network latency and remain online during server failures and network partitions, many modern distributed data storage systems eschew transactional functionality, which provides strong semantic guarantees for groups of multiple operations over multiple data items. In this work, we consider the problem of providing Highly Available Transactions (HATs): transactional guarantees that do not suffer unavailability during system partitions or incur high network latency. We introduce a taxonomy of highly available systems and analyze existing ACID isolation and distributed data consistency guarantees to identify which can and cannot be achieved in HAT systems. This unifies the literature on weak transactional isolation, replica consistency, and highly available systems. We analytically and experimentally quantify the availability and performance benefits of HATs, often two to three orders of magnitude over wide-area networks, and discuss their necessary semantic compromises.

## Overview

By 2013 the key-value stores that replaced transactional RDBMSs (Dynamo and its relatives) gave up multi-item transactions to stay available and fast, and CAP was often read as saying ACID and availability cannot coexist. The paper says CAP is narrower: as proved in [Gilbert and Lynch's formalization](/papers/brewers-conjecture-cap-feasibility-web-services), it concerns [linearizability](/papers/linearizability-correctness-condition-concurrent-objects), not every ACID property. The question is: which transactional semantics can a system provide while every non-failing server answers every request without waiting on other servers, even through indefinite partitions? That also yields low latency, since nothing is waiting on a wide-area round trip.

This note was written from the 12-page VLDB version (PVLDB 7(3), pp. 181-192, presented at VLDB 2014). The 17-page arXiv extended version (1302.0309) holds the formal definitions and algorithm pseudocode; I read its MAV pseudocode but not the appendix proofs. The authors build on Adya's isolation definitions and Berenson et al. ([Critique of ANSI SQL Isolation Levels](/papers/critique-of-ansi-sql-isolation-levels)). The paper also cites [Dynamo](/papers/dynamo-amazons-highly-available-key-value-store), [Spanner](/papers/spanner-globally-distributed-database), [Calvin](/papers/calvin-fast-distributed-transactions-for-partitioned-databases) and [Helland's apostate paper](/papers/life-beyond-distributed-transactions-an-apostates-opinion).

Worth knowing first: Read Committed, Repeatable Read, Snapshot Isolation and serializability, the anomalies Lost Update and Write Skew, and the session guarantees (monotonic reads, read your writes).

## Contribution

- **A taxonomy of availability.** High availability (Gilbert and Lynch): every user who can reach a non-failing server gets a response, with no coordination, so a majority-quorum system counts as unavailable. Sticky availability: the same holds only while the client keeps talking to a copy of the database that reflects its own prior operations. Transactional availability: given a replica for every item, a transaction eventually commits (possibly after retries) or aborts by its own choice, which rules out the trivial "abort everything" system.
- **Classification of existing models.** Table 3 and Figure 2 sort the models into highly available, sticky available and unavailable. The paper says this is, to its knowledge, the first unification of transactional isolation, distributed consistency and session guarantees.
- **Proof-of-concept algorithms.** Constructions for Read Committed, cut isolation, MAV and the session guarantees (feasibility, "not necessarily optimal or even efficient"), plus an efficient MAV algorithm.
- **Impossibility arguments** for Lost Update, Write Skew and recency bounds, and a TPC-C analysis of which transactions fit.

## Methodology

The paper combines three things. First, a measurement study: a week of ping times between EC2 regions (the text says seven, Table 1c lists eight), across three availability zones, and within one zone. Second, analysis: each model is defined informally, with a minimal example, and either an available algorithm or an argument that a partition forces a violation. Third, a prototype: a hash-partitioned key-value store backed by LevelDB, written in Java with Apache Thrift, with servers grouped in clusters (each a full copy, five m1.xlarge instances) and clients stuck to one cluster. It runs YCSB with 8 operations per transaction, 50% reads and 50% writes, 100,000 keys, 1KB values, 180 seconds per configuration. It compares eventual (last-writer-wins Read Uncommitted with all-to-all anti-entropy), RC (eventual with write buffering), MAV, and master (all operations on a key routed to one master replica, single-key linearizability).

## Findings

**Taxonomy (Table 3).**
- **Highly available:** Read Uncommitted, Read Committed, Monotonic Atomic View, Item Cut Isolation, Predicate Cut Isolation, Writes Follow Reads, Monotonic Reads, Monotonic Writes. Convergence (eventual consistency) is also achievable.
- **Sticky available:** Read Your Writes, PRAM, causal consistency. The proof: a client that writes on one partitioned replica and then reaches another cannot both stay available and read its write.
- **Unavailable:** Cursor Stability, Snapshot Isolation (including Parallel SI), Repeatable Read, one-copy serializability (each needs Lost Update or Write Skew prevented), and recency, safe, regular, linearizable and strong 1SR (any recency bound can be broken by a long partition). Durability across F faults also needs F+1 reachable replicas.

Combining all HA and sticky guarantees gives causally consistent transactional snapshot reads (Figure 2 depicts 144 HAT combinations).

**Algorithms.** RC: clients buffer writes until commit (or servers hide them), one timestamp per transaction, last-writer-wins. MAV: replicas reveal a write only once all replicas of the transaction's other writes have it ("pending stable"), writes carry the transaction timestamp and the list of sibling keys, and reads send a lower-bound timestamp. It is masterless and never blocks on replica coordination.

**Network (Section 2).** Intra-datacenter RTT is 1.82 to 6.38 times faster than across availability zones and 40 to 647 times faster than across regions. São Paulo to Singapore averaged 362.8ms (95th percentile 649ms) against a 106.7ms speed-of-light bound. A 2011 Microsoft study found a mean of 40.8 link failures per day.

**Weak isolation in practice.** Of 18 databases surveyed, only 3 default to serializability and 8 do not offer it at all.

**TPC-C.** Order-Status and Stock-Level (read-only) and Payment (increment- and append-only) fit HATs, and foreign-key-style conditions can be kept with MAV. New-Order can get unique but not the required sequential IDs, and Delivery's idempotent delete needs Lost Update prevention (the paper suggests compensation in the real world).

**Experiments.**
- Two clusters in one datacenter: master gets roughly half the throughput and double the latency of eventual; RC is almost identical to eventual; MAV reaches about 75% of the throughput.
- Two clusters across the continental US: master latency averages 300ms per transaction (about 37ms per operation). With five clusters in five datacenters it reaches nearly 800ms, and a Dynamo-style quorum variant (done once a majority responds) did not substantially improve it.
- Across two datacenters, eventual, RC and MAV perform like the single-datacenter deployment. The paper puts the WAN advantage of HAT algorithms at 10 to 100 times lower latency.
- MAV overhead grows with transaction length: within 18% of eventual at 1 operation (34 bytes of metadata), within 60% at 128 operations (1898 bytes). With 99.8% reads it costs 7%.
- Scale-out from 5 to 25 servers per cluster: about 5x for eventual and RC, 3.8x for MAV (over 260,000 operations per second), 4.25x for MAV in memory.
- With five clusters, MAV peaked at about half of eventual (disk IOPS and anti-entropy cost), and within 20% with in-memory storage.

## Critical Analysis

The authors state several limits. The algorithms are proofs of existence, not tuned systems. MAV pays metadata proportional to transaction length. Two-phase locking is omitted because their textbook version did worse than master, and their claim about Calvin is only an expectation. HATs expose more anomalies than a single-site database under weak isolation, particularly during partitions, and none of the achievable models prevents concurrent updates.

The following points are a reading of the paper, not claims of its authors.

- **The unavailability proofs lean on one availability definition.** It excludes majority quorums and any "high probability" response (footnote 2). It is the strict Gilbert and Lynch one, so "not HAT" does not mean "unusable in practice": a majority-quorum system keeps serving whenever a majority is reachable.
- **Availability is argued, not measured.** The text describes no experiment that injects partitions. The experiments measure latency and throughput on healthy links.
- **The headline factor varies by section.** The abstract says two to three orders of magnitude, the introduction one to three, Section 6.3 says 10 to 100 times. The first appears to rest on the Table 1 RTT ratios, the others on the master comparison.
- **The master baseline is weak.** It is a randomly designated single master with single-key linearizability, not a transactional system, so the figures do not measure a serializable alternative.
- **The TPC-C summary is inconsistent.** Section 6.2 first calls Payment monotonic and fine, then the summary lists New-Order and Payment as the problematic pair while the text names New-Order and Delivery. The durability sentence is printed as "F > 1".
- **Later literature, marked as such.** I read only the Crossref abstract of each of these. [Keeping CALM](/papers/keeping-calm-when-distributed-consistency-is-easy) (Hellerstein and Alvaro, 2020) gives the monotonicity account of which programs are coordination-free, building on the Bloom work this paper cites for "logically monotonic". "Coordination Avoidance in Database Systems" (Bailis et al., PVLDB 8(3), 2014) proposes invariant confluence, a necessary and sufficient condition for safe coordination-free execution of an application. "Scalable Atomic Visibility with RAMP Transactions" (SIGMOD 2014) names Read Atomic isolation for multipartition atomic visibility. Elle (Kingsbury and Alvaro, PVLDB 14(3), 2020) is a checker that infers Adya-style dependency graphs from observed histories to find isolation anomalies in real databases.

## Further Research

- The paper's own list: how to mix HAT and non-HAT semantics, used sparingly, and what architecture supports the hybrid; escrow and bounded-asynchrony assumptions for richer semantics; strong semantics when there is no partition and weaker ones during one.
- Cheaper MAV algorithms without metadata proportional to transaction length (the authors say they are investigating), and which application invariants survive HAT anomalies, where the later invariant confluence work starts.
- Testing real databases against the isolation levels they claim, the problem Elle targets.
