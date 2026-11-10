---
title: "Jetpack: Consensus Made Generally Fast"
summary: Jetpack is a shim layer that gives existing consensus protocols such as Raft a 1-RTT fast path by running it beside the original path, and it names and fixes the view change hazard, where a promise made in one view can be broken by the next leader election.
researchArea: Distributed Systems
keywords: consensus, fast path, view change, state machine replication, geo-replication, commutativity, raft
version: 1.0
updatedAt: 2026-11-07
---

## Overview

Classic leader-based consensus (Viewstamped Replication, MultiPaxos, Raft) needs 2 round-trip times (RTTs) for a client to commit: one to reach the leader and back, and another for the leader to replicate to followers. That cost is high in geo-replicated deployments. Protocols such as Fast Paxos, EPaxos, Tapir, SwiftPaxos and CURP commit in 1 RTT by letting clients send commands straight to all replicas and collecting a larger quorum, but each fast path is welded to its host protocol, and replacing the consensus layer of a mature system is rarely an option.

This OSDI 2026 paper, from Stony Brook University and DatenLord, asks whether a fast path can be a plugin instead. Jetpack sends every command down both a fast path and the original path, and the client commits as soon as either one finishes.

Three terms recur. The original path is the unmodified protocol, the fast path is the 1-RTT superquorum route, and the view change hazard is the way a promise the original path made during one view can be lost after a leader election.

Worth knowing first: [Paxos Made Simple](/papers/paxos-made-simple) and [Raft](/papers/raft-understandable-consensus-algorithm) for quorums, leaders and views, the Fast Paxos idea of a larger quorum for a direct round, and [NOPaxos](/papers/nopaxos-replacing-consensus-with-network-ordering) as an example of a native 1-RTT design.

## Contribution

- **Two paths and one promise.** When a command c is fast-committed, the original path promises not to propose any concurrent conflicting command ahead of c in the log. Only the proposers of the current view must make the promise, which keeps it tractable, and a command that cannot get it falls back to the original path.
- **Commutativity and a superquorum.** The application supplies a `Conflict(c1, c2)` predicate (for a key-value store, same key and at least one write). With 2f+1 replicas, a command is fast-committed once f + ceil(f/2) + 1 replicas acknowledge it conflict-free, a set that must include every original-path proposer.
- **The view change hazard.** Two structural requirements: R1, recover every fast-committed command of the previous view, and R2, place each recovered command before any conflicting uncommitted command in the new view. Two principles meet them. Principle 1: the fast path keeps its own view, and a command is fast-committed only when acknowledgments from both paths share a view. Principle 2: new proposers recover the previous view's fast-committed commands, or a no-op, through the original path before committing anything else, and that entry becomes a stability marker.
- **Recovery.** Three phases: pause the replicas, agree through a Paxos-like step on a recovery set (commands present in at least ceil(f/2) + 1 of f + 1 replies), then resubmit it to the original protocol and resume.
- **A shim with two prerequisites.** A Jetpack replica runs beside each original replica. The original protocol must keep proposal order equal to log order (PR 1) and arrival order equal to proposal order (PR 2). Clients adapt their fast-path attempt rate to recent latency and CPU load, backing off under saturation.
- **Evidence the hazard is real.** The authors show gaps in CURP's Raft sketch, in Xline (a system built on it) and in Carousel.

## Methodology

Jetpack is written in C++. Raft and Copilot are built on DepFast, Mencius in the same codebase, and the production systems are MongoDB 8.2.0, etcd 3.7.0-alpha.0 and ZooKeeper 3.9.4. The authors model-check each integration in TLA+ across view changes and report no safety violations, and Appendix B gives a proof. Experiments run on AWS EC2 across 10 datacenters, with replicas in five and clients in all ten, and 60 open-loop clients drive a YCSB-inspired 50/50 read/write load over 1M Zipfian keys, varying skew from 0.5 to 1.0 and key range from 100 to 1M. Jetpack runs with the fast path off, always on, and adaptive. Other experiments compare Jetpack-Raft with CURP, SwiftPaxos and EPaxos in one codebase, use an Akkio-style workload with leader locality and read leases, shut down a leader to time recovery, inject 300 ms of one-way latency into Copilot's pilot, and measure CPU and memory.

## Findings

These are the authors' reported results.

