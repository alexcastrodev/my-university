---
title: "Practical Byzantine Fault Tolerance"
summary: Castro and Liskov's PBFT, the first state machine replication protocol that survives Byzantine faults in an asynchronous network at a cost low enough for real services, shown by a replicated NFS that ran only 3% slower than the unreplicated one in the Andrew benchmark.
researchArea: Distributed Systems
keywords: byzantine fault tolerance, state machine replication, pbft, view change, message authentication codes, linearizability
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

This paper describes a new replication algorithm that is able to tolerate Byzantine faults. We believe that Byzantine-fault-tolerant algorithms will be increasingly important in the future because malicious attacks and software errors are increasingly common and can cause faulty nodes to exhibit arbitrary behavior. Whereas previous algorithms assumed a synchronous system or were too slow to be used in practice, the algorithm described in this paper is practical: it works in asynchronous environments like the Internet and incorporates several important optimizations that improve the response time of previous algorithms by more than an order of magnitude. We implemented a Byzantine-fault-tolerant NFS service using our algorithm and measured its performance. The results show that our service is only 3% slower than a standard unreplicated NFS.

## Overview

[The Byzantine Generals Problem](/papers/byzantine-generals-problem) defined arbitrary (Byzantine) faults in 1982, but the protocols that followed were either theoretical constructions too slow to use or assumed a synchronous network with known bounds on message delay. [Paxos](/papers/paxos-part-time-parliament) and Viewstamped Replication handled replication in asynchronous systems, but only for benign faults, where a node crashes or is slow and never lies. This paper, presented at OSDI in February 1999 by Miguel Castro and Barbara Liskov, aims at the gap in between: state machine replication ([the tutorial](/papers/state-machine-approach-fault-tolerant-services-tutorial)) that works when a bounded number of replicas are compromised or buggy, over a network like the Internet.

The motivation is stated in the first lines: malicious attacks and software errors are increasingly common, and both can make a node behave arbitrarily. The service can be any deterministic state machine, not just reads and writes of a register.

Worth knowing first: the asynchronous model and why [FLP](/papers/flp-impossibility-of-distributed-consensus) forces any such protocol to give up something (here, liveness depends on a weak synchrony assumption), [linearizability](/papers/linearizability-correctness-condition-concurrent-objects) as the safety condition, and the primary-backup structure with views used by [Paxos](/papers/paxos-made-simple).

## Contribution

- **A Byzantine protocol that needs no synchrony for safety.** With at least 3f+1 replicas and at most f faulty, clients get correct replies that satisfy linearizability, and the protocol never has to exclude suspected replicas from the group, which is the weakness the paper attributes to Rampart and SecureRing.
- **A three-phase normal case.** The primary assigns a sequence number in pre-prepare, replicas exchange prepare messages, then commit messages, and the client accepts a result after f+1 matching replies.
- **A view change that replaces a faulty primary,** with checkpoints and a stable-checkpoint proof so replicas can discard their logs.
- **Optimizations that make it usable.** Authenticators (vectors of MACs) instead of public-key signatures during normal operation, digest replies, tentative execution that cuts five message delays to four, a one-round-trip path for read-only operations, request batching and incremental checkpoint digests.
- **A replication library and BFS,** a Byzantine-fault-tolerant NFS service, with measurements.

## Methodology

Section 2 fixes the model: an asynchronous network that may lose, delay, duplicate and reorder messages, nodes that may fail arbitrarily and independently, and a computationally bounded adversary that cannot forge signatures or break the digests. Independence is not free: the paper says replicas should run different implementations, operating systems and administrators. Sections 3 to 5 give the algorithm, a proof sketch of safety and liveness (the full proof is in a separate technical memo) and the optimizations.

