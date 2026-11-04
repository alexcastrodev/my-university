---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Explain ordered unreliable multicast, and why ordering without reliable delivery is cheap to provide while ordering with it is not.
- Trace NOPaxos's normal case and its gap agreement at a concrete sequence number.
- Explain why neither one global counter nor one counter per shard works for transactions, and how Eris's multi-stamp fixes both.
- Apply Hydra's delivery rule to a trace from two sequencers, and say what each design keeps paying for.

## Context & Motivation

`the-replicated-state-machine-approach` split replication into Agreement and Order, and `paxos-the-original-consensus-protocol` solved both in the protocol, because it assumes a network that may lose or reorder anything. `deterministic-transactions-calvin` moved agreement before locks, with a software sequencer working in 10 ms epochs.

The papers here move part of the job below the application. Atomic broadcast in the network would make replication trivial, but it is equivalent to consensus and only moves the cost. So the question is which part of the job is cheap for a network to do, inside one datacenter, where a device on the path can stamp a packet in microseconds.

## Core Theory

### NOPaxos: ordering yes, reliability no

[NOPaxos](/papers/nopaxos-replacing-consensus-with-network-ordering) (OSDI 2016) divides replication into two properties: ordering (if some replica processes a before b, none processes b before a) and reliable delivery (a request is processed by all replicas or none). Only ordering goes to the network, through **ordered unreliable multicast** (OUM):

```text
Asynchrony:     no bound on delivery latency.
Unreliability:  no message is guaranteed to arrive.
Ordered:        receivers of m and m' get them in the same order.
Drop detection: each receiver gets m or a DROP-NOTIFICATION,
                or no receiver gets either.
```

All packets for a group pass through one sequencer, which writes a counter into each. Receivers discard what arrives out of order and treat a gap as a drop. The counter must increment by exactly 1, because a timestamp would increase but could not reveal a gap. A session number covers sequencer failure, and when a session ends receivers get SESSION-TERMINATED instead.

The replicas now need to agree only on which requests to execute and which to skip:

```text
Normal case: client multicasts; every replica logs and replies; only
  the leader executes. The client waits for f + 1 matching replies,
  including the leader's. One round trip, no replica-to-replica messages.
Gap agreement: a non-leader fetches the missing request from the leader.
  If the leader lacks it, the leader commits a NO-OP in that slot
  (GAP-COMMIT) and waits for f replies.
View change: replaces the leader or moves to a new session.
```

Paxos needs 4 message delays and 2n messages at its bottleneck. NOPaxos needs 2 of each, and a simple majority, where Fast Paxos and Speculative Paxos need larger quorums.

### Eris: ordering across shards

NOPaxos orders one replica group. [Eris](/papers/eris-coordination-free-consistent-transactions) (SOSP 2017) targets a partitioned store, where shards see different transactions and still must apply shared ones consistently. Its sequencer keeps one counter per destination group, atomically increments those of a message, and writes the set of counters into the packet as a **multi-stamp**. Example 2 shows why both simpler schemes fail.

The transaction model makes this enough. An independent transaction is a one-shot procedure with no cross-shard data dependencies, where each shard reaches the same commit decision alone. Executing such transactions sequentially at each shard in sequence order is serializable, so the normal case is one round trip: the client waits for a majority of each shard, including its Designated Learner, the only replica that executes synchronously. The application still owns reliability, through a replicated Failure Coordinator that recovers or permanently drops lost transactions. General transactions are built on top: a preliminary transaction gathers reads and takes locks, and a conclusory one commits. Unknown read and write sets use reconnaissance queries, as in Calvin.

### Hydra: ordering without a serialization point

Both designs route all traffic through one device, which caps throughput, restricts routing, and couples sequencer replacement to network rerouting. [Hydra](/papers/hydra-serialization-free-network-ordering) (NSDI 2023) runs several sequencers at once and gives the same guarantees. Independent counters alone fail: two sequencers can write the same number, and breaking the tie by sequencer ID leaves a receiver unable to notice a lost "smaller" message.

Hydra therefore uses two pieces of data, each for what it can do. **Clocks give the order**: each sequencer stamps its loosely synchronized clock, and receivers order by (clock, sequencer ID). **Sequence numbers detect gaps**: each sequencer keeps per-group counters. A receiver tracks the largest clock seen from each sequencer and delivers a message only once it is at or below the minimum of those values (`cmin`). By then, anything lost has shown up as a gap. Clock skew can delay delivery, but safety needs only clocks that never run backwards.

An idle sequencer would stall every receiver, so sequencers send **flush** messages carrying their clock and latest sequence numbers. A failed sequencer also stalls receivers until a configuration service removes it, with quorums from each receiver group agreeing on its last sequence numbers. Failover involves only receivers, not the network.

### What moved, and what remains

```text
             Network does                Application still does
NOPaxos      total order per group       gap agreement, view changes
Eris         partial order across shards drop recovery via FC, epochs,
                                         locks for general transactions
Hydra        same, with N sequencers     same, plus flushes and
                                         sequencer removal
```

Consensus does not disappear: the SDN controller in NOPaxos is replicated with Paxos, and the Eris Failure Coordinator is replicated too. Coordination leaves the common path.

### Numbers and their conditions

