---
title: "Designing a Hotel Reservation System"
description: Why a booking system is one of the rare designs where correctness outranks throughput — the room-type inventory model, the double-booking race between two users buying the last room, and the pessimistic, optimistic, and constraint-based mechanisms that actually stop it.
difficulty: Intermediate
readingTime: 13
tags:
  - Data Consistency
  - ACID Transactions
  - Concurrency Control
  - Scalability
prerequisites:
  - "Transactions, ACID, and Isolation Levels"
related:
  - label: "Transactions, ACID, and Isolation Levels"
    slug: transactions-acid-and-isolation-levels
  - label: "The Transactional Outbox Pattern"
    slug: outbox-pattern
  - label: "Read/Write Splitting and CQRS-Lite"
    slug: read-write-splitting-and-cqrs-lite
---

## Overview

Most system design prompts reward the instinct to scale first and relax consistency: a chat system can show a stale message list, a feed can be a few seconds behind, a proximity search can miss a restaurant that opened this morning. A hotel reservation system is one of the rare cases where that instinct is wrong. Selling the same room twice for the same night is not a stale read that resolves itself — it's a guest standing at a front desk with a confirmation email and nowhere to sleep, and no amount of throughput compensates for it. The design problem is therefore inverted: the write path is small, slow, and unapologetically transactional, and the interesting engineering is in keeping the *rest* of the system fast around a deliberately serialized core.

## Requirements

**Functional scope** for an interview-sized version: browse hotel and room-type detail pages with prices for a date range, reserve one or more rooms of a given type for a date range, cancel a reservation, and an admin path for staff to add/update hotels, rooms, and rates. Prices are per-day and change daily — a room type's rate is a function of the date, not a fixed attribute of the room. Deliberately out of scope: full search with arbitrary filters, loyalty programs, and multi-leg itineraries.

**Non-functional requirements**, and this is where the design commits:

- **Strong consistency for the booking transaction, specifically.** Not for the whole system — for the single operation that decrements available inventory. That operation must be linearizable with respect to every other booking for the same hotel, room type, and date. Everything else can be looser.
- **Availability over consistency for search and browsing.** A user seeing a room that got booked 200ms ago is a recoverable annoyance (they get an error at checkout); a search page that returns a 503 during a flash sale is lost revenue. Browsing tolerates staleness; booking does not.
- **Read-heavy overall, write-light in absolute terms.** Take a chain with 5,000 hotels and 1M rooms, 70% occupancy, average 3-night stays: roughly 240,000 reservations/day, which is about **3 reservations per second**. Work backwards up the funnel with a 10% step-through rate and the booking-confirmation page runs ~30 QPS and the detail page ~300 QPS. Reads outnumber writes 100:1, and the write rate is low enough that an expensive, heavily-locked write path is affordable.
- **Moderate latency on the write path.** A booking taking a second or two is fine. A booking being wrong is not. This is the trade the whole design is built on.

That last pair of numbers is the punchline of the estimation: at 3 TPS you can afford serializable isolation, row locks, and retries. Candidates who skip the estimation often over-engineer the write path into an eventually-consistent event pipeline that reintroduces the exact bug they were asked to prevent.

## Data Model

A relational database is the right default here — the entities are stable and well-understood, the workload is read-heavy with infrequent writes, and the ACID guarantees are load-bearing rather than decorative. The naive schema is `hotel → room → reservation(room_id, start_date, end_date)`, and it's wrong for hotels in an instructive way.

A guest does not reserve room 412. A guest reserves *a king room with a city view*; the specific room number is assigned at check-in. Airbnb's model (where `listing_id` is the unit of inventory) does not transfer. So the unit of inventory is `(hotel_id, room_type_id, date)`:

| Table | Key columns | Notes |
|---|---|---|
| `hotel` | `hotel_id`, `name`, `address` | Static; heavily cached. |
| `room_type` | `room_type_id`, `hotel_id`, `name`, `max_occupancy` | e.g. standard, king, two-queen. |
| `room` | `room_id`, `room_type_id`, `hotel_id`, `floor`, `status` | Physical rooms; needed for housekeeping and check-in, *not* for booking. |
| `room_type_rate` | `(hotel_id, room_type_id, date)`, `rate` | Price varies per day. |
| `room_type_inventory` | `(hotel_id, room_type_id, date)` PK, `total_inventory`, `total_reserved` | The contended table. One row per room type per **single date**. |
| `reservation` | `reservation_id` PK, `hotel_id`, `room_type_id`, `start_date`, `end_date`, `room_count`, `status` | `status ∈ {pending, paid, refunded, canceled, rejected}`. |

