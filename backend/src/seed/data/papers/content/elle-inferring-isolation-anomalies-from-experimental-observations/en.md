---
title: "Elle: Inferring Isolation Anomalies from Experimental Observations"
summary: Elle checks the isolation of a black-box database from the history clients observed. By generating workloads of list appends (and weaker datatypes), it infers an Adya-style dependency graph, finds cycles with linear-time graph search, and reports sound anomalies, with bugs found in TiDB, YugaByte DB, FaunaDB and Dgraph.
researchArea: Databases
keywords: transaction isolation, isolation checking, Adya dependency graph, list append, traceability, recoverability, Jepsen, black-box testing
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

Users who care about their data store it in databases, which (at least in principle) guarantee some form of transactional isolation. However, experience shows that many databases do not provide the isolation guarantees they claim. With the recent proliferation of new distributed databases, demand has grown for checkers that can, by generating client workloads and injecting faults, produce anomalies that witness a violation of a stated guarantee. An ideal checker would be sound (no false positives), efficient (polynomial in history length and concurrency), effective (finding violations in real databases), general (analyzing many patterns of transactions), and informative (justifying the presence of an anomaly with understandable counterexamples). Sadly, we are aware of no checkers that satisfy these goals. We present Elle: a novel checker which infers an Adya-style dependency graph between client-observed transactions. It does so by carefully selecting database objects and operations when generating histories, so as to ensure that the results of database reads reveal information about their version history. Elle can detect every anomaly in Adya et al's formalism (except for predicates), discriminate between them, and provide concise explanations of each. This paper makes the following contributions: we present Elle, demonstrate its soundness over specific datatypes, measure its efficiency against the current state of the art, and give evidence of its effectiveness via a case study of four real databases.

## Overview

A database that says "serializable" or "snapshot isolation" may not deliver it. [A Critique of ANSI SQL Isolation Levels](/papers/critique-of-ansi-sql-isolation-levels) is the older argument that these names are easy to define badly. This paper by Kyle Kingsbury (Jepsen) and Peter Alvaro (UC Santa Cruz), in the Proceedings of the VLDB Endowment, volume 14, issue 3 (pages 268-280), asks how to check the claim from outside. Adya, Liskov and O'Neil define isolation levels as forbidden cycles in a dependency graph, but that graph needs a version order of each object, which a client does not see. The authors say the order may not even exist, and that real-time order cannot stand in for it.

The checker belongs to the Jepsen tradition of testing under faults. The catalog has two failure studies from the same angle, [Simple Testing Can Prevent Most Critical Failures](/papers/simple-testing-can-prevent-most-critical-failures) and [Analysis of Network Partitioning Failures](/papers/analysis-of-network-partitioning-failures-in-cloud-systems), and the paper uses linearizability as the baseline it beats ([Linearizability](/papers/linearizability-correctness-condition-concurrent-objects)). [Highly Available Transactions](/papers/highly-available-transactions-virtues-and-limitations) covers which isolation levels survive partitions, a catalog pairing and not a claim of this paper. The paper describes three of the four databases tested as based on catalog papers: TiDB from [Percolator](/papers/percolator-large-scale-incremental-processing) (see also [TiDB](/papers/tidb-raft-based-htap-database)), YugaByte DB from [Spanner](/papers/spanner-globally-distributed-database), FaunaDB from [Calvin](/papers/calvin-fast-distributed-transactions-for-partitioned-databases).

## Contribution

- **Inference of dependencies from observations.** Elle chooses the objects and operations of the workload so that reads reveal version history. Dependencies are then recovered from what clients saw, not from database internals.
- **Two properties.** Traceability: every version has exactly one trace (a path of writes from the initial version), so a read of a list gives all earlier versions. Recoverability: every observed version maps to one write in one observed transaction (unique write arguments are enough for registers and lists).
- **Soundness.** An anomaly Elle reports must be present in every interpretation of the observation (Theorem in the paper, proof only summarized).
- **A breadth of anomalies.** G0, G1a, G1b, G1c, G-single, G2, plus dirty updates, garbage reads, duplicate writes, internal inconsistency, and cycles that include process and real-time order. Predicates are excluded.
- **Linear-time checking** and human-readable explanations of each cycle, implemented in Jepsen.

