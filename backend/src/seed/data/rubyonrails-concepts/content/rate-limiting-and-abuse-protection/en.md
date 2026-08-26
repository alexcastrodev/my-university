---
version: 1.0
updatedAt: 2026-08-21
---
## Objective

`rack-attack` ships with a one-line install and a config file that looks
finished the moment it boots — and that's exactly the trap. The default cache
store on a multi-process Puma deployment (2 workers, say) is per-process
memory, so a `throttle` of "5 requests/second" is silently enforcing "10
requests/second" against the actual client, split invisibly across whichever
worker each request happens to land on. Nobody sees an error; the throttle
just doesn't throttle. This concept is about the handful of concrete facts —
the shared-cache-store requirement, the window algorithm, and where blocking
by IP goes wrong — that separate a rack-attack config that *looks* correct
from one that actually holds under real traffic and real attackers.

## Use Cases

- Adding your first `throttle` or `blocklist` to a Rails API and deciding
  whether to key it on IP, API key, or account — the choice determines
  whether a shared office or carrier NAT gets collectively rate-limited by
  one bad actor.
- Debugging "our rate limit doesn't seem to be working" in production, where
  the answer turns out to be `ActiveSupport::Cache::MemoryStore` running
  per-Puma-worker instead of a shared Redis/Memcached instance.
- Deciding how to respond to a throttled request — plain 429, or a `429` with
  `Retry-After` and `RateLimit-*` headers so well-behaved clients back off
  correctly instead of retrying immediately.
- Reviewing a security report of "rate limiting is trivially bypassed" and
  checking whether it's exploiting the fixed-window boundary (2x burst) or
  a shared-NAT false positive being worked around with distinct API keys.
- Choosing where in the stack abuse protection belongs — ahead of
  authentication and authorization, as Rack middleware, rather than inside a
  controller `before_action` that only runs after Rails has already parsed
  the request.

## Deep Dive

### `rack-attack` as Rack middleware, ahead of the Rails app

`rack-attack` runs as Rack middleware, not as Rails application code — for a
Rails app it's included and enabled automatically once the gem is in the
Gemfile, sitting in the middleware stack (see `bin/rails middleware`,
covered for the full stack in
[Reducing Per-Request Framework Overhead](reducing-per-request-framework-overhead.md))
ahead of `ActionDispatch::Executor` and everything downstream, including
routing, controller `before_action` chains, and any Pundit/CanCanCan
`authorize` call:

```ruby
# Gemfile
gem "rack-attack", "~> 6.8"
```

```ruby
# config/initializers/rack_attack.rb
# For Rack (non-Rails) apps you'd need: require "rack/attack"; use Rack::Attack
# Rails apps get this wired in automatically once the gem is present.
```

That ordering is the point: a request rack-attack blocks or throttles never
reaches [authorization](authorization-mass-assignment-and-encryption.md) at
all — it never instantiates a Pundit policy, never touches `current_user`,
never runs a single line of your controller. Abuse protection at this layer
is deliberately dumber and earlier than authorization: it doesn't know who
the user is yet, only what the raw request looks like (IP, path, headers,
params). By default rack-attack blocks and throttles nothing — every rule
below is opt-in, declared in `config/initializers/rack_attack.rb`.

### The DSL: `throttle`, `blocklist`, `safelist`, `track`

Four declarations, checked in a fixed precedence order: safelist first (an
unconditional allow that skips everything else), then blocklist, then
throttle, then track (which never blocks — it only observes and instruments).

**`safelist`** — always allow, regardless of any blocklist or throttle match:

```ruby
Rack::Attack.safelist("allow from localhost") do |req|
  "127.0.0.1" == req.ip || "::1" == req.ip
end
```

**`blocklist`** — unconditional block, evaluated as a boolean per request:

```ruby
Rack::Attack.blocklist("block known bad UA") do |req|
  req.user_agent == "BadBot/1.0"
end
```

**A per-API-key throttle**, the shape you want for an authenticated API —
discriminator is the key itself, so each caller gets its own independent
counter:

```ruby
Rack::Attack.throttle("api requests by key", limit: 100, period: 60) do |req|
  req.env["HTTP_X_API_KEY"] if req.path.start_with?("/api/")
end
```

**A per-IP throttle**, the fallback for unauthenticated endpoints (signup,
login, password reset) where there's no API key yet to key on:

```ruby
Rack::Attack.throttle("logins by ip", limit: 5, period: 20) do |req|
  req.ip if req.path == "/login" && req.post?
end
```

The block returns the **discriminator** — whatever value rack-attack should
count requests per. Returning `nil` (as both examples do implicitly for
non-matching paths) means "don't count this request against this throttle at
all," which is how you scope a throttle to specific routes without a
separate `blocklist` guard. `limit` and `period` both also accept a `proc`,
which is how the README's own example gives an authenticated admin a higher
limit than an anonymous user from inside the same throttle block.

**`track`** — pure observation, no blocking, useful for measuring a pattern
before deciding whether it deserves a throttle:

```ruby
Rack::Attack.track("scraper-looking requests") do |req|
  req.user_agent&.include?("HeadlessChrome")
end
```

`Fail2Ban.filter` and `Allow2Ban.filter` are two ready-made patterns built on
top of `blocklist` for "N failures in a window bans for a cooldown period"
(Fail2Ban: count bad requests, ban past a threshold) and its inverse
(Allow2Ban: allow until a threshold, then ban) — both still just call into
the same shared cache underneath.

### The cache store: the single most common rack-attack misconfiguration

Every `throttle`, `Fail2Ban`, and `Allow2Ban` counter is stored in
`Rack::Attack.cache`, which defaults to `Rails.cache` if Rails is present.
That default is the trap: **if `Rails.cache` is `ActiveSupport::Cache::MemoryStore`
(the Rails default in `development`, and sometimes left unchanged in
`production` on a small app), every Puma worker process counts independently**.
A `throttle` of `limit: 5, period: 20` on a 4-worker Puma cluster doesn't
enforce "5 requests per 20 seconds" — it enforces up to "20 requests per 20
seconds," silently, because each worker's in-memory counter never sees the
requests the other three workers counted. Nothing raises an error; the
throttle just quietly under-counts, and the failure mode is invisible until
someone points a real burst at the endpoint.

The fix — point the cache explicitly at a store shared across every process
and every instance:

```ruby
# config/initializers/rack_attack.rb
Rack::Attack.cache.store = ActiveSupport::Cache::RedisCacheStore.new(url: ENV["REDIS_URL"])
```

Per rack-attack's own README, the store only needs to implement `increment`
and `write` the way `ActiveSupport::Cache::Store` does, so any
`ActiveSupport::Cache::Store` subclass qualifies — Redis and Memcached are
the two the README calls out explicitly, and it explicitly recommends a
**separate database/instance from your general-purpose cache**, so a spike in
throttle traffic during an actual attack doesn't also degrade unrelated
application caching.

Rails 8's `Solid Cache` (covered in
[Solid Queue, Cache, and Cable](solid-queue-cache-and-cable.md)) technically
satisfies the same interface — it's `ActiveSupport::Cache::Store`-backed — so
it will *work*. But it's backed by a database table
(`solid_cache_entries`), not memory, and a throttle counter does an
`increment` write on every single matched request. The traffic pattern that
makes rate limiting matter — a burst or an attack — is exactly the traffic
pattern that turns that into a burst of database writes at the moment your
database is least able to absorb extra load. Redis/Memcached remain the
better fit specifically for this workload; Solid Cache's write-amplification
trade-off is a good one for general application caching, not for a
counter that gets hit on every request to a hot endpoint.

### Window strategy: fixed window, not sliding

rack-attack's counting is a **fixed window**, confirmed directly in its
source (`Rack::Attack::Cache#key_and_expiry`): the cache key embeds
`epoch_time / period`, bucketing every request into a window aligned to
wall-clock time (e.g., with `period: 60`, every request between `:00` and
`:59` of a minute shares one counter, and the counter resets to zero at the
next minute boundary) rather than tracking a rolling N-second lookback from
each request.

That has a concrete, exploitable consequence: a client can send `limit`
requests in the last instant of one window and another `limit` requests in
the first instant of the next window, getting **up to 2x the configured
limit** in a short real-world span that straddles the boundary — with
`limit: 100, period: 60`, up to 200 requests in a couple of seconds, split
across the `:59.9` mark. It's a real gap, but a bounded one: at most a single
extra burst per boundary crossing, not an unlimited bypass, and rack-attack's
own documentation is explicit that the primary goal is blunting sustained
abuse, not providing an exact rolling-window guarantee — for stricter
precision, a sliding-window algorithm implemented in your own `throttle`
block (against the same shared cache) is the documented escape hatch, not a
built-in mode.

