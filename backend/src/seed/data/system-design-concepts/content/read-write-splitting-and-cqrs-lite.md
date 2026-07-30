---
title: Read/Write Splitting and CQRS-Lite
description: When separating the read path from the write path is a legitimate scaling technique versus when it's just two databases arguing about which one is telling the truth.
difficulty: Advanced
readingTime: 10
tags:
  - Distributed Systems
  - Data Consistency
  - CQRS
  - Database Replication
  - Scalability
prerequisites:
  - CAP Theorem
  - Database replication basics
  - Eventual consistency
related:
  - The Transactional Outbox Pattern
  - PostgreSQL Quorum Voting and Connection Indirection
  - PostgreSQL Split-Brain Prevention
  - Change Data Capture (CDC)
---

## Overview

A read-heavy system — say, a URL shortener with a 10:1 read-to-write ratio — has an obvious-looking optimization available: point writes at one database and reads at another, so each can be scaled and tuned independently. This is a real, well-established technique (read replicas, and at its more structured end, CQRS), but it's also one of the easiest ideas to reach for *before* establishing whether the specific problem actually needs it — and a design that splits storage without being able to say why, concretely, tends to draw exactly the same pushback from a human interviewer that it would from an automated design-review tool: it looks like architecture, but it's actually two sources of truth that now have to agree with each other.

## The Naive Move: One Database Per Access Pattern

Given a URL shortener with heavy read traffic, an appealing first sketch is: writes (creating short codes) go to a SQL database for its integrity guarantees on the `code` uniqueness constraint, and reads (resolving a short code to its target URL) go to a separate NoSQL store for its I/O throughput on simple key lookups:

```
Client -> App Server -> writes -> SQL DB (source of truth for codes)
                      -> reads  -> NoSQL DB (replicated copy, optimized for lookups)
```

The problem isn't that this is *impossible* — it's that it introduces a second store whose entire job is to stay in sync with the first, and the design now owes an answer to questions it didn't have before: how does data get from SQL to NoSQL (a CDC pipeline? A dual write from the application? See the **Transactional Outbox Pattern** concept for why a naive dual write is unsafe), how far behind can the NoSQL copy legally be, and what happens on a redirect request for a code that was just created and hasn't propagated yet.

## Why a Real Interviewer (or an Automated Judge) Pushes Back

For a simple key→URL lookup, a single relational database plus a cache in front of it (see **Caching Strategies and CDNs**) solves the same read-scaling problem with one source of truth instead of two, and no cross-database consistency protocol to design, test, and operate. The critique isn't "never split read and write storage" — it's that the split has to be justified by a read *pattern* the write-side database genuinely can't serve well (full-text search, graph traversal, complex aggregation), not adopted by default because "reads and writes are different operations." A URL redirect is a single-key lookup; that's precisely the case a cache in front of the primary database already handles, making a second, independently-replicated database an unjustified increase in the system's failure surface for no corresponding benefit.

## Replica Lag and What It Breaks

Any read replica — SQL-to-SQL streaming replication or a cross-store pipeline — has a real propagation delay, and the read-your-own-writes problem is the concrete failure mode that delay causes:

```
1. User creates short code "abc123" -> written to primary
2. User is immediately redirected to /abc123 to verify it worked
3. Read hits a replica that hasn't received "abc123" yet -> 404
```

This is not a hypothetical edge case in an interview setting — it's the literal next action ("did my write work?") most users take after writing something. Common mitigations: route a user's own reads to the primary for a short window after they write (session affinity to the primary), have the client pass back a log sequence number / commit timestamp and have the replica wait until it has caught up to that point before answering ("read-your-writes" consistency), or accept the staleness and design the UI around it (e.g., show the newly created short code optimistically without re-fetching it from the read path at all).

## CQRS-Lite: Splitting Models, Not Necessarily Databases

