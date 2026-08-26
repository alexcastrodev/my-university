---
version: 1.0
updatedAt: 2026-08-21
---
## Objective

A `rails db:migrate` that runs in 40ms in your dev sandbox can hold an
`ACCESS EXCLUSIVE` lock on a 200-million-row `orders` table in production for the
several minutes it takes Postgres to rewrite it — and every other query against
that table, reads included, queues up behind that lock for the entire time. The
failure mode isn't the migration failing; it's the app going down while the
migration runs, followed by a wall of timed-out requests once it finally commits.
The gap between "the schema change is correct" and "the schema change is safe to
run against a live table" is exactly what naive `ActiveRecord::Migration` code
does not protect you from — Rails will happily generate a migration that locks a
hot table for a maintenance window you didn't schedule. This concept is about the
specific mechanics of which DDL locks what, how to catch it before it ships, and
the multi-deploy pattern for the changes that are unsafe no matter how you write
them.

## Use Cases

- Reviewing a migration PR that adds a `NOT NULL` column or changes a column's
  type on a table you know gets thousands of writes per minute, and needing to
  know whether it's actually safe or just looks safe.
- Deciding whether a migration needs `algorithm: :concurrently` /
  `disable_ddl_transaction!` versus a full multi-step, multi-deploy rollout (a
  much bigger commitment) — see `postgres-indexing-for-rails` for the concurrent
  index case specifically.
- Renaming or dropping a column that application code still reads, where a
  single-deploy migration would break either the old code (mid-deploy) or silently
  drop live data.
- Backfilling a new column across a table too large to update in one
  transaction without bloating it, blocking replication, or triggering a
  `statement_timeout`.
- Setting up `strong_migrations` for a team so that a dangerous migration fails
  in CI/dev with an explanation, instead of failing in production with an
  incident.
- Deciding whether it's safe to reach for `safety_assured { }` versus doing the
  multi-step migration properly, when a linter flags something you believe is
  fine.

## Deep Dive

### Why naive migrations lock production tables

Every `ALTER TABLE` in Postgres takes some lock; the dangerous ones take
`ACCESS EXCLUSIVE`, which blocks every other transaction — reads and writes both
— for as long as the statement runs.

**`ADD COLUMN` with a default — the version boundary that actually matters.**
Before Postgres 11, adding a column with any default value rewrote the entire
table: Postgres had to go back and stamp the default value into every existing
row, under `ACCESS EXCLUSIVE`, for the whole operation. Postgres 11 changed this
for the common case — a non-volatile (constant) default is now stored once in
the table's catalog metadata and applied lazily when each row is read, so the
`ALTER TABLE` itself is fast regardless of table size:

```ruby
class AddStatusToOrders < ActiveRecord::Migration[7.1]
  def change
    # Postgres 11+: metadata-only, near-instant even on a huge table.
    # Postgres < 11: rewrites every row under ACCESS EXCLUSIVE.
    add_column :orders, :status, :string, default: "pending"
  end
end
```

The exception that still bites you on any Postgres version: a **volatile**
default — `clock_timestamp()`, `random()`, anything that doesn't evaluate to the
same value for every row — forces a full table rewrite no matter how new your
Postgres is, because there is no single value to store in the metadata. If your
production Postgres is 11 or newer and your default is a constant, this
particular migration is genuinely cheap; verify both of those things before
assuming it.

**Changing a column's type.** `change_column` generally rewrites the whole table
and every index on it, under `ACCESS EXCLUSIVE`, for the duration — Postgres has
to convert every existing value to the new on-disk representation. There's a
narrow exception when the new type is binary-coercible with the old one (for
example, widening a `varchar` with no length limit change in the representation),
but the common cases Rails developers hit — `integer` to `bigint`, `string` to
`text` with a length change, anything through a `USING` cast — are full
rewrites. Assume it locks the table until you've confirmed otherwise on your
specific Postgres version and type pair.

**Adding a `NOT NULL` constraint.** `change_column_null :orders, :customer_id,
false` requires Postgres to scan every existing row to prove none of them are
`NULL`, and by default that scan happens under `ACCESS EXCLUSIVE` — so a
`NOT NULL` addition on a huge table can hold the same lock for the same
uncomfortably long time as a rewrite, even though no bytes on disk actually
change.

