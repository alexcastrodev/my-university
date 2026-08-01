---
title: Change Data Capture (CDC)
description: How tailing a database's own replication log — instead of polling a table or dual-writing — turns every committed change into an ordered event stream, and why that stream, not the table, is arguably the real source of truth.
difficulty: Intermediate
readingTime: 14
tags:
  - Distributed Systems
  - Data Consistency
  - Event-Driven Architecture
  - Streaming
  - Replication
prerequisites:
  - Database replication basics
  - Message queues / brokers basics
  - The Transactional Outbox Pattern
related:
  - label: The Transactional Outbox Pattern
    slug: outbox-pattern
  - Event Sourcing
  - label: Read/Write Splitting and CQRS-Lite
    slug: read-write-splitting-and-cqrs-lite
  - Log Compaction
---

## Overview

Every write to a database is, underneath the table abstraction, an event: a row was inserted, updated, or deleted, in some order. Change Data Capture (CDC) is the practice of tailing the database's own replication log — the same log it already uses to keep its followers in sync — and turning that private implementation detail into a public stream of ordered change events other systems can consume. Instead of a search index, a cache, or a downstream service polling for what changed, they just subscribe to the log.

## The Problem CDC Solves: Keeping Systems in Sync

Almost no nontrivial system stores data in only one place. The same row might need to exist, in different shapes, in an OLTP database, a search index, a cache, and a data warehouse. Keeping those copies in sync has traditionally meant one of two options: periodic batch ETL (simple, but slow and coarse — a full or incremental dump on a schedule) or *dual writes*, where application code writes to the database and then explicitly updates the search index or invalidates the cache in the same request.

Dual writes have a race condition that's easy to miss: two clients writing conflicting values can have their writes arrive at the database and the search index in a *different relative order*, because nothing forces the two systems to agree on a single order of operations. The database ends up with one final value; the search index ends up with another. Nothing crashed — the two systems are just silently, permanently inconsistent with each other.

## How CDC Fixes the Ordering Problem

CDC makes one database the leader and turns every other representation of the data into a follower of it — the same state-machine-replication idea a database uses to keep its own replicas in sync, just extended to heterogeneous systems. The database decides the order in which conflicting writes are applied and records that order in its log; every downstream consumer (search index, cache, warehouse) applies changes in that same order, so they all converge on the same final value the leader has. The order is decided once, at the source — nobody downstream has to re-derive it.

## Implementing CDC: Log-Based, Not Query-Based

CDC tools attach to a database's existing replication mechanism instead of running periodic queries against application tables:

- **PostgreSQL** — logical replication slots (`pgoutput`, `wal2json`)
- **MySQL** — the binlog, in row-based format
- **MongoDB** — the oplog
- **SQL Server, Oracle, Db2, Cassandra** — each has its own native change-log mechanism

**Debezium** is the dominant open-source CDC platform today, with source connectors for all of the above. It's most commonly deployed via **Kafka Connect** — Debezium's connectors run as Connect tasks, publishing each change as a Kafka record — which brings distributed-mode fault tolerance, rebalancing, and offset management along for free. Contrary to a common assumption, Kafka Connect isn't a hard requirement of Debezium itself: **Debezium Server** and an embeddable engine mode exist for teams that want the same battle-tested connectors without running a Kafka Connect cluster. Maxwell (MySQL binlog), GoldenGate (Oracle), and pgcapture (PostgreSQL) solve the same problem for teams not standardized on Debezium.

## Bootstrapping: The Initial Snapshot Problem

A replication log only contains changes going forward from wherever it starts — it doesn't contain the full history of a table forever (keeping every change ever made would need unbounded disk space). So a brand-new consumer — say, a search index being built for the first time — can't be populated from the log alone; it needs a **consistent snapshot** of the current state first, taken at a known position in the log, with log-based changes applied only from that position onward. Some CDC tools handle this automatically; Debezium specifically uses an incremental-snapshot algorithm derived from Netflix's DBLog project, so a snapshot can be taken without blocking ongoing replication.

## Log Compaction: Bounding the Log Without Losing Correctness

