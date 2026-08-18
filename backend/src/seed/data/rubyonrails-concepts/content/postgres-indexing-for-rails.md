---
version: 1.0
updatedAt: 2026-08-18
---
## Objective

An index in a Rails app is not a switch you flip when a page feels slow — it is a
line in a migration that Postgres has to maintain on **every** `INSERT`,
`UPDATE`, and `DELETE` against that table, forever. `add_index` is a small API
with a surprising amount of meaning packed into its options (`order:`, `where:`,
`unique:`, an expression instead of a column name, an array instead of a single
symbol), and Rails is deliberately unopinionated about which indexes you need:
it will happily let you ship a `belongs_to` whose foreign key has no index at
all. Knowing which indexes are effectively mandatory in a Rails schema, which
ones a composite index actually buys you, and how to confirm from a Rails console
that Postgres is really using the index you wrote is the difference between
tuning and guessing.

## Use Cases

- Reviewing a migration that adds a `belongs_to`/`references` association and
  checking whether the foreign key actually got an index — Rails does not add one
  unless you ask.
- Deciding between two `add_index` calls on single columns versus one composite
  `add_index :table, [:a, :b]`, given that Postgres can combine single-column
  indexes on its own via a bitmap index scan.
- Making a key-based (Russian doll) cache expiration query fast, where the
  hot query is `MAX(updated_at)` over a collection rather than a lookup by id.
- Confirming in a Rails console — with `.explain` or `EXPLAIN ANALYZE` — that a
  slow scope is hitting the index you added, instead of assuming it is because
  the migration ran.
- Diagnosing a table whose disk usage keeps growing even though row counts are
  flat, and deciding whether it needs autovacuum tuning or a maintenance-window
  `VACUUM FULL`.

## Deep Dive

### Composite indexes: column order is the whole game

A composite index only helps when the query's column order lines up with the
index's column order.

```ruby
class AddIndexToOrders < ActiveRecord::Migration[7.1]
  def change
    add_index :orders, [:customer_id, :status]
  end
end
```

That index serves `Order.where(customer_id: 1, status: "open")` and it also
serves `Order.where(customer_id: 1)` on its own, because `customer_id` is the
**leading** column. It does *not* help `Order.where(status: "open")` — a query
that skips the leading column cannot use the index as a search structure. This is
often called the leftmost-prefix rule: an index on `[:a, :b, :c]` covers `a`,
`a, b`, and `a, b, c`, but not `b` alone or `b, c`.

The tempting reaction is to add composite indexes for every column combination
the app queries. Resist it. Postgres can already combine two separate
single-column indexes at query time using a **bitmap index scan** — it builds a
bitmap of matching rows from each index, ANDs them together, and then visits the
heap once:

```ruby
add_index :orders, :customer_id
add_index :orders, :status
```

Those two indexes handle `customer_id` alone, `status` alone, and (via bitmap
AND) both together. A composite index is faster than a bitmap AND for its one
specific shape, but it is an ongoing write cost — every write to `orders` has to
maintain it — and it is dead weight for every query that does not lead with
`customer_id`. Reach for the composite index when you have measured that one
specific query shape and it matters; not by default.

The exception where the composite really is the right call is when the pair is
semantically inseparable — a polymorphic association being the canonical example
(below).

### The indexes a Rails app almost always needs

**Foreign keys.** Rails does not index a `belongs_to` foreign key for you. A
bare `add_column :comments, :post_id, :bigint` gives you an unindexed column,
and then every `post.comments` lookup is a sequential scan. Both of these do add
the index:

```ruby
class AddPostToComments < ActiveRecord::Migration[7.1]
  def change
    # add_reference adds the index by default (index: true is the default)
    add_reference :comments, :post, foreign_key: true

    # or, on an existing column:
    add_index :comments, :post_id
  end
end
```

Note that `foreign_key: true` (the database-level referential constraint) and
the index are two different things — the constraint does not create the index,
and an index does not enforce referential integrity. You generally want both.

**Polymorphic columns.** A polymorphic association is queried by `_type` and
`_id` *together*, always, so this is the case where the composite index is
clearly right:

```ruby
class IndexCommentablesOnComments < ActiveRecord::Migration[7.1]
  def change
    add_index :comments, [:commentable_type, :commentable_id]
  end
end
```

