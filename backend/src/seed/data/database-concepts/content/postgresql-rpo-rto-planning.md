---
version: 1.0
updatedAt: 2026-07-27
---
## Objective

Understand Recovery Point Objective (RPO — how much data the business can afford to lose in an outage) and Recovery Time Objective (RTO — how long an outage may last) as the two numbers that drive every downstream decision in a highly available PostgreSQL cluster, and how PostgreSQL's synchronous replication turns a stated RPO into an enforceable guarantee instead of a hope.

## Use Cases

- Justifying to stakeholders why a single PostgreSQL node with nightly `pg_dump` backups doesn't meet a requirement of "we can't lose more than a few seconds of data" — the gap between stated RPO and actual architecture is where outages become incidents.
- Translating a business SLA ("checkout must recover within 2 minutes") into a concrete PostgreSQL configuration choice: how many standbys, sync vs. async replication, and how failover is triggered.
- Building a spreadsheet of every activity that can take the database offline (minor upgrade, major upgrade, reboot, switchover, failover) to catch cases where the *database layer's* realistic recovery time already exceeds what the rest of the application stack promises customers.
- Deciding between quorum-based and priority-based synchronous replication when more than one standby exists, based on whether predictability or fault tolerance matters more.

## Deep Dive

### RPO: how much data can you afford to lose

RPO describes the amount of data that may be lost following an unexpected outage before the system is operational again. It's not a technical measurement you calculate — it's a business decision you gather from stakeholders (VP/C-level, product managers, architects, infrastructure leads) *before* picking an architecture, because it drives node count, data synchronization method, and backup technology. Asking "how much data can we lose in a major outage?" almost always gets the answer "none!" — which is exactly why the conversation has to happen early: a zero-RPO architecture costs a lot more than a ten-second-RPO one, and the business needs to see that trade-off in dollars before committing to it.

### RTO: how long can recovery take, and the spreadsheet that proves it

RTO is the amount of time an outage of the database layer may last, often written into a Service Level Agreement. The book's method for pinning this down is a simple spreadsheet: one row per activity that can take PostgreSQL offline, with columns for time-per-occurrence and how many times per year it happens.

| Activity | Time (s) | Count | Total (s) |
|---|---|---|---|
| Minor Upgrade | 30 | 4 | 120 |
| Major Upgrade | 120 | 1 | 120 |
| Reboot | 300 | 1 | 300 |
| Switchover | 60 | 2 | 120 |

`Total = Time * Count`, summed across all rows, gives a cumulative yearly RTO contribution from the database layer alone. The point isn't the exact numbers — it's that RTO values amplify between layers: if the database's realistic RTO is higher than what a layer above it promises, that layer's RTO silently becomes wrong too. A classic sanity check for how strict a stated RTO really is: "five 9s" of uptime (99.999%) leaves only about 5 minutes of *total* downtime per year — barely enough for one unplanned reboot, let alone routine maintenance.

### Turning "RPO = 0" into an actual guarantee: synchronous replication and quorum commit

Business intent ("no data loss") only becomes real once it's backed by a durability guarantee PostgreSQL enforces on every commit. `synchronous_standby_names` configures which standbys a transaction must wait on before the primary reports success:

```
# priority-based: waits specifically for s1, falls back to s2 if s1 is down
synchronous_standby_names = 'FIRST 1 (s1, s2, s3)'

# quorum-based: waits for ANY 2 of the three listed standbys
synchronous_standby_names = 'ANY 2 (s1, s2, s3)'
```

With `synchronous_commit = on`, a commit waits until its WAL record is confirmed written to disk on both the primary and the required number of standbys — data can only be lost if the primary and every required standby crash at the same instant. That's what an RPO of zero actually looks like in a running system, not just a number on a slide.

### Book vs. today: incremental backup used to require third-party tools

The book (2020, targeting PostgreSQL 12) leans on third-party tools like pgBackRest for efficient, low-RPO backup strategies — PostgreSQL itself had no way to take an incremental backup (only changed data since the last backup) without one. PostgreSQL 17 (2024) closed that gap natively: `pg_basebackup --incremental` takes a backup relative to a previous backup's manifest, and the companion `pg_combinebackup` tool reconstructs a full, restorable backup from a full backup plus its chain of increments. The RPO/RTO planning process the book describes is unchanged — but "how do we back up cheaply enough to hit our RPO" no longer forces a decision between a third-party tool and doing it the slow way.

## Trade-offs

- **A zero-RPO guarantee costs write latency, not just infrastructure** — every commit under `synchronous_commit = on` waits for a network round trip to the required standbys; that's the price of "only lost if primary and standby crash together," and it's paid on every single write, not just during an outage.
- **`FIRST n` is predictable, `ANY n` is resilient — pick one on purpose** — `FIRST n` always waits on the same named standbys, so latency is consistent and easy to reason about, but if that specific standby lags, every commit lags with it. `ANY n` tolerates one slow standby by falling back to the others, at the cost of which two standbys satisfied a given commit being non-deterministic.
- **Naming more eligible standbys than you have running is a silent trap** — if `synchronous_standby_names` requires more replicas than are currently connected, commits don't fail, they hang indefinitely; RPO/RTO planning has to account for "what happens when a standby is down," not just the happy path.
- **The RTO spreadsheet is a communication tool as much as a technical one** — the book is explicit that this process gets run multiple times: estimate, present to decision-makers, negotiate, re-estimate. Treating it as a one-shot calculation defeats its actual purpose, which is getting non-technical stakeholders to see the cost of the RTO they're asking for.

## Documentation Links

- [PostgreSQL 12 High Availability Cookbook, 3rd Edition (Packt, 2020) — Chapter 1: "Architectural Considerations", p. 8-15](https://www.packtpub.com/en-us/product/postgresql-12-high-availability-cookbook-9781838984854) — doc
- [PostgreSQL Documentation — Synchronous Replication (synchronous_standby_names, quorum commit)](https://www.postgresql.org/docs/current/warm-standby.html#SYNCHRONOUS-REPLICATION) — doc
- [PostgreSQL 17 Release Notes — Incremental backup (pg_basebackup, pg_combinebackup)](https://www.postgresql.org/docs/17/release-17.html) — doc
