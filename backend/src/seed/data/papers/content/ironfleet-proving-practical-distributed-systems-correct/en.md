---
title: "IronFleet: Proving Practical Distributed Systems Correct"
summary: IronFleet verifies the implementations of two distributed systems, a Paxos-based replicated state machine library and a sharded key-value store, by chaining TLA-style refinement from a short spec to a protocol and Floyd-Hoare proofs in Dafny from the protocol to the code, and it proves liveness as well as safety. The price is 3.7 person-years and a trusted base the authors list.
researchArea: Distributed Systems
keywords: formal verification, refinement, Dafny, TLA, reduction, liveness, Paxos, replicated state machine, key-value store
version: 1.0
updatedAt: 2026-11-20
---

## Abstract

Distributed systems are notorious for harboring subtle bugs. Verification can, in principle, eliminate these bugs a priori, but verification has historically been difficult to apply at full-program scale, much less distributed-system scale. We describe a methodology for building practical and provably correct distributed systems based on a unique blend of TLA-style state-machine refinement and Hoare-logic verification. We demonstrate the methodology on a complex implementation of a Paxos-based replicated state machine library and a lease-based sharded key-value store. We prove that each obeys a concise safety specification, as well as desirable liveness requirements. Each implementation achieves performance competitive with a reference system. With our methodology and lessons learned, we aim to raise the standard for distributed systems from "tested" to "correct."

## Overview

Most formal work on distributed systems stops at the protocol: a proof that Paxos is safe says nothing about the code someone wrote from it. The paper (SOSP 2015, Microsoft Research) targets that gap. Protocol proofs, it argues, rarely reach the implementation, and model checking is incomplete and does not scale. Real implementations add what protocol papers omit, such as log truncation, batching, state transfer, bounded integers and packet parsing, and that is where subtle bugs live.

The catalog already holds the neighbors. [Paxos Made Simple](/papers/paxos-made-simple) describes the algorithm IronRSL implements (the paper cites the original [Part-Time Parliament](/papers/paxos-part-time-parliament) for Paxos). [Raft](/papers/raft-understandable-consensus-algorithm), [Zab](/papers/zab-high-performance-broadcast-primary-backup-systems), [Egalitarian Paxos](/papers/egalitarian-paxos-more-consensus-in-egalitarian-parliaments) and [Chord](/papers/chord-scalable-peer-to-peer-lookup-service) appear in its related work as protocols with paper proofs; its unverified baseline is the Multi-Paxos code of the EPaxos codebase. [Chubby](/papers/chubby-lock-service-loosely-coupled-distributed-systems) and [ZooKeeper](/papers/zookeeper-wait-free-coordination-internet-scale-systems) are the kind of service where it says a replication bug cascades, and [FLP](/papers/flp-impossibility-of-distributed-consensus) is why its liveness theorem needs timing assumptions. On the systems side it names [seL4](/papers/sel4-formal-verification-of-an-os-kernel) as verified single-machine code; IronFleet is distributed and also proves liveness.

Worth knowing first: state machine refinement, Hoare logic with pre and postconditions, what an SMT solver such as Z3 can and cannot decide, and the safety versus liveness distinction.

## Contribution

