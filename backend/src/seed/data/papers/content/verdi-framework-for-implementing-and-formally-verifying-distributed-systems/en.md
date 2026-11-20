---
title: "Verdi: A Framework for Implementing and Formally Verifying Distributed Systems"
summary: Verdi is a Coq framework in which a distributed system is verified first under an idealized network and then moved, by verified system transformers, to semantics with reordering, duplication, drops and crashes, with a key-value store, a primary-backup transformer and a Raft-based replicated store (vard) as case studies.
researchArea: Distributed Systems
keywords: formal verification, Coq, network semantics, verified system transformers, state machine replication, Raft, linearizability, extraction to OCaml
version: 1.0
updatedAt: 2026-11-20
---

## Abstract

Distributed systems are difficult to implement correctly because they must handle both concurrency and failures: machines may crash at arbitrary points and networks may reorder, drop, or duplicate packets. Further, their behavior is often too complex to permit exhaustive testing. Bugs in these systems have led to the loss of critical data and unacceptable service outages. We present Verdi, a framework for implementing and formally verifying distributed systems in Coq. Verdi formalizes various network semantics with different faults, and the developer chooses the most appropriate fault model when verifying their implementation. Furthermore, Verdi eases the verification burden by enabling the developer to first verify their system under an idealized fault model, then transfer the resulting correctness guarantees to a more realistic fault model without any additional proof burden. To demonstrate Verdi's utility, we present the first mechanically checked proof of linearizability of the Raft state machine replication algorithm, as well as verified implementations of a primary-backup replication system and a key-value store. These verified systems provide similar performance to unverified equivalents.

## Overview

Most formal work on distributed systems checks an abstract protocol (TLA, Alloy), while real implementations "often diverge in important ways from their high-level descriptions", a point the authors take from [Paxos Made Live](/papers/paxos-made-live-engineering-perspective). Verdi (PLDI 2015, University of Washington) instead verifies working code. It opens with the April 2011 Amazon EC2 outage, caused by a malfunction of failure recovery, and cites [Simple Testing Can Prevent Most Critical Failures](/papers/simple-testing-can-prevent-most-critical-failures) among its sources for data loss and service outages. Compared with [seL4](/papers/sel4-formal-verification-of-an-os-kernel), which verifies one machine, the hard part here is that the environment misbehaves: the verified program must be correct under every network the deployment may produce.

Useful background: [Raft](/papers/raft-understandable-consensus-algorithm) and its [dissertation](/papers/consensus-bridging-theory-and-practice-raft-thesis), [linearizability](/papers/linearizability-correctness-condition-concurrent-objects), state machine replication and the Coq proof assistant. The paper limits itself to safety properties. Liveness is left for future work.

## Contribution

- **A Coq toolchain without a formality gap.** The programmer writes four definitions in Coq (node names, inputs, outputs and messages, per-node state, handlers), proves the specification, and extracts OCaml that links with an OCaml shim.
- **Network semantics as a parameter.** Small-step relations for single-node, reordering, duplicating, dropping and node-failure networks, each parameterized by the system's own types and handlers.
- **Verified system transformers (VSTs).** A function from a system to a new system for a different semantics, with a proof that properties carry over through a `transfer` function. Transmission transformers keep the node set (sequence numbering); replication transformers add copies of nodes (primary-backup, Raft). A ghost-variable transformer adds proof-only state at no proof cost.
- **Case studies:** a key-value store, a primary-backup transformer, and a Raft-based consensus transformer with a linearizability proof, plus the composed store vard.

## Methodology

A trace is the sequence of external inputs and outputs. A system satisfies a specification if it holds on every trace the semantics allows. The running example is a lock service whose property is mutual exclusion. In the reordering semantics (packets arrive exactly once, in any order, nodes never crash) the proof has three steps: an inductive invariant over node states and in-flight packets, a relation between states and traces, and their combination. The invariant took about 500 lines of Coq.

The dropping semantics adds a DROP rule and a TIMEOUT rule (a timeout may fire at any step, time is not modeled), and the failure semantics adds CRASH and REBOOT, where a reboot handler decides what state survives. A transformer is a wrapper around state, messages and handlers, so the wrapped handlers cannot tell which semantics they run in. The sequence numbering transformer tags messages and discards pairs already seen. Its proof is a backward simulation: any step of the transformed system, with duplicates removed from the network, corresponds to a step of the underlying system, shown by induction.