`add_reference :comments, :commentable, polymorphic: true` creates exactly this
composite index for you. Writing the two columns as separate single-column
indexes here would be strictly worse: `commentable_type` alone has terrible
selectivity (a handful of distinct class names across the whole table).

**`updated_at` / `created_at` when used for cache keys.** Key-based cache
expiration (see the `russian-doll-caching` sibling concept) builds a cache key
from the collection's maximum `updated_at`, so the query that runs on every
render is not a lookup — it is `SELECT MAX(updated_at) FROM posts`. Postgres can
answer that from an index by walking to one end of it, but only if the index's
sort order matches, and `NULLS LAST` matters because `NULL` sorts as the largest
value by default in a descending index:

```ruby
class AddUpdatedAtIndexToPosts < ActiveRecord::Migration[7.1]
  def change
    add_index :posts, :updated_at, order: { updated_at: "DESC NULLS LAST" }
  end
end
```

The same index also serves the very common `Post.order(updated_at: :desc).limit(20)`
feed query, which is usually the second reason you want it.

### Partial, expression, and unique indexes

A **partial index** indexes only the rows matching a predicate. It is the right
tool when the value distribution is skewed — if 99% of your rows are
`billed = true` and every query you care about is looking for the 1% that are
not, indexing all of them is wasted space and wasted write time:

```ruby
class AddUnbilledIndexToCustomers < ActiveRecord::Migration[7.1]
  def change
    add_index :customers, :billed, where: "billed = false"
  end
end
```

Postgres will only use a partial index for a query whose `WHERE` clause it can
prove is covered by the index predicate, so `Customer.where(billed: false)` uses
it and `Customer.where(billed: true)` does not — which is the point.

An **expression index** indexes the result of a function rather than a raw
column, which is what makes case-insensitive lookups fast:

```ruby
class AddLowerEmailIndexToUsers < ActiveRecord::Migration[7.1]
  def change
    add_index :users, "lower(email)", name: "index_users_on_lower_email"
  end
end
```

The query has to use the *same* expression for the index to apply —
`User.where("lower(email) = ?", email.downcase)` hits it, while
`User.where(email: email)` does not. Passing an explicit `name:` is worth doing
here because Rails cannot derive a clean index name from an expression, and the
generated one is both awkward and easy to collide with.

Finally, prefer `unique: true` whenever the data genuinely is unique. A unique
index is both faster (Postgres knows it can stop at the first match) and a real
integrity constraint at the database level, which a Rails `validates_uniqueness_of`
alone is not — model validations lose races under concurrency:

```ruby
add_index :users, :email, unique: true
```

### Confirming the index is used: EXPLAIN ANALYZE from Rails

Adding an index is a hypothesis; `EXPLAIN ANALYZE` is the test. From a Rails
console, the cheapest path is `.explain` on any relation:

```ruby
Order.where(customer_id: 1, status: "open").explain
# => EXPLAIN for: SELECT "orders".* FROM "orders" WHERE ...
#    Index Scan using index_orders_on_customer_id_and_status on orders ...
```

In Rails 7+, `.explain` takes options, so you can get real execution numbers and
buffer statistics without leaving the console:

```ruby
Order.where(customer_id: 1).explain(:analyze, :buffers, :verbose)
```

For anything more exotic, or on older versions, drop to the connection:

```ruby
puts ActiveRecord::Base.connection.execute(
  "EXPLAIN (ANALYZE, BUFFERS, VERBOSE) SELECT * FROM orders WHERE customer_id = 1"
).values.join("\n")
```

Reading the output, two things matter most. First, compare the estimated `cost`
against `actual time` — if the planner estimated 50 rows and actually got
500,000, the statistics are stale (the planner is choosing badly because it has
bad information, not because the index is wrong) and the table may need an
`ANALYZE`. Second, look at the node type: a `Seq Scan` where you expected an
`Index Scan` is the classic symptom that your index does not apply — wrong
column order in a composite, a query expression that does not match an
expression index, or a predicate outside a partial index's `where:`. `BUFFERS`
adds `shared hit=` / `read=` counters, which tell you whether the pages came from
Postgres' buffer cache or from disk — a plan that looks fine on a warm cache and
terrible in production is usually visible right there.

