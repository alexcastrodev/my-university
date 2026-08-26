---
version: 1.0
updatedAt: 2026-08-21
---
## Objective

A B2B SaaS with a few hundred tenant accounts sharing one Rails app has three
real options for keeping their data apart: a `tenant_id` column, a Postgres
schema, or a physically separate database. All three get marketed as "multi
-tenancy," but they buy wildly different isolation guarantees at wildly
different operational cost — and the cheapest one enforces isolation entirely
in application code. That means the day someone ships a new model, or a
`.unscoped` call, or a raw SQL query without a `WHERE tenant_id = ?`, is the
day one tenant's rows become readable (or writable) by another. This isn't a
hypothetical edge case: broken tenant/object-level isolation is one of the
most common real-world SaaS vulnerability classes, and unlike a SQL injection
it doesn't require an attacker at all — a forgotten scope in an internal
admin script or a background job is enough to leak data with nobody probing
for it. Picking a tenancy model, and enforcing it correctly, is a
security decision wearing an architecture-decision costume.

## Use Cases

- Choosing a tenancy model for a new multi-tenant product: row-based
  (cheapest, weakest DB-level guarantee), schema-based (DB-enforced boundary,
  more ops overhead), or database-per-tenant (strongest isolation, most
  expensive to run at scale).
- Auditing an existing row-based app for the actual failure mode of that
  model: a model, a raw query, or a background job that isn't tenant-scoped.
- Deciding whether to hand-roll tenant scoping with `default_scope` and
  `ActiveSupport::CurrentAttributes`, or adopt a gem like `acts_as_tenant` —
  and what you're trusting that gem with if you do.
- Debugging a Postgres connection that appears to be querying the wrong
  tenant's data intermittently — a strong signal of a `search_path` reset bug
  in a schema-based setup, or a connection-pool interaction with PgBouncer.
- Threading tenant identity through a Sidekiq/Solid Queue job correctly,
  since the job runs on a worker process with no request and no
  `Current.tenant` already set.
- Deciding when to graduate from row-based to schema-based, or from either of
  those to the full database-per-tenant sharding topology.

## Deep Dive

### The three tenancy models, and their real trade-offs

**Row-based (shared schema).** Every tenant-scoped table carries a
`tenant_id` column; every table lives in the same schema, the same database,
behind the same connection pool. Isolation is enforced entirely by
application code remembering to filter on `tenant_id` on every query.

```ruby
create_table :invoices do |t|
  t.references :tenant, null: false, foreign_key: true
  t.integer :amount_cents, null: false
  t.timestamps
end
add_index :invoices, [:tenant_id, :created_at]
```

**Schema-based.** One Postgres schema per tenant, inside the same database.
The table structure (`invoices`, `users`, ...) is duplicated once per schema;
isolation is enforced by Postgres itself — a connection whose `search_path`
is `tenant_42` simply cannot see `tenant_43.invoices` without qualifying the
name. Covered in the next section.

**Database-based.** One physical Postgres database (potentially one physical
server) per tenant. This is the strongest isolation of the three and the
most expensive to operate — see
[Multiple Databases, Read Replicas, and Horizontal Sharding in Rails](/rubyonrails-concepts/multi-database-sharding-and-read-replicas)
for the actual `connects_to shards:` / `ActiveRecord::Middleware::ShardSelector`
mechanics; this concept won't re-derive them.

The trade-off matrix, stated plainly:

| Model | Isolation enforced by | Cost to run | Real failure mode |
|---|---|---|---|
| Row-based | Application code | One table set, one connection pool — cheapest | A missing `tenant_id` scope is a full cross-tenant data leak |
| Schema-based | Postgres schema boundary | Migrations run once per tenant schema; soft ceiling on schema/connection count | `search_path` leaking across a pooled connection |
| Database-based | Physical database boundary | Highest — N databases, N connection pools, N backup/restore jobs | Cross-database joins don't exist; most expensive at scale |

Row-based is the default choice for a reason: it's the cheapest to run and
the easiest to scale horizontally (no per-tenant schema or database
proliferation). But its isolation guarantee lives entirely in Ruby code that
runs on every single query, forever, including code nobody has written yet —
which is why the next section is about making that guarantee hard to forget
rather than trusting everyone to remember it.

