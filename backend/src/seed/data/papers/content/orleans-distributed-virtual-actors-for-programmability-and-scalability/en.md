---
title: "Orleans: Distributed Virtual Actors for Programmability and Scalability"
summary: The 2014 Microsoft Research report introduces virtual actors, entities that always exist logically and that the runtime activates on demand on any server, so that placement, lifecycle and failure recovery stop being the application's job. Its evaluation is the Halo 4 Presence code on up to 125 servers.
researchArea: Distributed Systems
keywords: virtual actors, actor model, location transparency, distributed directory, eventual single activation, promises, Halo 4
version: 1.0
updatedAt: 2026-11-20
---

## Abstract

High-scale interactive services demand high throughput with low latency and high availability, difficult goals to meet with the traditional stateless 3-tier architecture. The actor model makes it natural to build a stateful middle tier and achieve the required performance. However, the popular actor model platforms still pass many distributed systems problems to the developers. The Orleans programming model introduces the novel abstraction of virtual actors that solves a number of the complex distributed systems problems, such as reliability and distributed resource management, liberating the developers from dealing with those concerns. At the same time, the Orleans runtime enables applications to attain high performance, reliability and scalability. This paper presents the design principles behind Orleans and demonstrates how Orleans achieves a simple programming model that meets these goals. We describe how Orleans simplified the development of several scalable production applications on Windows Azure, and report on the performance of those production systems.

## Overview

This is Microsoft Research technical report MSR-TR-2014-41 (March 2014), by Bernstein, Bykov, Geller, Kliot and Thelin. It is a technical report, not a peer-reviewed paper. The problem it names: a stateless middle tier forces every request through storage, and a cache in front of storage loses its concurrency guarantees, in the style of [Scaling Memcache at Facebook](/papers/scaling-memcache-at-facebook). Actors keep state next to the code. But Erlang and Akka still leave the developer to manage actor lifecycle and distributed races, handle failures and recovery, and decide placement, which the authors say requires a distributed systems expert.

The report is the second Orleans paper. The first is [Orleans: Cloud Computing for Everyone](/papers/orleans-cloud-computing-for-everyone) (SoCC 2011). Using only what the two texts say, three things changed. The 2014 report says the early prototype required explicit lifecycle management, and now actors cannot be created or destroyed explicitly. It says the prototype's multi-master replication of multi-activation actors was dropped because it performed badly and users found it too complex, and the 2011 transactions are absent from the model: "Orleans does not yet support cross-actor transactions". It also says the prototype persisted state on every call, which was too expensive, so persistence became explicit checkpoints, and explicit promise syntax became async-await. The 2011 evaluation used micro-benchmarks; this one uses production code. The one-hop DHT directory with caches appears in both texts.

## Contribution

- **Virtual actor.** An actor has perpetual existence, automatic instantiation, location transparency and automatic scale out. The identity is the actor type plus a primary key (a 128-bit GUID). The authors compare it to virtual memory: a layer of indirection that lets the runtime place, move and reclaim physical instances.
- **Activations and turns.** In-memory instances are called activations. An activation runs one turn at a time, where a turn is a method invocation or a closure run when a promise resolves. By default a request is not interleaved with another one in the same activation, and the `[Reentrant]` attribute allows interleaving of turns, still single-threaded.
- **Promises.** Every actor method returns a promise (`Task` or `Task<T>`) that is unresolved, fulfilled or broken. References are created locally and need no bind or register step.
- **Two activation modes.** Single activation (default) and stateless worker, where many independent activations are created up to a limit, with no state reconciliation.
- **Runtime services.** Directory, membership, reminders (timers that fire even if the actor is not active), persistence providers and at-least-once messaging.

## Methodology

Section 3 describes the runtime on a cluster of servers. Each server hosts activations and has Messaging, Hosting and Execution subsystems. Hosting keeps a distributed directory: a one-hop DHT with consistent hashing, a record per actor id, and a local cache of about 80 bytes per single-activation entry. Placement is "completely flexible", not hash-determined: in Presence, the stateless Router activations stay on the server that received the request and the other actor types are spread randomly across servers. Idle actors, or memory pressure, trigger deactivation. Scheduling is cooperative with roughly one thread per core.