Note that `ANALYZE` actually executes the query, so wrap it in a transaction you
roll back if the statement writes.

### Dead tuples, autovacuum, and VACUUM FULL

Postgres uses MVCC: an `UPDATE` does not overwrite a row, it writes a new row
version and marks the old one dead, and a `DELETE` just marks the row dead. Those
**dead tuples** still occupy pages, so a heavily-updated table bloats even when
its logical row count is constant — and bloated tables mean more pages to read
for the same result, including through indexes, which bloat alongside them.

`autovacuum` is the background process that reclaims dead tuples for reuse, and
it should always be on. It is enabled by default in Postgres, and managed
providers (Heroku Postgres among them) ship it enabled — the failure mode is
usually someone disabling it to "reduce load," which trades a small continuous
cost for an eventual large one.

The important caveat: ordinary `VACUUM` marks space reusable by that same table
but does **not** return it to the operating system. Only `VACUUM FULL` actually
shrinks the files on disk — and it does so by rewriting the entire table while
holding an `ACCESS EXCLUSIVE` lock, which blocks reads *and* writes for the
duration. That makes it a maintenance-window operation on a production table,
never something to fire off casually from a console because a disk graph looked
alarming.

## Trade-offs

- **Every index is a permanent write tax.** The read speedup is visible in a
  benchmark; the cost is spread invisibly across every `INSERT` and `UPDATE` on
  that table plus the extra disk and cache pressure. Indexes that no query uses
  are pure loss — and they accumulate quietly, because migrations add indexes far
  more often than they drop them. Auditing `pg_stat_user_indexes` for
  never-scanned indexes is worth doing periodically.
- **The composite-vs-two-single-column choice is not "composite is better."**
  A composite index wins decisively for its exact query shape and is useless for
  queries that do not lead with its first column; two single-column indexes are
  more flexible and let Postgres bitmap-AND them, at the cost of being slower for
  that one shape. Choosing composite before you have a measured query is
  optimizing a query you have not written yet.
  ```ruby
  add_index :orders, [:customer_id, :status]  # great for (customer_id, status) and (customer_id)
                                              # useless for (status)
  ```
- **Partial and expression indexes are brittle in a specific way**: they only
  apply when the query text matches what the index describes. An expression index
  on `lower(email)` silently stops helping the moment someone rewrites the scope
  to `where(email: ...)`, and nothing fails — the query just gets slow. Both of
  these deserve a comment in the model next to the scope they exist for.
- **`unique: true` is a constraint, not just an optimization.** It will reject
  writes, which means adding it to an existing table can fail on production data
  that already contains duplicates. That is usually the correct outcome, but it
  means the migration needs a dedup step first, and it turns a "performance"
  change into a data-integrity change with a real rollout risk.
- **A `DESC NULLS LAST` index on `updated_at` only pays off if the cache strategy
  it exists for is actually in place.** If you are not doing key-based cache
  expiration and not rendering `updated_at`-ordered feeds, it is an index on the
  single most frequently written column in the table — the worst possible write
  cost for no read benefit.
- **`VACUUM FULL` fixes bloat but costs availability.** The exclusive lock means
  the table is unavailable for the rewrite, which on a large table can be many
  minutes. When downtime is unacceptable, the alternatives (`pg_repack`, or
  rebuilding indexes concurrently) trade operational complexity for that
  availability — there is no version of this that is both free and instant.

## Documentation Links

- [Active Record Migrations — Rails Guides](https://guides.rubyonrails.org/active_record_migrations.html#creating-a-standalone-migration) — doc
- [PostgreSQL Documentation — Indexes](https://www.postgresql.org/docs/current/indexes.html) — doc
- [PostgreSQL Documentation — EXPLAIN](https://www.postgresql.org/docs/current/sql-explain.html) — doc
- [PostgreSQL Documentation — Routine Vacuuming](https://www.postgresql.org/docs/current/routine-vacuuming.html) — doc
- [The Complete Guide to Rails Performance — Interacting with (SQL) Databases: Indexing](https://pragprog.com/titles/nragilperf/the-complete-guide-to-rails-performance/) — doc
