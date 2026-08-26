---
version: 1.0
updatedAt: 2026-08-03
---
## Objective

A single misbehaving client can undermine an otherwise highly available
PostgreSQL cluster — a forgotten `WHERE` clause turns into an hours-long
sequential scan that saturates a CPU and the storage bandwidth, or a buggy
application opens a transaction and never closes it, leaving locks held
indefinitely and other sessions queued behind them. Evicting that client is
an escalation, not a single command: start gentle (ask the query to stop),
get more forceful (disconnect the session), and only reach for an
operating-system-level network kill when PostgreSQL itself can't get the
client's attention.

## Use Cases

- A long-running, unindexed query is saturating CPU/disk and needs to be
  stopped without restarting the whole server.
- An application bug leaves a transaction open ("idle in transaction"),
  holding row/table locks that block every other session waiting on the
  same rows.
- A client's network connection has gone stale (a laptop put to sleep
  mid-query, a container killed without a clean shutdown) and PostgreSQL is
  still waiting for it to acknowledge a termination signal that will never
  come.

## Deep Dive

### Finding the culprit: pg_stat_activity

The starting point for any of this is `pg_stat_activity`, which lists every
active backend along with its process ID, port, state, and running query.
Filtering for anything that's been running longer than a couple of seconds
and isn't idle narrows the list to genuine candidates fast:

```sql
SELECT pid, client_port, state,
       now() - query_start AS duration, query
  FROM pg_stat_activity
 WHERE now() - query_start > INTERVAL '2 seconds'
   AND state != 'idle'
 ORDER BY duration DESC;
```

The 2-second threshold is arbitrary — it's just enough to filter out the
flood of normal, fast queries so only genuinely long-running ones are left
to review. `pid` is what every escalation step below targets; `client_port`
matters only if the process falls back to a network-level kill.

### Step one: ask nicely with pg_cancel_backend

```sql
SELECT pg_cancel_backend(pid);
```

`pg_cancel_backend()` sends a cancel signal for whatever the target backend
is currently doing — equivalent to a client pressing Ctrl+C on a running
query. It only affects a backend that's actively running something; a
session that's merely "idle in transaction" (not executing a query right
now, just sitting on an open transaction) won't be touched by a cancel,
because there's no in-flight query to interrupt. After running it, re-run
the `pg_stat_activity` query above to confirm the target `pid` actually
stopped before deciding whether to escalate further.

### Step two: disconnect with pg_terminate_backend

```sql
SELECT pg_terminate_backend(pid);
```

If the query is still running, or if the session has settled into "idle in
transaction" (which a cancel can't touch), `pg_terminate_backend()`
escalates from "stop the query" to "end the whole session" — the rough
equivalent of an operating-system kill on the client process, but issued
directly from SQL. It rolls back any in-progress transaction and releases
every lock the session was holding. As with the cancel step, re-check
`pg_stat_activity` afterward — a slow or unreliable network can still leave
the connection technically alive even after PostgreSQL has sent the
terminate signal.

### Killing several rogue sessions at once

Both functions accept a `pid` from any source, including a subquery over
`pg_stat_activity` — useful when an application bug leaves many connections
idle in transaction simultaneously rather than just one:

```sql
SELECT pg_terminate_backend(pid)
  FROM pg_stat_activity
 WHERE now() - state_change > INTERVAL '2 minutes'
   AND state = 'idle in transaction';
```

`pg_stat_activity` exposes enough columns (client address, application
name, connection start time) to target a termination sweep by almost any
useful criterion — not just duration, but origin or client identity too.

### The last resort: tcpkill

Rarely, `pg_terminate_backend()` sends its signal successfully but the
client connection survives anyway — not a PostgreSQL bug, but a genuinely
unreliable network: a socket stuck mid-write, a client that never
acknowledges receipt, an operating system that hasn't yet noticed the
connection is dead. PostgreSQL will then wait indefinitely for the client
to cooperate. At that point the fix has to happen below PostgreSQL, at the
network layer, using the `tcpkill` utility (from the `dsniff` package):