The evaluation (Section 5) ran on up to 125 servers with two quad-core 2.10 GHz Opterons, 32 GB RAM, Windows Server 2008 R2 and .NET 4.5. Micro-benchmarks ran 5 times for 10 minutes. The Halo 4 Presence production code ran in a test cluster for 30 minutes per run, with generated heartbeat load. The production figures are confidential, so the report gives lab numbers. Section 4 describes Presence, Statistics, Galactic Reign and a database connection pool built from Shard actors.

## Findings

- **Isolation.** Deep copy of arguments costs 4.3% for a 100-byte array (7300 vs 7000 requests per second), 9.5% for a 100-element dictionary, and 47.7% for a dictionary of lists (6500 vs 3400), at 50% remote calls.
- **Latency masking.** Per-server throughput stays almost flat while simulated external call latency goes from 10 to 1000 ms (Figure 4, graph reading: about 8000 per server). More scheduler threads lower throughput (Figure 5, graph reading: from about 11,000 at 8 threads to about 4,300 at 1000).
- **Presence scale.** With 1 million actors and CPU at 95 to 97%, 25 servers sustain about 130,000 heartbeats per second (about 5200 per server), and throughput is almost linear up to 125 servers (Figure 6, graph reading: about 600,000). With 25 servers, throughput is almost the same from 2 thousand to 2 million actors (text); the small drop at the high end is blamed on larger internal data structures.
- **Latency under load.** Median heartbeat latency is about 6.5 ms up to 19% CPU, 10 ms at 34% and 15 ms at 55%. Figure 8 (graph reading) shows the 95th percentile near 650 ms at 72% CPU.
- **Production claims.** Cache hit rates "well over 90%" in production services, and load tests with 25 servers at 90+% CPU for many days. The authors say productivity gains were verified "at least anecdotally".

## Critical Analysis

What the report does not claim. It does not give strong consistency across actors: there are no cross-actor transactions, and persistence is the developer's job. Uniqueness is eventual: "In failure-free times, Orleans guarantees that an actor only has a single activation", but after a failure two activations may register in different directory partitions until membership settles, and then one is deactivated. The authors chose availability over consistency and point to external storage for stronger needs, which resembles the trade-off of [Dynamo](/papers/dynamo-amazons-highly-available-key-value-store) and the [CAP](/papers/brewers-conjecture-cap-feasibility-web-services) discussion. Delivery is at-least-once, FIFO ordering was dropped for state size reasons (n^2 sequence numbers and queues), and exactly-once is listed as future work.

Limits of the evidence. It is one vendor's design and experience, not peer reviewed. The measured service is Presence, which keeps state in memory because the consoles hold the ground truth. Failure experiments are absent: membership converges in 30 to 60 seconds in production, but no experiment measures recovery. The report itself lists poor fits: bulk operations over many entities, billions of actors without temporal locality, and multi-tenant use.

Reading notes, not claims of the report. The directory cites [Chord](/papers/chord-scalable-peer-to-peer-lookup-service), but the report does not discuss other membership designs such as [SWIM](/papers/swim-scalable-weakly-consistent-infection-style-process-group-membership-protocol). Dropping reconciliation is a different path from [CRDTs](/papers/conflict-free-replicated-data-types).

Later work (not in the report, not read by me). I did not read the Orleans transactions work, Akka Cluster Sharding, Cloudflare Durable Objects or Azure Durable Functions, so I make no claim about them.

## Further Research

- Test the eventual single activation during a network partition: how long do duplicates live, and what do they corrupt when state is persisted?
- Compare with [Consensus on Transaction Commit](/papers/consensus-on-transaction-commit), the kind of protocol the cross-actor transactions the report postpones would need.
- Measure failure recovery, including the 30 to 60 second membership window and directory loss, which the evaluation leaves out.
- Check which Presence results survive with persistent state and strict checkpointing.