## Methodology

Elle takes the Adya model and generalizes registers to objects whose writes are state transitions, which gives a version graph per object and adds "dirty update" (an uncommitted version leaking into a committed write). An observation is the client-side record: operations, arguments, return values where known, and commit, abort or unknown for each transaction. An interpretation is any history compatible with it.

The paper walks the datatypes. Registers lose history on a blind write. Counters give read-read order but no recoverability. Sets recover some dependencies but cannot order two adds. Lists with unique appends give both properties. From the longest committed read of each key Elle takes a prefix of the version order, builds the inferred serialization graph (ww, wr, rw edges), and adds process, real-time, per-key and version-metadata orders where available. Cycles come from Tarjan's strongly connected components plus breadth-first search; G0 uses only ww edges, G1c ww and wr, and G-single starts from one rw edge and closes with ww and wr edges.

The case study ran random transactions of 1 to 10 operations, with 1 to 1024 writes per object, 10 to 30 client threads, 5 to 9 nodes, and fault injection. The performance test compares Elle against Knossos on histories from a simulated serializable snapshot isolated database.

## Findings

- **TiDB (2.1.7 to 3.0.0-beta.1, claims snapshot isolation).** Frequent anomalies even without faults: G-single, inconsistent observations implying aborted reads, and lost updates, from two default automatic retry mechanisms. Version 3.0.0-rc2 disabled both. G2 including write skew remained possible with select ... for update, a documented limitation of its locking on rows not yet created.
- **YugaByte DB 1.3.1.** G2-item anomalies after master crashes or pauses, from a race after leader election; fixed in 1.3.1.2-b1. No G-single, G1 or G0 seen.
- **FaunaDB 2.6.0.** Internal inconsistency, such as a transaction not seeing its own append, limited to index reads, and G2 inferred from it.
- **Dgraph 1.1.1.** Internal inconsistency under normal operation, and read skew from shard migration returning nil. Registers, with partial version orders from initial state, write-follows-read and per-key real-time order.
- **Summary.** Anomalies in all four systems; almost all previously unknown. G0, G1b and G1c are shown in Elle's own test suite, not in these databases.
- **Performance.** Knossos often timed out or ran out of memory after a few hundred transactions, with a 100 second cap in the experiment. With 40 or more concurrent processes, 5000-transaction histories were generally uncheckable by it. Elle checked histories of hundreds of thousands of transactions in tens of seconds; the paper says it is primarily linear in history length, with concurrency having mild effects. Test machine: 24-core Xeon, 128 GB.

## Critical Analysis

What the paper does not claim. A clean run does not prove isolation: Elle only finds violations. Completeness is proven only in special cases (determinate, completely recoverable observations); otherwise the paper falls back on probabilistic arguments and the case study. The non-cycle anomalies it catches depend on recoverability. Predicates are not handled, so Elle cannot tell repeatable read from serializability, and some known anomalies such as long fork are tagged only as G2. It does not claim to replace Jepsen's other checks, and it tests only the isolation of the transaction patterns it generates. In the related work the VLDB version says Knossos is more general (arbitrary datatypes) but exponential in concurrency, while Elle is constant.

My reading, not the paper's:
- The linear-time claim covers the graph work, and the proof of soundness is summarized, not given in the paper. The soundness is conditional on the database actually exposing what a list read returns.
- Elle needs workload control: unique values and list-like objects. Where the client cannot choose them, results fall to the weaker register inferences, which assume things like per-key linearizability (Dgraph case).
- The performance chart uses a simulated database, not a real one.

Later literature: not checked in this entry. I did not read or verify any work after 2020.

## Further Research

- Extending the model to predicates, to distinguish repeatable read from serializability and detect predicate-many-preceders (the authors' own future work).
- More specific hints for anomalies tagged as G2, such as long fork, and telling a user exactly which isolation levels a history does and does not satisfy.
- Weaker partial version orders for non-traceable objects, which the authors leave "as an exercise".
- Related work cited by the paper: Biswas and Enea (OOPSLA 2019) on the complexity of checking, and the client-centric formalism of Crooks et al. (PODC 2017). I did not read either.
