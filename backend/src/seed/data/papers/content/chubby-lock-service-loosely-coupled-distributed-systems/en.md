---
title: "The Chubby Lock Service for Loosely-Coupled Distributed Systems"
summary: Burrows describes Google's Chubby, a replicated lock service with a small-file interface that was built for coarse-grained locking and primary election, and explains how real use (above all as a name service) forced changes to the original design.
researchArea: Distributed Systems
keywords: chubby, lock service, leader election, leases, sequencers, consistent caching, fault tolerance
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

We describe our experiences with the Chubby lock service, which is intended to provide coarse-grained locking as well as reliable (though low-volume) storage for a loosely-coupled distributed system. Chubby provides an interface much like a distributed file system with advisory locks, but the design emphasis is on availability and reliability, as opposed to high performance. Many instances of the service have been used for over a year, with several of them each handling a few tens of thousands of clients concurrently. The paper describes the initial design and expected use, compares it with actual use, and explains how the design had to be modified to accommodate the differences.

## Overview

By 2006 Google's systems needed a dependable way to choose a primary among equivalent servers. The author notes that this is an instance of the distributed consensus problem, which asynchronous networks solve with Paxos ([Paxos Made Simple](/papers/paxos-made-simple), [The Part-Time Parliament](/papers/paxos-part-time-parliament)): safety needs no timing assumptions, while clocks are added for liveness, which gets around the impossibility result in [FLP](/papers/flp-impossibility-of-distributed-consensus). Chubby wraps that machinery in a service that looks like a small file system with advisory locks, and the Google File System and Bigtable use it to elect their masters.

Before Chubby, most Google systems used ad hoc primary election when duplicated work was harmless, and needed operator intervention when correctness was essential. The paper is explicit that it is an engineering report: "it was not research", and it claims no new algorithms or techniques. Its value is the account of why the service looks the way it does and what happened when real developers used it.

Worth knowing first: leases (a promise valid for a bounded time), replicated state machines as in [the state machine approach](/papers/state-machine-approach-fault-tolerant-services-tutorial), and why a process holding a lock may still send a stale request.

## Contribution

- **A lock service instead of a consensus library.** The paper argues that a lock service fits existing programs better, serves a name-advertising need with small files, feels familiar to programmers, and lets a client system make progress safely even when fewer than a majority of its own members are up.
- **Coarse-grained locks by design.** Locks are expected to be held for hours or days, as when electing a primary, which keeps load low and lets locks survive a lock server fail-over. Clients who need fine-grained locks are expected to build them on top.
- **Sequencers and lock-delay.** A lock holder can request a sequencer, an opaque string with the lock name, the mode and the lock generation number, and pass it to the servers it talks to so they can reject requests from a stale holder. For servers that cannot check sequencers, a lock-delay keeps a lock from being claimed for up to one minute after a holder fails.
- **Sessions with a grace period.** Client sessions are leases kept alive by KeepAlive RPCs, with a 45 s default grace period that lets clients ride out long master fail-overs without losing locks.
- **Consistent client caching.** Master-driven invalidations give clients strictly consistent caches, which turned out to suit naming better than DNS-style TTLs.

## Methodology

This is an experience paper. It describes the architecture (five replicas per cell, a master elected by consensus and held by a master lease, a client library, and an optional proxy), the file, handle, lock and event interfaces, the fail-over procedure, and the database underneath. It then compares the expected use with the observed one.

The evidence is operational: a snapshot of a typical Google cell (a table of clients, files, locks and RPC rates), a sample of 61 outages over 700 cell-days, counts of data-loss incidents over a few dozen cell-years, and war stories about client mistakes. A comparison with the Boxwood lock server closes the paper. There is no benchmark against alternatives, and the paper says outright that it omits the consensus protocol and RPC details.

## Findings