- **Layered refinement.** A trusted high-level spec (a state machine), an untrusted distributed protocol layer, and an imperative implementation. The protocol is proved to refine the spec in TLA style, and the implementation is proved to refine the protocol with Floyd-Hoare reasoning, all in Dafny so no semantic gap opens between the layers.
- **Concurrency containment.** The proofs assume each host step is atomic. A reduction argument (the paper cites Lipton's 1975 reduction) justifies that, because the implementation must do all its receives before all its sends in a step. Dafny enforces this obligation; the argument that the obligation suffices is a paper sketch, not machine-checked.
- **Liveness in Dafny.** A TLA embedding with 40 verified proof rules, and protocols built from always-enabled actions so that fairness is easy to establish.
- **Two verified systems.** IronRSL (Multi-Paxos replicated state machine with batching, log truncation, state transfer, dynamic view-change timeouts and a reply cache) and IronKV (a sharded hash table).
- **Reusable libraries and lessons,** such as verified marshalling and parsing, and invariant quantifier hiding.

## Methodology

The spec is three predicates (SpecInit, SpecNext, SpecRelation), 85 lines for IronRSL, where linearizability is the property, and 34 for IronKV, a plain hash table. The protocol layer has N hosts and a network, each protocol step atomic, written declaratively with unbounded integers and abstract packets. Refinement is proved with a refinement function plus inductive invariants. The implementation uses uint64s, mutable arrays and byte-level UDP packets, and a main loop that every host must run (Figure 8 of the paper).

Dafny compiles to C#, so the .NET compiler produces the executable. Z3 discharges most low-level proof steps. The authors write opaque and reveal attributes, fuel and manual triggers to keep Z3 from timing out, and build implementations first with functional types and then with mutable heap types.

Evaluation compared each system with an unverified one: IronRSL against Multi-Paxos from the EPaxos codebase on three machines (Xeon L5630, 1 Gbps), IronKV against Redis on two machines (10 Gbps).

## Findings

- **Proved properties.** IronRSL: complete functional correctness (linearizability) plus liveness: if a client repeatedly sends a request to all replicas, it eventually gets a reply, assuming a live quorum, a minimum scheduler frequency, bounded network delay and burst size, bounded clock error, and no overflow-limit stall. IronKV: functional correctness plus a liveness property of its reliable-transmission component: on a fair network, every submitted packet is eventually received.
- **Effort (Figure 12).** 1,400 lines of spec, 5,114 of implementation, 39,253 of proof. At the implementation layer the ratio of proof annotation to executable code is 3.6 to 1. Developing the methodology and verifying both systems took approximately 3.7 person-years.
- **Verification time.** 395 minutes in total; a serial full build takes about six hours, and with parallel cloud machines a developer rarely waits more than 6 to 8 minutes. Per-method IDE feedback is 1 to 10 seconds.
- **Performance.** IronRSL's peak throughput is within 2.4 times of the Multi-Paxos baseline. IronKV is described as competitive with Redis. The conclusion cites up to 18,200 requests per second (IronRSL) and 28,800 (IronKV). The CPU was the bottleneck in all experiments.
- **Bugs.** Apart from unverified components such as the C# client, both systems worked the first time they were run.

## Critical Analysis

What the paper does not claim. Its guarantees rest on a stated trusted base: the specs and the short main-event loop must be read by the user, and Dafny, the .NET compiler and runtime, Windows and the hardware are assumed correct. The network may drop, delay or duplicate packets but must not tamper with them, and header addresses are trusted. Byzantine behavior appears only in related work (proofs of PBFT by others), and the paper says nothing about tolerating it. The reduction argument is unverified, and the paper lists as future work: verifying it, bounded-time main loop, no memory exhaustion, no overflow limit. Post-crash recovery (crashes that wipe memory but not disk) needs new techniques, and the paper says reconfiguration in IronRSL needs only developer time but did not do it.

Other limits. The 3.7 person-years cover the methodology and two systems together, so the cost of a third is not given. Both systems are slower than their baselines and the authors say each optimization must be proven. The abstract calls the key-value store "lease-based", but the body describes delegation maps and reliable transmission and the word "lease" appears nowhere else; I read this as a loose label.

Later literature, not part of the 2015 text, and not re-read for this analysis (only this catalog's analyses of them): [Grove](/papers/grove-separation-logic-library-for-verifying-distributed-systems) reports a proof cost slightly above IronFleet's, and [Verus](/papers/verus-practical-foundation-for-systems-verification) ports the IronKV host from Dafny and reports smaller proofs and faster verification. On the kernel side, [Hyperkernel](/papers/hyperkernel-push-button-verification-of-an-os-kernel) (2017) also uses Z3 but aims at push-button proofs of a single-machine kernel, and [CertiKOS](/papers/certikos-extensible-architecture-for-certified-concurrent-os-kernels) (2016) comes from the same project as the mCertiKOS-hyp hypervisor that IronFleet cites. Neither verifies a distributed system.

## Further Research

- A machine-checked proof of the reduction obligation, and of bounded-time main loops.
- Verified reconfiguration and crash recovery, which the authors say need additional techniques.
- Verifying C++ or lower-level code instead of C# built from Dafny, to shrink the trusted base.
- Cheaper proofs: the authors point to better libraries and tooling.
