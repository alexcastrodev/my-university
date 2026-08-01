---
title: Transactions, ACID, and Isolation Levels
description: What ACID actually guarantees underneath the marketing term, the specific race conditions (dirty reads, lost updates, write skew, phantoms) that weak isolation levels allow through, and why PostgreSQL's "repeatable read" and MySQL's "repeatable read" don't mean the same thing.
difficulty: Intermediate
readingTime: 13
tags:
  - Databases
  - Data Consistency
  - Transactions
  - Concurrency
  - Fundamentals
prerequisites:
  - Basic SQL (SELECT/UPDATE/transactions)
  - What a race condition is
related:
  - label: "The Trouble with Distributed Systems: Partial Failures, Clocks, and Pauses"
    slug: distributed-systems-partial-failures
  - label: CAP Theorem
    slug: cap-theorem
  - label: Consensus and Coordination Services
    slug: consensus-and-coordination-services
---

## Overview

"ACID" gets thrown around as a stamp of approval, but in practice it's mostly a marketing term — one database's implementation of atomicity, consistency, isolation, and durability rarely matches another's exactly, and *isolation* in particular hides a spectrum of guarantees, not one fixed thing. A database claiming "serializable" or "repeatable read" can mean genuinely different things depending on which product you're talking to. Knowing the specific race conditions each isolation level does and doesn't prevent is what separates "I know transactions exist" from actually being able to reason about a concurrency bug.

## What ACID Actually Promises

- **Atomicity** — not about concurrency at all, despite the name; it's about partial failure. If a transaction is aborted midway (a crash, a constraint violation), the database discards every write it made — an all-or-nothing guarantee, not a claim about visibility to other transactions.
- **Consistency** — the most overloaded word in this space. In ACID it means the application's own invariants (e.g., "the sum of all account balances never changes") stay true across a transaction — but the database only enforces the invariants you actually declare as constraints. An undeclared invariant can be silently violated; the "C" is really a property of the application, not something a database can guarantee on its own.
- **Isolation** — concurrently running transactions don't observe each other's in-progress work. The strongest form is *serializability*: the end result is as if transactions ran one at a time, in some order, even though they actually overlapped.
- **Durability** — once committed, a write survives a crash. In practice this means "on disk" (via `fsync` and a write-ahead log) for single-node systems, or "replicated to enough nodes" for distributed ones — and even then, "durable" is a risk-reduction claim, not an absolute one (correlated failures, firmware bugs, and bad SSDs all still happen).

## Read Committed: The Baseline Almost Everyone Runs

The most common isolation level in production makes two narrow promises: no *dirty reads* (you never see another transaction's uncommitted writes) and no *dirty writes* (you never overwrite another transaction's uncommitted write). That's it — it says nothing about what happens between two reads in the *same* transaction.

```
Transaction A                    Transaction B
--------------                   --------------
BEGIN
                                  BEGIN
                                  UPDATE accounts SET balance = 400 WHERE id = 1
SELECT balance FROM accounts
  WHERE id = 1        -- sees 500, NOT 400 (no dirty read)
                                  COMMIT
SELECT balance FROM accounts
  WHERE id = 1        -- now sees 400 — same transaction, different answer
COMMIT
```

That's already enough for a subtle bug: if A is reading two related balances to compute a total, it can see one before B's transfer and one after — the numbers look internally inconsistent even though neither individual read was ever "wrong."

## Snapshot Isolation: Fixing the Inconsistent-Read Problem

Snapshot isolation (what PostgreSQL calls `REPEATABLE READ`) gives every transaction a consistent view of the database as it looked at the moment the transaction started — implemented via *multi-version concurrency control* (MVCC), where the database keeps multiple versions of a row and each transaction reads the version that was committed before it began. This fixes the read-skew example above entirely: both reads inside one transaction see the same snapshot, so the numbers are always self-consistent.

What it does **not** fix is two transactions writing to *different* rows based on a read of *the same* snapshot — which is exactly what makes lost updates and write skew possible.

## Lost Updates and Write Skew: The Anomalies Snapshot Isolation Allows

A **lost update** happens when two transactions both read a value, compute a new value, and write it back — the second write clobbers the first, and one of the two increments effectively never happened:

```
-- Both start from balance = 100
A: read balance (100) -> compute 100+50=150 -> write 150
B: read balance (100) -> compute 100+30=130 -> write 130   -- B's write wins, A's +50 is lost
```

**Write skew** is the same root cause — two transactions reading overlapping data and writing to *different* objects — generalized to more than one row:

```
-- Rule: at least one on-call doctor per shift. Two doctors, both on call.
A: SELECT count(*) FROM doctors WHERE on_call AND shift=1  -- sees 2
B: SELECT count(*) FROM doctors WHERE on_call AND shift=1  -- sees 2
A: UPDATE doctors SET on_call=false WHERE name='Aaliyah'   -- "2 on call, safe to go off"
B: UPDATE doctors SET on_call=false WHERE name='Bryce'     -- "2 on call, safe to go off"
-- both commit: zero doctors on call, invariant violated, neither transaction saw the other's write
```

Write skew is easy to miss precisely because no single row was double-written — each doctor only updated their *own* row. The anomaly is in the invariant across rows, which snapshot isolation was never designed to protect.

## Serializability: Making the Anomalies Actually Go Away

Three approaches genuinely eliminate write skew, lost updates, and phantoms (a write that changes the result of another transaction's search query) instead of just reducing their likelihood:

- **Actual serial execution** — run transactions one at a time, single-threaded, on an in-memory dataset (VoltDB, Redis, Datomic). Sidesteps concurrency bugs by removing concurrency; the trade-off is throughput capped by a single core, so transactions have to be small and fast.
- **Two-phase locking (2PL)** — every transaction acquires a shared lock to read and an exclusive lock to write, holding all locks until commit. Correct and long-standing (the only viable option for decades), but writers block readers *and* readers block writers, which produces unstable, sometimes very high latency under contention.
- **Serializable snapshot isolation (SSI)** — an optimistic technique: transactions run against a normal MVCC snapshot with no blocking, and the database checks at commit time whether the execution was actually serializable. If not, one of the conflicting transactions aborts and retries. This is what PostgreSQL's actual `SERIALIZABLE` level (not its `REPEATABLE READ`) uses, and it gets full serializability at only a small performance cost relative to plain snapshot isolation.

## Trade-offs

- **Read Committed is the widely-deployed default for a reason: it's cheap and prevents the most obviously dangerous anomaly (dirty reads), but it's not remotely enough for anything touching money, inventory, or any cross-row invariant** — read skew, lost updates, and write skew all sail straight through it.
- **PostgreSQL's `REPEATABLE READ` (snapshot isolation) and MySQL/InnoDB's `REPEATABLE READ` are not the same guarantee**, despite the identical SQL-standard name — PostgreSQL auto-detects lost updates at this level via first-committer-wins (the second conflicting writer is aborted), while InnoDB does not: a second transaction's write to a row already committed by another proceeds silently, with no error and no automatic first-committer-wins check. The SQL standard itself never defined snapshot isolation at all (it predates the concept). Never assume a `SET TRANSACTION ISOLATION LEVEL` string means the same thing across two different databases without checking their own docs.
- **Serializable isolation is available almost everywhere today (PostgreSQL, CockroachDB, FoundationDB, Db2 all offer it), and the old assumption that "serializable is too slow to actually use" is dated** — SSI in particular has a small enough overhead over snapshot isolation that "just use serializable and stop reasoning about anomalies by hand" is a legitimate default for anything where correctness matters more than squeezing out maximum throughput.
- **A `SELECT ... FOR UPDATE` lock (explicit locking) is the pragmatic fallback exactly when serializable isolation isn't available or is too expensive for a hot path** — it doesn't generalize as cleanly as a database-enforced constraint, and it's easy to forget to add the lock somewhere in a large codebase, silently reintroducing the anomaly it was meant to prevent.

## Interview Questions

- What specifically does "Consistency" mean in ACID, and why is it fundamentally different from consistency in CAP?
- Walk through a concrete read-skew example under Read Committed isolation, and explain why snapshot isolation fixes it.
- What's the difference between a lost update and write skew — and why does write skew survive automatic lost-update detection?
- PostgreSQL defaults to Read Committed; what specific bug would you expect in a "check balance, then insert a spending record" flow if the team assumed `REPEATABLE READ` was already the default?
- Why is optimistic concurrency control (SSI) generally a better default than 2PL when contention is low, and why does that flip under high contention?

## References

- Martin Kleppmann, [*Designing Data-Intensive Applications*, 2nd Edition](https://www.oreilly.com/library/view/designing-data-intensive-applications/9781098119058/) (O'Reilly) — Chapter 8, "Transactions"
- [PostgreSQL Documentation — Transaction Isolation](https://www.postgresql.org/docs/current/transaction-iso.html)
- [MySQL Reference Manual — InnoDB Transaction Isolation Levels](https://dev.mysql.com/doc/refman/8.4/en/innodb-transaction-isolation-levels.html)
- [Jepsen — Analyses](https://jepsen.io/analyses) (isolation-level violations found in real databases under test)
