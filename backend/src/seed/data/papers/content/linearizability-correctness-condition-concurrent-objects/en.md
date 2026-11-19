---
title: "Linearizability: A Correctness Condition for Concurrent Objects"
summary: Herlihy and Wing's definition of linearizability, the condition that makes each operation on a shared object appear to take effect instantaneously between its invocation and its response, with proofs that it is local and nonblocking, a comparison with sequential consistency and serializability, and a proof method for implementations.
researchArea: Distributed Systems
keywords: linearizability, concurrent objects, correctness condition, locality, sequential consistency, serializability, abstraction function
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

A concurrent object is a data object shared by concurrent processes. Linearizability is a correctness condition for concurrent objects that exploits the semantics of abstract data types. It permits a high degree of concurrency, yet it permits programmers to specify and reason about concurrent objects using known techniques from the sequential domain. Linearizability provides the illusion that each operation applied by concurrent processes takes effect instantaneously at some point between its invocation and its response, implying that the meaning of a concurrent object's operations can be given by pre- and post-conditions. This paper defines linearizability, compares it to other correctness conditions, presents and demonstrates a method for proving the correctness of implementations, and shows how to reason about concurrent objects, given they are linearizable.

## Overview

This is the paper that gave "looks like a single copy that updates atomically" a precise meaning. It appeared in ACM Transactions on Programming Languages and Systems in July 1990, after a preliminary version at the ACM Symposium on Principles of Programming Languages in January 1987. The setting is a shared-memory multiprocessor, with sequential processes calling operations on typed shared objects, not a network of machines. Even so, almost every later use of the word "linearizable" in distributed systems, from replicated logs to cloud databases, points back to this definition.

The paper sits between two older ideas. Sequential consistency (Lamport) only asks that the result look like some sequential execution. Serializability, from databases, asks the same for whole transactions. Linearizability adds the requirement that the order of non-overlapping operations in real time be preserved. Readers coming from distributed systems will see why it matters in [Bodega](/papers/bodega-localized-linearizable-reads-with-roster-leases), which pays a protocol cost to serve linearizable reads locally, and in [Spanner](/papers/spanner-globally-distributed-database), which calls its transactional guarantee external consistency. [Lamport's logical clocks](/papers/lamport-time-clocks-ordering-of-events) are a useful contrast: they order events by causality, while linearizability orders them by real-time precedence, which a replicated service built with the [state machine approach](/papers/state-machine-approach-fault-tolerant-services-tutorial) or with [Raft](/papers/raft-understandable-consensus-algorithm) must respect.

Worth knowing first: pre- and post-conditions, what a FIFO queue and a read/write register are, and the idea of an interleaving of concurrent steps.

## Contribution

- **A formal definition.** A history is a finite sequence of invocation and response events. It is linearizable if it can be extended with responses for some pending invocations so that, after dropping the rest, it is equivalent to a legal sequential history (L1) that preserves the real-time precedence order of operations (L2).
- **Two structural properties, proved.** Linearizability is local (a history is linearizable if and only if each object's subhistory is) and nonblocking (a pending invocation of a total operation never has to wait for another one).
- **A comparison with other conditions.** Sequential consistency and serializability are not local, and serializability is inherently blocking. The paper shows linearizability is a special case of strict serializability where each transaction is one operation on one object.
- **A proof method for implementations.** The rep invariant must hold at every step, and the abstraction function must map each representation value to a nonempty set of abstract values, not to one value.
- **Two novel implementations of a highly concurrent queue,** used to show that method on code with no mutual exclusion, and then on a variant with critical sections using auxiliary data.
- **Reasoning about clients.** Given only the sequential axioms and linearizability, the paper proves properties of registers and queues.

## Methodology

The paper is a formal development with worked examples, not an experiment. Section 2 defines histories, well-formedness (each process subhistory is sequential), sequential specifications (prefix-closed sets of sequential histories, written in the axiomatic style of Larch) and the precedence order induced by a history. Figures show four FIFO queue histories and two register histories to separate acceptable from unacceptable behavior before the formalism is introduced.

Section 3 proves the two theorems and builds counterexamples: history H8 over two queues p and q is sequentially consistent on each object but not as a whole. Section 4 defines when an implementation is correct (every history restricted to the abstract object is linearizable) and introduces linearized values, the set Lin(H) of object values at the end of the possible linearizations of H. The proof obligation is that for every linearized value r of the representation history, I(r) holds and A(r) is a subset of Lin of the abstract history. An appendix gives four generic axioms (C, I, R and S) over "possibilities" and states that they are sound and complete.

## Findings

All results are proved in the paper, not measured.

- **Locality (Theorem 1).** A system of linearizable objects is linearizable, so objects can be implemented and verified independently, and scheduling needs no global coordination.
- **Nonblocking (Theorem 2).** For a total operation, any linearizable history with a pending invocation can be completed with some response and stay linearizable. A partial operation such as dequeue on an empty queue may still wait, and that is a choice of the specification.
- **Weaker conditions fail locality.** Sequential consistency is not local (H8), and neither serializability nor strict serializability is local. Serializability can also force a transaction to roll back even when its operations are total (history H9 with two registers and two transactions).
- **The single-step abstraction function does not work.** For the queue implemented with INC, STORE, READ and SWAP on an infinite array, no function that picks one abstract value per representation value is consistent with all futures. The order of two concurrent enqueues depends on a race with a later dequeue, so the abstraction function must return a set of values.
- **Properties of linearizable objects.** Every value read from a register was written and not overwritten (Theorem 3), and reads that lie within an interval with no overlapping write return the same value (Theorem 4). For queues, if two enqueues are ordered, the dequeues cannot be reversed (Theorem 6), and items neither vanish (Theorem 7) nor appear from nothing (Theorem 8). The paper notes that Theorem 6 alone, used as the specification by Gottlieb, Lubachevsky and Rudolph, is incomplete without the other two.

## Critical Analysis

The paper achieves what it sets out to do: a definition short enough to remember (L1 and L2) and strong enough to prove useful theorems. The limits are mostly about scope.

- **No performance evidence.** The queue is said to be much more efficient and more concurrent than versions based on two-phase locking or multiversion timestamping, but the claim is argued, not benchmarked.
- **Failures are out of the model.** Processes are sequential and nothing crashes; the paper states that there is no counterpart to failure atomicity for linearizability. Using it for a replicated service means adding a fault model that the paper does not give.
- **Safety only.** The paper says linearizability is a safety property and that liveness such as fairness needs other tools like temporal logic.
- **Proof effort.** The method needs an invariant, a set-valued abstraction function and sometimes auxiliary variables, and the appendix only outlines the full proof, with details left to a separate report. Checking a real implementation this way is laborious.
- **Real time is assumed, not defined.** Precedence is "response before invocation", so the model never says how a system learns about it, which is the practical problem for distributed implementations.

## Further Research

The paper is the base of a large body of work, and these directions follow from it.

- Wait-free and lock-free implementations of linearizable objects, which the paper says are discussed elsewhere.
- Prophecy variables, which the paper says were inspired by its queue example (Abadi and Lamport), and refinement-based proofs generally.
- Testing and checking: recording a history and searching for a linearization, as done by modern checkers used on databases and queues.
- Relaxations that keep part of the guarantee, such as sequential consistency, causal consistency and per-key linearizability, and their cost in latency.
- Linearizability in replicated and geo-distributed services, where real-time order must be enforced with consensus, leases or synchronized clocks, as in the papers linked above.
