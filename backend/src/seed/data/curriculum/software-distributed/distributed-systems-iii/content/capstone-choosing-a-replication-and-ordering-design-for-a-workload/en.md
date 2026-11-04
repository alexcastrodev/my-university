---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Turn a workload into the questions that decide a design: what must be ordered, where the replicas live, which invariants exist, how contended the data is, and what the network allows.
- Match each answer to a family of designs from this discipline, and name what that family assumes.
- Compute a design's cost for a concrete workload from round trips, quorum sizes, and conflict odds.
- Split one system into data sets with different designs, and defend each choice against its failure modes.

## Context & Motivation

This discipline has covered a dozen ways to order and replicate data, and each lesson ended with a price. None of them won. `multi-paxos-from-one-decision-to-a-replicated-log` is simple and strong, and it charges a round trip to a majority for every write. `causal-consistency` answers locally and cannot protect an invariant. `deterministic-transactions-calvin` removes commit votes and requires declared read and write sets.

The working skill is reading a workload closely enough to know which price it can pay. This capstone applies that skill to a single system, the way `capstone-designing-a-cloud-storage-system-for-a-workload` did for storage. The conclusion is that one system rarely has one answer.

## Core Theory

### Five questions

**1. What has to be ordered?** A replicated state machine needs one order for everything it holds, while a set of independent keys needs far less. Asking this first prevents buying a global order for data that only needs per-key order.

**2. Is there an invariant across concurrent operations?** "A seat is sold once" and "a username is unique" cannot be checked by two sites that each act alone. `transactional-causal-consistency` shows two datacenters each approving an action that is individually legal and jointly illegal. If the invariant must hold, those operations need agreement, and no amount of causal metadata replaces it.

**3. Where are the replicas relative to the clients?** Inside one datacenter a round trip is cheap. Across regions the speed of light sets a floor, and any write that must reach a majority pays it.

**4. How contended is the data?** Contention decides between optimistic designs, which pay in aborts, and pessimistic or deterministic ones, which pay in waiting.

**5. What do you control?** Network-ordered designs need a sequencer in the network. Calvin needs transactions whose sets can be declared. A design is only available if its assumptions can be met.

### The families and what they assume

| Family | Gives | Assumes | Pays with |
|---|---|---|---|
| Consensus log | One order, linearizable | A majority reachable | A majority round trip per write |
| Certification | One-copy serializability | Atomic broadcast | Aborts under contention |
| Causal stores | Local writes, availability | No cross-site invariants | Weaker reads, visibility delay |
| Shared log | One order over many servers | A way to order at scale | An ordering step on the path |
| Deterministic | Serial order without commit votes | Declared sets | Batching delay, no reordering around stalls |
| Network-ordered | Fast path without coordination | A network the operator controls | A slow path, one datacenter |

Failure detection and membership sit underneath all of them. `failure-detectors` explains why suspicion is enough for liveness, and `reconfiguration-changing-membership-in-paxos-and-raft` shows why changing replicas needs the same care as the data path.

### Read every published number with its condition

The lessons here report throughput and latency from papers, and each figure belongs to one testbed, workload, and payload. A number from one paper cannot be set against a number from another as if both were measured together. For a design decision, use papers for the shape of the trade-off and measure your own workload for the quantity.

## Worked Examples

A ticketing platform has four data sets. All latencies, rates, and contention figures below are assumptions for this exercise, and each calculation was run in a script.

### Example 1: Control plane

The shard map and feature flags change a few times a minute, must be read consistently, and live in one region on five replicas. Writes are rare, there are no multi-key transactions, and availability during two crashes matters.

A consensus log fits directly. Flexible quorums are worth checking, because `fast-paxos-and-flexible-quorums` shows that only phase 1 and phase 2 quorums must intersect:

```text
Q1  Q2  intersect?  crashes survivable writing  crashes survivable electing
3   3   yes         2                           2
4   2   yes         3                           1
5   1   yes         4                           0
3   2   no
```

A smaller phase 2 quorum helps a workload that writes constantly. This one barely writes, and with Q1 = 4 a leader change would survive only one crash. Plain majorities win, and the optimization is declined.

### Example 2: Seat inventory

Sixteen shards in one region hold seats. A purchase takes several seats that can span shards, and a popular on-sale makes a few keys extremely hot. "Sold once" is an invariant, so question 2 rules out causal stores.

Certification has no lock window, so it seems attractive. Take write sets of `k` keys among `D` hot keys, and `c` concurrent transactions:

```text
D          k  c    P(two transactions overlap)  P(at least one overlap)
1,000,000  5  200  0.000025                     0.0050
100        5  200  0.2304                       1.0000
```

On a large, cold key space certification is excellent. During an on-sale, a transaction almost always meets a conflict, and the aborted work is retried into the same contention.

Compare two lock-based paths on one hot key, assuming a one-way delay of 0.25 ms and 0.1 ms of execution. In this simple model, 2PC over consensus groups holds locks across prepare, replication, the vote, and replicating the decision, which is 6 one-way delays. A deterministic design holds them for the read exchange and execution, about 2 delays, because the order was fixed first:

```text
2PC over consensus:  hold 1.60 ms -> at most 625 transactions/s on that key
Deterministic:       hold 0.60 ms -> at most 1,667 transactions/s on that key
```