```bash
sudo tcpkill -i eth0 -9 port client_port
```

`-i eth0` names the network interface PostgreSQL is using, `port` targets
the exact connection via the `client_port` value pulled from
`pg_stat_activity` earlier, and `-9` tells `tcpkill` to block all traffic
in both directions with no ambiguity. This forces the operating system to
tear down the socket, which in turn makes the PostgreSQL client exit on its
own — it can take a minute or two of output before the connection is
actually gone, so patience matters here more than at any earlier step.

## Trade-offs

- **`pg_cancel_backend()` and `pg_terminate_backend()` are not
  interchangeable first choices.** A cancel only interrupts an
  *actively running* query; a session that's idle in an open transaction
  needs the heavier terminate call from the start, since there's nothing
  for a cancel to interrupt.
- **`pg_terminate_backend()` rolls back the entire transaction and drops
  every lock the session held** — correct and necessary for freeing up a
  stuck resource, but also destructive to whatever work that session had
  done; it's not a graceful stop, it's closer to pulling the plug.
- **A network-level `tcpkill` is a genuine last resort, not a shortcut.**
  It operates below PostgreSQL entirely, requires root and a separate
  utility, and risks disrupting other traffic on the same interface/port
  range if used carelessly — reach for it only after both in-database
  options have been confirmed (via `pg_stat_activity`) not to have worked.
- **Manually re-querying `pg_stat_activity` after every step is real
  operational overhead** — it's the only way to know whether a cancel or
  terminate actually took effect, since neither function's return value
  (in older PostgreSQL) tells you whether the client is actually gone, only
  whether the signal was sent.
- **Book vs. today: `pg_terminate_backend()` gained an optional `timeout`
  parameter in PostgreSQL 14** (signature became
  `pg_terminate_backend(pid, timeout bigint DEFAULT 0)`). With a positive
  `timeout` (in milliseconds), the function itself blocks until the target
  process actually terminates or the timeout expires — returning `true`
  only if termination was confirmed, `false` (with a warning) on timeout.
  Confirmed via the current official docs. This replaces the recipe's
  manual "run the terminate, then re-run the status query to check" loop
  for the terminate step specifically:
  ```sql
  -- waits up to 5 seconds for confirmed termination instead of a
  -- separate manual re-check
  SELECT pg_terminate_backend(pid, 5000);
  ```
  `pg_cancel_backend()` did not gain an equivalent timeout parameter — its
  signature is unchanged, so the manual re-check the book describes is
  still the only way to confirm a cancel actually stopped a query.
- **Book vs. today: declarative timeouts can prevent needing this recipe
  at all for the "idle in transaction" case.** The book's own "Getting
  ready" section already mentions `idle_in_transaction_session_timeout`
  (added in PostgreSQL 9.6) as a `postgresql.conf` setting that
  automatically kills sessions idle-in-transaction past a threshold — since
  the book, PostgreSQL 14 added a parallel `idle_session_timeout` (for
  connections idle outside any transaction), and PostgreSQL 17 added
  `transaction_timeout`, capping the total duration of a transaction
  (explicit or implicit) regardless of how idle or active it is inside that
  window. Setting these proactively turns much of this manual escalation
  recipe into a rare exception-handling path instead of routine DBA work.

## Documentation Links

- Shaun Thomas, "PostgreSQL 12 High Availability Cookbook", 3rd Edition (Packt, 2020) — Chapter 3, "Minimizing Downtime", recipe "Terminating rogue connections", p. 111-114 — doc
- [PostgreSQL Documentation — System Administration Functions (pg_cancel_backend, pg_terminate_backend)](https://www.postgresql.org/docs/current/functions-admin.html) — doc
- [PostgreSQL Documentation — The Cumulative Statistics System (pg_stat_activity)](https://www.postgresql.org/docs/current/monitoring-stats.html) — doc
- [PostgreSQL Documentation — Resource Consumption (statement_timeout, idle_in_transaction_session_timeout, idle_session_timeout, transaction_timeout)](https://www.postgresql.org/docs/current/runtime-config-client.html) — doc
