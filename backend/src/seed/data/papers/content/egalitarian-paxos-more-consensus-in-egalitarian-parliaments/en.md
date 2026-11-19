---
title: "There Is More Consensus in Egalitarian Parliaments"
summary: EPaxos is a leaderless Paxos variant in which any replica can order commands, committing non-interfering ones in a single round trip and recording dependencies so that every replica executes interfering commands in the same order.
researchArea: Distributed Systems
keywords: epaxos, leaderless consensus, state machine replication, command interference, dependency graph, fast path, wide-area replication
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

This paper describes the design and implementation of Egalitarian Paxos (EPaxos), a new distributed consensus algorithm based on Paxos. EPaxos achieves three goals: (1) optimal commit latency in the wide-area when tolerating one and two failures, under realistic conditions; (2) uniform load balancing across all replicas (thus achieving high throughput); and (3) graceful performance degradation when replicas are slow or crash. Egalitarian Paxos is to our knowledge the first protocol to achieve the previously stated goals efficiently, that is, requiring only a simple majority of replicas to be non-faulty, using a number of messages linear in the number of replicas to choose a command, and committing commands after just one communication round (one round trip) in the common case or after at most two rounds in any case. We prove Egalitarian Paxos's properties theoretically and demonstrate its advantages empirically through an implementation running on Amazon EC2.

## Overview

Most replicated state machines built on Paxos ([Paxos Made Simple](/papers/paxos-made-simple), [The Part-Time Parliament](/papers/paxos-part-time-parliament)) rely on a stable leader, the "Multi-Paxos" optimization used in systems such as [Chubby](/papers/chubby-lock-service-loosely-coupled-distributed-systems) and, in a similar form, [ZooKeeper](/papers/zookeeper-wait-free-coordination-internet-scale-systems). Raft, which appeared shortly after this paper, also centers on a leader ([Raft](/papers/raft-understandable-consensus-algorithm)). The paper (SOSP 2013) argues that this has costs: the leader handles more messages than the other replicas, clients in other regions pay a trip to a remote master, load spikes at the leader raise latency, and a leader failure stops service until a new one is elected. Mencius rotates leadership round-robin, but then every replica must hear from all others, so the system runs at the speed of the slowest one.

EPaxos has no designated leader. A client sends a command to any replica, which becomes that command's command leader. Instead of fixing the order in a pre-assigned log, each command is committed together with ordering attributes (the commands it depends on and a sequence number), and replicas derive the execution order from those attributes. This builds on [state machine replication](/papers/state-machine-approach-fault-tolerant-services-tutorial) and aims at [linearizable](/papers/linearizability-correctness-condition-concurrent-objects) behavior. Its liveness claim is bounded by the [FLP result](/papers/flp-impossibility-of-distributed-consensus). Later work in the catalog that also attacks leader cost includes [NOPaxos](/papers/nopaxos-replacing-consensus-with-network-ordering) and [QuePaxa](/papers/quepaxa-escaping-the-tyranny-of-timeouts-in-consensus).

Worth knowing first: Paxos quorums, the difference between committing and executing a command, and the non-Byzantine failure model (replicas may stop, not lie).

## Contribution

- **Leaderless ordering.** Every replica owns its own row of instances (R.1, R.2, ...), and the global order is decided dynamically by attributes attached to each command, not by a fixed slot sequence or a leader.
- **Command interference.** Two commands interfere if some command sequence gives different states or read results when they are applied in the two orders. Only interfering commands need a consistent order.
- **A fast path of one round trip.** A command leader sends PreAccept to a fast-path quorum; if all replies carry the same attributes, it commits. The basic protocol needs 2F of N = 2F + 1 replicas, and the optimized one only F + floor((F+1)/2), including the leader.
- **A slow path of two round trips.** If the replies disagree, the leader takes the union of the dependencies and the highest sequence number and runs a Paxos-Accept round with F + 1 replicas.
- **An execution algorithm.** Committed commands form a dependency graph; strongly connected components are executed in inverse topological order, sorted by sequence number inside each component.
- **Recovery, reconfiguration and safety arguments.** Explicit Prepare for failed leaders, a join protocol with epochs, informal proofs in the paper and formal ones plus a TLA+ specification in a technical report.

## Methodology

The design is presented as a basic protocol (Figure 2, with a simplified recovery in Figure 3) followed by optimizations, with informal proof sketches for the guarantees in Section 4.2: nontriviality, stability, consistency, execution consistency, execution linearizability and liveness with high probability.