Command Query Responsibility Segregation, in its full form (Greg Young's original formulation), separates the *write model* (validates commands, enforces invariants) from the *read model* (denormalized, shaped for exactly the queries the UI needs) — and critically, this separation doesn't require two different database *technologies*, or even two different database *instances*. A "CQRS-lite" approach that most systems actually need:

- Same database, different **schemas**: normalized tables for writes, materialized/denormalized views for reads, refreshed on a schedule or via triggers.
- Same database technology, separate **instances**: a primary for writes, streaming read replicas (still SQL, still the same engine) for reads — the workhorse pattern behind most "read/write splitting" in production, and a much smaller commitment than a cross-technology sync pipeline.
- Genuinely different **stores** (SQL primary + Elasticsearch read index, or SQL primary + a graph database for relationship queries) — justified specifically when the read pattern is something the write-side engine is structurally bad at, e.g. full-text search or multi-hop graph traversal, not "reads happen more often than writes."

The URL shortener case fits the first two tiers at most; reaching for the third tier for a plain key lookup is the over-engineering the earlier critique is about.

## When Splitting Storage Actually Is Justified

- A social feed's "who does this user follow, ranked by recent activity" query needs a fan-out/aggregation shape a normalized OLTP schema handles poorly at scale — a separate, purpose-built read store (or precomputed feed cache) is earning its keep here.
- A product catalog with faceted search (filter by price range, brand, rating, in stock) is a genuinely different access pattern from "insert this new product" — Elasticsearch or similar alongside the system-of-record SQL database is standard, not over-engineering.
- An analytics dashboard querying aggregates over millions of rows shouldn't run those queries against the same database serving live user traffic regardless of read/write ratio — a separate OLAP store or read replica dedicated to analytical load protects the transactional path from long-running scan queries, independent of the CQRS question.

In each of these, the justification is a *specific query shape the primary store can't serve well* — the same test that a simple key-value lookup (the URL shortener redirect) fails.

## Trade-offs

- **Every replica or read model is a staleness window you now have to design around, not just accept** — "eventually consistent" isn't a caveat you can leave unstated; the bound (milliseconds? seconds?) determines whether read-your-writes problems are cosmetic or actually break user-facing flows.
- **A second store doubles your operational surface for a benefit that has to be measured, not assumed** — schema migrations, backups, monitoring, and failure modes (see **PostgreSQL Split-Brain Prevention** and **PostgreSQL Quorum Voting and Connection Indirection** for what "another node can diverge from the primary" actually entails operationally) all now exist twice.
- **CQRS-lite (same engine, separate read replicas) gets most of the scaling benefit most systems ask for, at a fraction of the cost of a cross-technology split** — reaching straight for "SQL for writes, NoSQL for reads" without first asking whether a same-engine replica plus a cache already solves the stated problem is the specific pattern worth being suspicious of, in your own designs and in review.

## Interview Questions

- For a URL shortener, what specific read query would justify a different storage engine on the read side, versus what a cache in front of the primary already handles?
- What is the read-your-writes problem, and name two ways to mitigate it without giving up replication entirely.
- What's the difference between "CQRS" as Greg Young defined it and "read/write splitting" as most systems implement it?
- Give an example of a read pattern where a separate, purpose-built read store is genuinely justified, and explain what makes it different from a simple key lookup.
- If asked to add a second data store to a design, what's the first question you should be able to answer before proposing it?

## References

- Martin Fowler, ["CQRS"](https://martinfowler.com/bliki/CQRS.html) (bliki)
- microservices.io — [Pattern: CQRS](https://microservices.io/patterns/data/cqrs.html)
- [PostgreSQL Documentation — High Availability, Load Balancing, and Replication](https://www.postgresql.org/docs/current/warm-standby.html)
- Martin Kleppmann, [*Designing Data-Intensive Applications*](https://www.oreilly.com/library/view/designing-data-intensive-applications/9781491903063/) (O'Reilly, 2017) — Chapter 5, "Replication"
