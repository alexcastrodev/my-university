---
version: 1.0
updatedAt: 2026-07-30
---
## Objective

Multi-master PostgreSQL — multiple simultaneously-writable primary nodes — trades
the failover/quorum problem for a different one: instead of asking "how do we
detect a failure and promote a replacement," a multi-master cluster asks "how do we
let several nodes accept writes at once without those writes conflicting or racing
each other." The payoff is close to zero-RTO maintenance and failover; the cost is
architectural complexity that only pays for itself under specific conditions.

## Use Cases

- An application with real cross-continent write latency (e.g., users on three
  continents all writing to the same logical database) where a single-primary
  architecture makes every write pay a full round-trip to one region.
- A workload where a single logical operation issues several sequential writes, so
  network latency to a single primary compounds instead of being paid once.
- Needing PostgreSQL major-version upgrades or node maintenance to cost close to
  zero downtime, since a multi-master cluster can shift traffic away from a node
  without any promotion step.

## Deep Dive

### Three questions before considering multi-master

The book frames adoption as answering three questions, not defaulting to "more
availability is always better":

1. Is there significant geographical distance between nodes?
2. Does the application issue multiple transactions or queries per logical
   operation?
3. Are users/accounts naturally regionalized, so most writes for a given account
   already originate near a specific node?

A "no" to the first two makes multi-master mostly cost without corresponding
benefit — the latency problem it solves doesn't exist yet.

### Why write latency compounds

A write to a distant primary pays full network round-trip time before the local
replica can even begin replaying it. A single web page might issue a dozen queries;
a credit application might involve several writes plus polling for results. Each of
those pays the round-trip separately, so the *time amplification* — not just the raw
per-write latency — is what makes single-primary architecture painful at global
scale. Multi-master eliminates this by letting each region write to its own local
primary.

### Mesh overhead: C = N × (N − 1)

Multi-master's naive topology — every primary connected directly to every other
primary — has a communication-channel count that grows quadratically:

```
C = N * (N - 1)
```

Three nodes need 6 channels; ten nodes need 90. Every transaction in the cluster
must eventually be acknowledged by every other primary, so this isn't just a
connection-count curiosity — it's real replication overhead that scales worse than
the node count itself.

### Hub + Spoke as the mitigation

Instead of making every new node a full mesh peer, a Hub + Spoke model keeps a
small number of regional primaries and adds ordinary read replicas locally to absorb
read traffic. This satisfies growing regional read demand without adding to the
primary-to-primary mesh, since the added nodes never need to accept writes
themselves.

### Near-zero RTO through proxy-mediated switchover

Because no node needs promotion — every primary is already writable — a proxy
layer can redirect traffic from one primary to another in milliseconds instead of
running through a failure-detection-then-promotion sequence. With two primaries
per data center, the proxy can also autodetect an offline node and route only to the
online one in the same location, so maintenance on any single node doesn't force a
cross-region failover.

Multi-master clusters also don't need an odd node count or a witness — since no
node is ever promoted, there's no election to arbitrate and no ordinary split-brain
failure mode to guard against with a tie-breaking voter.

### The double-write race and why data locality matters

Multiple writable primaries introduce a specific race a single-primary architecture
never has: Node A accepts a write for an account, the change hasn't yet replicated to
Node B, a stateless application reconnects to Node B, doesn't see its own write, and
resubmits it — replaying the change a second time once B eventually catches up.
Coupling an application session to one primary (via sticky sessions, or by
geographically partitioning which accounts write to which node) prevents this by
making sure a client's writes and its subsequent reads hit the same node.

### Book vs today: the vendor landscape shifted, the shape of the answer didn't

The book (2020) deliberately doesn't name a specific multi-master product, calling it
generic "proprietary extended functionality." The vendor most likely meant at the
time was 2ndQuadrant's BDR — 2ndQuadrant was acquired by EDB in 2020, and BDR is
now sold as **EDB Postgres Distributed (PGD)**, still commercial/subscription-based.
What's new since the book is a genuinely open-source alternative: **pgEdge**'s
multi-master engine (the `Spock` extension) was re-licensed to the plain PostgreSQL
License in September 2025, making a full open-source multi-master option available
for the first time where the book only saw paid ones.

Native PostgreSQL logical replication itself also gained ground — PostgreSQL 18 added
built-in conflict *detection and logging* (`insert_exists`, `update_origin_differs`, and
similar conflict types, surfaced via `pg_stat_subscription_stats`). This doesn't change
the book's core framing, though: detection isn't resolution. A conflict still halts
replication until resolved manually (`ALTER SUBSCRIPTION ... SKIP` or
`pg_replication_origin_advance()`) — true bidirectional multi-master with automatic
conflict resolution still requires an extension like PGD or Spock, not stock
PostgreSQL. And the book's double-write mitigation — keep a session's writes and
reads on one node via sticky/regional routing — remains the standard advice from
today's multi-master vendors, not something a newer proxy-layer trick has replaced.

## Trade-offs

- **Multi-master is a specific answer to a specific latency problem, not a general
  upgrade over single-primary replication.** Adopting it without cross-region
  latency or multi-write-per-operation workloads (the book's first two guiding
  questions) adds proxy complexity, mesh overhead, and conflict-avoidance design
  for no corresponding benefit.
- **Hub + Spoke trades write locality for architectural simplicity.** Regional read
  replicas absorb read traffic without joining the mesh, but they still route all
  writes back to their region's single primary — the model helps mesh overhead,
  not the original cross-region write-latency problem for regions without their own
  primary.
- **Sticky sessions/data locality solve the double-write race by giving something
  up: even load distribution.** Coupling a session (or an account) to one primary
  means that primary's capacity, not the cluster's aggregate capacity, bounds how
  fast that session's writes can go — the opposite failure mode from an
  evenly-balanced but conflict-prone cluster.

## Documentation Links

- Shaun Thomas, "PostgreSQL 12 High Availability Cookbook", 3rd Edition (Packt, 2020) — Chapter 1, "Architectural Considerations", recipes "Incorporating multi-master" and "Leveraging multi-master", p. 34-41 — doc
- [PostgreSQL Documentation — Logical Replication](https://www.postgresql.org/docs/current/logical-replication.html) — doc
- [PostgreSQL Documentation — Conflict Detection and Logging in Logical Replication](https://www.postgresql.org/docs/current/logical-replication-conflicts.html) — doc
- [EDB Postgres Distributed (PGD) Documentation](https://www.enterprisedb.com/docs/pgd/latest/) — doc
- [pgEdge — Spock multi-master engine re-licensed to the PostgreSQL License](https://www.pgedge.com/blog/pgedge-goes-open-source) — doc
