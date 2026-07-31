---
title: Caching Strategies and CDNs
description: The handful of caching patterns — cache-aside, write-through, write-behind — that cover most interview and production scenarios, plus what a CDN adds on top of an in-datacenter cache.
difficulty: Intermediate
readingTime: 8
tags:
  - Caching
  - Performance
  - CDN
  - Scalability
prerequisites:
  - HTTP request/response basics
  - Database read/write basics
related:
  - Consistent Hashing
  - Read/Write Splitting and CQRS-Lite
  - CAP Theorem
---

## Overview

A cache trades a small amount of staleness risk for a large amount of latency and database-load reduction: instead of every read hitting the primary data store, a fast, usually in-memory layer answers most requests, and only a fraction fall through to the source of truth. Almost every caching decision in an interview or in production is a choice between a handful of well-known patterns — cache-aside, write-through, write-behind — plus the question of how you invalidate a cached value once the underlying data changes, which is reliably the hard part.

## Cache-Aside (Lazy Loading)

The application, not the cache, is responsible for populating the cache on a miss:

```python
def get_user(user_id):
    user = cache.get(f"user:{user_id}")
    if user is not None:
        return user                      # cache hit
    user = db.query("SELECT * FROM users WHERE id = %s", user_id)
    cache.set(f"user:{user_id}", user, ttl=300)
    return user                          # cache miss, now populated
```

This is the default pattern for read-heavy data: the cache only ever holds what's actually been requested (no wasted memory on cold data), and a cache outage degrades to "every read hits the database" rather than losing data — the database is still the source of truth and nothing was ever written cache-first.

## Write-Through and Write-Behind

**Write-through** writes to the cache and the database synchronously, as one logical operation, so the cache is never stale after a write it participated in:

```python
def update_user(user_id, data):
    db.execute("UPDATE users SET ... WHERE id = %s", user_id)
    cache.set(f"user:{user_id}", data, ttl=300)   # same request, before returning
```

**Write-behind (write-back)** acknowledges the write after updating only the cache, and flushes to the database asynchronously in batches:

```python
def update_user(user_id, data):
    cache.set(f"user:{user_id}", data, ttl=300)
    write_queue.enqueue(("users", user_id, data))  # flushed to DB by a background worker
    return  # caller sees success before the DB write has happened
```

Write-behind is the lowest-latency write path of the three, and batches many writes into fewer database round trips — at the cost of a real durability gap: if the cache node dies before the queued write reaches the database, that update is gone. It shows up in workloads that can tolerate that (metrics counters, view counts) and rarely in anything resembling money.

## Invalidation: The Hard Part

Phil Karlton's line — "there are only two hard things in computer science: cache invalidation and naming things" — is a cliché precisely because it's accurate. Three practical approaches:

- **TTL (time-to-live) expiry** — the simplest and most common: every cached value expires after N seconds regardless of whether the underlying data actually changed. Bounds staleness to a known window with zero coordination, at the cost of guaranteed staleness for up to that window even when nothing changed.
- **Explicit invalidation on write** — the write path deletes or updates the cache key at the same time it writes the database (this is write-through's invalidation-only cousin: `cache.delete(key)` instead of `cache.set(key, ...)`). Precise, but only as complete as every write path that's been updated to remember to do it — a write path added later that forgets to invalidate is a silent, hard-to-notice bug.
- **Event-driven invalidation** — a change-data-capture stream or message off the database (see the outbox pattern) triggers cache invalidation as a side effect of the write, decoupling "remember to invalidate" from every individual write call site. More moving parts, but immune to the "someone added a new write path and forgot" failure mode above.

## CDN: Caching at the Edge

A CDN (Content Delivery Network) is the same idea — serve from a fast layer instead of the origin — applied geographically: dozens to hundreds of edge locations cache responses physically close to end users, so a request from Tokyo doesn't round-trip to an origin server in Virginia on every hit. `Cache-Control` and `ETag`/`Last-Modified` response headers tell the CDN (and browsers) how long a response is fresh and how to validate it cheaply once it expires:

```
Cache-Control: public, max-age=86400, stale-while-revalidate=3600
ETag: "33a64df551425fcc55e4d42a148795d9f25f89d"
```

`stale-while-revalidate` lets the CDN serve the (now-expired) cached copy immediately while it fetches a fresh one in the background — trading a bounded amount of extra staleness for zero added latency on the request that happens to trigger revalidation. CDNs are a natural fit for static assets (images, JS bundles) and increasingly for personalized-but-cacheable API responses via edge compute (Cloudflare Workers, Lambda@Edge) that vary the cache key per user or region instead of caching one global response.

## Cache Stampede / Thundering Herd

When a hot key expires, every concurrent request for it misses at the same instant and falls through to the database simultaneously — a stampede that can take down the very database the cache exists to protect, precisely at the moment a popular item's TTL lapses:

```python
def get_user(user_id):
    key = f"user:{user_id}"
    user = cache.get(key)
    if user is not None:
        return user
    lock = cache.acquire_lock(f"lock:{key}", ttl=5)
    if lock:
        user = db.query(...)
        cache.set(key, user, ttl=300)
        cache.release_lock(f"lock:{key}")
        return user
    else:
        time.sleep(0.05)             # someone else is already refilling this key
        return get_user(user_id)     # retry, likely hits the now-warm cache
```

A short-lived lock per key ensures only one request repopulates a given key on expiry while the rest wait briefly and then hit the now-warm cache, instead of all of them hitting the database. `stale-while-revalidate` (above) and randomized "jittered" TTLs (so a batch of keys set at the same time don't all expire in the same instant) are the other two standard mitigations, often used together.

## Trade-offs

- **Cache-aside leaves a race window on concurrent writes and reads** — a read that misses, then a concurrent write, then the read's stale fetch finishing and overwriting the cache with old data, is a real (if narrow) inconsistency window that write-through avoids by construction.
- **Write-through adds latency to every write, not just cache misses** — every write now pays for two synchronous operations (DB + cache) instead of one, which is the direct cost of never letting the cache go stale after its own writes.
- **A longer TTL means less database load but a wider staleness window** — this single number is usually the most consequential caching decision in a system, and the right value is a property of the data's actual staleness tolerance, not a default worth copying from another service.

## Interview Questions

- Walk through what happens on a cache miss under cache-aside versus write-through.
- What's the actual durability risk of write-behind caching, and what kind of data is it acceptable for?
- Why is TTL-based invalidation both the simplest and the least precise of the invalidation strategies?
- What causes a cache stampede, and name two independent mitigations for it.
- What does a CDN add on top of an application-level cache that isn't just "the same thing, farther away"?

## References

- [MDN — HTTP Caching](https://developer.mozilla.org/en-US/docs/Web/HTTP/Caching)
- Rajesh Nishtala et al., ["Scaling Memcache at Facebook"](https://www.usenix.org/conference/nsdi13/technical-sessions/presentation/nishtala) (NSDI 2013)
- [AWS — Caching Best Practices](https://aws.amazon.com/caching/best-practices/)
- [Cloudflare Learning Center — What is a CDN?](https://www.cloudflare.com/learning/cdn/what-is-a-cdn/)
