---
title: "SWARM: Replicating Shared Disaggregated-Memory Data in No Time"
summary: SWARM replicates shared objects in disaggregated memory so that reads and writes usually take one round trip while staying linearizable and wait-free, by guessing write timestamps and checking them with timestamp locks, and by updating large buffers on memory nodes that run no code.
researchArea: Distributed Systems
keywords: disaggregated memory, replication, linearizability, wait-freedom, rdma, key-value store
version: 1.0
updatedAt: 2026-11-07
---

## Overview

Memory disaggregation places memory in separate memory nodes that servers reach over a fast fabric, today RDMA and in the future possibly CXL. It improves utilization, but a failing memory node can now take away data shared by many servers, so the data must be replicated. The authors argue that schemes built for ordinary servers fit this setting badly for two reasons. They need several round trips, which at least doubles the latency of disaggregated memory, and they often run code next to the data to track timestamps, filter old messages or vote, which memory nodes may not be able to do or may do only at a high cost.

This SOSP 2024 paper (Austin), by Antoine Murat, Clément Burgelin, Athanasios Xygkis, Igor Zablotchi, Marcos K. Aguilera and Rachid Guerraoui, from EPFL, Oracle Labs, Mysten Labs and VMware Research Group, proposes SWARM (Swift WAit-free Replication in disaggregated Memory). It targets low-latency uses such as trading systems and microsecond-scale microservices.

Five terms carry the paper. A **max register** is an object whose read returns a value at least as large as every write that completed before it. **Safe-Guess** is the replication protocol. **Timestamp locks** are the wait-free locks that make its guesses safe. **In-n-Out** is the technique that builds a max register for large values on memory nodes without compute. **SWARM-KV** is the key-value store built on all of it.

Worth knowing first: linearizability, wait-freedom and ABD, the classic quorum protocol for replicating a read-write register, which the paper starts from. The paper contrasts its approach with consensus-based replication, which it cites through Lamport's [The Part-Time Parliament](/papers/paxos-part-time-parliament). It does not cite [Paxos Made Simple](/papers/paxos-made-simple) or [Raft](/papers/raft-understandable-consensus-algorithm), which are linked here as background on that leader-based alternative.

## Contribution

- **A narrower problem.** SWARM replicates read-write registers, not arbitrary state machines. The authors argue that state machine replication needs consensus, which costs more round trips and is not wait-free, while registers suffice for key-value stores. Assumptions: crash failures only, a majority of memory nodes alive, any number of failed clients, and wait-freedom only if the number of concurrent threads is bounded.
- **Safe-Guess.** ABD spends a first round trip fetching a fresh timestamp. A Safe-Guess writer instead guesses one from its local clock, writes its tuple (timestamp, GUESSED flag, value) to the max register and reads the register in parallel. If it reads nothing larger than what it wrote, the guess was fresh and the write is done in one round trip, while a background write flips the flag to VERIFIED so that readers also finish in one.
- **Timestamp locks.** If the writer reads something larger, its guess may have been stale, but re-writing could expose the value twice. A timestamp lock lets a reader and a writer race for the same timestamp so that at most one wins. If the writer wins, no reader can return the guessed value and it rewrites above the timestamp it saw. If it loses, a reader judged the guess fresh and the write is done. A reader returns a VERIFIED value, or locks a tuple it has seen twice in read mode, or returns after seeing two different tuples from one writer, which bounds it to 2 × (number of writers) + 1 iterations. Each lock is built from CAS objects on the memory nodes.
- **In-n-Out.** Memory nodes offer plain reads and writes, a 64-bit CAS, and ordered execution of two pipelined updates. A max register entry combines out-of-place buffers, 8 bytes of metadata (a timestamp and a pointer) and an in-place copy protected by a hash that covers the pointer. A write fills a new buffer and updates the metadata in one pipelined round trip, then refreshes the in-place copy in the background. A read fetches metadata and in-place data together and follows the pointer only if the hash does not match. The max update is emulated with CAS, and an array of 8-byte buffers, one per writer, reduces contention.
- **SWARM-KV.** Clients reach replicas directly, with an index of replica locations (about 24 bytes per key) and the uKharon membership service on ordinary servers. Gets, updates, inserts and deletes take one round trip in the common case, and a delete writes the maximum timestamp so later operations on the key fail. Memory recycling asks clients to stop using buffers, which needs eventual synchrony.

## Methodology

SWARM-KV is 3,151 lines of C++17 on RDMA, using uKharon's framework, xxHash3 for the hashes and FUSEE's index modified for strong consistency. Clients guess timestamps from a loosely synchronized TSC-based clock and resynchronize after each stale guess. Writes and reads first contact a bare majority of replicas, and the in-place data lives on one replica. The authors say they did not implement memory recycling.

