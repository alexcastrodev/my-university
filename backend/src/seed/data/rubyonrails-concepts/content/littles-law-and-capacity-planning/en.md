---
version: 1.0
updatedAt: 2026-08-18
---
## Objective

Capacity planning for a Rails fleet is not a guess — it's one equation from
queueing theory. **Little's Law** says the number of app instances you need is
the arrival rate multiplied by the average response time:

```
instances_needed = arrival_rate × average_response_time
```

Everything else in scaling follows from it: what "utilization" actually means,
why running at 100% of theoretical capacity is a symptom of chronic overload
rather than efficiency, why one pathologically slow endpoint corrupts the math
for the *entire* fleet, and why the only honest signal to add instances is
**queue time**, not response time.

## Use Cases

- Deciding how many web instances (dynos, pods, containers) a given traffic
  level actually requires, instead of scaling by feel after an incident.
- Picking a target utilization: how much headroom to buy against traffic spikes,
  and what that headroom costs.
- Deciding whether a slow endpoint is "just slow" or is actively contaminating
  the scaling math for every other endpoint sharing the same instances.
- Sizing a background worker fleet — where the same law applies, but the input
  is queue depth rather than job duration.
- Reading a "queue time" chart in an APM correctly, including knowing what that
  metric can and cannot see.

## Deep Dive

### The law, and what "utilization" means

Arrival rate and response time must be in matching units. At 100 requests per
second with an average response time of 100 ms (0.1 s):

```
instances_needed = 100 req/s × 0.1 s = 10 concurrent request slots
```

That "10" is the *theoretical minimum* — the number of slots that would be busy
100% of the time if requests arrived perfectly evenly. **Utilization** is how
much of your provisioned capacity that minimum consumes. Run 10 slots and you
are at 100% utilization; run 200 slots and you are at 5%.

The book cites three real fleets to anchor the range:

```
Twitter (2007)  ~100%  — chronic overload; the Fail Whale era
Shopify           ~5%  — deliberately, expensively over-provisioned
Envato           ~37%  — cited as a good balance
```

### Why 100% utilization is a failure mode, not a win

Little's Law describes a *long-term average*. Real traffic does not arrive
evenly — it arrives in bursts, and response times have a long tail. At 100%
utilization there is zero slack to absorb either. The moment arrival rate
exceeds the average even briefly, requests have nowhere to go but a queue, and
because the servers are already saturated the queue never gets a chance to
drain. Queueing grows without bound until traffic drops — which is exactly what
"the site is down" looks like from the outside.

At the other extreme, 5% utilization means 95% of the money spent on instances
buys nothing except insurance against the tail. That is a legitimate, deliberate
purchase (Shopify buys it on purpose for flash-sale spikes), but it *is* a
purchase. Somewhere around a third of capacity in use is the usual sweet spot:
enough headroom that a burst queues briefly and then drains, without paying for
twenty times the steady-state need.

### The 4:1 rule: keeping the response-time distribution uniform

Little's Law uses a single *average* response time for the whole app, then you
scale instance count for the whole fleet. That only works if response times are
roughly uniformly distributed. Two rules of thumb keep them that way:

```
per endpoint:   p95 ≤ 4 × that same endpoint's own mean
across the app: no endpoint's mean > 4 × the application's overall mean
```

An endpoint outside either bound contaminates the shared scaling math. If the
app-wide mean is 100 ms but one report endpoint averages 2 s, the instances that
happen to pick up report requests are occupied 20x longer than the average
assumes — so the fleet-wide "instances_needed" number under-counts real
occupancy, and requests for *unrelated, fast* endpoints queue behind the slow
one. The fix is not more instances; it's either making that endpoint fast, or
moving it off the shared fleet (a separate instance pool, or a background job)
so its response-time distribution stops polluting everyone else's.

### Background workers: size by queue depth, not job duration

The same law governs Sidekiq/Resque/Solid Queue fleets, but the useful input
changes. Job durations vary by orders of magnitude across queues, so an average
job time is close to meaningless. **Queue depth** — the backlog, and whether it
is growing or draining — is the direct observable. A depth that trends toward
zero between bursts means the fleet is correctly sized; a depth that ratchets
upward across a day means arrival rate exceeds the fleet's service rate and you
need more workers (or faster jobs), regardless of how quick any individual job
looks in the dashboard.