- **NOPaxos.** Throughput within 2% and latency within 16 µs of unreplicated, on a Cavium middlebox with five replicas. Latency 111 µs against Paxos's 240 µs. After a sequencer failure simulated by notifying the controller, operation resumed in about 110 ms and peak throughput returned in 270 ms. The hardware for an in-switch sequencer was not yet available in 2016, so that design went unmeasured there.
- **Eris.** 221K TPC-C new-order transactions per second, 7.6× Lock-Store, on 15 shards of 3 replicas, with H-Store's partitioning, which makes all transactions independent. The 35× comes from the most skewed run of a custom workload. Sequencer capacity was 6.19M packets per second on the middlebox.
- **Hydra.** On a Tofino switch with two sequencers and three replicas, HydraPaxos has latency within 5 µs and throughput within 17% of NOPaxos. HydraTxn gets 47% more than Eris in a run that rate limits sequencers and uses single-shard transactions.

## Worked Examples

### Example 1: a NOPaxos gap at sequence 6

Three replicas (f = 1), leader R0. The sequencer stamps requests 1 to 7. Request 4 is lost on the way to R1. Request 6 (`SET a=6`) is lost on the way to R0.

```text
seq 4: R1 sees 5 after 3 -> DROP-NOTIFICATION
       R1 fetches 4 from the leader. No agreement round.
seq 6: R0 sees 7 after 5 -> DROP-NOTIFICATION
       Replies so far: R1, R2. No leader reply, client not done.
       R0 logs NO-OP, sends GAP-COMMIT(6)
       R1, R2 overwrite 'SET a=6' with NO-OP, reply
       R0 has f = 1 reply, moves to 7
retry: client resends, gets seq 8

All logs: a=1 b=2 a=3 c=4 b=5 NO-OP d=7 a=6
```

Two replicas held the request and it was still discarded, safely, because the client never had the leader's reply. As an optimization, the leader can first ask the others for a copy.

### Example 2: three ways to number T1{A,B}, T2{B,C}, T3{A,C}, T4{A,B,C}

```text
One global counter, sent only to participants:
  A receives 1 3 4 with nothing lost.
  Is 2 a drop, or a message for other shards? A cannot tell.

One sequencer per shard:
  A orders T1 before T4, B orders T4 before T1. A cycle.

Multi-stamp:
  T1 {A:1, B:1}   T2 {B:2, C:1}   T3 {A:2, C:2}   T4 {A:3, B:3, C:3}
  T3 lost at A: A receives 1, 3 and knows number 2 is missing.
  Shard C logged T3 as C:2, so the transaction can be recovered.
```

Each receiver gets a gap-free counter of its own, and the atomic increment orders any two transactions that share a shard.

### Example 3: Hydra's delivery rule

This is the trace of Figure 1 in the Hydra paper, run through a receiver in group 1. Each input shows (sequencer, its number for group 1, clock), and F is a flush.

```text
Input                 cmin      buffer   delivered
M1 (1, 1, 42)         (0,2)     M1       -
M2 (2, 1, 42)         (42,1)    M2       M1
F1 (1, 3, 80)         (42,2)    -        DROP(seq 1, #2), M2
M3 (2, 2, 85)         (80,1)    M3       -
M4 (2, 4, 90)         (80,1)    M3 M4    DROP(seq 2, #3)
F2 (1, 3, 98)         (90,2)    -        M3, M4
```

M1 waits for evidence from sequencer 2. F1's number 3 reveals that #2 was lost. M3 waits because sequencer 1 has reached only clock 80. If sequencer 1 sends nothing after M1, then M2, M3 and M4 stay buffered, which is why an idle or failed sequencer is a stall point.

## Common Misconceptions & Pitfalls

- **"NOPaxos replaces consensus."** It replaces coordination on the common path. Gap agreement, view changes and the controller remain, and safety depends on the OUM guarantees holding.
- **"Network ordering is free."** The 16 µs and 2% come from a middlebox in one datacenter testbed. The in-switch sequencer expected to cost less went unmeasured in that paper.
- **"Eris is coordination-free."** That describes the normal case of independent transactions. A sequencer failure stops replicas in every shard for an epoch change.
- **"Hydra removes the sequencer failure problem."** It shortens the outage. Every sequencer is a stall point, and more sequencers mean more failures.

## Summary

These designs hand ordering to the network, where a counter in a packet is cheap, and keep reliable delivery in the application. NOPaxos reduces replication to deciding which slots to skip. Eris extends the order across shards with multi-stamps, for transactions that fit its independent model. Hydra removes the single device by ordering with clocks and detecting drops with per-sequencer numbers, at the price of flush traffic and some throughput against serialization. All three keep a slow path for drops and failures, and all three assume one datacenter whose network the operator controls.

## Documentation Links

- [Li et al.: Just Say NO to Paxos Overhead: Replacing Consensus with Network Ordering (OSDI 2016)](https://www.usenix.org/system/files/conference/osdi16/osdi16-li.pdf): OUM, the sequencer implementations, the NOPaxos protocol and its evaluation.
- [Li, Michael and Ports: Eris: Coordination-Free Consistent Transactions Using In-Network Concurrency Control (SOSP 2017)](https://syslab.cs.washington.edu/papers/eris-sosp17.pdf): multi-sequencing, independent and general transactions, and the Failure Coordinator.
- [Choi et al.: Hydra: Serialization-Free Network Ordering for Strongly Consistent Distributed Applications (NSDI 2023)](https://www.usenix.org/system/files/nsdi23-choi.pdf): multiple sequencers, the clock and sequence number delivery rule, flushes and failover.