Postgres does have a way to avoid the blocking scan, but it's not a direct
`NOT VALID` flag on `SET NOT NULL` in the older, common case — it's an
indirect route through a `CHECK` constraint: add `CHECK (col IS NOT NULL) NOT
VALID` (cheap, doesn't scan), validate it separately with `VALIDATE CONSTRAINT`
(scans, but only takes a `SHARE UPDATE EXCLUSIVE` lock that doesn't block
reads/writes), and then Postgres 12+ recognizes that a validated constraint
already proves the column has no nulls and lets `SET NOT NULL` skip its own
scan entirely. As of Postgres 18 (released September 2025), Postgres also
supports `NOT VALID` directly on a not-null constraint, closing the gap between
the two mechanisms — but the indirect check-constraint route above is what
you'll need on anything older, and it's what `strong_migrations` generates by
default (next section).

### The strong_migrations gem

[`strong_migrations`](https://github.com/ankane/strong_migrations) hooks into
`ActiveRecord::Migration` and raises with an explanation *before* running a
migration it considers dangerous, rather than letting Postgres teach you the
hard way in production. Per its README, its Postgres-specific checks cover:
adding an index non-concurrently, adding a `belongs_to`/`reference` (which
implies a non-concurrent index unless told otherwise), adding a unique or
exclusion constraint, adding a `json` column (it wants `jsonb`), adding a column
with a volatile default, setting a column `NOT NULL`, renaming an enum value,
and renaming a schema — plus database-agnostic checks for removing a column,
changing a column's type, renaming a column or table, and a few more. When it
catches the `NOT NULL` case, it doesn't just say "no" — it generates the
three-step check-constraint pattern for you:

```ruby
# Migration 1: add the constraint unvalidated — fast, no full scan
class AddNotNullCheckToOrdersCustomerId < ActiveRecord::Migration[7.1]
  def change
    add_check_constraint :orders, "customer_id IS NOT NULL",
      name: "orders_customer_id_null", validate: false
  end
end

# Migration 2: validate it — scans, but with a non-blocking lock
class ValidateNotNullCheckOnOrdersCustomerId < ActiveRecord::Migration[7.1]
  def change
    validate_check_constraint :orders, name: "orders_customer_id_null"
  end
end

# Migration 3: the real constraint is now free (Postgres 12+ skips its scan),
# then drop the check constraint since NOT NULL now enforces it
class AddNotNullToOrdersCustomerId < ActiveRecord::Migration[7.1]
  def change
    safety_assured do
      change_column_null :orders, :customer_id, false
      remove_check_constraint :orders, name: "orders_customer_id_null"
    end
  end
end
```

`safety_assured { }` is the escape hatch — it wraps a block and tells the gem
"I have verified this is fine, stop checking it." Configuration lives in
`config/initializers/strong_migrations.rb`: `StrongMigrations.target_version =
16` tells the gem which Postgres version production actually runs, so its
checks match reality instead of the most conservative case;
`StrongMigrations.safe_by_default = true` makes the gem automatically rewrite
certain unsafe calls into their safe multi-step equivalents;
`StrongMigrations.start_after = 20260101000000` exempts migrations older than a
given timestamp, useful when adopting the gem on an existing app;
`StrongMigrations.lock_timeout` / `statement_timeout` set defaults the gem
applies to the migration connection.

Using `safety_assured` is legitimate when you've actually reasoned about the
specific table: it's small, it's low-traffic, or the migration is running in an
explicit maintenance window. It's a footgun when it's used to silence a warning
on a hot table because the deadline is today — at that point you've disabled
the one thing that would have stopped the incident, and the gem has no way to
warn you that the table it's protecting grew 100x since the last time someone
looked.

### The multi-step pattern for a genuinely unsafe change

Some changes have no single-migration safe form, no matter what lock you take —
renaming a column is the canonical example. The problem isn't the `ALTER TABLE
RENAME COLUMN` itself (that's actually a fast, metadata-only operation in
Postgres); it's that the moment it commits, every line of running application
code that references the old column name breaks, and during a rolling deploy
you *will* have old code and new code running against the same database
simultaneously. The fix is to split the change across multiple deploys:

```ruby
# Deploy 1 — add the new column, don't touch the old one
class AddNewEmailToUsers < ActiveRecord::Migration[7.1]
  def change
    add_column :users, :new_email, :string
  end
end
```

```ruby
# Deploy 1 (app code) — dual-write: every write goes to both columns
class User < ApplicationRecord
  before_save :sync_new_email

  private

  def sync_new_email
    self.new_email = email if email_changed?
  end
end
```

```ruby
# Deploy 1 or 2 — backfill existing rows (see next section for how, at scale)
User.where(new_email: nil).in_batches.update_all("new_email = email")
```

```ruby
# Deploy 2 — reads move to the new column once backfill is confirmed complete
class User < ApplicationRecord
  before_save :sync_new_email

  def email
    new_email
  end

  private

  def sync_new_email
    self.new_email = email if email_changed?
  end
end
```

```ruby
# Deploy 3, separately, once nothing reads or writes the old column —
# drop it, ideally still behind strong_migrations' remove_column check
class RemoveOldEmailFromUsers < ActiveRecord::Migration[7.1]
  def change
    safety_assured { remove_column :users, :email }
  end
end
```

This has to be multiple deploys, not one migration with clever ordering,
because a migration runs once, at a single point in time, while a deploy is a
*rollout* — old server processes and new server processes coexist for however
long the rolling restart takes. A single migration can't make old code
understand a renamed column; only shipping application code that tolerates both
names, for at least one full deploy cycle, does that. The same shape applies to
splitting a column into two, changing a column's semantic meaning, or moving
data to a new table.

### Backfilling large tables safely

Never backfill a large table inside the migration transaction itself — a
migration that updates 50 million rows in one `UPDATE` statement holds locks
and generates WAL for the entire duration, and if it's wrapped in Rails' default
migration transaction, a failure partway through rolls back all of it and you've
paid the full cost for nothing. `in_batches` (Rails' `ActiveRecord::Batches`
API) pages through the table using the primary key rather than loading it into
memory or updating it in one pass:

```ruby
# lib/tasks/backfill.rake — run as a rake task or background job, not inside a migration
namespace :backfill do
  task orders_status: :environment do
    Order.where(status: nil).in_batches(of: 2_000) do |batch|
      batch.update_all(status: "pending")
      sleep 0.1 # throttle: give replicas and autovacuum room to keep up
    end
  end
end
```

A batch size in the low thousands (2,000 is a reasonable starting point, not a
rule) keeps each `UPDATE` short enough that it doesn't hold its row locks for
long and doesn't generate a disruptive burst of WAL in one shot. The `sleep`
between batches is a deliberately crude throttle — its job is to leave gaps for
two things that a back-to-back loop of batches would starve: replica
apply (a synchronous or lagging replica can fall further behind if the primary
never stops writing), and autovacuum (an `UPDATE`-heavy backfill generates dead
tuples as fast as MVCC rewrites rows, and autovacuum needs CPU and I/O
headroom to keep up or the table bloats). On a system with real replication
lag monitoring, checking actual lag between batches and backing off when it
climbs is a better throttle than a fixed sleep, but the fixed sleep is the
80% solution most teams ship.

Running this as a rake task invoked by a deploy step, or as a background job
(`BackfillOrdersStatusJob.perform_later`, chaining itself batch-by-batch via
`perform_later` again), rather than inside the migration itself, matters for a
concrete reason: migrations are expected to run to completion during a deploy,
usually under some timeout the deploy tooling enforces, and a backfill of
millions of rows can take much longer than that window. Decoupling it from the
deploy means the deploy finishes in seconds and the backfill runs — and can be
paused, resumed, or retried — on its own schedule.

### Lock timeouts as a safety net

Every mitigation above reduces the *chance* a migration blocks the table for a
long time; `lock_timeout` is the backstop for when something still goes wrong —
a long-running query you didn't know about holding a conflicting lock, an
estimate that was wrong. It's a genuine Postgres session-level setting (not a
Rails-specific mechanism), set with `SET lock_timeout`, that aborts a statement
if it can't acquire a lock within the given time, instead of queueing
indefinitely behind whatever is holding it:

```ruby
class AddPriorityToOrders < ActiveRecord::Migration[7.1]
  def change
    reversible do |dir|
      dir.up do
        execute "SET lock_timeout = '5s'"
        add_column :orders, :priority, :integer
      end
    end
  end
end
```

`strong_migrations` exposes the same idea as configuration rather than raw SQL
per migration — `StrongMigrations.lock_timeout = 10.seconds` applies it to every
migration the gem runs, paired with a longer `StrongMigrations.statement_timeout`
so slow-but-uncontended work isn't killed. Either way, the effect is the same:
if the migration can't get its lock within the timeout, it fails loudly and
immediately, and you get to retry at a quieter moment — instead of the
migration silently queueing behind a stuck query while every other request
against that table queues up behind *it*, which is how a routine migration
turns into a full outage. `lock_timeout` doesn't make an unsafe migration safe;
it converts "the app goes down for ten minutes" into "the deploy fails and
Slack tells you why," which is a strictly better failure mode.

## Trade-offs

- **The multi-step rename pattern is genuinely more work, not just more
  cautious.** It's three-plus migrations, a dual-write period in application
  code that has to be remembered and eventually cleaned up, and coordination
  across at least two deploys. Teams under deadline pressure frequently skip
  straight to `rename_column` on a table "small enough it won't matter" — which
  is a real judgment call, not automatically wrong, but it's a call that has to
  be made deliberately, table by table, not by default.
- **`safety_assured` silences the check permanently for that block, with no
  distinction between "I verified this" and "I'm annoyed by the warning."**
  ```ruby
  # Compiles, ships, and looks identical whether the author checked the table
  # size or just wanted the red error message to go away.
  safety_assured { change_column_null :orders, :customer_id, false }
  ```
  A code reviewer sees the same one line either way. Some teams require a
  comment next to every `safety_assured` explaining *why* it's safe, precisely
  because the block itself carries no evidence.
- **A fixed `sleep` throttle in a backfill is a guess, not a measurement.**
  `sleep 0.1` between batches was fine on the table and traffic pattern it was
  tuned against; it can still overwhelm a replica during a traffic spike, or be
  needlessly slow during a quiet period. Checking actual replication lag is
  more correct and more work — most teams accept the imprecision of a fixed
  sleep because it's good enough almost all the time.
- **`lock_timeout` trades a stuck migration for a failed deploy.** A migration
  that times out on its lock hasn't run — if your deploy pipeline doesn't treat
  a failed migration as a hard stop (some don't, if the migration step is
  fire-and-forget), the app can end up serving requests against a schema the
  new code assumes already changed.
- **Backfilling outside the migration means the schema and the data can be
  out of sync for an extended, observable period.** Between "column added" and
  "backfill finished," `Order.where(status: nil)` is a real, valid state your
  application code has to handle correctly — not a transient implementation
  detail. Code that assumes the backfill is instantaneous (most `NOT NULL`
  assumptions do) will break in exactly that window.
- **The Postgres-version-dependent behavior means "safe" is not a property of
  the migration alone.** The same `add_column ... default: "pending"` is a
  metadata-only no-op on Postgres 11+ and a full table rewrite on Postgres 10.
  A migration reviewed as safe against staging's Postgres version is not
  automatically safe against production's — this is exactly what
  `StrongMigrations.target_version` exists to pin down, and skipping that
  configuration means the gem is checking against a version that may not be
  the one that matters.

## Documentation Links

- [strong_migrations — README](https://github.com/ankane/strong_migrations) — doc
- [PostgreSQL Documentation — ALTER TABLE](https://www.postgresql.org/docs/current/sql-altertable.html) — doc
- [PostgreSQL Documentation — lock_timeout (Client Connection Defaults)](https://www.postgresql.org/docs/current/runtime-config-client.html#GUC-LOCK-TIMEOUT) — doc
- [PostgreSQL 11 Release Notes](https://www.postgresql.org/docs/11/release-11.html) — doc
- [Active Record Migrations — Rails Guides](https://guides.rubyonrails.org/active_record_migrations.html) — doc
- [ActiveRecord::Batches — Rails API](https://api.rubyonrails.org/classes/ActiveRecord/Batches.html) — doc