The evaluation compares EPaxos with Multi-Paxos, Mencius and Generalized Paxos, all implemented by the authors in Go 1.0.2 in one framework to share code, on Amazon EC2 (large instances with two virtual cores and 7.5 GB, Ubuntu 11.10). The workload is a replicated key-value store with update requests. Command interference is varied (0%, 2%, 25% and 100%), and the paper argues that 0% and 2% are the most realistic, citing Chubby (lease renewals are over 90% of requests and generate no conflicts) and Spanner-backed F1 (fewer than 0.3% of operations may conflict). Wide-area tests use three replicas (CA, VA, EU) and five (adding OR and JP) with ten co-located clients per replica. Cluster tests cover throughput, persistent logging to SSD, execution latency, batching and a replica failure.

## Findings

- **Latency in the wide area.** With three replicas, an EPaxos replica commits after one round trip to its nearest peer even when commands interfere. Generalized Paxos has a fast quorum of three for N = 3 and showed a median of 341 ms at 100% interference. With five replicas EPaxos avoids the two most distant replicas for non-interfering commands.
- **Execution can lag commit.** At 100% interference, median execution latency was 125 ms to 139 ms with three replicas, and 304 ms to 319 ms with five (274 ms to 296 ms for Mencius). The paper notes commit latency is what matters for writes.
- **Throughput.** EPaxos outperforms Multi-Paxos, whose leader is CPU-bound, and generally Mencius, because of the thrifty optimization (sending PreAccept and Accept only to a quorum). Generalized Paxos ran at less than 1/4 the speed of EPaxos and was dropped from these tests. EPaxos executes an extra round per command with many conflicts and more than three replicas.
- **Slow replica and failures.** EPaxos handles a slow node better because peers monitor ping speed and exclude the slowest from quorums; Mencius runs at the speed of the slowest replica. In a three-replica failure test at about 10,000 requests per second, Multi-Paxos stalls on leader failure and Mencius is disrupted by any failure, while EPaxos continues to commit.
- **Batching.** It raised maximum throughput by 5x for Multi-Paxos and 9x for EPaxos, and with it EPaxos at 100% interference was effectively as fast as with none.
- **Logging and execution.** With synchronous SSD logging EPaxos beat Mencius and Multi-Paxos. In a three-replica cluster its execution latency was lower than both, whatever the interference.

## Critical Analysis

- **Three message delays, not two.** The paper concedes that its fast path takes three message delays where Fast Paxos and Generalized Paxos take two, and argues that the first delay is negligible in the wide area because clients sit next to a replica.
- **Interference must be knowable.** The protocol needs to decide interference before executing, conservatively if unsure. Key-value stores make this easy; the paper admits general transactions are harder and are treated as interfering with everything.
- **Per-object guarantees.** EPaxos guarantees per-object linearizability. For operations where interference is not transitive, strict serializability needs a variant that notifies clients only after the whole dependency graph is committed, which raises client latency under conflicts.
- **The evaluation favors the common case.** Most results use 0% and 2% interference, and the 100% case is dismissed as unlikely. Later literature questions this (literature posterior, not in the paper): Tollman, Park and Ousterhout, "EPaxos Revisited" (NSDI 2021), report that the original benchmark does not trigger the full impact of conflicts and measure tail latency more than 4x worse than Multi-Paxos, while confirming optimal median commit latency.
- **Correctness of the specification (literature posterior).** Pierre Sutra, "On the correctness of Egalitarian Paxos" (Information Processing Letters, 2020), identifies a problem in both the TLA+ specification and the implementation, related to how replicas switch ballots when computing a command's dependencies, which may break linearizability. The recovery text of this paper should be read together with that note.
- **Go and garbage collection.** The authors say EPaxos suffers more from GC than the others because its messages carry attributes, which they consider fair to the others.

## Further Research

- Reducing conflict cost, which the paper leaves as future work: forwarding PreAccepts among fast-quorum members to cut one message delay on the slow path, or a partitioned Multi-Paxos mode for groups of commands.
- Using synchronized clocks to reduce conflicts, as in the re-evaluation by Tollman and colleagues.
- Fixed and formally verified recovery, following Sutra's findings.
- Leaderless or leader-light alternatives that use network ordering or randomization, such as the catalog's [NOPaxos](/papers/nopaxos-replacing-consensus-with-network-ordering) and [QuePaxa](/papers/quepaxa-escaping-the-tyranny-of-timeouts-in-consensus).
- Comparing EPaxos with production systems that kept a leader, such as [Spanner](/papers/spanner-globally-distributed-database), and with the engineering lessons in [Paxos Made Live](/papers/paxos-made-live-engineering-perspective).