### Enforcing row-based isolation: `CurrentAttributes` + scoping

`ActiveSupport::CurrentAttributes` is Rails' supported mechanism for a
thread- (and fiber-) isolated, per-request singleton — exactly the shape
"current tenant" needs, so it doesn't have to be threaded through every
method signature as a parameter. Per the Rails API docs, it "resets
automatically before and after each request," and the same reset happens
around each Active Job execution:

```ruby
# app/models/current.rb
class Current < ActiveSupport::CurrentAttributes
  attribute :tenant
end
```

```ruby
# app/controllers/application_controller.rb
class ApplicationController < ActionController::Base
  before_action :set_current_tenant

  private

  def set_current_tenant
    Current.tenant = Tenant.find_by!(subdomain: request.subdomain)
  end
end
```

The scoping itself belongs on an abstract base class, not repeated per
model, so there's exactly one place to audit:

```ruby
# app/models/tenant_scoped.rb
class TenantScoped < ApplicationRecord
  self.abstract_class = true

  default_scope { where(tenant_id: Current.tenant.id) }
end

class Invoice < TenantScoped
end
```

The two concrete ways this fails in practice:

1. **A new model that skips the base class.** `class Report <
   ApplicationRecord` instead of `class Report < TenantScoped` compiles,
   boots, and runs fine — with zero tenant scoping. There's no error, just
   every tenant's reports returned to every tenant, silently, forever, until
   someone notices in a support ticket.
2. **`Model.unscoped`.** `default_scope` is explicitly designed to be
   removable, and `unscoped` removes *all* scopes, not just the tenant one:

   ```ruby
   Invoice.unscoped.find(params[:id]) # bypasses tenant_id entirely
   ```

   This is frequently reached for legitimately (an admin panel, a
   cross-tenant report) and then copy-pasted into a context where it
   shouldn't be. Prefer an explicit, named escape hatch —
   `Invoice.unscoped.where(tenant_id: allowed_tenant_ids)` at minimum, or a
   gem's dedicated `without_tenant` API (next section) that at least makes
   the bypass searchable in the codebase.

### `acts_as_tenant`: a real gem for row-based tenancy

