---
version: 1.0
updatedAt: 2026-08-17
---
## Objective

Every Ruby application server makes a trade-off along one axis: does it protect
the app from a **slow client** (a request that trickles in bytes slowly), does it
protect against a **slow app** (a request whose own code takes a long time), or
both? Webrick and Thin cover only one side each; Unicorn covers "slow app" but
needs a buffering reverse proxy in front of it to cover "slow client"; Puma
(clustered) and Phusion Passenger are the only two that handle both on their own
— which is why they're the default choice for most production Rails deployments
today.

## Use Cases

- Choosing between Puma and Unicorn for a new deployment, and knowing *why*
  Unicorn requires NGINX (or an equivalent buffering proxy) in front of it in
  production, never exposed directly.
- Sizing the number of worker processes and threads per process for a given
  amount of available RAM and CPU.
- Diagnosing "queue time" in an APM: recognizing that a growing queue means the
  app needs more capacity (or the fleet is undersized), not that a single
  request needs to be individually faster.
- Deciding whether a spike in response time is caused by the app itself or by
  requests queuing up waiting for a free worker.

## Deep Dive

### The two threats: slow client, slow app

A "slow client" is a request that takes a long time to *send* — a mobile user on
a bad connection uploading a large form, or worse, a client deliberately holding
a connection open (a basic denial-of-service vector). A "slow app" is a request
that arrives instantly but takes the server a long time to *process* — a
expensive query, an N+1, a slow third-party API call.

```
Webrick     — single process, blocks fully on either threat. Never use in production.
Thin        — single process, evented (EventMachine). Protects against slow clients;
              does NOT protect against a slow app without manually using the reactor.
Unicorn     — multi-process, workers listen directly on a shared socket. Protects
              against a slow app (other free workers keep accepting requests) but a
              slow client can pin a worker while it trickles in bytes — MUST run
              behind a buffering reverse proxy (NGINX) that shields it from clients.
Puma        — threaded, evented reactor. The reactor protects against slow clients;
  (clustered)  clustered mode (multiple worker processes, each multi-threaded) adds
              protection against a slow app the same way Unicorn does.
Passenger 5 — combines a buffering proxy and multiple processes internally, so it
              handles both threats without needing anything else in front of it.
```

### Why Unicorn needs NGINX in front of it

```
Client (slow upload) ---> Unicorn worker
```

Without a buffering proxy, a Unicorn worker stays occupied for the entire time it
takes the client to finish sending the request — even though the app code hasn't
started running yet. With NGINX (or an equivalent) in front:

```
Client (slow upload) ---> NGINX (buffers the full request) ---> Unicorn worker
```

NGINX absorbs the slow-upload cost itself and only hands the worker a
fully-buffered request, so the worker is occupied only for the time it takes to
actually run the app code — which is the one threat (slow *app*) Unicorn's
multi-process model was built to isolate.

### Sizing processes and threads

```
processes ≈ available_RAM / (RAM_per_process × 1.2)
          cross-checked against ~1.25–1.5 × available hyperthreads
```

Measure `RAM_per_process` only after the process has been running 12–24h without
a restart — a freshly-booted Ruby process is typically 2–3x smaller than its
steady-state memory footprint, so sizing off a cold boot undercounts real usage.
On MRI, threads stop paying off past roughly 5 threads per process for typical
web workloads, because the GVL means only one thread executes Ruby bytecode at a
time (see the GVL & Concurrency concept) — more threads help concurrency for
I/O-bound request handling, but not indefinitely.

## Trade-offs

- **Unicorn "naked" (no reverse proxy in front) is a real production
  misconfiguration, not a minor omission** — it leaves every worker vulnerable to
  being pinned by a single slow client, effectively capping the server's
  concurrency at whatever fraction of workers a handful of slow clients can tie
  up.
- **More processes trade memory for isolation and slow-app protection; more
  threads trade nothing for I/O concurrency but hit a hard ceiling from the GVL
  on CPU-bound work** — the right mix depends on whether the app's typical
  request is I/O-bound (favor threads) or has real CPU-bound segments (favor
  processes).
- **Scaling the number of server instances only helps once queue time is
  actually elevated** (rule of thumb: >5–10ms relative to average response
  time) — scaling before that point spends money without making any individual
  request faster, since the bottleneck isn't capacity yet.

## Documentation Links

- [Puma — GitHub (README, concurrency model)](https://github.com/puma/puma) — doc
- [The Complete Guide to Rails Performance — Webservers and I/O models](https://pragprog.com/titles/nragilperf/the-complete-guide-to-rails-performance/) — doc
