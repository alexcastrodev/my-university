---
version: 1.0
updatedAt: 2026-07-30
---
## Objective

Two mechanisms work together to make PostgreSQL failover both safe and invisible
to applications: quorum voting decides, without ambiguity, which node becomes the
new primary after a failure; connection indirection makes sure application traffic
finds that new primary without any client-side reconfiguration. Neither one alone is
enough — a cluster that can elect a new primary but still has every application
hardcoded to the old node's hostname hasn't achieved high availability.

## Use Cases

- Sizing and converting nodes so an automated-failover cluster always has an odd
  number of voters, without paying for an extra full database replica just to break
  ties.
- Deciding where a witness node should live so a network partition between two
  data centers can't cause an unwanted promotion on the wrong side.
- Choosing an indirection mechanism (DNS, virtual IP, connection multiplexer, or
  load balancer) so that switching the active primary doesn't require touching every
  application's configuration.
- Explaining to a team why direct application-to-database-hostname connections are
  an operational liability the moment failover automation is introduced.

## Deep Dive

### Reaching an odd voter count

Automated failover needs a way to avoid a tie vote when the primary disappears.
The guideline is simple to apply on top of whatever node count a cluster already has:

1. If the initial node count is even, add one dedicated witness node — a voter only,
   never a promotion candidate.
2. If the initial node count is odd, convert one existing replica into a witness
   instead of adding a new node.
3. In a two-data-center layout, keep the witness in the same data center as the
   primary — this is what stops a network partition from letting the isolated
   secondary site incorrectly promote one of its own replicas, since the primary's
   side keeps the voting majority.
4. With three or more locations available, place the witness in an independent,
   third location instead, so it isn't tied to either "real" site.

### Why the witness can't vote for itself

A witness never votes for itself, so it always breaks a tie in favor of whichever
replica is actually eligible for promotion. In a 3-node cluster (primary, replica,
witness), if the primary fails, the witness has exactly one node to vote for — the
replica — guaranteeing a majority. If the witness were an ordinary replica instead,
it could vote for itself and produce a tied election, which is precisely the scenario
automated failover exists to avoid.

### Breaking ties with the log sequence number

If a design ends up with multiple witnesses and a vote still splits, PostgreSQL
quorum systems fall back to the Log Sequence Number (LSN) of each candidate: the
node that has replicated the most data — even by a single transaction — wins,
because it represents the least possible data loss.

### Connection indirection: four ways to hide the primary's identity

None of the quorum mechanics matter to an application if it's still connecting to a
specific node's hostname. Four techniques accomplish the same goal — a stable
address applications use, decoupled from which physical node is primary right now:

1. Domain name reassignment
2. Virtual IP address
3. Session multiplexing software (e.g., PgBouncer)
4. Software or hardware load balancer (e.g., HAProxy)

The design rule is the same regardless of technique: always route application
traffic through at least one proxy, never directly to a node, and provision two
proxies so the indirection layer itself isn't a new single point of failure.

### Book vs today: indirection built on the quorum tool itself

The book (2020) presents the four indirection techniques as generic, tool-agnostic
options. Today, when Patroni is already managing quorum and leader election (see
`postgresql-node-count-and-placement`), it also solves indirection: Patroni exposes
a REST API with purpose-built health-check endpoints — `GET /primary` (or `/`)
returns HTTP 200 only from the current leader, `GET /replica` only from standbys.
HAProxy (or any load balancer) polls those endpoints with `option httpchk` and
routes traffic only to whichever node answers 200 — Patroni ships a working
`haproxy.cfg` example doing exactly this. PgBouncer commonly sits in front of that
layer for connection pooling. This collapses the book's "pick one of four generic
techniques" decision into "point a health-check-aware load balancer at the
orchestration tool's own API" — DNS reassignment and virtual IPs (via tools like
`vip-manager`) remain supported for environments that can't run a proxy layer, but
the HAProxy-against-Patroni's-REST-API pattern is what the tooling ships and
documents as its own reference setup.

## Trade-offs

- **A two-data-center layout stays symmetric only until the first failover.** The
  book's own worked example shows a Chicago/Dallas cluster failing over to Dallas —
  which has no witness of its own — meaning every subsequent failover has to be
  followed by a manual switch back to Chicago, doubling the effective downtime.
  This is exactly the asymmetry that a third, independent witness location (rule 4
  above) is meant to eliminate.
- **The four indirection techniques aren't interchangeable in practice.** DNS
  reassignment is simple but subject to client-side and resolver caching (a low TTL
  helps but doesn't eliminate the delay); a virtual IP needs the proxy and the nodes
  on the same layer-2 network segment to work at all; a load balancer or connection
  multiplexer adds a piece of software that itself needs health checks and its own
  redundancy plan. Picking one is a trade between operational simplicity and how
  quickly clients actually notice a failover happened.
- **Two proxies solve the single-point-of-failure problem but reintroduce a
  smaller version of the same question** — how do clients know which of the two
  proxies to use? In practice this gets solved one layer up (each application server
  targets a specific proxy, or a lightweight DNS/VIP layer sits in front of the
  proxy pair) rather than solved away entirely.

## Documentation Links

- Shaun Thomas, "PostgreSQL 12 High Availability Cookbook", 3rd Edition (Packt, 2020) — Chapter 1, "Architectural Considerations", recipes "Considering quorum" and "Introducing indirection", p. 25-30 — doc
- [PostgreSQL Documentation — High Availability, Load Balancing, and Replication](https://www.postgresql.org/docs/current/warm-standby.html) — doc
- [Patroni Documentation — REST API (health-check endpoints for load balancers)](https://patroni.readthedocs.io/en/latest/rest_api.html) — doc
- [Patroni — example haproxy.cfg using the REST API health checks](https://github.com/patroni/patroni/blob/master/haproxy.cfg) — doc