The testbed has 4 client servers and 4 memory nodes behind a single 100 Gbps switch. The baselines are RAW (unreplicated, no concurrency control, a lower bound), DM-ABD (the authors' ABD-based store with out-of-place updates) and FUSEE, a state-of-the-art replicated disaggregated store. The comparison with FUSEE is limited to end-to-end latency. The default workloads are YCSB A (50% updates) and B (5% updates) with Zipfian 0.99 keys, 3 replicas, 100K keys of 24 B, 64 B values and 4 clients, after a warm-up of 1M operations. Further experiments vary load, clients up to 64, value size, replication factor, cache size, a memory node crash and contention on a single key. The appendices hold correctness proofs and round-trip analyses, marked as not peer reviewed.

## Findings

These are the authors' reported results.

- **Against the unreplicated store.** On YCSB B, SWARM-KV gets take a median 2.4 µs against RAW's 1.9 µs (+27%), with P1 at 2.2 µs and P99 at 2.8 µs. Updates take 3.1 µs against 1.6 µs (+92%). The overhead is below one round trip, 0.5 µs for gets and 1.5 µs for updates.
- **Against the replicated baselines.** DM-ABD takes two round trips: 4.3 µs for gets and 4.9 µs for updates. FUSEE gets take 2.9 µs for 87% of operations and 4.8 µs at the 90th percentile, and its updates take 8.5 µs (4 round trips) up to 10.4 µs (5). The authors summarize this as up to 2× faster gets and 3.4× faster updates than FUSEE.
- **Small caches.** With 1M keys and 5 MiB of cache, DM-ABD and FUSEE cache 21.8% of the keys and SWARM-KV 16.4%, with miss rates of 42.5% and 45.6% respectively. SWARM-KV's average latency stays better for both operations.
- **Throughput and scale.** On YCSB A, one core goes from 2.7 µs and 264 kops with one operation at a time to 499 kops with two (2.8 µs) and 640 kops at most. With one operation per client, 64 clients reach 15.9 Mops, with get latency growing from 2.2 to 3.69 µs and update latency from 2.7 to 4.3 µs. With 4 concurrent operations the peak is 28.3 Mops at 40 clients, after which the fabric becomes the bottleneck.
- **Replicas and value size.** Each 2 extra replicas add 0.2 µs to gets and 0.5 µs to updates, and throughput drops 9% from 3 to 5 replicas and 7% more from 5 to 7. Values up to 8 KiB keep single-digit latency, and in-place data makes 8 KiB gets 33% faster and, at that size, raises YCSB B throughput by 50%.
- **Resources.** For 1M keys of 1 KiB, SWARM-KV uses 4.06 GiB of disaggregated memory against 3.00 for DM-ABD, 2.04 for FUSEE and 0.95 for RAW, about twice FUSEE's. Its CPU use is 61.3%, against 99.0% for DM-ABD and 74.2% for FUSEE, and its client cache is 33% larger than DM-ABD's.
- **Failure.** Crashing a memory node does not interrupt service. Latency rises for a while, since operations contact more nodes and the in-place data is lost, and later operations rebuild it. The authors say that synchronous systems such as FUSEE reportedly need at least tens of milliseconds to recover.
- **Contention.** With 16 clients on one key, get P99 reaches 30 µs, and only 14% of gets finish in one round trip. Updates need at most 4 round trips (73% in 1, 7% in 2, 14% in 3, 6% in 4) with P99 at 10 µs. With 64 clients, 99% of YCSB B updates take one round trip with a metadata buffer per client, against 23% with a single shared buffer.

## Critical Analysis

The two-part design is clear, and the paper is frank about where it stops. It concedes several limits.

- **One round trip is the common case.** It needs no failures, little contention and nearly synchronized clocks, and the paper recalls that always taking one round trip is provably impossible. The related-work section grants that Gus, which needs co-located replicas, has a worst case of two round trips where Safe-Guess may take its slow path.
- **Wait-freedom has conditions.** It needs a bounded number of threads, recycling is not wait-free in theory, and SWARM-KV relies on an index and a membership service whose unavailability can stall clients. The paper says all systems have unbounded worst-case latency because their index is synchronous.
- **It costs memory and scalability.** SWARM-KV uses twice FUSEE's disaggregated memory, and the metadata arrays that keep updates fast grow with the number of clients, which the authors say hinders scalability.
- **Unfinished parts.** Durability and formal verification of the algorithms and the implementation are left for later, and memory recycling is designed but not implemented.

The following points are a reading of the evidence, not claims of the paper.

- **Disaggregation is approximated with RDMA servers.** Memory nodes are ordinary servers with RDMA NICs behind one switch, with no CXL hardware. That more hops would widen the benefit is asserted, not measured.
- **The baselines are partly the authors' own.** RAW and DM-ABD are built for the paper, and FUSEE is compared on latency and on computed resource use. The availability advantage over FUSEE rests on recovery times that systems like it "reportedly" have, against one memory-node crash in a single client's trace, so it is not an experiment on the same testbed.
- **The headline wording differs from the body.** The abstract says marginal overhead, while updates are 92% slower than RAW. Both hold, since the gap is below one round trip, but the relative cost of updates is large.
- **Table 3 is computed and assumes recycling.** The text calls the figures computed, with garbage collection once per second, while Section 6 says recycling was not implemented. The cost of the recycling protocol is therefore not measured end to end.
- **The slow-path bound is loose.** The appendix gives a write bound that depends on the timestamp value (up to ts + 4 round trips), which is a liveness argument, not a latency guarantee for clock-derived timestamps. The slow path is stressed mainly by the single-key experiment, and the 32-client SWARM-KV result is given only in text.
- **Workload and clock coverage is narrow.** Only YCSB A and B are run, both Zipfian, with small values by default. I found no experiment that varies clock skew, although the fast path depends on it. With 5 and 7 replicas on 4 nodes, some replicas share a node.
- **The closest protocols are not measured.** Gus and Gryff are discussed only in words.

## Further Research

- Adding durability to SWARM without harming its latency, which the authors call appealing but nontrivial.
- Formally proving both the algorithms and the implementation, in the style of IronFleet, and implementing and measuring memory recycling.
- Running on real CXL memory pools, where a native max operation (not usually offered by hardware today) would remove the CAS retries.
- Measuring sensitivity to clock skew, recovery against FUSEE on one testbed, and behavior with many more clients than 64.
