---
version: 1.0
updatedAt: 2026-09-07
---
## Learning Objectives

- Define the SQL standard's four isolation levels by exactly which anomaly each one still permits.
- Distinguish a dirty read, a non-repeatable read, and a phantom read as three genuinely different anomalies, not three names for the same problem.
- Trace a real worked schedule producing each of the three anomalies, and identify the weakest isolation level that prevents it.
- State honestly what SERIALIZABLE actually promises, and what it costs in reduced concurrency relative to the weaker levels.

## Context & Motivation

`deadlocks-in-two-phase-locking` completed the mechanics of Strict 2PL — locking, deadlock detection, and deadlock prevention — as one full concurrency-control protocol capable of delivering true serializability. But real systems rarely run every transaction at full serializable isolation, because doing so costs real concurrency: more blocking, more waiting, more aborted transactions under contention. The SQL standard instead defines four **isolation levels**, each permitting progressively fewer anomalies (and correspondingly costing progressively more in reduced concurrency), letting an application choose exactly how much isolation it actually needs rather than always paying for the strongest guarantee.

## Core Theory

### Three anomalies, precisely distinguished

Before defining the levels, three distinct anomalies need precise, separate definitions — later isolation levels are defined entirely in terms of which of these three they still permit:

- **Dirty read** — reading a value written by a transaction that has not yet committed (already defined in `concurrency-anomalies-dirty-reads-and-lost-updates`).
- **Non-repeatable read** — a transaction reads the *same row* twice, and gets two different values, because a different transaction committed an update to that row in between the two reads.
- **Phantom read** — a transaction re-runs the *same predicate-based query* twice, and gets a different *set of rows* the second time, because a different transaction committed an insert (or delete) of a row matching that predicate in between. This is a genuinely different problem from a non-repeatable read: no previously-read row's value changed — an entirely new row appeared (or an old one vanished) that the query's predicate now matches.

### The four isolation levels

| Isolation Level | Dirty Read | Non-repeatable Read | Phantom Read |
|---|---|---|---|
| READ UNCOMMITTED | permitted | permitted | permitted |
| READ COMMITTED | prevented | permitted | permitted |
| REPEATABLE READ | prevented | prevented | permitted |
| SERIALIZABLE | prevented | prevented | prevented |

Each level going down this table adds exactly one more guarantee on top of the level above it, at the cost of additional locking (or, under MVCC — the subject of the next concept — additional validation): **READ UNCOMMITTED** provides no isolation guarantee at all beyond basic atomicity of individual statements; **READ COMMITTED** guarantees a transaction never reads another's uncommitted write, but the same row read twice may still change value between reads; **REPEATABLE READ** additionally guarantees that once a transaction has read a specific row, re-reading that exact row within the same transaction always returns the same value; **SERIALIZABLE** is the only level that additionally prevents phantoms, because it is the only level requiring isolation over an entire *predicate's* result set, not just over individually-read rows.

## Worked Examples

### Example 1 — a dirty read, prevented starting at READ COMMITTED