Keeping the entire change history forever is often wasteful, but truncating the log naively would break any new consumer trying to reconstruct current state from it. **Log compaction** resolves this: for each key, the log retains only the most recent event, discarding older superseded updates for that same key (a delete is represented as a special tombstone value, which removes the key's history entirely once compacted). A consumer reading a compacted log from the beginning is still guaranteed to see the current value for every key — it just won't see the intermediate history. Apache Kafka supports this as a native topic feature, which is what lets a compacted Kafka topic double as a durable source of truth rather than just transient messaging.

## CDC vs. Event Sourcing

Both make a log of events the foundation of the system, but at different levels of abstraction. CDC extracts change events from a database that's still being mutated conventionally (updated and deleted in place) — the log is a byproduct, reconstructed at low level from the replication mechanism. Event sourcing goes further: the application itself is built around an append-only log of domain events from the start (`OrderPlaced`, `OrderShipped`), and current state is a read-optimized *view* derived from replaying them — updates and deletes at the storage level are avoided by design, not just captured after the fact. CDC can be retrofitted onto an existing database with minimal application changes; event sourcing is a bigger, more invasive architectural commitment.

## The Schema-as-Public-API Problem

CDC's biggest operational trap: replicating a table's own schema turns that schema into a de facto public API for every downstream consumer, even though the table was never designed to be one. A column rename or drop that's harmless inside a single service can silently break every CDC consumer relying on it — and because CDC is a stream, the failure can surface as a customer-facing outage rather than a contained ETL job failure. This is exactly the problem **the outbox pattern is designed to route around** — see `outbox-pattern` — by giving CDC a dedicated table with its own schema to capture, decoupled from whatever the internal business tables look like. Using CDC to capture a purpose-built outbox table (rather than capturing business tables directly) gets the low-latency, no-polling benefits of CDC without coupling internal schema to the public event contract.

## Trade-offs

- **CDC is asynchronous, so it inherits every problem of replication lag.** The system of record commits before waiting for any CDC consumer to catch up — a slow consumer doesn't slow down the source database, but it does mean derived systems can be observably behind, sometimes by a meaningful amount under load.
- **Turning a database's replication log into a stream doesn't remove the operational cost — it moves it.** Polling adds query load and latency to the database; CDC replaces that with a connector/Kafka Connect cluster (or Debezium Server instance) to run, monitor, and keep compatible across database version upgrades.
- **Quorum-based, eventually consistent databases (Cassandra, DynamoDB-style stores) don't have one obvious log to subscribe to.** There's no single leader whose log is authoritative — Cassandra, for example, exposes CDC as raw per-node log segments and leaves it to the consumer to merge them into one ordered stream, the same problem a quorum reader already has to solve.
- **CDC-consumed events typically carry the whole current row on every change, which log compaction handles differently than event-sourced logs.** A CDC update event fully supersedes the prior one for that key, so compaction can safely discard history; an event-sourced log's events describe *intent* ("shipped"), not full state, so most of them can't be discarded the same way without losing information needed to reconstruct history.

## Interview Questions

- Why does writing to a database and then updating a search index in the same request-handling code (a "dual write") lead to permanent inconsistency, even with no crashes involved?
- How does CDC's single-leader-log approach solve the ordering problem that dual writes can't?
- Why can't a new CDC consumer just start reading the log from wherever it currently is — what does the initial snapshot solve?
- What's the practical difference between CDC and event sourcing, given that both center on a log of changes?
- Why is it risky to point a CDC connector directly at a business table instead of a dedicated outbox table, and how does the outbox pattern address that risk?

## References

- Martin Kleppmann, [*Designing Data-Intensive Applications*, 2nd Edition](https://www.oreilly.com/library/view/designing-data-intensive-applications/9781098119058/) (O'Reilly) — Chapter 12, "Stream Processing," sections "Databases and Streams" and "State, Streams, and Immutability"
- [Debezium Documentation — Features](https://debezium.io/documentation/reference/stable/features.html)
- [PostgreSQL Documentation — Logical Replication](https://www.postgresql.org/docs/current/logical-replication.html)
- [Google Cloud — Datastream Overview](https://cloud.google.com/datastream/docs/overview) (a managed CDC service, one of several — AWS DMS's CDC mode and Confluent's managed CDC connectors solve the same problem)
- [Netflix Tech Blog — DBLog: A Generic Change-Data-Capture Framework](https://netflixtechblog.com/dblog-a-generic-change-data-capture-framework-69351fb9099b)