For primary-backup, the primary queues inputs and replicates them one at a time, replying only after the backup acknowledges. The primary's traces are traces of the original system, and the backup is equal to the primary or one step ahead. Raft is implemented as a set of RPCs, each a pair of messages (AppendEntries, RequestVote), without log compaction or membership changes. Linearizability is proved from Raft's state machine safety, since the log already holds a linearized order.

## Findings

- **Effort (Table 2, lines including blanks and comments, spec / impl / proof).** Sequence numbering 20 / 89 / 576; key-value store 41 / 138 / 337 (the text says about 280 lines for that proof); primary-backup 20 / 134 / 1155; Raft linearizability 170 / 520 / 4144; Verdi itself (shim, semantics, common lemmas) 148 / 220 / 2364. Applying the primary-backup transformer to the store costs 5 spec lines and 19 proof lines.
- **Bugs found while proving.** The authors found several serious errors in their own implementations. The most subtle one was in their Raft: servers could delete committed entries after a complex sequence of failures, which regular testing would rarely reach.
- **Functional check.** On a three-node cluster they killed the leader of vard and the system came back as expected.
- **Performance (Table 3).** Three nodes with eight 2.0 GHz Xeon cores, 8 GB and 7200 RPM disks on a gigabit switch. A separate node sent 100 random get or put requests from 8 threads, over 50 keys. etcd reached 38.9 req/s with 205 ms get and 198 ms put latency. vard, the OCaml extraction of the composed store, reached 34.3 req/s with 232 ms and 232 ms. The authors attribute etcd's lead to better data structures and request batching, note that vard is not feature complete, and conclude that performance is roughly equivalent.

## Critical Analysis

The paper states its trusted base: the specifications, the assumption that the network semantics match the physical network, the Verdi shim, Coq's checker and OCaml extractor, and the OCaml compiler and runtime. It proves safety only, with no liveness, and no semantics models Byzantine behavior. Network semantics treat inputs and packets as abstract datatypes, so connection state and bits on the wire are not modeled. Raft lacks log compaction and membership changes.

The following points are a reading of the evidence, not claims of the paper.

- **The Raft result is conditional.** The abstract claims the first mechanically checked proof of linearizability of Raft, but Sections 7 and 7.2 say that state machine safety, from which linearizability follows, was still in progress. What is checked is the implication from state machine safety to linearizability, and the 4144 proof lines in Table 2 are for that.
- **The benchmark is small.** 100 requests, 50 keys, no variance reported, and an unspecified etcd version beyond a 2014 reference. About 12% lower throughput and 13% (get) to 17% (put) higher latency (my arithmetic from Table 3) say little about steady-state cost.
- **Unbounded wrapper state (my reading of Figure 10).** The sequence numbering transformer keeps every (sender, number) pair it has seen, so the state only grows.
- **Failure of the primary is manual.** The primary-backup system is verified in the reordering semantics, so a crash needs manual intervention, as the paper says.
- **Later literature, not part of the 2015 text.** Crossref lists "Planning for change in a formal verification of the Raft consensus protocol" (Woos, Wilcox, Anton, Tatlock, Ernst, Anderson, CPP 2016, pp. 154-165); I checked only title, authors and venue, and did not read it. The Raft dissertation note in this catalog also says the Verdi team completed a machine-checked proof for basic Raft, which is that note's claim, not something I verified.

## Further Research

- Liveness, which the authors propose to support with infinite traces and fairness axioms as in TLA, and Byzantine fault models, by adding non-determinism to the semantics.
- Lower-level network semantics connected through transformers, which would shrink the trusted base, and a verified shim.
- Raft extensions left out: log compaction and membership changes.
- Other approaches to verifying distributed implementations in this catalog: [IronFleet](/papers/ironfleet-proving-practical-distributed-systems-correct) verifies a Paxos-based library and a key-value store in Dafny, and its catalog note says it proves liveness as well as safety (I read only that note, not the IronFleet paper; the Verdi paper does not cite it). [Grove](/papers/grove-separation-logic-library-for-verifying-distributed-systems) uses separation logic to cover crashes, lossy networks and time-based leases (catalog note, my pairing).
- Verifying the machine under the program: [CertiKOS](/papers/certikos-extensible-architecture-for-certified-concurrent-os-kernels) and [Hyperkernel](/papers/hyperkernel-push-button-verification-of-an-os-kernel) verify kernels, so end-to-end stacks from network protocol to hardware are not yet joined in the catalog's papers (my reading).
