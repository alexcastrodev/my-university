---
title: "Bodega: Localized Linearizable Reads at Anywhere Anytime via Roster Leases"
summary: Bodega lets chosen replicas answer linearizable reads from local state by recording them as responders in a cluster-wide roster, kept consistent by all-to-all leases that ride on heartbeats, and it holds reads that collide with a write instead of redirecting them.
researchArea: Distributed Systems
keywords: linearizable reads, consensus, leases, wide-area replication, roster, local reads, multipaxos
version: 1.0
updatedAt: 2026-11-07
---

## Overview

Replicated systems spread across availability zones pay a wide-area round trip for every quorum, and reads are the majority of most workloads. Serving a read from the client's nearest replica would remove that cost, but a replica can only do it linearizably if it knows its data is the latest, and asking an outside service would defeat the purpose and cap fault tolerance at that service's.

This OSDI 2026 paper, by Guanzhou Hu (Amazon Web Services, work done at Wisconsin) and Andrea C. Arpaci-Dusseau and Remzi H. Arpaci-Dusseau (University of Wisconsin-Madison), argues that existing read leases fall short. Leader Leases help only at the leader, and Quorum Leases lose their benefit when even a small share of writes touches the same key.

Four terms carry the paper. The **roster** is cluster metadata that names the leader and, per key range, the **responders** allowed to read locally. **Roster leases** are the all-to-all leases that make nodes agree on it. **Optimistic holding** keeps a read that meets an in-flight write at the responder until the write commits. Bodega is the protocol built from them.

Worth knowing first: MultiPaxos ([Paxos Made Simple](/papers/paxos-made-simple)) and [Raft](/papers/raft-understandable-consensus-algorithm), leader leases, and, for contrast, how [Spanner](/papers/spanner-globally-distributed-database) uses synchronized clocks. Bodega assumes only bounded clock drift.

## Contribution

- **The roster.** A leader plus, for each key range, a set of responders, identified by a unique ballot. The leader counts as a responder for every key. It generalizes leadership to arbitrary subsets of replicas.
- **A stricter commit rule for writes.** A write to key k commits once a majority has accepted it and every responder for k, in the leader's roster, has replied. The authors call this an unavoidable price of any local linearizable read scheme.
- **Roster leases.** Every node is both grantor and grantee to every peer, using the standard guard and renew phases. A node holding at least a majority of leases knows the roster is stable. A node that has just joined a roster also checks that it has committed all slots up to the safety thresholds peers report, so it cannot serve a stale value.
- **The read path.** The leader answers from its last committed value, a non-responder redirects the client, and a responder replies if the newest write to the key is committed. Otherwise it holds the read until commitment. Optional early accept notifications let followers tell responders about accepts directly, which the authors say halves the expected holding time under low load. A client-side timeout retries elsewhere if the leader is slow.
- **Practicality.** Leases piggyback on heartbeats, and most heartbeats carry only the ballot because full rosters can reach tens of KBs. Servers can propose responders from per-key read counts. A proactive roster change takes two message rounds, one to revoke and one to initiate.
- **Assurance.** A pseudocode summary, a concise proof of linearizability and write liveness that relies on known lease results, and a TLA+ specification.

## Methodology

The authors built Summerset, a protocol-generic replicated key-value store in async Rust. Bodega is about 3.0k lines in it, next to MultiPaxos with Leader Leases, EPaxos, PQR and Quorum Leases (the last two with a variant each), so every baseline is the authors' own implementation.

Experiments use two five-node settings: a real wide-area CloudLab cluster, and a GEO cluster emulated with Google Cloud round-trip times taken from earlier work. The microbenchmark uses 50 closed-loop clients, 10 near each server, 1k keys, 128B values and 0%, 1% or 10% writes. Heartbeats are every 120 ms and leases last about 2500 ms. Further experiments cover latency distributions, one interfering write, write ratios, value sizes, roster changes, a failure simulation and YCSB against etcd and ZooKeeper.

## Findings

These are the authors' reported results.

