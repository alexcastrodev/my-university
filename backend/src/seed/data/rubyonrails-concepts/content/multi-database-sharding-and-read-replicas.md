---
version: 1.0
updatedAt: 2026-08-21
---
## Objective

A single Postgres primary can absorb a surprising amount of read traffic before
it becomes the bottleneck — a reporting dashboard, an analytics export, or a
handful of noisy `COUNT(*)` scopes running alongside normal OLTP writes usually
shows up as replica-shaped pain before it shows up as sharding-shaped pain. Rails
6 added first-class support for exactly this progression: point some models at a
read replica with a couple of `database.yml` entries and a `connects_to` call,
and the framework's own middleware will route reads to the replica automatically.
Sharding is the next, much bigger step, and it's easy to reach for before you
need it: it turns "one database" into "N databases with no foreign keys or joins
between them," and there is no config flag that gives that back. The tell that
you've outgrown a replica and actually need shards is write throughput or
storage on the *primary* — a replica does nothing for that, because every write
still goes through one machine.

## Use Cases

- Offloading reporting, analytics, and admin-dashboard queries onto a replica so
  they stop competing with OLTP writes for the primary's CPU and I/O.
- Deciding whether "add a replica" is enough, or whether write volume/storage on
  the primary itself is the actual constraint, which only sharding addresses.
- Wiring a background job or an API endpoint to explicitly read from the primary
  right after it writes, instead of trusting Rails' default staleness window.
- Building a multi-tenant SaaS where a customer's data needs to live on a
  specific shard — for data-residency, noisy-neighbor isolation, or so a single
  huge tenant doesn't degrade every other tenant sharing infrastructure.
- Auditing what breaks when a `has_many :through` or a report query needs to
  join across two shards, and deciding whether to fan the query out in the app
  instead.
- Running migrations across a sharded topology, where "did this ship to
  production" now means "did it ship to every shard."

## Deep Dive

### Multi-database config: `database.yml` and `connects_to`

Rails' three-tier `database.yml` names a primary and a replica per environment,
and the replica config is marked with `replica: true`:

```yaml
# config/database.yml
production:
  primary:
    database: app_production
    username: app
    password: <%= ENV["APP_DB_PASSWORD"] %>
    adapter: postgresql
  primary_replica:
    database: app_production
    username: app_readonly
    password: <%= ENV["APP_REPLICA_PASSWORD"] %>
    adapter: postgresql
    replica: true
```

Two things matter here that are easy to get wrong. First, `primary` and
`primary_replica` point at the **same database name** — they're the same data,
reached through two different connections. Second, the replica's user should
actually be a read-only Postgres role; `replica: true` tells Rails "never run
migrations against this," it doesn't itself enforce read-only access at the
database level. Rails doesn't create or maintain the replication itself —
`primary_replica` has to already be a real Postgres streaming replica (self-managed
or a managed offering like RDS/Cloud SQL read replicas); Rails' job starts at
routing queries to it, not at setting up replication.

Routing is declared once, on an abstract connection class, with `connects_to`:

```ruby
# app/models/application_record.rb
class ApplicationRecord < ActiveRecord::Base
  self.abstract_class = true

  connects_to database: { writing: :primary, reading: :primary_replica }
end
```

Every model that inherits from `ApplicationRecord` now has two connections
available — `:writing` and `:reading` — mapped to the `primary` and
`primary_replica` entries in `database.yml`. Nothing in a model or controller has
to change to pick up the replica; what changes is *which role Rails routes a
given query to*, covered next.

### Automatic read/write splitting and the staleness window

Inside a role, code just runs — `ActiveRecord::Base.connected_to(role: :reading)
{ ... }` sends every query in the block to `primary_replica`, and passing
`prevent_writes: true` makes Rails actually check each statement and raise if
something in that block tries to write:

```ruby
ActiveRecord::Base.connected_to(role: :reading, prevent_writes: true) do
  Report.heavy_aggregate_query
end
```

You rarely have to write that yourself for ordinary web requests, because Rails
ships a middleware that does the routing automatically —
`ActiveRecord::Middleware::DatabaseSelector`, paired with a resolver and a
resolver-context class, wired up via `bin/rails g active_record:multi_db`:

