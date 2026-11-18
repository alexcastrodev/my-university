---
title: "AgileLog: A Forkable Shared Log for Agents on Data Streams"
summary: AgileLog adds cheap, isolated forks to the shared log under data-streaming systems, including forks that keep inheriting the parent's new records, so LLM agents can analyze, test and propose writes on a stream without slowing production consumers or corrupting the main log, and Bolt implements it on a diskless architecture with a hierarchical log index and lazy tail updates.
researchArea: Distributed Systems
keywords: shared log, data streaming, ai agents, forks, diskless architecture, object storage, metadata layer
version: 1.0
updatedAt: 2026-11-18
---

## Overview

A shared log is the durable, totally ordered sequence of records underneath data-streaming systems such as Kafka. Producers append to it and consumers read from it for analytics, search, inference and fraud monitoring. A new kind of client now reads and writes these streams: LLM-powered agents that decide their steps at run time and call tools, usually through the Model Context Protocol.

The authors, from the University of Illinois Urbana-Champaign, argue that agents break two assumptions of a streaming system. They are exploratory, so many of them issue many speculative reads and writes at once and interfere with latency-critical production consumers. And their writes can be wrong, because LLM actions can be inaccurate, so they must be validated before downstream applications see them. Coding and testing agents also want a sandbox with realistic production data, which today means a separate synthetic stream.

The proposal is to give the shared log itself a fork operation, as some databases, object stores and lakehouses already have for agents. This SOSP 2026 paper (Prague) defines the abstraction, AgileLog, and an implementation, Bolt.

Terms to keep apart: a fork is a logically separate child copy of a log that can be read and appended to, a severed fork (sFork) stops seeing the parent after the fork point, a continuous fork (cFork) keeps inheriting the parent's later appends, and promotion makes a cFork become the parent.

Worth knowing first: what a shared log is and how the metadata that orders records can be separated from the data. [CORFU](/papers/corfu-shared-log-design-for-flash-clusters) is the classic design, [Scalog](/papers/scalog-seamless-reconfiguration-and-total-order) and [Boki](/papers/boki-stateful-serverless-computing-with-shared-logs) are the two the paper compares with, and the metadata layer runs on [Raft](/papers/raft-understandable-consensus-algorithm). [FuzzyLog](/papers/fuzzylog-partially-ordered-shared-log) is the one prior log the paper says allows forked histories, only implicitly during partitions.

## Contribution

- **The AgileLog abstraction.** The log API (read, append) gains `cFork`, `sFork`, `squash` and `promote`. Each fork is itself an AgileLog instance and can be forked again. A cFork shares history up to the fork point and then inherits every later append of its parent, while its own appends stay private, which the authors call unidirectional write isolation. Appends on a cFork are linearizably interleaved with the inherited parent records, so a record appended on the cFork after a parent append finished always lands after it. An sFork can start from a past offset.
- **Safe agentic writes.** An agent writes on a promotable cFork, a copy of the main consumer validates the result on that fork, and then the fork is promoted (or squashed if validation fails). The authors prefer this to a temporary log because validation can be stateful and sees parent records interleaved in the right order. A promotable cFork restricts its parent while it exists: reads beyond the fork point are blocked, appends on the parent no longer return their index, and non-promotable cForks cannot go beyond the fork point either. Several promotable cForks can race, and only the first promotion succeeds.
- **Bolt on a diskless architecture.** Copying data makes forks slow, and hosting forks on the same disk-based brokers as the parent makes them interfere. Bolt instead builds on diskless shared logs: stateless brokers write batched objects to a cloud object store, and a Raft-replicated metadata layer sequences records and keeps an index from log positions to objects. A fork is a new log whose metadata points at the same objects, served by a different broker, so it is zero-data-copy and isolated.
- **Hierarchical log index (HLI).** A new fork starts with an empty index and the parent's tail, and a lookup of a position below the child's first entry recurses to the parent, so no index entries are copied. A log's index also keeps a cumulative count of locally appended records, which lets a lookup translate a child position into a parent position.
- **Tail updates and lazy propagation.** To implement cForks, a parent append updates only the tails of its descendants, not their indexes, and the update is applied lazily when someone queries a descendant's tail. A lazy tail tree stores the inheritance tree as an Euler tour in a balanced search tree, so a subtree update is a range update in logarithmic time. A lease can also squash a promotable cFork left unresolved by a rogue agent.
- **Size.** Bolt is about 21K lines of C++, using eRPC, MinIO as the object store and an existing Raft implementation.

## Methodology

