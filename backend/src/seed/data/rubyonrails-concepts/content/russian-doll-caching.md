---
version: 1.0
updatedAt: 2026-08-17
---
## Objective

Russian Doll caching is Rails' key-based expiration strategy for fragment
caching: instead of manually expiring a cache entry when the underlying data
changes (observers, sweepers, explicit `expire_fragment` calls), every cache key
embeds enough information — the record's class, id, and `updated_at` — that a
change to the data produces a brand-new key automatically. The old entry is never
explicitly deleted; it just becomes unreachable and eventually gets evicted by
the cache store's own LRU policy. This only works end-to-end if every fragment,
including ones that wrap collections, includes the right data in its own key —
and it only performs well if the underlying cache store is actually fast, which
isn't automatic.

## Use Cases

- Caching a view fragment for a single record (a comment, a product page) so it
  never needs manual invalidation when the record is edited.
- Caching a fragment that wraps a *collection* of records (a comments list, a
  product grid) where any single item changing should invalidate the outer
  fragment too.
- Choosing a cache store (`MemoryStore`, `FileStore`, `Dalli`/`redis-cache-store`)
  based on actual measured latency, not on which one is the Rails default.
- Recognizing when caching a fragment is actually *slower* than not caching it at
  all, for content that's cheap to render and backed by a remote cache store.

## Deep Dive

### The key-based expiration mechanism

```erb
<% cache comment do %>
  <%= comment.body %>
<% end %>
```

`cache comment` builds a key that embeds the class name, id, and `updated_at` of
`comment` (plus a digest of the template itself). Editing the comment changes its
`updated_at`, which changes the key, which means the view fragment is rendered
fresh and stored under a *new* key — the old entry is simply never looked up
again. No explicit invalidation code is ever written.

### Nested fragments need the outer key to know about the inner collection

```erb
<% cache product do %>
  <% cache [product, product.reviews.maximum(:updated_at)] do %>
    <% product.reviews.each do |review| %>
      <% cache review do %>
        <%= review.body %>
      <% end %>
    <% end %>
  <% end %>
<% end %>
```

If the *outer* `product` fragment's key only depended on `product`'s own
`updated_at`, editing a single review wouldn't change the product's own
`updated_at` — so the outer fragment would keep serving a stale cached page even
though the correctly-keyed inner `review` fragment updated on its own. Including
`product.reviews.maximum(:updated_at)` in the outer key means any review edit
changes the outer key too.

### `touch: true` propagates invalidation up the association chain for free

```ruby
class Review < ApplicationRecord
  belongs_to :product, touch: true
end
```

Saving a `Review` now also updates its `product.updated_at` automatically. Any
fragment cached with `cache product` picks up that new key without the nested-key
gymnastics above — `touch: true` is the more elegant fix for exactly this
invalidation-propagation problem, wherever the association allows it.

### Cache store latency dominates the decision

Order-of-magnitude, `fetch` operations per second, fastest to slowest:
`LruRedux` (in-process) > `MemoryStore` > `FileStore` > local Dalli/Redis > a
**remote** Redis/Memcache over the network, which can be roughly four orders of
magnitude slower than an in-process cache. A fragment that costs a few
milliseconds to render can render *faster uncached* than the round-trip to a
remote cache store costs — caching only pays off when the render cost genuinely
exceeds the cache store's own latency.

## Trade-offs

- **`FileStore` (the Rails default in some setups) is not LRU** — it expires
  entries by write time, not by access frequency, so a frequently-hit key can be
  evicted before a key nobody reads anymore. It also performs badly on platforms
  with ephemeral or networked filesystems.
- **A remote cache store can make a cheap-to-render fragment slower than no
  caching at all** — before wrapping something in `cache do...end`, it's worth
  knowing (measuring, not assuming) both the render cost and the cache store's
  real round-trip latency.
- **Nested Russian Doll caching adds real authoring overhead**: every level that
  wraps a collection needs its key deliberately extended with that collection's
  max `updated_at` (or the association needs `touch: true`) — skipping this for
  just one nested level silently reintroduces stale content at that level, with
  no error to signal it happened.

## Documentation Links

- [Caching with Rails — Rails Guides](https://guides.rubyonrails.org/caching_with_rails.html) — doc
- [ActiveSupport::Cache::Store — Rails API docs](https://api.rubyonrails.org/classes/ActiveSupport/Cache/Store.html) — doc
- [The Complete Guide to Rails Performance — Caching in Rails](https://pragprog.com/titles/nragilperf/the-complete-guide-to-rails-performance/) — doc