The evaluation in Section 7 uses four replicas, which tolerate one Byzantine fault, plus one client, all identical DEC 3000/400 Alpha workstations (133 MHz) on an isolated 10 Mbit/s switched Ethernet. A micro-benchmark times null operations (10,000 invocations, median of three runs). The Andrew benchmark, a software development workload with five phases, compares BFS against NFS-std (the Digital Unix NFS V2) and BFS-nr (BFS without replication), averaging 10 runs.

## Findings

- **Resilience is optimal.** 3f+1 is the minimum number of replicas for safety and liveness in an asynchronous system with f faulty, and the paper cites a proof for it. Safety holds for any number of faulty clients.
- **Micro-benchmark.** For a null operation (0/0) the replicated read-write latency is 3.35 ms against 0.82 ms unreplicated (309% overhead), and read-only is 1.62 ms (98%). With 4 KB arguments (4/0) the values are 14.19 ms (207%) and 6.98 ms (51%) against 4.62 ms; with 4 KB results (0/4) they are 8.01 ms (72%) and 5.94 ms (27%) against 4.66 ms. The paper calls this the worst case, since the operations do no work.
- **Andrew benchmark.** BFS in its strict form takes 64.48 s against 62.52 s for NFS-std, 3% more, and 26% more than BFS-nr at 51.07 s. Making lookup read-only brings BFS to 61.07 s, 2% faster than NFS-std and 20% above BFS-nr. Phases 1, 2 and 5 are faster than NFS-std because replication gives stability without synchronous disk writes, as in Harp.
- **Cryptography.** A 1024-bit RSA signature takes 43 ms to generate and 0.6 ms to verify on the paper's hardware, while a MAC of a 64-byte message takes about 10.3 microseconds. Signatures are used only in view-change and new-view messages.
- **Versus Rampart.** The paper estimates, from published numbers, a latency of at least 65 ms for Rampart, and concludes its algorithm is faster by more than 10 times for read-write and more than 20 times for read-only null operations, after a conservative scaling by 1.7.
- **Masking a real bug.** The authors report that they hit a software bug while running the system and the algorithm kept running correctly.

## Critical Analysis

PBFT is the reference design for practical Byzantine replication, and its strengths hold up: safety without synchrony, a clean separation between ordering within a view and agreement across views, and a measured cost on a real service. The limits are also visible in the paper.

- **The measurements cover normal operation only.** The paper says the experiments have no view changes, and the replication library did not yet implement view changes or retransmissions. The cost of a faulty primary is therefore not measured, and neither is behavior under an actual attack.
- **Small scale.** Every experiment uses four replicas, one client and a 10 Mbit/s LAN. The paper notes that authenticator generation time grows linearly with the number of replicas, and message counts grow with the group, so the results say little about large groups or wide-area deployments.
- **The Rampart comparison is an estimate** built from numbers published for different hardware, not a head-to-head run.
- **The independence assumption is demanding.** Diverse implementations and administrators are costly, and a bug present at all replicas is not masked.
- **No privacy.** A faulty replica can leak data, because operations need their inputs in the clear.
- **Later work changed the picture.** PBFT's view change and its all-to-all messaging became the main scaling problem. HotStuff (2019) restructured the protocol to make leader replacement simpler with linear communication, and BFT replication became a building block of permissioned blockchains and of consensus in some cryptocurrency systems. This material comes from later literature, not from this paper.

## Further Research

- The authors themselves list fewer resources: replicas used as witnesses only when a full replica fails, and fewer copies of the state (f+1), plus secret sharing for privacy.
- Protocols that keep PBFT's guarantees with less communication or leader overhead, such as [Autobahn](/papers/autobahn-seamless-high-speed-bft), which separates data dissemination from a PBFT-style ordering, and [Ambulance](/papers/ambulance-saving-bft-through-racing), which replaces timeouts with a race between replicas.
- Byzantine systems that avoid total order for parts of the workload, as in [Pesto](/papers/pesto-high-performance-bft-queries).
- Large-scale and wide-area BFT, including its use in blockchains.
- Measuring the cost of view changes, slow leaders and active attacks, which the original evaluation left out.