The `room_type_inventory` design — one row per calendar date rather than a stored date range — is what makes range queries trivial: checking a three-night stay is a `BETWEEN` over three rows, and reserving is an `UPDATE` over those same three rows. Rows are pre-populated two years out by a daily job. At 5,000 hotels × 20 room types × 730 days that's ~73M rows, which is unremarkable for a single well-indexed instance; the reason to replicate is availability, not volume.

Availability for a date range is then:

```sql
SELECT date, total_inventory, total_reserved
FROM room_type_inventory
WHERE hotel_id = :hotel AND room_type_id = :type
  AND date BETWEEN :start_date AND :end_date - 1;
-- bookable if, for every row: total_reserved + :n <= total_inventory
```

Storing a counter pair rather than a boolean also makes **overbooking** a one-character change. Hotels routinely sell ~110% of capacity because a predictable fraction of guests cancel or no-show, so the predicate becomes `total_reserved + :n <= 1.1 * total_inventory`. The system's job is to enforce whatever limit the business sets, exactly — not to decide the limit.

## The Core Concurrency Problem

Two users click "Book" at the same instant on the last king room for June 1. Both requests run the same two-step logic: read the inventory row, check the predicate in application code, then write the incremented counter.

Under any isolation level short of serializable, both reads see `total_reserved = 99, total_inventory = 100`. Both predicates evaluate true. Both writes set `total_reserved = 100`. Both commit. Two confirmation emails, one room. This is a textbook **lost update**: the read-modify-write cycle of one transaction is clobbered by the other, and neither ever observed the conflict. [Transactions, ACID, and Isolation Levels](transactions-acid-and-isolation-levels) covers why Read Committed and snapshot isolation both permit this, and why `SERIALIZABLE` (via SSI in PostgreSQL) is the level that doesn't — the short version is that the check and the write are not atomic with respect to each other, and isolation levels below serializable make no promise that they will be.

There's a second, dumber double-booking source worth naming because interviewers ask for it: **the same user double-clicking Submit**. Graying out the button client-side helps and is not a solution — a retry, a flaky network, or a disabled-JS client bypasses it. The fix is an **idempotency key**: generate a `reservation_id` server-side when the user reaches the confirmation page, send it as part of the `POST /v1/reservations` body, and make it the primary key of the `reservation` table. The second submission violates the primary key constraint and is rejected by the database, not by hopeful application logic. Idempotency solves *duplicate requests*; it does nothing for *concurrent distinct requests*, which is what the rest of this section is about.

## Three Mechanisms That Actually Prevent It

### Pessimistic locking

Take an exclusive row lock at read time so the second transaction blocks until the first commits:

```sql
BEGIN;
SELECT date, total_inventory, total_reserved
FROM room_type_inventory
WHERE hotel_id = :hotel AND room_type_id = :type
  AND date BETWEEN :start_date AND :end_date - 1
FOR UPDATE;                    -- transaction 2 waits here
-- application checks the predicate on freshly-locked rows
UPDATE room_type_inventory SET total_reserved = total_reserved + :n
WHERE hotel_id = :hotel AND room_type_id = :type
  AND date BETWEEN :start_date AND :end_date - 1;
COMMIT;                        -- lock released; transaction 2 now reads 100
```

Correct, easy to reason about, and the right call when contention is genuinely heavy and you'd rather queue than thrash on retries. The costs are real: locks held across an application round-trip serialize a hot room type entirely, and locking multiple date rows in an inconsistent order across concurrent requests invites deadlocks (always acquire in a deterministic order — ascending `date` — to avoid this). Long-lived locks are especially dangerous if any external call, like a payment authorization, sits inside the transaction. It never should.

### Optimistic concurrency control

Don't lock. Read a `version` column, and make the write conditional on the version not having moved:

```sql
-- read: version = 42, total_reserved = 99
UPDATE room_type_inventory
SET total_reserved = total_reserved + :n, version = version + 1
WHERE hotel_id = :hotel AND room_type_id = :type AND date = :date
  AND version = 42
  AND total_reserved + :n <= total_inventory;
-- affected rows = 0  ->  someone else won; abort and retry the whole read-check-write
```

The transaction that commits second finds zero rows affected and retries from the read. At 3 TPS this is almost always the right default: no locks, no deadlocks, no blocked readers, and conflicts are rare enough that retries are invisible. Its failure mode is contention-shaped — during a flash sale on one hotel, every client reads the same version, one wins, the rest retry, and the next round has the same structure. Throughput collapses into a retry storm exactly when demand is highest. Use a bounded retry count with jittered backoff, and treat "optimistic under high contention" as a known cliff, not a surprise.

Note that a plain conditional `UPDATE` with the predicate inlined in the `WHERE` clause (as above) is atomic even without the version column — the database re-evaluates the row under its own write lock. The version column earns its keep when the decision depends on more state than the single row being written.

### A database constraint

Push the invariant into the schema so it cannot be violated by any code path, present or future. For the counter model, that's a `CHECK`:

