---
version: 1.0
updatedAt: 2026-07-30
---
## Objective

Every architecture decision covered so far — node count, quorum, indirection,
fencing — answers "how do we survive a failure." None of it says how much downtime
is actually acceptable in the first place. That number doesn't come from the database
team; it comes from asking who uses the system, what they'll tolerate, and turning
the answer into a concrete uptime target — expressed as a percentage of "nines" —
that every later architecture decision gets measured against.

## Use Cases

- Deciding whether a maintenance window needs to happen at 2 a.m. or can happen
  during business hours, based on which category of user is active at that time.
- Justifying an HA investment (a witness node, a second data center, an automated
  failover stack) by pointing at a specific downtime budget it needs to hit, instead of
  "more availability is always better."
- Setting expectations with stakeholders *before* an outage happens, so a 20-minute
  maintenance window isn't treated as a crisis by users who were never told to
  expect it.

## Deep Dive

### Users are categories, not accounts

The book's checklist starts by identifying categories of users — not individual
accounts — and asking, for each category: when do they access the database, what
query timeout will they tolerate, do they lose money during an outage, are they
likely to come back afterward, should they be included in maintenance or emergency
notifications. A QA department and 10,000 holiday shoppers are different categories
with entirely different tolerance for the exact same outage.

### What a "nine" actually costs in downtime

"Uptime percentage" only becomes actionable once translated into a concrete time
budget per year:

| Uptime | Downtime / year |
|---|---|
| 99% (two nines) | ~3.65 days |
| 99.9% (three nines) | ~8.76 hours |
| 99.99% (four nines) | ~52.6 minutes |
| 99.999% (five nines) | ~5.3 minutes |

Each additional nine is roughly a 10x reduction in tolerated downtime — which is
also, roughly, a 10x jump in the engineering effort needed to guarantee it. Whether
planned maintenance counts against this budget or is carved out separately is a
scope decision the SLA has to state explicitly; the two framings produce very
different effective targets from the same headline percentage.

### Maintenance windows follow user activity, not the calendar

The book's operational rule: don't take a critical node offline while more than 5% of
active users are on the platform, and schedule maintenance after official business
hours close. Disaster-recovery nodes, standbys, and QA/dev copies get more leeway
— they're not what users depend on directly, so touching them carries less risk, even
if it's still worth keeping them available for their own consumers (developers, QA
staff, or an actual failover event).

### The SLA as a contract, not just a target

Turning all of this into a signed SLA with clients does two things at once: it sets
explicit, agreed-upon expectations (so a maintenance window doesn't read as broken
trust), and it acts as a legal boundary that limits liability if an outage does occur. The
checklist — uptime percentage, notification rules, maintenance cadence, what counts
as an emergency — is what actually goes into that contract.

### Book vs today: the same idea, formalized as SLO and error budget

The book uses only "SLA" and never distinguishes it from the target itself. The
Google SRE discipline that's become the industry-standard vocabulary since splits
this into three layers: an **SLI** (Service Level Indicator — the actual measured
metric, e.g., successful-query ratio), an **SLO** (Service Level Objective — the
internal target, e.g., 99.95%), and an **SLA** (the external, often contractual promise,
usually set looser than the SLO to leave margin). The **error budget** is simply
`1 − SLO`: a concrete, spendable quantity of allowed unreliability that planned
maintenance and unplanned outages draw from the same pool — which is exactly the
book's "does planned maintenance count against the number" question, just given a
name and a formal accounting model.

Teams no longer have to pick an uptime number from nothing, either: managed
PostgreSQL now ships with a published SLA to benchmark against — AWS RDS for
PostgreSQL (Multi-AZ) publishes **99.95%**, and Google Cloud SQL for PostgreSQL
publishes **99.95%** on its Enterprise edition (regional/HA) or **99.99%** on Enterprise
Plus. Neither number is a ceiling a self-managed cluster must accept — but both are a
concrete, externally-validated starting point for "what uptime percentage is
expected?" that the book could only answer by asking around.

The "don't take a node offline while more than 5% of active users are on it" heuristic
has also been partly automated away: AWS RDS Multi-AZ still uses a scheduled
weekly maintenance window (a direct descendant of "after business hours"), but
patches now apply to the standby first, then an automatic failover — typically well
under a minute — promotes it, rather than a human checking live user counts before
touching the primary.

## Trade-offs

- **Each additional nine costs roughly an order of magnitude more effort, for a
  proportionally smaller absolute time budget** — going from three nines (8.76
  hours/year) to four nines (52.6 minutes/year) demands roughly the same relative
  engineering investment as going from four nines to five (5.3 minutes/year), even
  though the second jump buys back far fewer actual minutes.
- **Whether maintenance counts against the SLA changes what "meeting the target"
  even means** — an SLA that excludes planned maintenance can look identical on
  paper to one that includes it, while representing very different actual user-facing
  reliability; this has to be stated explicitly, not left implicit in the headline
  percentage.
- **A signed SLA reduces legal exposure at the cost of operational flexibility** — once
  maintenance cadence and notification rules are contractual, renegotiating them
  later (a new deploy pipeline that wants a different window, say) requires
  re-opening the agreement, not just an internal process change.

## Documentation Links

- Shaun Thomas, "PostgreSQL 12 High Availability Cookbook", 3rd Edition (Packt, 2020) — Chapter 3, "Minimizing Downtime", recipe "Determining acceptable losses", p. 88-90 — doc
- [Google SRE Book — Service Level Objectives](https://sre.google/sre-book/service-level-objectives/) — doc
- [Google SRE Workbook — Implementing SLOs (error budgets)](https://sre.google/workbook/implementing-slos/) — doc
- [AWS — Amazon RDS Service Level Agreement](https://aws.amazon.com/rds/sla/) — doc
- [Google Cloud — Cloud SQL Service Level Agreement](https://cloud.google.com/sql/sla) — doc
- [AWS Documentation — Maintaining a DB instance (Multi-AZ standby-first patching + automatic failover)](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_UpgradeDBInstance.Maintenance.html) — doc