### How a request actually reaches a dyno

The routing story matters because it determines where queueing physically
happens — and therefore what your metrics can see:

```
client
  → load balancer (SSL termination)
  → one of 100+ INDEPENDENT routers, each with its own queue
                 (no coordination between them)
  → RANDOM selection of a web dyno (not "smart"/least-busy routing)
  → up to ~5s waiting for a connection to that dyno
  → the socket backlog ON the dyno
  → an app server worker finally picks it up
```

Random routing is the crux: a router does not know or care that the dyno it
picked is already busy. With few dynos, an unlucky random assignment parks a
request behind a slow one while other dynos sit idle — which is why response
time variability (the 4:1 rule above) hurts far more here than the average
alone would suggest.

### The queue-time metric, and why it was once simply wrong

Today's "queue time" in an APM (New Relic and friends) is computed from the
`REQUEST_START` header the router stamps on the way in: the app subtracts that
timestamp from its own clock when it starts processing. That is a **wall-clock
diff between two different machines**, so it is inherently imprecise at
millisecond resolution — treat single-digit-millisecond readings as noise.

Historically it was worse than imprecise, it was *wrong*. The 2013 RapGenius
incident made this public: the metric at the time only accounted for queueing on
the **router** side and was blind to the queue that actually mattered — requests
sitting in the **socket backlog on the dyno itself**, waiting for a free app
server worker. Teams read a flat, healthy queue-time chart while their real
queueing was invisible, and concluded their capacity was fine when it wasn't.

### The only honest trigger for scaling up

```
queue time is a small fraction of average response time  →  don't scale
queue time > ~5-10ms relative to average response time   →  add instances
```

Below that threshold the fleet has capacity and adding instances is money spent
for nothing. Above it, requests are genuinely waiting for a free worker and more
instances directly reduce that wait.

The complementary point is just as important: **a bigger instance does not make
a single request faster.** Doubling a dyno's size (or a container's CPU/RAM)
lets it hold more workers, which reduces *queue wait*. The code path itself
takes the same time it always did. If your problem is a 2 s controller action
with no queueing behind it, no amount of capacity fixes it — that's an
optimization problem, not a scaling problem.

## Trade-offs

- **Utilization is a direct trade between cost and safety against variance** —
  Shopify's ~5% is not incompetence, it's insurance bought deliberately for
  flash-sale traffic; Twitter's ~100% was not efficiency, it was the shape of an
  outage waiting for a burst. Around a third is the usual balance, but the right
  number depends on how spiky your arrival rate genuinely is.
- **Isolating a slow endpoint onto its own instance pool fixes the contaminated
  scaling math but doubles the fleets you must size, deploy, and monitor** — the
  cheaper first move is usually to make the endpoint fit inside the 4:1 bound, or
  push its work into a background job, and only split the pool when it can't be
  made fast.
- **Scaling instances and optimizing response time are both valid levers on the
  same equation, and queue time is what tells you which one you're actually
  short on** — but reading that signal means trusting a wall-clock diff between
  machines, so build the decision on a sustained trend, never on one noisy
  millisecond-scale reading.
- **Sizing workers by queue depth reacts to the real backlog but is a lagging
  signal** — by the time depth is visibly growing, latency-sensitive jobs in that
  queue are already late, which is the argument for separate queues per latency
  class rather than one deep queue sized by its average.

## Documentation Links

- [Heroku Dev Center — HTTP Routing (random routing, per-router request queues)](https://devcenter.heroku.com/articles/http-routing) — doc
- [Speedshop — Scaling Ruby Apps to 1000 Requests per Minute (Little's Law in practice)](https://www.speedshop.co/blog/scaling-ruby-apps-to-1000-rpm/) — doc
- [The Complete Guide to Rails Performance — Little's Law and Capacity Planning](https://pragprog.com/titles/nragilperf/the-complete-guide-to-rails-performance/) — doc
