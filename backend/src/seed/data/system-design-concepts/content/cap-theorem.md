---
title: The CAP Theorem
description: Why a distributed system can't give you consistency and availability at the same time during a network partition — and why that framing is both essential and incomplete.
difficulty: Beginner
readingTime: 8
tags:
  - Distributed Systems
  - Consistency Models
  - Fundamentals
  - Trade-offs
prerequisites:
  - Basic client-server networking
  - What a network partition is
  - Database replication basics
related:
  - PACELC Theorem
  - Consistent Hashing
  - Read/Write Splitting & CQRS-Lite
  - Eventual Consistency
---

## Overview

Any distributed data system — a multi-node database, a cache cluster, a replicated key-value store — has to make a choice the moment a network partition happens: a node can't reach the rest of the cluster, but a client is still asking it to read or write data. Does it answer anyway (possibly with stale or divergent data), or does it refuse until it can confirm it's not isolated? The CAP theorem, formalized by Eric Brewer in 2000 and proven by Seth Gilbert and Nancy Lynch in 2002, says you can't have all three of Consistency, Availability, and Partition tolerance at once — and in practice, partitions happen, so the real choice is between C and A.

## The Three Properties

- **Consistency (C)** — every read receives the most recent write, or an error. This is *linearizability*, not the "C" in ACID (which is about transaction invariants, not cross-node freshness) — a common point of confusion in interviews.
- **Availability (A)** — every request to a non-failing node receives a (non-error) response, without guaranteeing it's the most recent write.
- **Partition tolerance (P)** — the system keeps operating despite an arbitrary number of messages being dropped or delayed between nodes.

## Why You Don't Actually Get to Choose "C or A" Freely

The theorem is often taught as "pick 2 of 3," which is misleading. Partition tolerance isn't optional — a network of independent machines *will* partition eventually (a switch fails, a cable is cut, a data center loses connectivity), and no software choice prevents that. So P is a given, not a choice. The actual, forced decision only happens *during* a partition: when a node can't confirm it's in sync with the rest of the cluster, does it keep serving requests (choosing A, at the risk of returning stale data) or does it refuse to serve until it can confirm consistency (choosing C, at the cost of availability)? Outside of a partition, a well-designed system can be both consistent and available — CAP says nothing about the common case, only about the failure case.

## CP vs. AP: What Each Choice Looks Like in Practice

**CP (Consistent + Partition-tolerant, sacrifices Availability):**

```
Client -> Node A (isolated from cluster)
Node A: "I can't confirm quorum. I will not answer this write."
Client: request fails / times out
```

ZooKeeper, etcd, and HBase are commonly cited CP systems: a ZooKeeper ensemble that loses quorum stops serving writes (and often reads) rather than risk returning a value that a majority of nodes never agreed to.

**AP (Available + Partition-tolerant, sacrifices Consistency):**

```
Client -> Node A (isolated from cluster)
Node A: "I don't know if I'm current, but here's what I have."
Client: gets a response, possibly stale
```

Cassandra and DynamoDB default to this: every reachable replica answers, and conflicting writes made during the partition are reconciled later (last-write-wins, vector clocks, or application-level merge logic) once the partition heals.

Neither is "correct" in the abstract — a payments ledger typically needs CP (an unconfirmed balance is worse than an unavailable one), while a shopping cart or a social feed typically prefers AP (showing a slightly stale cart beats showing an error page).

## PACELC: The Extension Nobody Mentions in Interviews

Daniel Abadi pointed out in 2010 that CAP only describes behavior *during a partition* (P), but says nothing about the trade-off that exists all the rest of the time, when there's **E**lse no partition — every system still has to choose between **L**atency and **C**onsistency on every request, partition or not. A system that synchronously replicates a write to every node before acknowledging it (strong consistency) pays for that with latency; a system that acknowledges after the local write and replicates asynchronously (lower latency) is only eventually consistent. This is why "PACELC" is a strictly more useful mental model in an interview than CAP alone: it forces you to also state your consistency/latency trade-off in the *normal* case, not just the partition case.

## Common Misreadings of CAP

- **"NoSQL means AP, SQL means CP"** — false as a blanket rule. A single-node PostgreSQL instance isn't meaningfully "CP" (there's nothing to partition), and plenty of NewSQL/distributed SQL systems (CockroachDB, Google Spanner) are CP by design, using consensus (Raft/Paxos) to keep every committed write linearizable across regions.
- **"You must pick one of C or A for your entire system"** — the choice is usually made *per subsystem*, not globally. An e-commerce platform can run its inventory count as CP (never oversell) while running its recommendation feed as AP (a slightly stale "customers also bought" is harmless).
- **"Eventual consistency means unreliable"** — eventual consistency is a precise guarantee (all replicas converge to the same value *given no new writes*), not a synonym for "occasionally wrong." The trade-off is a bounded staleness window, which many domains can tolerate entirely.

## Trade-offs

- **CP costs availability exactly when you need it most** — the moment a partition happens is also the moment traffic can't be evenly rebalanced, so a CP system's "safe" refusal to answer often coincides with the worst possible time for an outage.
- **AP costs correctness in a way that has to be resolved somewhere** — conflicting writes accepted by different partitions during a split don't disappear; something (vector clocks, CRDTs, "last write wins," or a human) has to reconcile them once the partition heals, and that reconciliation logic is real, often-skipped engineering work.
- **The interview mistake isn't picking C or A — it's not stating which subsystem you're talking about.** "Is this system CP or AP?" almost never has one answer for a whole architecture; naming the specific data (inventory count vs. product description) you're making the trade-off for is what separates a strong answer from a memorized one.

## Interview Questions

- Why is "partition tolerance" not really a third option you can decline?
- For a URL shortener, is the write path (creating a short code) CP or AP, and why might the read path (redirect) make a different choice?
- What does PACELC add that CAP doesn't cover?
- Give an example of a single system that is CP for one kind of data and AP for another.
- How would conflicting writes made on both sides of a partition get reconciled in an AP system once the partition heals?

## References

- Eric Brewer, ["CAP Twelve Years Later: How the 'Rules' Have Changed"](https://www.infoq.com/articles/cap-twelve-years-later-how-the-rules-have-changed/) (InfoQ / IEEE Computer, 2012)
- Daniel Abadi, ["Problems with CAP, and Yahoo's Little Known NoSQL System"](http://dbmsmusings.blogspot.com/2010/04/problems-with-cap-and-yahoos-little.html) (DBMS Musings, 2010) — the post introducing PACELC
- [Wikipedia — CAP theorem](https://en.wikipedia.org/wiki/CAP_theorem) — overview and history, including the Gilbert & Lynch proof
- Martin Kleppmann, [*Designing Data-Intensive Applications*](https://www.oreilly.com/library/view/designing-data-intensive-applications/9781491903063/) (O'Reilly, 2017) — Chapter 9, "Consistency and Consensus"