The deterministic path pays elsewhere: with Calvin's 10 ms epochs a request waits 5 ms on average for its batch, plus replication. Seat IDs are in the request, so the sets can be declared, and a few milliseconds are acceptable to someone buying a ticket. A deterministic design fits.

Network ordering would cut latency further, but `network-ordered-consensus-nopaxos-eris-and-hydra` assumes a network the operator controls. The platform runs on a public cloud, so question 5 removes it.

### Example 3: Profiles and follows

Three regions serve users, and writes must feel instant. Assume round trips of 70 ms between Virginia and Ireland, 150 ms between Virginia and Tokyo, and 210 ms between Ireland and Tokyo. Consensus with a leader in Virginia and a majority of two gives:

```text
Client in   Consensus write   Causal write acknowledged
Virginia    70 ms             local
Ireland     140 ms            local
Tokyo       220 ms            local
```

Causal replication acknowledges in the local region, and a write becomes visible elsewhere after at least the one-way delay: 35 ms from Virginia to Ireland, 75 ms to Tokyo, 105 ms from Ireland to Tokyo. Profiles and follows have no cross-site invariant, and a follow that appears 100 ms later harms nobody, so transactional causal consistency fits. `causal-metadata-for-geo-replication-saturn` matters if metadata grows into a visibility or throughput problem.

There is one exception inside this data set. Usernames must be unique, and question 2 applies. Username claims go through the control plane's consensus log and pay the round trip. Those are rare, so the cost is small.

### Example 4: Order events

Every sale produces events that many consumers replay, and replay needs one total order. Assume 40 storage shards at 15,000 appends per second each, 600,000 in total, and a single sequencer capped at 200,000 tokens per second:

```text
Offered 600,000/s, delivered min(600,000, 200,000) = 200,000/s
Shards the sequencer can feed: 13 of 40
```

The sequencer becomes the bottleneck long before storage does. `scaling-shared-logs-fuzzylog-and-scalog` offers two exits. FuzzyLog removes the global order, which replay needs here, so it is out. Scalog keeps the total order by ordering records already replicated, at the cost of waiting for a cut. If a consumer later needs lower end-to-end latency, `low-latency-shared-logs-lazylog-and-speclog` shows where that wait can move. It does not disappear.

### The result

| Data set | Design | What would change the choice |
|---|---|---|
| Control plane | Consensus log, majorities | Heavy write load |
| Seat inventory | Deterministic transactions | Sets that cannot be declared |
| Profiles, follows | Transactional causal | A new cross-site invariant |
| Usernames | Consensus log | Nothing common |
| Order events | Shared log with cuts | Replay no longer needing one order |

## Common Misconceptions & Pitfalls

- **"Pick the strongest guarantee to be safe."** Example 3 shows the strongest option adding 220 ms to a write that needed none of it. Strength has a price, and paying it where nothing depends on it is a design error.
- **"Causal consistency is nearly as good as consensus."** It is a good fit until an invariant appears. The username in Example 3 cannot be protected by metadata, however rich.
- **"Certification is always cheaper because it avoids locks."** Example 2 shows it depends entirely on contention: the same protocol went from 0.5% to near certainty of conflict.
- **"This paper reached a million operations per second, so my system will."** That figure carries a testbed, a payload, and often a missing replication factor. Use it for shape, not for planning.
- **"A faster network sequencer solves it."** Only for operators who can deploy one, and only inside one datacenter.
- **"One system should have one replication design."** Four data sets with different answers is the normal result, not a failure of architecture.

## Summary

A design follows from five questions: what must be ordered, which invariants span concurrent operations, where replicas sit, how contended the data is, and what you control. Each family answers some of these and assumes the rest. In this example, consensus held rare, critical data, a deterministic design took the contended inventory, causal replication kept global profiles fast, and a cut-based shared log carried events past a sequencer's limit. Compute the cost for your own workload, read published numbers with their conditions, and name what would change your mind.

## Documentation Links

- [Howard, Malkhi and Spiegelman (2016): Flexible Paxos, Quorum Intersection Revisited](https://arxiv.org/abs/1608.06696): the quorum intersection requirement behind Example 1.
- [Thomson et al. (2012): Calvin: Fast Distributed Transactions for Partitioned Database Systems](https://cs.yale.edu/homes/thomson/publications/calvin-sigmod12.pdf): deterministic transactions and the 10 ms epochs in Example 2.
- [Li, Michael and Ports (2017): Eris: Coordination-Free Consistent Transactions Using In-Network Concurrency Control](https://syslab.cs.washington.edu/papers/eris-sosp17.pdf): the network-ordered alternative set aside in Example 2.
- [Akkoorath et al. (2016): Cure: Strong Semantics Meets High Availability and Low Latency](https://webperso.info.ucl.ac.be/~pvr/icdcs2016-cure.pdf): the transactional causal model in Example 3.
- [Lloyd et al. (2011): Don't Settle for Eventual: Scalable Causal Consistency for Wide-Area Storage with COPS](https://www.cs.cmu.edu/~dga/papers/cops-sosp2011.pdf): causal replication with local operations.
- [Ding et al. (2020): Scalog: Seamless Reconfiguration and Total Order in a Scalable Shared Log](https://www.usenix.org/system/files/nsdi20-paper-ding.pdf): ordering replicated records by cuts, as in Example 4.
