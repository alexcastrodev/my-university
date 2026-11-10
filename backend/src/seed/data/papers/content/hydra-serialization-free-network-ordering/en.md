---
title: "Hydra: Serialization-Free Network Ordering for Strongly Consistent Distributed Applications"
summary: Hydra replaces the single network sequencer of systems like NOPaxos and Eris with several active sequencers, combining per-sequencer sequence numbers, loosely synchronized clocks and flush messages to keep the same ordering and drop detection guarantees.
researchArea: Distributed Systems
keywords: network ordering, sequencers, groupcast, state machine replication, distributed transactions, programmable switches, loosely synchronized clocks
version: 1.0
updatedAt: 2026-11-03
---

## Overview

[NOPaxos](/papers/nopaxos-replacing-consensus-with-network-ordering) and [Eris](/papers/eris-coordination-free-consistent-transactions) moved the ordering of operations into the network: a sequencer, typically a programmable switch, stamps each request, and receivers process requests in stamp order and notice gaps. The catch is serialization. All traffic must pass through one device, which limits scale, restricts routing, and ties sequencer replacement to network rerouting.

This NSDI 2023 paper asks whether network sequencing can work without that single device. Its answer is Hydra, a group communication primitive in which several sequencers run at once and receivers merge their streams into one consistent order, with the same guarantees as the primitives under NOPaxos and Eris.

Worth knowing first: state machine replication, the ordered but unreliable network model, and why sequence numbers reveal gaps while timestamps do not.

## Contribution

- **Groupcast with three properties.** Messages with overlapping destination groups are delivered in a consistent order, delivery is best effort, and for each message either all destination groups deliver it or a DROP-NOTIFICATION, or none does.
- **Clocks for order, sequence numbers for gaps.** Each sequencer atomically writes its clock value and a per-group sequence number into a message. Receivers order by clock, breaking ties by sequencer ID, and deliver a message only once the clock values received from all sequencers have reached it. By then, any missing message shows up as a gap.
- **Flush messages for progress.** An idle sequencer would stall every receiver, so sequencers send flushes with their clock and latest sequence numbers. Receivers can solicit them on demand, and programmable ToR switches can aggregate them.
- **Failover without rerouting.** A fault-tolerant configuration service removes a suspected sequencer using quorums from each receiver group, so only receivers coordinate, not the network layer.
- **Two systems.** HydraPaxos builds on NOPaxos and HydraTxn on Eris. The only change is disabling their own sequencer failure handling.

## Methodology

Hydra runs in P4 on a Tofino switch and in C++ on end hosts, and a TLA+ specification of groupcast and of sequencer addition and removal is model checked against the safety guarantees. The testbed is 10 nodes on one switch, with multiple switch sequencers made by statically partitioning it. Microbenchmarks compare Hydra with the authors' own atomic multicast and an unordered baseline. Replication runs on three replicas against Paxos, Fast Paxos and NOPaxos. Transactions run on 15 shards of three replicas with single-shard YCSB+T, against Lock-Store, Granola and Eris. Hydra uses two sequencers, and NOPaxos and Eris one. Load balancing is simulated in NS3 on a FatTree of 2560 servers, and in the failover test Eris's rerouting is a simulated 100 ms delay.

## Findings

These are the authors' reported results.

- **Against atomic multicast.** With one group of three receivers and two switch sequencers, 378% more throughput and 42% less latency. Growing the group to nine cost Hydra 8% of throughput and no latency.
- **Against unordered multicast.** A 3 μs latency penalty and throughput within 39% in the three-receiver setup.
- **Sequencer scaling.** Throughput grows linearly to eight emulated switch sequencers, past 250 million groupcasts per second, and near-linearly with end-host sequencers.
- **HydraPaxos.** 204% more throughput than Paxos and 180% more than Fast Paxos, with latency within 5 μs and throughput within 17% of NOPaxos.
- **HydraTxn.** 3.1× and 1.9× the throughput of Lock-Store and Granola, and 47% more than Eris, whose single sequencer is the bottleneck.
- **Network effects, in simulation.** A single ToR sequencer saturated several aggregation links, while eight kept all core and aggregation links below 50%.
- **Failover.** After a 30 ms timeout, removing the sequencer took a few hundred microseconds. The introduction sums up the gain as 5× less downtime.
- **Clock skew.** A 200 μs skew added less than 100 μs of latency, and throughput did not change.

## Critical Analysis

Hydra does what it sets out to do: several sequencers, no coordination among them on the critical path, and the guarantees of the earlier primitives.

The paper itself concedes these costs:

- **Every sequencer is a stall point.** Losing one stops some or all receivers until reconfiguration, and more sequencers mean more failures. Hydra shortens the outage rather than removing it.
- **Flush traffic scales with sequencers.** The flushes needed per message grow linearly unless ToR switches aggregate them.
- **Performance is close to serialization, not equal.** HydraPaxos sits 17% below NOPaxos in throughput, which the introduction calls a "marginal performance cost".

The rest is a reading of the evaluation:

- **Sequencer scaling is nearly set by the experiment.** The eight sequencers are emulated on one switch, each rate limited to 10 Gbps, with load from virtual groups dropped at the egress. The 250 million figure measures stamping capacity, and these sequencers do not fail or drift independently.
- **The 47% over Eris reflects a chosen bottleneck.** That run also rate limits sequencers, and the paper notes that in-switch sequencers sustain far higher rates than server replicas.
- **Transactions are single-shard.** The HydraTxn numbers do not exercise multi-shard transactions or shard-spanning drop agreement.
- **Network effects are not measured on hardware.** The lone sequencer in the simulation sits at a ToR, although the paper says earlier work envisioned root switches. Section 7.5 does not show how the 5× is derived.
- **Verification stops at groupcast.** The TLA+ model treats each receiver group as a single entity, so composition with NOPaxos and Eris is argued, not checked.

## Further Research

- How Hydra behaves with physically separate switch sequencers, real clock drift and full load reaching real receivers.
- How multi-shard transactions perform when drop agreement must span shards and sequencers.
- What failure timeouts work in production, given that a false suspicion removes a healthy sequencer.
- Whether delivery can continue for groups unaffected by a failed sequencer.
- Machine-checked proofs of Hydra composed with NOPaxos and Eris.
- Whether merging sequencers by clock could serve shared logs, which the paper contrasts with its design through [Scalog](/papers/scalog-seamless-reconfiguration-and-total-order).