- **Locks are rare, KeepAlives dominate.** In the snapshot cell there were 22k directly connected clients, 32k proxied clients and 12k open files, with 1k exclusive locks and no shared locks. KeepAlives were 93% of the RPCs, and acquires were 31 parts per million.
- **Scale comes from fewer calls to the master.** One master was seen handling 90,000 clients, not through a faster server but through caching, lease extensions from the default 12 s up to around 60 s under load, and protocol-conversion servers. The paper says no significant effort went into tuning the server code paths.
- **Chubby became a name service.** Its most popular use was naming. The paper's example: a 3 thousand client job with a 60 s DNS TTL would need 150 thousand lookups per second, against about 50 thousand per second for a 2-CPU 2.6 GHz Xeon DNS server. Chubby's invalidation-based caching removes that polling, and batching around 100 names per lookup tamed start-up spikes.
- **Availability numbers.** Of 61 outages in 700 cell-days, most lasted 15 s or less and 52 were under 30 s. The other nine came from network maintenance (4), suspected network problems (2), software errors (2) and overload (1). Data was lost six times in a few dozen cell-years (4 database software errors, 2 operator errors). Observed elections took 6 s and 4 s, with values up to 30 s.
- **Latency.** Reads at the client take under 1 ms in a local cell and 250 ms between antipodes. Writes, including lock operations, are delayed a further 5 to 10 ms by the database log update.
- **Design errors.** There were no storage quotas (one service rewrote a single 1.5 MB file on every user action, and a 256 kB limit was introduced), developers rarely planned for outages, and some crashed their applications on the fail-over event. TCP-based KeepAlives lost sessions under congestion, so UDP was used.

### What the paper says about locks and sequencers

Locks are advisory, so holding one neither is needed to reach the file nor stops others from doing so. The paper states the core hazard directly: a holder of lock L may issue a request R and then fail, another process may acquire L and act, and R may arrive afterwards and be executed without the protection of L. The remedies it describes are the sequencer, checked either against the server's Chubby cache or against the most recent sequencer the server has seen, and the cheaper but "imperfect" lock-delay. In its own rationale it describes a version of the same idea for existing file servers: pass the lock acquisition count with the write RPC and reject the write if the count is lower than the current value.

## Critical Analysis

- **A thin evaluation by design.** The evidence is one snapshot, an outage sample and anecdotes. These are credible because they come from production, but they cannot be reproduced outside Google, and the only comparison with another system is a discussion of the Boxwood lock server.
- **The lock safety story depends on clients.** Protection of an external resource relies on its server checking the sequencer. The paper admits that "important protocols evolve slowly" and offers the lock-delay as an imperfect fallback, so the guarantee for unmodified servers is weaker than for sequencer-aware ones. It also notes that developers often treat locks as familiar and "usually" get them wrong in distributed settings.
- **Clock assumptions are part of the contract.** Lease correctness requires that the server's clock advance no faster than a known constant factor faster than the client's. The paper states this requirement, but the paper does not discuss what happens if it is violated.
- **Fail-over was the weak spot.** The authors say the fail-over code, exercised far less often than the rest, "has been a rich source of interesting bugs", and Section 4.4 revises the design after the session-recording optimization turned out to be unsafe in a corner case.
- **Scope claims are modest and honest.** The authors say that they did not need the fine-grained lock server they sketched, and that the proxy and partitioning mechanisms were designed but not yet deployed. Readers should treat those as plans, not results.

## Further Research

- Consensus-based coordination services with the same file-and-lock flavor but different APIs (ZooKeeper and etcd are the best-known descendants), and how [Raft](/papers/raft-understandable-consensus-algorithm) made the replication layer easier to implement.
- Safe distributed locking in general, including when a lock is enough for efficiency and when correctness needs fencing tokens checked by the protected resource, which is the idea behind the paper's sequencers.
- Lease-based read optimizations in consensus systems, such as [Bodega](/papers/bodega-localized-linearizable-reads-with-roster-leases).
- Isolating clients in shared coordination services: quotas, review of intended use, and designs that make repeated calls cheap, as the paper concludes for repeated Open() calls.
- The Paxos-based replicated database that replaced Berkeley DB and its role in the fail-over design, which the paper only summarizes.