- **Latency.** In adaptive mode, average latency falls by 53.39% for Raft, 63.90% for Copilot, 39.06% for MongoDB, 42.36% for etcd and 52.59% for ZooKeeper.
- **No cost when unused.** With the attempt rate at zero, Jetpack-Raft nearly overlaps vanilla Raft, and under growing load the adaptive policy converges to vanilla behavior.
- **Versus native fast paths.** At low load, Jetpack-Raft, CURP, SwiftPaxos and EPaxos commit at 165 to 210 ms against about 355 ms for Raft. Raft, Jetpack-Raft and CURP saturate at 12k ops/s, SwiftPaxos at about 19k and EPaxos at about 25k, which the authors attribute to the tradeoff between generality and deep integration.
- **Contention.** Gains shrink as skew grows, but Jetpack-Raft beats vanilla on average and p99 latency at every level. At skew 1.0 with 50/50 reads and writes, the share of requests that actually benefit is 65.91% for Raft, 64.53% for Copilot, 34.66% for MongoDB and 18.87% for Mencius.
- **Production mitigations.** With 73% of requests reaching a local leader, the other 27% still pay 2 RTTs. Read leases speed up reads only, while Jetpack speeds up reads and writes and composes with both.
- **Failures and slowdowns.** A leader shutdown makes recovery about 1 s longer for Raft and 1.5 s longer for MongoDB than vanilla. Copilot's adaptive policy falls back to nearly vanilla latency when the pilot slows down.
- **Mencius.** Gains are smaller and extra CPU is 36.83% on a 16.70% base, against 3.03% to 9.57% extra elsewhere. The authors derive an Ω(M) per-command cost for non-intrusive integration with M leaders.
- **Effort and compatibility.** The MongoDB, etcd and ZooKeeper integrations took 60, 68 and 52 lines on the original protocol. Of 16 consensus systems surveyed, 6 (among them NOPaxos and [LazyLog](/papers/lazylog-shared-log-abstraction-for-low-latency-applications)) already have a fast path, 9 of the other 10 meet the prerequisites, and EPaxos does not.

## Critical Analysis

The idea is clean, and naming the hazard is useful beyond this system. The paper concedes several limits.

- **Throughput is traded for latency.** Each command reaches all proposers, so peak throughput does not improve, and the adaptive policy mitigates this only by backing off.
- **Multi-leader overhead is structural.** The authors argue shared-log multi-leader designs are rare, citing six of the top 10 DB-Engines databases that use leader-based per-shard replication and none that use shared-log multi-leader. They also leave BFT, interactive transactions and EPaxos open.

The following points are a reading of the evidence, not claims of the paper.

- **Most numbers come from one default workload.** The headline reductions use 50/50 reads and writes over 1M keys. For 95% reads the paper reports only benefit rates, and for MongoDB that rate is capped at 5%, so gains depend on the read share and on contention.
- **Recovery is measured lightly.** Each system gets one induced leader shutdown, and the text states no repeat counts or variance for the latency results. Recovery time is not related to log or command-pool size, and the Appendix B.2 optimizations (six RPCs down to two) are not quantified.
- **The headline is rounded and Copilot-driven.** The abstract says "as much as 60%", while Copilot's result is 63.90%, and the paper says Copilot often fails its own FastAccept and drops to a 3-RTT slow path, so part of that gain reflects Copilot's weaker baseline.
- **Correctness is conditional.** The proof assumes properties of the original protocol, and the text gives no model sizes for the TLA+ runs. MongoDB needed a change that skips uncommitted entries in catch-up, justified in one sentence. The survey also includes SwiftPaxos, which the references list as NSDI, not OSDI or SOSP.
- **Critiques and baselines are partly constructed.** Carousel's case comes from its published specification, and the paper notes that its authors say additional mechanisms may cover it. Xline's issue was reported with a patch, but the outcome is not stated. Figure 10's CURP is a version with the hazard fixed.

## Further Research

- Adapting EPaxos, which breaks PR 1, for example by forcing its topological sort to respect insertion order, and extending the approach to BFT protocols and interactive transactions, as the paper suggests.
- Richer conflict predicates (ranges, SQL predicates) through interval indexes or coarser scopes, which the paper describes but does not evaluate.
- Cheaper multi-leader integration, for example by relaxing the non-intrusive requirement behind the Ω(M) bound.
- Recovery cost as logs and command pools grow, with repeated failures and the Appendix B.2 optimizations measured.
