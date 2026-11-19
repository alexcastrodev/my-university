---
title: "Conflict-free Replicated Data Types"
summary: Shapiro, Preguiça, Baquero and Zawirski define Strong Eventual Consistency and show that two simple conditions, a monotonic semilattice for state-based objects and commuting operations for operation-based ones, make replicas converge without consensus or rollback. The paper also builds counters, sets, a log and a directed graph from these conditions.
researchArea: Distributed Systems
keywords: crdt, eventual consistency, strong eventual consistency, semilattice, commutativity, replication, cap theorem
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

Replicating data under Eventual Consistency (EC) allows any replica to accept updates without remote synchronisation. This ensures performance and scalability in large-scale distributed systems (e.g., clouds). However, published EC approaches are ad-hoc and error-prone. Under a formal Strong Eventual Consistency (SEC) model, we study sufficient conditions for convergence. A data type that satisfies these conditions is called a Conflict-free Replicated Data Type (CRDT). Replicas of any CRDT are guaranteed to converge in a self-stabilising manner, despite any number of failures. This paper formalises two popular approaches (state- and operation-based) and their relevant sufficient conditions. We study a number of useful CRDTs, such as sets with clean semantics, supporting both add and remove operations, and consider in depth the more complex Graph data type. CRDT types can be composed to develop large-scale distributed applications, and have interesting theoretical properties.

## Overview