```ruby
# config/initializers/multi_db.rb
Rails.application.configure do
  config.active_record.database_selector = { delay: 2.seconds }
  config.active_record.database_resolver = ActiveRecord::Middleware::DatabaseSelector::Resolver
  config.active_record.database_resolver_context = ActiveRecord::Middleware::DatabaseSelector::Resolver::Session
end
```

The one setting worth understanding precisely is `delay:`, which defaults to
**2 seconds**. The Rails Guide describes the guarantee in exactly these terms:
Rails will send a `GET`/`HEAD` request to the *writer*, not the replica, if it
falls within `delay` after that session last wrote — this is what buys you
"read your own write" without any code change. The hazard it exists to prevent
is concrete and common: a controller creates a record, redirects, and the
following `GET` immediately queries a replica that streaming replication hasn't
caught up to yet — the classic "I just saved this and now it's gone" bug report,
caused by replication lag, not by a real data-loss bug.

That guarantee is heuristic, not a lag measurement. It assumes actual replication
lag stays under 2 seconds; it does not check it. A replica falling behind under
load — a bulk import, a long vacuum, a network blip — can lag past that window,
and the middleware will happily route a request back to the replica believing
it's caught up. And the middleware only covers the request/response cycle for
one session; a Sidekiq job that writes and then needs to read that same row has
no middleware wrapping it at all and has to opt in explicitly:

```ruby
class SendWelcomeEmailJob < ApplicationJob
  def perform(user_id)
    ActiveRecord::Base.connected_to(role: :writing) do
      user = User.find(user_id) # force primary — this job just wrote `user` moments ago
      UserMailer.welcome(user).deliver_now
    end
  end
end
```

### Horizontal sharding: `connects_to shards:` and `connected_to(shard:)`

A replica solves read contention; it does nothing for write throughput or
storage, because every write still lands on one primary. Sharding splits the
*write* path itself across multiple independent primaries, each owning a slice
of the data:

```ruby
# app/models/sharded_record.rb
class ShardedRecord < ApplicationRecord
  self.abstract_class = true

  connects_to shards: {
    shard_one: { writing: :primary_shard_one, reading: :primary_shard_one_replica },
    shard_two: { writing: :primary_shard_two, reading: :primary_shard_two_replica }
  }
end
```

Every shard can still have its own reader, so role-switching and shard-switching
compose — but selecting a shard now takes both dimensions:

```ruby
ShardedRecord.connected_to(role: :writing, shard: :shard_two) do
  Order.create!(customer_id: 42, total_cents: 5_000)
end
```

Per-request resolution has the same generator-driven middleware pattern as
read/write splitting, this time `ActiveRecord::Middleware::ShardSelector`, whose
job is figuring out which shard a given request belongs to and wrapping the
whole request in `connected_to(shard: ...)` for you:

```ruby
# config/initializers/multi_db.rb
Rails.application.configure do
  config.active_record.shard_selector = { lock: true, class_name: "ShardedRecord" }
  config.active_record.shard_resolver = ->(request) { Tenant.find_by!(host: request.host).shard }
end
```

`lock:` defaults to `true` and is a real safety mechanism, not just a default:
with it on, code inside the request cannot switch to a different shard than the
one the resolver picked, which is what stops a bug (or an unvalidated
tenant-id param) from accidentally reading or writing another tenant's shard
mid-request. `class_name:` points the middleware at the abstract class that owns
the shard connections — it's `ActiveRecord::Base` by default, which is wrong the
moment you have more than one shard-connected hierarchy.

### Choosing a sharding strategy — and its operational costs

The two common strategies are sharding by a business key (tenant/customer id)
and sharding by a hash of a key:

- **By tenant/customer.** A directory — a small fast table or service mapping
  `tenant_id → shard` — decides placement. Routing is simple and every one of a
  tenant's rows lives together, which is exactly what you want for isolation
  (a noisy or huge tenant only affects their own shard) and for data residency
  requirements. The cost is uneven shard sizes: tenants aren't the same size, so
  shards drift apart, and moving one whale tenant to its own shard later is a
  live data-migration project, not a config change.
