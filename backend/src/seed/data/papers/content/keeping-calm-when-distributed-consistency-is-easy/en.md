---
title: "Keeping CALM: When Distributed Consistency Is Easy"
summary: Hellerstein and Alvaro give an informal introduction to the CALM Theorem, which says a program has a consistent, coordination-free distributed implementation if and only if it is monotonic, and use it to explain when coordination is intrinsic and when it is an implementation choice.
researchArea: Distributed Systems
keywords: CALM theorem, monotonicity, coordination-free, confluence, eventual consistency, CRDTs, Bloom, CAP theorem
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

A key concern in modern distributed systems is to avoid the cost of coordination while maintaining consistent semantics. Until recently, there was no answer to the question of when coordination is actually required. In this paper we present an informal introduction to the CALM Theorem, which answers this question precisely by moving up from traditional storage consistency to consider properties of programs. CALM is an acronym for "consistency as logical monotonicity". The CALM Theorem shows that the programs that have consistent, coordination-free distributed implementations are exactly the programs that can be expressed in monotonic logic. This theoretical result has practical implications for developers of distributed applications. We show how CALM provides a constructive application-level counterpart to conventional "systems" wisdom, such as the apparently negative results of the CAP Theorem. We also discuss ways that monotonic thinking can influence distributed systems design, and how new programming language designs and tools can help developers write consistent, coordination-free code.

(This is the arXiv abstract. The PDF read has none.)

## Overview

Coordination protocols such as Paxos and Two-Phase Commit make machines agree on an order of access to shared state, and they are costly: the paper cites a result that state-of-the-art multiprocessor key-value stores can spend 90% of their time waiting for coordination, while a coordination-free one called Anna ran over two orders of magnitude faster. Amazon's James Hamilton is quoted advising designers to push consistency mechanisms off the critical path. The question the paper asks is when that is possible, treated as a computability question, not an engineering one: what is intrinsic to a problem and what is an implementation choice.

The answer in this CACM article (2020) is an informal tour of the CALM Theorem, conjectured at a PODS 2010 keynote and proved in later database-theory papers. This note was written from the arXiv version (v2, January 2019); the CACM text may differ. It sits beside [Brewer's conjecture and its proof](/papers/brewers-conjecture-cap-feasibility-web-services), [CRDTs](/papers/conflict-free-replicated-data-types), [Dynamo](/papers/dynamo-amazons-highly-available-key-value-store) and [linearizability](/papers/linearizability-correctness-condition-concurrent-objects).

Worth knowing first: monotone versus non-monotone queries (does adding input ever retract an output?), and the difference between consistency of memory (what reads return) and of a program (what it outputs).

## Contribution

- **Program consistency as confluence.** An operation is confluent if it produces the same set of outputs for any ordering and batching of its inputs, so it is a deterministic function from sets to sets. Confluent operations compose, so confluent parts make a confluent program.
- **Definition 1.** A program P is monotonic if for any input sets S and T with S a subset of T, P(S) is a subset of P(T).
- **Theorem 1 (CALM).** A program has a consistent, coordination-free distributed implementation if and only if it is monotonic. Non-monotonic programs "change their mind", so they are order-sensitive and must wait until all information has arrived.
- **A positive counterpart to CAP.** Observation 1 says coordination-freeness is equivalent to availability under partition, so monotone programs can have consistency, availability and partition tolerance together.
- **Design guidance.** Examples and patterns (carts, tombstones, immutable data, CRDTs, Bloom) and a list of open questions.

## Methodology

There are no experiments. The argument runs through examples and a proof sketch. Distributed deadlock detection (a cycle is evidence of existence, so output only grows) is set against distributed garbage collection (unreachability is non-existence of a path, so a machine must hear from all others). The sketch follows Ameloot, Neven and Van den Bussche: each machine is a relational transducer with an event loop of Ingest, Query and Send. Monotonic means every query is syntactically monotone (selection, projection, intersection, join, transitive closure; set difference and universal quantification are not). The authors point readers to the cited papers for the formal proof.

## Findings

These are the paper's claims, not measurements.

- **The "if" direction** is easy: a monotonic transducer network eventually ingests and sends a deterministic set of messages and produces a deterministic output.
- **The "only if" direction** is harder. A program "contains coordination" if messages are needed under all partitionings of the initial data, including one that co-locates everything on a single machine. Messages that merely move data dependencies do not count. Non-monotonic operations are shown to need such messages.
- **Membership.** Monotonic programs are exactly those that do not need to know network membership (the All relation); a similar link holds for a machine knowing its own address.
- **Shopping cart.** Following Dynamo as the paper describes it, the cart is two growing sets, adds and deletes, which commute, so replicas need no coordination. Checkout does not commute with them, so it needs coordination. Later work by the authors makes checkout monotonic with a manifest of preceding update IDs.
- **Coordination in its place.** Keep it off the critical path (checkout, background garbage collection, lazy reclamation of tombstones) or compensate, as with an out-of-stock email and coupon after an inventory decrement.
- **Open questions** (not results): expressiveness (Immerman-Vardi and PTIME with a successor relation), monotonic program synthesis, analyzing repaired non-monotonic code, and a stochastic CALM that would cover Hogwild!-style convergence.

## Critical Analysis

The authors state the limits themselves: CALM "falls short of being a constructive result". It does not say how to find a monotonic specification, and the theory gives no guidance on extracting one from an implementation. The article is an informal introduction, and the proof is a sketch of another group's argument. Their definition of consistency also gives no promise about recency or ordering, which the paper says is the point.

The following points are a reading of the paper, not claims of its authors.

- **Strong notion of "coordination-free".** It means no messages beyond data movement in any partitioning, so "needs coordination" is a statement about the program, not about a cheap protocol a given system could use.
- **Confluence is not what users see.** It permits storage-level anomalies by design, so a confluent app can still show stale data in the middle of a run.
- **The 90% and two-orders figure is self-cited.** It comes from Anna (Wu, Faleiro, Lin, Hellerstein), a system of the first author, and the paper does not evaluate it.
- **Dynamo detail is second-hand.** The cart description is the authors' summary of the Dynamo paper, not a re-derivation.
- **Later literature, abstracts only (I did not read the papers).** "Keep CALM and CRDT On" (Laddad et al., arXiv 2022) extends CRDTs with a query model that uses monotonicity to decide which reads are coordination-free. "New Directions in Cloud Programming" (Cheung, Crooks, Hellerstein, Milano, CIDR 2021 per arXiv) proposes separating program semantics from availability and consistency choices.

## Further Research

- Which real application invariants have a monotonic specification, and how often is checkout-like coordination unavoidable?
- Tooling that checks "repaired" programs, where coordination has been added to non-monotonic code, as the paper asks.
- Compensation and coordination as one semantic idea, which the paper suggests as eventual non-deterministic agreement.
- Compare [Helland's entity-based design](/papers/life-beyond-distributed-transactions-an-apostates-opinion), which this paper does not cite but which also pushes agreement into business-level workflow, with CALM's compensation by apology.