```sql
ALTER TABLE room_type_inventory
  ADD CONSTRAINT inventory_not_oversold
  CHECK (total_reserved >= 0 AND total_reserved <= total_inventory);
```

For a model where reservations map to *specific* rooms (Airbnb, meeting rooms, equipment rental), the far stronger version is an **exclusion constraint** over a range type, which makes overlapping bookings for the same room physically unrepresentable:

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE reservation
  ADD CONSTRAINT no_overlapping_stays
  EXCLUDE USING gist (
    room_id      WITH =,
    daterange(start_date, end_date, '[)') WITH &&
  ) WHERE (status IN ('pending', 'paid'));
```

`&&` is the range-overlap operator; the constraint says "no two live reservations may share a room and overlap in time." The `[)` bound is deliberate — checkout day is not an occupied night, so a stay ending June 3 and one starting June 3 do not conflict. This is the strongest of the three options because it is enforced by the storage engine regardless of which service, script, or manual `psql` session issues the insert. Its costs: it is not version-controlled alongside application logic as naturally, it isn't portable across engines (this is PostgreSQL-specific), and like optimistic control it converts contention into user-visible errors rather than queueing.

**Choosing.** Low contention and low write volume — which describes almost every real reservation system — favors optimistic control plus a constraint as a backstop: fast in the common case, impossible to get wrong in the uncommon one. Sustained heavy contention on a single hot row favors pessimistic locking, because queueing beats a retry storm. A constraint should be present in all three cases; it is not an alternative to the others so much as the last line of defense behind them.

```mermaid
sequenceDiagram
    participant U1 as User A
    participant U2 as User B
    participant DB as Inventory DB<br/>(1 room left, version=42)

    U1->>DB: BEGIN; read row (99/100, v42)
    U2->>DB: BEGIN; read row (99/100, v42)
    Note over U1,U2: both see one room available

    U1->>DB: UPDATE ... SET total_reserved=100, version=43<br/>WHERE version=42
    DB-->>U1: 1 row affected
    U1->>DB: INSERT reservation (idempotency key); COMMIT
    DB-->>U1: 201 Confirmed

    U2->>DB: UPDATE ... SET total_reserved=100, version=43<br/>WHERE version=42
    DB-->>U2: 0 rows affected (version moved)
    Note over U2,DB: CHECK (total_reserved <= total_inventory)<br/>would also have rejected this write
    U2->>DB: ROLLBACK; retry read
    DB-->>U2: 0 available
    U2-->>U2: 409 Sold out — surface, don't retry forever