Experiments run on CloudLab xl170 nodes: nine nodes for MinIO, three metadata replicas, one node per broker, and 4 KB records. Since no existing shared log has forks, Bolt is mostly compared with its own variants: BoltMetaCpy (copies the parent's metadata to create a fork), BoltNaiveCF (copies index entries to every descendant on each append) and Bolt-ET (updates tails eagerly without the lazy tail tree). For isolation it is also compared with disk-based Kafka and with Inkless, Aiven's diskless Kafka, where a read-only fork is simulated by a new diskless broker on the production topic.

The tests measure fork latency against log length, the latency of a latency-critical workload next to an analysis workload and next to appending forks, root-log performance with 0, 10 and 100 cForks (also 32 root logs), metadata-layer throughput with 10, 100 and 1000 cForks, metadata memory, recursive lookup cost by nesting depth, parent insert latency under star, balanced, chain and irregular hierarchies of 100 to 1M logs, and promote latency. Metadata-layer throughput is measured in isolation with emulated brokers, because the authors lacked machines to generate that load end to end. Three agents built on OpenCode with Gemini-2.5-Pro exercise the full interface: an ad-hoc IoT analytics agent (sFork), a stream-processor testing agent (non-promotable cFork) and a supply-chain restocking agent (promotable cFork). A rogue agent that never resolves a promotable cFork tests the lease.

## Findings

These are the authors' reported results.

- **Fork creation.** Bolt creates a fork in about 50 microseconds whatever the length of the parent, while BoltMetaCpy takes about 100 ms with 25M entries, three orders of magnitude slower. During the creation of 100 forks the parent's throughput is unaffected in Bolt and drops in BoltMetaCpy.
- **Isolation.** A bulk analysis task leaves the latency-critical workload untouched in Bolt and Inkless, while in disk-based Kafka its latency degrades by 2 times from broker contention. Root-log append throughput and latency show no degradation with 10 or 100 cForks, including with 32 root logs with that many cForks each.
- **Metadata scalability.** BoltNaiveCF becomes a bottleneck at 100 and 1000 cForks, and Bolt-ET at 1000, while Bolt keeps scaling. With 1000 cForks of a root log holding 1M records, BoltNaiveCF needs 4.4 GB of metadata and Bolt 8 MB.
- **Recursive lookups.** With 1M records per level, a lookup at depth 7 is 5.2% slower (at most 2 microseconds more). Parent insert latency differs by less than 0.5 microseconds across hierarchy shapes and grows logarithmically with the number of logs, up to 1M.
- **Promote.** A metadata-copy promote takes tens to hundreds of microseconds, far less than the data-copy approach on Kafka, which also lacks stateful validation and linearizable interleaving.
- **Agentic applications.** During the analytics agent's queries Kafka's latency-critical workload sees 14 times higher mean and 130 times higher p99 latency, and Bolt shows no interference. The testing agent runs tumbling-window tests on cForks with no latency degradation in the real-time workload. In the supply-chain case an injected schema error crashes the downstream consumer on Kafka, while on Bolt the bad fork is caught before promotion, with throughput dips while reads are blocked. A lease of 500 ms squashes a stuck promotable cFork and the consumer's throughput recovers.

## Critical Analysis

The paper states several limits itself.

- **Promotion has a price.** A promotable cFork blocks reads beyond its fork point and hides append indexes, causing the throughput dips seen in the supply-chain test. The authors suggest delaying its creation until the proposed writes are computed and doing long analysis on non-promotable cForks.
- **Promote is a restricted merge.** Only one forked child merges into the parent. A general merge of several forks would not preserve linearizable ordering, and the authors' use cases did not need it. They also note that a global address space could remove the append-index restriction but not the read one.
- **No baseline with forks.** Since no forkable log exists, most comparisons are against the authors' own variants.

The following points are a reading of the evidence, not claims of the paper.

- **The agent evidence is three built apps.** Each is a single-agent application on one LLM, and for determinism the authors replay one captured trace on both systems, so how much real agents vary, and how many forks a fleet of them would create, is not measured. The headline "14 times and 130 times" is for one scripted workload.
- **Part of the scalability is argued, not measured.** The metadata layer is tested in isolation with emulated brokers, and one Raft group sequences all logs. The object store is a nine-node MinIO, and the S3 throughput figure used to argue that reads scale is a number quoted from outside, not measured here.
- **The Kafka comparison mixes two effects.** Disk-based Kafka differs from Bolt both in having no forks and in having stateful brokers, so the 2 times degradation shows the cost of local-disk brokers, which the authors say, rather than anything specific to forks. Inkless, the diskless baseline, is the fairer match and shows no interference either.
- **Validation is left to the application.** Promotion is only as safe as the check run on the fork, and the paper evaluates one schema-error case. Cost is also absent: object-store requests and storage for many forks, the cost of running a copy of the consumer per validation, and retention when a parent's old objects are still referenced by forks are not discussed in the text I read.
- **Access control is thin.** The lease is configured by an authenticated entity, but who may fork, with what quota, and how many forks one tenant can create is not covered.

## Further Research

- General merge across several forks, and a tagged global address-space design, which the authors sketch as another point in the design space.
- Retention, compaction and garbage collection of shared-storage objects while forks still point at them, and the cloud cost of forks.
- Quotas, authorization and tenancy for agents that can create forks, and evaluating with fleets of concurrent, varied agents rather than replayed traces.
- Sharding the metadata layer and measuring end-to-end throughput on a real cloud object store with more brokers.