### Response handling: 429, `Retry-After`, and customizing the responder

A throttled request gets a `429 Too Many Requests` by default; a blocklisted
request gets `403 Forbidden` by default. Both are overridable:

```ruby
Rack::Attack.throttled_responder = lambda do |request|
  match_data = request.env["rack.attack.match_data"]
  now = match_data[:epoch_time]

  headers = {
    "Content-Type"        => "application/json",
    "RateLimit-Limit"     => match_data[:limit].to_s,
    "RateLimit-Remaining" => "0",
    "RateLimit-Reset"     => (now + (match_data[:period] - now % match_data[:period])).to_s
  }

  [429, headers, [{ error: "rate_limited" }.to_json]]
end
```

`request.env["rack.attack.match_data"]` carries `:discriminator`, `:count`,
`:period`, `:limit`, and `:epoch_time` — everything needed to tell the
caller exactly how long to wait, rather than making them guess-and-retry.
For the common case of just wanting a standard `Retry-After` header without
writing a custom responder:

```ruby
Rack::Attack.throttled_response_retry_after_header = true
```

`blocklisted_responder` is the equivalent override for blocked requests, and
the README notes a real reason to reach for it: returning `503` instead of
the default `403` for a blocklisted request can make an attacker believe
they've successfully knocked the service offline rather than that they've
been identified and blocked, which is sometimes preferable to confirming
detection.

## Trade-offs

- **IP-based blocking behind shared NAT is a false-positive machine.** A
  `blocklist_ip` or per-IP `throttle` scoped too tightly treats "one IP
  address" as "one user," which is false for anyone behind a corporate
  proxy, a university network, a mobile carrier's CGNAT, or a shared VPN
  exit node. Blocking one abusive actor on that IP locks out every other
  person who happens to share it — potentially an entire office or a slice
  of a carrier's subscriber base — none of whom did anything wrong:
  ```ruby
  # Looks reasonable, silently punishes everyone behind req.ip:
  Rack::Attack.blocklist("ban abusive ip") do |req|
    Rack::Attack::Fail2Ban.filter(req.ip, maxretry: 3, findtime: 1.minute, bantime: 1.hour) do
      req.path == "/login" && req.post? && invalid_login?(req)
    end
  end
  ```
  For an authenticated API, throttling per API key or per account (as in the
  Deep Dive's first throttle) doesn't have this failure mode at all — it
  isolates each caller's own credential, so one caller's abuse can't spill
  onto a stranger who happens to share their network. Per-IP throttling is
  the necessary fallback only for the pre-authentication surface (login,
  signup, password reset) where there's no account yet to key on.
- **Fixed-window counting under-protects right at the boundary.** As shown
  above, a determined client can extract roughly 2x the configured limit by
  timing requests around the window edge. This is a known, bounded property
  of the algorithm, not a bug — but a `throttle` sized as if it were an exact
  rolling limit will be surprised by it under adversarial traffic.
- **A shared cache store is a new single point of contention, and possibly
  failure.** Pointing rack-attack at Redis/Memcached means every throttled
  request now costs a network round trip to that store; the README's own
  performance note calls this out and recommends keeping the number of
  throttle checks per request low. It also means an outage or latency spike
  in that store now affects request handling on every route a throttle
  covers, not just the ones under attack — this is the argument for the
  README's advice to give rack-attack its own dedicated database/instance
  rather than sharing your application's general-purpose cache.
- **Safelisting overrides everything, including a throttle you meant to
  enforce.** A `safelist` block that's too broad (e.g., trusting a header a
  client can set themselves, like an unauthenticated `X-Internal: true`)
  doesn't just fail to block — it bypasses every blocklist and throttle in
  the app for any request that matches it, silently and completely.
- **`track` never blocks, so a `track`-only deployment gives a false sense of
  protection.** It's easy to ship a `track` for a suspicious pattern, watch
  the metrics, and forget that nothing is actually stopping the traffic —
  observation is not enforcement, and the two are easy to conflate at a
  glance in the initializer.

## Documentation Links

- [rack-attack — GitHub](https://github.com/rack/rack-attack) — doc
- [rack-attack — Advanced Configuration](https://github.com/rack/rack-attack/blob/main/docs/advanced_configuration.md) — doc
- [rack-attack — Example Configuration](https://github.com/rack/rack-attack/blob/main/docs/example_configuration.md) — doc