- **Headline.** Average client read requests are 5.6× to 13.1× faster than with previous approaches on real wide-area clusters under moderate write interference. Bodega matches Leader Leases for clients near the leader or a non-responder.
- **Robust to writes.** At 10% writes Bodega keeps reads close to zero latency near responders, while Quorum Leases almost degrade to Leader Leases.
- **Throughput.** In the 10% write WAN setting the leader-bound Leader Leases saturate near 1.8k requests per second, Quorum Leases near 3.4k and Bodega near 6k, with 1.5× better latency.
- **One interfering write.** Quorum Leases reads rise to about 40 ms, the average round trip to the leader. Bodega's disruption lasts about 25 ms, and held reads are released afterwards.
- **Write costs.** Writes are somewhat slower than Leader Leases because they must reach responders. Throughput gains shrink as the write ratio grows to 50%, and more responders or more covered keys trade write latency for read latency.
- **Roster changes.** An explicit change completes in about 75 ms. After a responder crash, writes block and reads stay local without interruption for about 1.1 s until a heartbeat timeout starts a change, then a 2.6 s wait for lease expiration follows.
- **Frequent failures.** A Monte Carlo simulation with exaggerated failure rates still gives up to 2.2× the throughput of Leader Leases.
- **Production systems.** On YCSB, Bodega matches and sometimes beats sequentially consistent ZooKeeper and keeps up with stale etcd. With no writes, those two serve reads in about 0.3 ms against Bodega's roughly 1.2 ms, which the authors attribute to 1 ms request batching.

## Critical Analysis

The idea is clean: it moves the cost of local reads from every write to a rarely changing roster. The paper is open about several limits.

- **Writes pay for reads.** A write must reach every responder, so far-off responders cost write latency, and the improvement fades for write-dominant or intra-datacenter workloads. Choosing responders is left as a policy question.
- **Liveness and scope.** Heartbeat-based roster changes risk liveness under partial network partitions, a problem the authors say pre-votes could address. Transactions are out of scope.
- **Crashes stall writes.** The commit rule makes a responder crash block writes until the roster changes, which Figure 16 shows.

The following points are a reading of the evidence, not claims of the paper.

- **Failure behavior is thinly measured.** The real experiment is one crash of one responder with a single client. The frequent-failure result is a simulation with assumed stalls (3 s per failure, 100 ms per responder recovery) built from failure-free numbers. In the uniform YCSB setup every node is a responder, so any crash stalls writes for seconds, where a majority-quorum protocol would not stall on a follower crash. The paper does not weigh this against the read gain.
- **The headline range is hard to trace.** The abstract says moderate interference and the introduction says slight. Figure 9 reports per-location results, and the text does not say which baseline and write ratio give each end of 5.6× to 13.1×.
- **Comparisons mix implementations.** Ratios against the other lease protocols are fair because they share a code base. The authors credit part of the gap with ZooKeeper to Java runtime overheads, and etcd (stale) and ZooKeeper are not linearizable, so that comparison shows Bodega is competitive, not that the protocol is faster.
- **Only five nodes.** All runs use five nodes, with 1k keys in the microbenchmarks and 10k in YCSB. The paper says lease overhead is negligible, but no experiment varies cluster size or isolates it.
- **Assumptions are not stressed.** No run injects clock drift. The model check covers 3 nodes, 3 ballots and 2 writes plus 2 reads, taking 43 hours and about 4.27 billion states, so five-node behavior rests on the proof sketch.
- **Policy is lightly tested.** The default heuristic needs over 95% reads and adds servers near over 20% of reads. The Zipfian YCSB roster was built by hand from top-20% keys, so the automatic policy is not evaluated under workload shifts.

## Further Research

- Policies that choose responders and key coverage automatically, including how stable they are under shifting workloads and fail-slow nodes.
- Roster leases as a general mechanism for infrequently changing metadata, such as membership, asymmetric quorum sizes or node performance hints, as the authors suggest.
- Bounded-staleness reads, which the authors sketch as scanning the log tail for a limited number of versions of the key.
- Measuring larger clusters, drift injection and repeated failures, which would test the overhead and availability claims directly.