[`acts_as_tenant`](https://github.com/ErwinM/acts_as_tenant) is a
long-standing gem for exactly the pattern above. Its maintenance is worth
stating precisely rather than assuming: the last released gem version
(1.0.1) shipped December 2023, and the most recent commit to the repository
as of this writing is from April 2025 (a documentation fix). That's a low
but non-zero cadence — treat it as maintained-but-slow-moving, and verify
its issue tracker yourself before betting a security boundary on it, rather
than trusting either "it's popular" or "it hasn't been touched in a while"
as the whole answer.

Declaring it on a model wraps `belongs_to` and a `default_scope` for you:

```ruby
class Invoice < ApplicationRecord
  acts_as_tenant :account
end
```

Setting the current tenant per request:

```ruby
class ApplicationController < ActionController::Base
  set_current_tenant_through_filter
  before_action :set_tenant

  private

  def set_tenant
    set_current_tenant(Account.find_by!(subdomain: request.subdomain))
  end
end
```

Internally, `acts_as_tenant` is built directly on
`ActiveSupport::CurrentAttributes` — the same mechanism from the previous
section, not a separate `Thread.current` scheme:

```ruby
# lib/acts_as_tenant.rb (gem internals)
class Current < ActiveSupport::CurrentAttributes
  attribute :current_tenant, :acts_as_tenant_unscoped
end

def self.current_tenant=(tenant)
  Current.current_tenant = tenant
end
```

Its block-scoped API is the gem's answer to the "current tenant outside a
request" problem — the same shape you need for background jobs, covered
below:

```ruby
ActsAsTenant.with_tenant(account) do
  Invoice.create!(amount_cents: 5_000) # tenant_id set automatically
end
```

And its own named escape hatch, deliberately more visible/greppable than a
bare `unscoped`:

```ruby
ActsAsTenant.without_tenant do
  Invoice.all # every tenant's invoices — for an admin report, say
end
```

`ActsAsTenant.configure { |c| c.require_tenant = true }` makes a missing
current tenant raise instead of silently returning an unscoped (or empty)
result — worth turning on, since the alternative failure mode of "no tenant
set" is either a leak or a confusing empty result set, not an error pointing
at the bug.

### Schema-based tenancy: `search_path` in practice

Postgres schemas are namespaces inside one database; `search_path` is the
per-connection setting that decides which schema an unqualified table name
resolves to. Rails' Postgres adapter exposes this as a real, current method
on the connection — `schema_search_path=` — which executes `SET search_path
TO ...` under the hood:

```ruby
ActiveRecord::Base.connection.schema_search_path = "tenant_42"
Invoice.all # resolves against tenant_42.invoices, no code change in the model
```

Rails' own source comment on that method is worth quoting exactly, because
schema-based tenancy code routinely does the opposite of what it says: *"This
should not be called manually but set in database.yml."* That guidance fits
a single fixed schema known at boot time; it doesn't fit "the schema is
whichever tenant is making this request," which is unknowable until a
request arrives — so schema-based tenancy code calls it manually by
necessity, and inherits the responsibility Rails' own docs are warning
against.

That responsibility has a specific, well-known failure mode: **`SET
search_path` is a session-level setting, and Rails' connection pool reuses
connections across requests.** A connection whose `search_path` was switched
to `tenant_42` and is then checked back into the pool without being reset
carries that setting to whichever request checks it out next:

```ruby
# The footgun — no reset on the way out
class ApplicationController < ActionController::Base
  before_action { ActiveRecord::Base.connection.schema_search_path = current_tenant.schema_name }
  # request finishes, connection returns to the pool still set to this tenant's schema
end
```

```ruby
# The fix — always reset, including on the exception path
class ApplicationController < ActionController::Base
  around_action :switch_tenant_schema

  private

  def switch_tenant_schema
    ActiveRecord::Base.connection.schema_search_path = current_tenant.schema_name
    yield
  ensure
    ActiveRecord::Base.connection.schema_search_path = "public"
  end
end
```

This exact hazard is why the actively maintained schema-based gem,
[`ros-apartment`](https://github.com/rails-on-services/apartment) (a
maintained fork of the original `apartment` gem), moved away from
thread-local `search_path` switching on shared connections in its v4
architecture toward a pool-per-tenant design — tenant context tracked via
`CurrentAttributes` and dedicated connection pools per tenant, specifically
so a stale `search_path` can't leak from one tenant's request into another's
connection. If you're evaluating schema-based tenancy today, that
architectural shift is itself evidence of how real this footgun is in
production, not a theoretical concern. It also documents a second, sharper
version of the same class of bug: PgBouncer in **transaction pooling mode**
can hand a connection back to the pool *between* setting `search_path` and
running your query, silently serving one tenant another tenant's data with
no error raised — a hazard that predates and outlives any Rails-level fix.

### Background jobs: tenant context doesn't survive a job boundary

`ActiveSupport::CurrentAttributes` resets around each job's `perform`, the
same as it does around each request — which means `Current.tenant` is
guaranteed to be **unset** when a job starts running, on whatever worker
process picks it up. Enqueuing a job from inside a tenant-scoped request
does not carry `Current.tenant` (or a schema's `search_path`) along with it;
the job argument has to be the tenant's id, explicit and serializable, and
the job has to re-establish context itself at the top of `perform`:

```ruby
# Row-based
class GenerateInvoicePdfJob < ApplicationJob
  def perform(tenant_id, invoice_id)
    tenant = Account.find(tenant_id)
    ActsAsTenant.with_tenant(tenant) do
      Invoice.find(invoice_id).generate_pdf!
    end
  end
end
```

```ruby
# Schema-based
class ExportTenantReportJob < ApplicationJob
  def perform(tenant_schema, report_id)
    ActiveRecord::Base.connection.schema_search_path = tenant_schema
    Report.find(report_id).export!
  ensure
    ActiveRecord::Base.connection.schema_search_path = "public"
  end
end
```

`GenerateInvoicePdfJob.perform_later(Current.tenant.id, invoice.id)` — never
`perform_later(Current.tenant, invoice.id)` relying on serialization to carry
"current-ness" along; there is no current tenant on the other side of the
queue, only whatever id you explicitly passed. For the idempotency, retry,
and fan-out mechanics of the job itself — what happens when this job runs
twice, or needs to fan out per-item work — see
[Background Jobs: Idempotency, Fan-out/Fan-in, and Queue Choice](/rubyonrails-concepts/background-jobs-idempotency-and-fan-out);
this section is only about the tenant-context handoff across the job
boundary, which that concept assumes is already solved.

## Trade-offs

- **Row-based isolation is a Ruby-code guarantee, not a database one.** Every
  new model, every raw SQL query (`ActiveRecord::Base.connection.execute`
  bypasses `default_scope` entirely), and every `.unscoped` call is a
  potential leak that Postgres itself has no way to catch, because as far as
  Postgres is concerned it's one query against one table with no tenant
  boundary at all:
  ```ruby
  ActiveRecord::Base.connection.execute(
    "SELECT * FROM invoices WHERE id = #{params[:id]}"
  ) # no tenant_id anywhere — default_scope never runs on raw SQL
  ```
- **Schema-based tenancy multiplies every migration by tenant count.**
  `bin/rails db:migrate` against one schema doesn't touch the other N-1
  schemas; a naive migration runner has to loop over every tenant schema,
  and a migration that fails on tenant 400 of 600 leaves the fleet on
  inconsistent schema versions until reconciled — the same operational shape
  as sharded migrations, just at the schema level instead of the database
  level. There's also a soft ceiling: nothing in Postgres hard-limits the
  number of schemas per database, but system-catalog bloat and slower
  catalog-scanning operations (migrations, `\dt`, autovacuum on
  `pg_catalog`) become a real, measurable cost as schema count grows into
  the thousands — it degrades gradually, not with a hard error, which makes
  it easy to not notice until it's already expensive to unwind.
- **`CurrentAttributes` resets around requests and jobs — not around test
  examples that don't go through either.** A model or service spec that
  calls `Current.tenant = tenant_a` directly, without going through a
  request or job, leaves that value set for the *next* example, because
  nothing triggers the reset outside the executor callbacks Rails wires up
  for requests and jobs:
  ```ruby
  # spec/support/current_attributes.rb — without this, tenant state leaks between examples
  RSpec.configure do |config|
    config.after { Current.reset }
  end
  ```
  Leaked tenant state between tests is worse than a flaky failure — it's a
  test that passes for the wrong reason, silently validating against the
  previous example's tenant.
- **Database-per-tenant has the strongest isolation and the highest bill.**
  N databases means N connection pools, N sets of backups, N migration runs,
  and (per the sharding concept) cross-tenant joins that stop being SQL
  joins entirely. It's the right call for hard regulatory or data-residency
  requirements; it's expensive insurance against a leak that row-based
  isolation, done carefully, also prevents at a fraction of the operational
  cost — the two models aren't equally validated by "we needed strong
  isolation," only one of them needed *this much* of it.
- **Trusting a gem with your isolation boundary means trusting its
  maintenance cadence, not just its API.** `acts_as_tenant`'s last release
  predates this document by over two years; that's not disqualifying, but it
  means CVEs, Rails-version compatibility issues, and edge-case bug reports
  move at whatever pace the maintainer has time for — check the issue
  tracker for your specific Rails version before adopting it, rather than
  inferring health from star count alone.

## Documentation Links

- [ActiveSupport::CurrentAttributes — Rails API](https://api.rubyonrails.org/classes/ActiveSupport/CurrentAttributes.html) — doc
- [acts_as_tenant — GitHub](https://github.com/ErwinM/acts_as_tenant) — doc
- [PostgreSQL Schemas — postgresql.org](https://www.postgresql.org/docs/current/ddl-schemas.html) — doc
- [ros-apartment (maintained Apartment fork) — GitHub](https://github.com/rails-on-services/apartment) — doc
- [Active Record Multiple Databases — Rails Guides](https://guides.rubyonrails.org/active_record_multiple_databases.html) — doc