- **By consistent hash.** Hashing a key spreads rows evenly across shards with
  no directory service required for placement, and rebalances more predictably
  as shards are added. The cost is that "a tenant's data" is no longer
  colocated unless you deliberately hash on the tenant id (which reintroduces
  the uneven-size problem above) — and adding or removing a shard means
  rehashing and physically moving a fraction of every existing row.

Whichever strategy you pick, three costs show up regardless:

1. **Cross-shard joins and associations mostly don't work as SQL joins anymore.**
   A `has_many :through` (or `has_one :through`) that spans two shards needs
   `disable_joins: true` on the association, which makes Rails run it as two or
   more separate queries and combine the results in Ruby instead of in the
   database:
   ```ruby
   class Customer < ShardedRecord
     has_many :orders, through: :order_items, disable_joins: true
   end
   ```
   That has real performance implications, and any `order`/`limit` on the
   association is applied **in memory** after fetching, since Postgres on one
   shard has no way to sort by a column that lives on another shard.
2. **Migrations run once per shard, not once.** `bin/rails db:migrate` becomes
   an operation that has to succeed against every shard's `primary_*` connection;
   a migration that fails on shard three after succeeding on shards one and two
   leaves the fleet on inconsistent schema versions until someone notices and
   reconciles it.
3. **"Which shard is this row on" becomes required infrastructure.** Once a
   customer's data lives on a specific shard, any code path that only has an id
   — a support tool, a webhook handler, a cross-tenant admin query — needs a
   lookup (the same directory table/service from the tenant strategy above,
   generalized) before it can even connect to the right database. There is no
   `Order.find(id)` that searches "all shards" for you.

## Trade-offs

- **The read-your-own-write guarantee is a timer, not a lag check.** It assumes
  replication lag stays under `delay` (2 seconds by default); it never measures
  actual lag. Under load — a bulk import, a long-running `VACUUM`, replication
  network saturation — real lag can exceed the window, and the exact stale-read
  bug the middleware exists to prevent comes back silently, with no error and no
  log line pointing at it.
- **The middleware only wraps the request/response cycle.** A background job,
  a Rake task, or a websocket connection gets none of this automatically. Code
  outside a web request that writes and then reads the same row has to wrap
  itself in `connected_to(role: :writing)` explicitly — forgetting it is the
  most common way this feature causes a production bug rather than preventing
  one:
  ```ruby
  def perform(order_id)
    order = Order.find(order_id) # created moments ago by the enqueuing request —
                                  # this may hit a replica that hasn't seen it yet
    ChargeCustomerJob.perform_now(order)
  end
  ```
- **Sharding is a one-way architectural door.** Once ids, foreign keys, and
  application code are shaped around "this row lives on shard N," undoing that
  — merging shards back together, or re-keying to a different shard strategy —
  is a full data migration, not a revert. Confirm the bottleneck is actually
  write throughput or storage on the primary (which a replica cannot fix)
  before adopting this; adding shards to solve a problem a replica would have
  solved is a common and expensive mistake.
- **`disable_joins: true` trades correctness for a performance cliff.**
  Cross-shard "joins" become N+1-shaped by construction — one query per shard,
  combined and sorted in Ruby — and that cost scales with shard count, not with
  row count. It make an association usable across shards; it does not make it
  cheap.
- **`shard_selector` with `lock: true` is a safety default that can also be a
  footgun in the other direction.** It's the right default for most apps
  (prevents accidental tenant bleed mid-request), but any legitimate workflow
  that genuinely needs to touch two shards in one request (a cross-tenant admin
  action, a data-migration script) has to explicitly manage `connected_to`
  itself rather than relying on the automatic resolver.

## Documentation Links

- [Active Record Multiple Databases — Rails Guides](https://guides.rubyonrails.org/active_record_multiple_databases.html) — doc
- [ActiveRecord::Middleware::DatabaseSelector — Rails API](https://api.rubyonrails.org/classes/ActiveRecord/Middleware/DatabaseSelector.html) — doc
- [ActiveRecord::Middleware::ShardSelector — Rails API](https://api.rubyonrails.org/classes/ActiveRecord/Middleware/ShardSelector.html) — doc
- [ActiveRecord::ConnectionHandling#connects_to — Rails API](https://api.rubyonrails.org/classes/ActiveRecord/ConnectionHandling.html#method-i-connects_to) — doc