```

## Fast Reads, Slow Writes: Splitting the Paths

The 100:1 read-to-write ratio means browsing traffic should never touch the primary. Hotel and room-type data is essentially static and belongs behind a CDN and an application cache. Availability data is more interesting: it changes, but a browsing user reading availability that's a second or two stale is harmless, because *the read is not the decision*. Serve availability queries from a read replica or a Redis inventory cache keyed `hotel_id:room_type_id:date`, and let the primary handle only the transactional write. [Read/Write Splitting and CQRS-Lite](read-write-splitting-and-cqrs-lite) covers when that split earns its complexity and when it's just two sources of truth arguing.

The rule that makes this safe is worth stating explicitly: **the cache filters, the database decides.** A cache that says "sold out" can safely reject a request early (it's only ever conservative if it lags a cancellation, and a refresh fixes that). A cache that says "available" must never be trusted to commit — the booking transaction re-validates against the primary under the constraint, and the user gets a 409 if the cache was optimistic. Every stale-read failure mode collapses into "user sees a room, clicks book, gets told someone beat them to it," which is a normal, explainable outcome rather than a data corruption.

Propagating inventory changes to the cache is a classic dual-write problem — update the database and the cache and hope both succeed. Tailing the database's change log (CDC/Debezium) or emitting the update through a [transactional outbox](outbox-pattern) keeps the cache converging on the database instead of drifting from it.

## Holds: Reserving Inventory During Checkout

There's a gap between "user has decided" and "payment has cleared" that lasts seconds to minutes — a 3-D Secure challenge, a card retry, a slow PSP. Leaving inventory available during that window means a user can be charged for a room someone else just took; decrementing it permanently means an abandoned checkout removes a room from sale forever.

The answer is a **short-lived hold with a TTL**. When the user enters checkout, insert the reservation with `status = 'pending'` and an `expires_at` a few minutes out, and count pending rows against `total_reserved` — the room is now invisible to other shoppers. Payment success flips the status to `paid` and clears `expires_at`; payment failure or abandonment leaves it to expire. A sweeper job (or a Redis key with a real TTL mirroring the row) releases expired holds back into inventory.

Two details make this robust. First, expiry must be **enforced on read**, not only by the sweeper: any availability check should ignore pending rows whose `expires_at` has passed, so a lagging sweeper delays reclamation but never causes a phantom sellout. Second, the payment call belongs **outside** the database transaction — holding a row lock across a third-party HTTP call is how a 30-second PSP timeout turns into a hotel-wide outage. Take the hold in a short transaction, commit, call the PSP, then take a second short transaction to confirm. The hold is precisely what makes it safe to release the lock in between.

## Scaling Beyond One Hotel Chain

At chain scale (3 TPS) a single primary with replicas is sufficient and sharding is over-engineering. At Booking.com or Expedia scale — 1,000× the traffic — the write path is still the bottleneck, and the shard key falls out of the access pattern: nearly every query filters by `hotel_id`, so `hash(hotel_id)` distributes load while keeping each booking transaction inside a single shard. That last property is the whole point. A reservation touches the inventory rows and the reservation row for one hotel; keeping them co-located means the ACID transaction stays local and no distributed commit protocol is needed.

The same logic argues against splitting inventory and reservations into separate microservices with separate databases. A "pure" microservice decomposition turns one local transaction into a distributed one requiring 2PC (blocking, slow) or a saga with compensating transactions (eventually consistent, and now you're writing code to un-book a room). Keeping inventory and reservation in one service backed by one database — a pragmatic hybrid — buys back ACID for the one operation where it matters most. Reserve saga-style choreography for things like payment settlement and notification fan-out, where eventual consistency is genuinely acceptable.

Reservation history also grows without bound while only current and future data is hot. Archiving past stays to cold storage keeps the transactional tables small, which keeps the indexes on the contended path shallow.

## Trade-offs

- **Strong consistency on the booking write is affordable precisely because the write rate is low** — 3 TPS justifies serializable isolation, row locks, and retries in a way that a 100k-TPS event ingest never would. The estimation isn't ceremony; it's what licenses the expensive choice, and skipping it is how candidates end up defending an eventually-consistent booking pipeline that reintroduces double-booking by construction.
- **Optimistic concurrency control is the right default and has a sharp contention cliff** — no locks, no deadlocks, and near-zero cost when conflicts are rare, but during a flash sale on one hotel every client retries into the same losing race, so throughput degrades exactly when demand peaks. Bound the retries, add jitter, and surface "sold out" rather than looping.
- **Pessimistic locking queues instead of thrashing, at the cost of serializing the hot path** — better than OCC under heavy contention, but locks held across an application round-trip (and catastrophically, across a payment call) convert a slow dependency into a hotel-wide stall, and multi-row date-range locks deadlock unless acquired in a deterministic order.
- **A database constraint is the only mechanism that can't be bypassed, and the only one that can't be code-reviewed like code** — an exclusion constraint on `(room_id, daterange)` makes overlapping bookings unrepresentable regardless of which service or ad-hoc script writes the row, but it's engine-specific, awkward to version alongside application logic, and it reports conflicts as errors rather than queueing them.
- **Caching availability improves read scalability and guarantees the cache will sometimes lie** — that's tolerable only because the cache filters and the database decides; a design that lets the cache authorize a booking has traded a rare stale read for a real double-booking.
- **Holds prevent mid-checkout theft and create a new failure mode: inventory held by abandoned carts** — too short a TTL fails users on slow payment flows, too long a TTL suppresses real availability, and expiry must be enforced on read as well as by the sweeper so that a lagging job never manufactures a phantom sellout.

## Interview Questions

- Two transactions read `total_reserved = 99` against a `total_inventory` of 100 and both commit an increment. Name the anomaly, explain which isolation levels permit it, and give two different mechanisms that prevent it.
- An idempotency key on `POST /v1/reservations` stops a double-clicking user from booking twice. Explain why it does nothing for two *different* users racing for the last room.
- Why does modeling inventory as one row per `(hotel_id, room_type_id, date)` make both date-range availability checks and a 10% overbooking policy easier than storing a date range per reservation?
- Your team wants to serve availability from a Redis cache. What is the exact rule that keeps this safe, and what does a user experience when the cache is wrong in each direction?
- A microservice purist insists inventory and reservations must have separate databases. What specifically breaks, what would you have to build to compensate, and what's your argument for the hybrid?

## References

- [Alex Xu and Sahn Lam, "System Design Interview – An Insider's Guide, Volume 2" (ByteByteGo, 2022) — Chapter 7, "Hotel Reservation System"](https://bytebytego.com)
- [PostgreSQL Documentation — Constraints (Exclusion Constraints)](https://www.postgresql.org/docs/current/ddl-constraints.html)
- [PostgreSQL Documentation — Range Types: Constraints on Ranges](https://www.postgresql.org/docs/current/rangetypes.html)
- [H. T. Kung and John T. Robinson, "On Optimistic Methods for Concurrency Control" (ACM TODS, 1981)](https://dl.acm.org/doi/10.1145/319566.319567)