Strong consistency serialises every update in a global total order, the approach of the [state machine approach](/papers/state-machine-approach-fault-tolerant-services-tutorial) and of consensus protocols such as [Paxos](/papers/paxos-made-simple). That order is a bottleneck, and [Brewer's conjecture](/papers/brewers-conjecture-cap-feasibility-web-services) says it cannot coexist with availability under partitions. Eventual consistency lets any replica accept an update locally and ship it later, but the authors note that conflict resolution is hard and that ad-hoc designs are brittle, citing the concurrency anomalies of the Amazon shopping cart in Dynamo. The paper appeared at SSS 2011 and, in the authors' words, is the first systematic study of these designs.

The question it asks is when concurrent updates can be merged with no arbitration at all. The answer is a pair of mathematical conditions that a data type can satisfy by construction, so that replicas converge without roll-back and without consensus, and consensus is exactly what the [FLP result](/papers/flp-impossibility-of-distributed-consensus) shows cannot be solved deterministically in an asynchronous system with even one crash.

Worth knowing first: the happened-before relation and vector clocks from [Lamport's logical clocks paper](/papers/lamport-time-clocks-ordering-of-events), the idea of a join semilattice (a partial order where any two elements have a least upper bound), and the difference between concurrent and causally ordered updates. The system model is asynchronous, non-Byzantine, with crash failures and a network that can partition and recover.

## Contribution

- **Strong Eventual Consistency (SEC).** Eventual consistency plus strong convergence: correct replicas that have delivered the same updates have equivalent state, with no later conflict resolution. The paper presents SEC as a solution to the CAP problem, since a SEC replica is always available for reads and writes.
- **Two sufficient conditions.** For state-based objects (CvRDT), states form a monotonic join semilattice and merge computes the least upper bound. For operation-based objects (CmRDT), all concurrent updates commute, given causally ordered reliable delivery.
- **Equivalence of the two styles.** Any SEC state-based object can be emulated by a SEC op-based one, and the reverse.
- **SEC is incomparable to sequential consistency,** shown with a set that has add-wins semantics.
- **A catalogue of building blocks.** Integer vectors, increment-only and increment/decrement counters, add-only sets, the U-Set, a map and a log.
- **A worked design: the directed graph.** A graph CRDT, specified op-based, motivated by a web crawler.

## Methodology

The paper is formal, not empirical. It defines replicated objects as tuples: state-based objects have a payload, query, update and merge methods, while op-based objects split each update into a side-effect-free prepare method at the source and an effect method that runs at every replica. A causal history, a formal reasoning device that implementations do not need, defines delivery, happened-before and concurrency.

Each sufficient condition is stated as a theorem. The CRDT examples are then specified in that style and checked against the conditions. For the graph, the authors start from a thought experiment (a search engine whose crawlers build the web graph asynchronously), compare three ways to handle concurrent `addArc` and `removeVertex`, and pick one. The conference version omits the proofs of the CvRDT theorem and of the graph, referring to a companion technical report. There is no implementation and no measurement.

## Findings

- **CvRDT and CmRDT are sufficient for SEC.** State-based convergence needs eventual delivery, termination and the monotonic semilattice; op-based convergence needs causal delivery and commuting concurrent updates.
- **No consensus and extreme fault tolerance.** A SEC object tolerates up to n - 1 simultaneous crashes, and any communicating subset of replicas converges even if partitioned from the rest.
- **SEC and sequential consistency are incomparable.** With add-wins semantics, one replica runs `add(e); remove(e')` and another `add(e'); remove(e)`. Merging them yields both `e` and `e'` in the set, a state no sequential execution produces. In the other direction, sequential consistency needs consensus, which fails with n - 1 crashes.
- **Counters and sets from monotonic parts.** A vector merged by per-index maximum is a CvRDT, and with one entry per process it is the vector clock. A counter with increments and decrements uses two increment-only counters, with value `|I| - |D|`. The U-Set keeps an added set A and a tombstone set R and returns `A \ R`.
- **Log garbage collection needs no consensus, but is only live if no process is crashed.** An entry can be dropped once its timestamp is below every remote vector clock.
- **The graph forces a design choice.** The options are to let `removeVertex` win and hide incident arcs, to let `addArc` win and restore vertices, or to delay `removeVertex`, which needs synchronisation. The paper takes the first, notes there is no perfect choice, and shows that the op-based set needs no tombstones because of causal delivery. A concurrent add and remove of the same vertex resolves in favour of the add.

## Critical Analysis

The paper gives eventual consistency a precise target, and its two conditions have aged well. Limits worth keeping in mind:

- **No implementation or evaluation.** The authors list a library, applications and performance evaluation as future work, so the costs of metadata, tombstones and vector sizes are not measured here.
- **The cost of the guarantees is hidden in the assumptions.** Op-based objects need reliable causal broadcast, state-based ones need state to keep flowing, and log garbage collection stalls when any process is down.
- **Conflict-freedom is not invariant preservation.** The CRDT must pick a resolution for concurrent updates (add wins, remove wins, last writer), and that policy may not fit the application. The graph design admits it has no perfect choice.
- **"A solution to the CAP problem" is a trade, not an escape.** SEC gives up strong consistency, as the authors say, and the paper does not claim otherwise.
- **The graph proofs are outside the conference text,** so the reader needs the companion report to verify the central worked example.
- **Book vs today.** The paper presents CvRDT and CmRDT as the whole picture. Later work went on to practical designs, such as delta-state CRDTs that ship only the part of the state that changed, and CRDT libraries used in collaborative editing and databases. The paper's U-Set assumption that elements are added only once is relaxed by later set designs.

## Further Research

- Which computations can be done by CRDTs, their complexity classes and the classes of invariants they can support.
- Relations between CRDTs and self-stabilisation and aggregation.
- A library of the specified types, real applications and analytical and experimental performance evaluation.
- Support for infrequent, non-critical synchronous operations such as committing a state or a global reset.
- Stronger global invariants, possibly with probabilistic or heuristic techniques.
- Where the model stops: [Byzantine faults](/papers/byzantine-generals-problem) and [practical BFT](/papers/practical-byzantine-fault-tolerance) are outside the non-Byzantine assumptions, and the strongest guarantees still come from coordination services such as [ZooKeeper](/papers/zookeeper-wait-free-coordination-internet-scale-systems) and [Chubby](/papers/chubby-lock-service-loosely-coupled-distributed-systems), with [linearizability](/papers/linearizability-correctness-condition-concurrent-objects) as the contrast.