Reusing `concurrency-anomalies-dirty-reads-and-lost-updates`'s Example 1: `T1` transfers `$100` from `A` (`$500`) to `B` (`$300`), writing `A = 400` before committing. `T2`, running at **READ UNCOMMITTED**, reads `A`'s uncommitted `400` and (per that concept's example) computes an incorrect total of `$700`. Running `T2` at **READ COMMITTED** or any stronger level instead forces `T2`'s read of `A` to block until `T1` either commits (in which case `T2` sees the final, correct `400`) or aborts (in which case `T2` sees the restored `500`) — the dirty intermediate value is never visible at all, at any isolation level above READ UNCOMMITTED.

### Example 2 — a non-repeatable read, prevented starting at REPEATABLE READ

`T1`, running at READ COMMITTED, reads account `A`'s balance twice within one transaction (perhaps computing something using the value at two different points in its own logic): first read returns `A = 500`. Between `T1`'s two reads, `T2` runs a separate, complete transaction that sets `A = 400` and commits. `T1`'s second read of the *same row* now returns `A = 400` — a different value for the identical row, read twice, within a single transaction that never itself wrote to `A`. This is legal under READ COMMITTED specifically because that level only guarantees no *uncommitted* value is ever read — `T2`'s update was fully committed by the time `T1`'s second read ran, so no dirty read occurred, yet `T1`'s two reads still disagree. Running `T1` at **REPEATABLE READ** instead prevents this: once `T1` has read `A`, that value (or, depending on implementation, a lock preventing any other transaction from modifying it) is held for `T1`'s entire duration, guaranteeing every subsequent read of that same row within `T1` returns the identical value.

### Example 3 — a phantom read, prevented only at SERIALIZABLE

`T1`, running at REPEATABLE READ, executes `SELECT * FROM Accounts WHERE balance > 400`, which returns 3 rows (say `B`, `C`, `D`). REPEATABLE READ's guarantee applies to those 3 *already-read rows* — none of them can change value for the remainder of `T1`. But `T2` now runs a separate transaction inserting a brand-new row `E` with `balance = 600` and commits. `T1` re-runs the *identical query* — `SELECT * FROM Accounts WHERE balance > 400` — and now gets back 4 rows: `B`, `C`, `D`, and the new `E`. No previously-read row's value changed (satisfying REPEATABLE READ's actual guarantee), but the *set* of rows satisfying the predicate changed — a phantom. Preventing this requires locking not just the rows a query happened to read, but the entire range or predicate space a query examined (so that no new row can be inserted anywhere that would have matched it) — exactly the extra guarantee only **SERIALIZABLE** provides.

## Common Misconceptions & Pitfalls

- **"A non-repeatable read and a phantom read are the same anomaly under different names."** Example 2 and Example 3 show a genuine structural difference: a non-repeatable read is about a *specific, already-identified row* changing value between two reads, while a phantom read is about the *set of rows matching a predicate* changing — REPEATABLE READ's row-level locking fixes the first but is structurally incapable of fixing the second, since it never locked "every row that could ever match this predicate," only the rows it happened to actually read.
- **"SERIALIZABLE just means 'no anomalies, full stop' with no further nuance."** SERIALIZABLE's precise guarantee, inherited from `acid-properties-precisely-defined`'s definition of Isolation, is equivalence to *some* serial execution — it prevents all three named anomalies as a *consequence* of that stronger guarantee, but the guarantee itself is about the whole schedule's equivalence to a serial order, not a checklist of three specific anomalies to avoid; the table above is a convenient characterization, not the actual definition.
- **"Since SERIALIZABLE prevents every anomaly, it should just always be used by default."** SERIALIZABLE's phantom-prevention requires locking (or validating against) entire predicate ranges, not just individually-touched rows — real production workloads that don't need full serializability routinely default to REPEATABLE READ or READ COMMITTED (or a snapshot-isolation variant, the subject of the next concept) specifically because SERIALIZABLE's stronger guarantee costs real, measurable concurrency that many applications' actual correctness requirements simply don't need.

## Summary

The SQL standard's four isolation levels are defined by exactly which anomaly each one still permits: READ UNCOMMITTED permits all three (dirty reads, non-repeatable reads, phantoms); READ COMMITTED prevents dirty reads but permits the other two; REPEATABLE READ additionally prevents non-repeatable reads but still permits phantoms, because its row-level guarantee never covers rows that didn't exist yet at the time of the original read; SERIALIZABLE is the only level that also prevents phantoms, by guaranteeing the entire schedule is equivalent to some serial execution — the same precise Isolation definition `acid-properties-precisely-defined` gave in the abstract. That strongest guarantee is not free: it requires locking or validating entire predicate ranges, not just individually-read rows, which is exactly why real systems let applications choose a weaker level when their actual correctness requirements don't demand it.

## Documentation Links

- [Database System Concepts (Silberschatz, Korth, Sudarshan) — Companion Site](https://www.db-book.com/) — the standard textbook source for the SQL isolation-level definitions and the dirty-read/non-repeatable-read/phantom-read anomaly taxonomy this concept builds from.
- [CMU 15-445/645 — Two-Phase Locking Concurrency Control Slides](https://15445.courses.cs.cmu.edu/fall2025/slides/18-twophaselocking.pdf) — covers how each isolation level maps to a specific locking discipline (row-level versus predicate/range-level), backing this concept's account of why SERIALIZABLE costs more than the weaker levels.
