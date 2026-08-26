---
version: 1.0
updatedAt: 2026-08-21
---
## Objective

Three unrelated-looking decisions — how you version a route, how you turn an
ActiveRecord object into JSON, and how you page through a collection — are
actually the same decision made three times: *what contract am I willing to
break, and when*. Get versioning wrong and a client's mobile app silently
breaks on your next deploy. Get serialization wrong and you either leak a
column you didn't mean to expose or eat an N+1 per response. Get pagination
wrong and a client "misses" rows every time someone inserts a record between
two of their page requests — a bug that never shows up in a demo with 20 seed
rows and shows up constantly on a table with 20 million. This concept is about
making those three decisions on purpose, with the actual current state of the
Ruby ecosystem (not five-year-old blog folklore) behind each choice —
`active_model_serializers`' own README, for instance, says its maintainers
have largely moved on and points readers at alternatives, which is a fact
worth knowing before you `bundle add` it in 2026.

## Use Cases

- Standing up `/api/v1/...` for a mobile client you don't control the release
  cadence of, and needing a real answer for what happens when `/api/v2`ships.
- Reviewing a PR that adds `render json: @user.as_json` (or a Jbuilder partial
  that touches an association inside a loop) and needing to know which failure
  mode — leaked attribute vs. N+1 — you're actually reviewing for.
- Choosing whether a new internal admin index page needs Kaminari's
  `page`/`per` (simple, page numbers, small table) or whether a public,
  high-write, infinite-scroll feed needs cursor pagination instead.
- Deciding whether a growing set of API responses justifies pulling in a
  dedicated serializer gem, or whether Jbuilder templates are still the right
  amount of machinery for the team's size.
- Auditing an existing API for a `Gemfile` line pinning `active_model_serializers`
  and deciding whether that's a live risk or a stable-enough dependency to leave
  alone.

## Deep Dive

### URL-path versioning

The common shape: a namespaced route plus a namespaced controller.

```ruby
# config/routes.rb
namespace :api do
  namespace :v1 do
    resources :orders, only: %i[index show]
  end
  namespace :v2 do
    resources :orders, only: %i[index show]
  end
end
```

```ruby
# app/controllers/api/v1/orders_controller.rb
module Api
  module V1
    class OrdersController < Api::BaseController
      def show
        render json: OrderSerializerV1.new(order).as_json
      end
    end
  end
end
```

`GET /api/v1/orders/42` and `GET /api/v2/orders/42` are two different URLs, so
every layer that caches by URL — a CDN, Rack::Cache, a browser — does the
right thing automatically. It's also trivially debuggable: `curl
https://api.example.com/api/v2/orders/42` shows exactly what a client sees,
no headers to remember. The cost shows up later: the version lives in every
client's hardcoded base URL, in every internal doc, in every log line's path —
bumping it is not a header flag, it's a coordinated client migration.

### Header-based (media-type) versioning

Rails routing supports arbitrary request-based constraints — a class (or
lambda) with a `matches?(request)` method, as documented for the general
constraints mechanism in the Routing Guide (its own example is IP allow-listing,
but the mechanism is the same one used for version negotiation):

```ruby
# app/constraints/api_version_constraint.rb
class ApiVersionConstraint
  def initialize(version:)
    @version = version
  end

  def matches?(request)
    request.headers["Accept"]&.include?("application/vnd.myapp.v#{@version}+json")
  end
end
```

```ruby
# config/routes.rb
namespace :api, path: "api" do
  scope module: :v1, constraints: ApiVersionConstraint.new(version: 1) do
    resources :orders, only: %i[index show]
  end
  scope module: :v2, constraints: ApiVersionConstraint.new(version: 2) do
    resources :orders, only: %i[index show]
  end
end
```

Now `GET /api/orders/42` is a single URL for every version — which is the
selling point for REST purists (the resource has one identity; the
*representation* varies) and the problem for everyone else. You cannot `curl`
it without remembering to set `-H "Accept: application/vnd.myapp.v2+json"`,
so every support ticket and every quick manual check gets harder. Worse: a
cache keyed on URL alone (most CDNs, by default) cannot tell v1 and v2 apart
and will happily serve one client's cached v1 response to a v2 request unless
you explicitly configure `Vary: Accept` — a header most teams forget to set
and even more CDNs don't honor well.

### Serialization: Jbuilder vs. plain Ruby objects vs. a dedicated gem

**Jbuilder** ships with Rails and lives in the view layer — it's a template,
not a class:

```ruby
# app/views/api/v1/orders/show.json.jbuilder
json.id order.id
json.total order.total_cents
json.status order.status
json.line_items order.line_items do |item|
  json.sku item.sku
  json.quantity item.quantity
end
```

It's flexible (full Ruby in a template, conditionals, partials) and requires
no new dependency or per-model class. The cost is exactly that flexibility:
nothing stops `json.line_items order.line_items do |item|` from calling
`item.discounts.where(...)` inside the block — a query method called once per
loop iteration is the same N+1 shape covered in the `n-plus-one-and-query-methods-in-models`
sibling concept, except here it's hidden inside a template instead of a model
method, which makes it easier to miss in review.

**A plain PORO serializer** — no gem, just a class with an explicit attribute
list:

```ruby
class OrderSerializer
  def initialize(order)
    @order = order
  end

  def as_json(*)
    {
      id: @order.id,
      total: @order.total_cents,
      status: @order.status,
      line_items: @order.line_items.map { |i| { sku: i.sku, quantity: i.quantity } }
    }
  end
end
```

Zero dependencies, explicit, easy to unit test in isolation. It's also one
more file per model and gives you nothing for free — no root-key convention,
no association caching, no benchmarked JSON generation path. It's the right
default until the number of serializers or the performance requirement grows
enough to want a shared abstraction.

**Dedicated serializer gems** — and here the ecosystem has actually moved.
`active_model_serializers` (AMS) is the name most tutorials from the 2015-2018
era reach for, but its own README says plainly: *"Almost none of the
maintainers from 0.8, 0.9, or earlier 0.10 are still working on AMS,"* its
last tagged release is `0.10.0.rc1` from **April 2015**, and the README's
own "Alternatives" section points readers at Blueprinter and Alba. That's not
the same as "abandoned" — the repo still receives sporadic commits (most
recently in late 2025) and issues still get triaged — so calling it dead would
overstate it; but calling it "the standard" in 2026, which is what most
blog posts still do, is simply out of date. Treat new dependence on AMS as a
decision that needs its own justification, not a safe default.

Two gems that are both currently active (commits within days of each other as
of writing, both with real adoption — Blueprinter ~1.3k GitHub stars, Alba
~1.2k):

```ruby
# Blueprinter — github.com/procore-oss/blueprinter
class OrderBlueprint < Blueprinter::Base
  identifier :id
  fields :total_cents, :status

  association :line_items, blueprint: LineItemBlueprint
end

OrderBlueprint.render(order)
```

```ruby
# Alba — github.com/okuramasafumi/alba
class OrderResource
  include Alba::Resource

  attributes :id, :status
  attribute :total_cents

  many :line_items, resource: LineItemResource
end

OrderResource.new(order).serialize
```

A third option worth knowing about specifically for raw throughput is
**Panko** (`panko_serializer`), which is explicitly built for speed — it uses
`Oj` for JSON generation and precomputes serialization metadata ahead of time
rather than at request time:

```ruby
class OrderSerializer < Panko::Serializer
  attributes :id, :total_cents, :status
  has_many :line_items, serializer: LineItemSerializer
end

render json: Panko::ArraySerializer.new(orders, each_serializer: OrderSerializer).to_json
```

Panko has a smaller community than Blueprinter or Alba (roughly 600 GitHub
stars vs. 1.2k+) — worth weighing if you value a bigger pool of Stack
Overflow answers and contributors over raw benchmark numbers.

All three gems share the same trade-off against Jbuilder: an explicit,
declared attribute list per class means a reviewer (and the gem itself) can
see exactly what's exposed, and association declarations are a natural point
to remember to `includes`/`preload` upstream — but it's another file, another
class name, and another thing to keep in sync when a column gets renamed.

### Pagination: offset vs. cursor (keyset)

**Offset-based pagination** — the familiar `page`/`per_page` — via Kaminari:

```ruby
User.order(:id).page(params[:page]).per(25)
```

or via Pagy, which markets itself specifically on being lighter than the
alternatives — its own docs claim roughly **40x faster, 36x less memory, and
35x simpler object allocation** than competing gems in its benchmark, for the
same offset-pagination job:

```ruby
# app/controllers/application_controller.rb
include Pagy::Method

# in a controller action
@pagy, @orders = pagy(:offset, Order.order(:id))
```

Both compute `LIMIT`/`OFFSET` under the hood. The correctness problem with
`OFFSET` is independent of which gem generates it: **a row inserted or deleted
before the current offset shifts every page after it.** If a client fetches
page 1 (rows 1-25), someone deletes row 3, and the client fetches page 2, row
26 has shifted into what page 1 would now return — the client silently skips
one row it never saw. Insert instead of delete, and a row can be *duplicated*
across two page requests. Neither gem can fix this; it's inherent to `OFFSET`
against a table that changes between requests.

**Cursor (keyset) pagination** avoids that by not counting rows at all — it
filters on the last-seen value of a stable, ordered column:

```sql
-- the manual version of what keyset pagination does
SELECT * FROM orders WHERE id > :last_seen_id ORDER BY id LIMIT 25;
```

Pagy ships this as a first-class paginator, described in its own docs as "the
fastest technique":

```ruby
@pagy, @orders = pagy(:keyset, Order.order(:id))
```

Because each page is defined by "give me rows after cursor X," a row inserted
or deleted elsewhere in the table cannot shift what a page returns — the
result set for a given cursor is stable regardless of concurrent writes. What
it gives up is arbitrary navigation: there is no `WHERE id > :cursor_for_page_5`
without having walked pages 1 through 4 first, so "jump to page 5" or "show
page count: 40" — both trivial with `OFFSET` — aren't available with keyset
pagination.

### A decision framework

- **URL-path vs. header versioning**: default to URL-path. It's cache-friendly
  by construction, curl-able, and legible in every log line — properties that
  matter for any API with external consumers or an on-call rotation debugging
  it at 2am. Reach for header-based versioning only when you're already
  committed to strict media-type-driven REST (a spec like JSON:API, or a
  client ecosystem that already negotiates content types) and you're prepared
  to own `Vary` headers correctly at every caching layer.
- **When a dedicated serializer gem earns its complexity**: when a codebase
  has enough serializers that a shared convention (association declarations,
  consistent null handling, one place to change the JSON shape globally) beats
  N slightly-different Jbuilder templates or POROs — or when serialization
  time is a measured, real cost in a hot endpoint, which is when Panko's
  Oj-backed speed becomes worth its smaller community. For a handful of
  endpoints on a small team, plain Jbuilder or a PORO is not under-engineering
  — it's the right amount of machinery.
- **When cursor pagination is worth losing "jump to page 5"**: any endpoint
  that's paginated by an end user scrolling forward through a feed (infinite
  scroll, a mobile timeline, a webhook/event log a client polls incrementally)
  where correctness under concurrent writes matters more than random access.
  Keep offset pagination for admin backoffice tables and anywhere a human
  actually types a page number or needs a total-page-count UI — that's exactly
  the interaction keyset pagination can't serve.

## Trade-offs

- **Header versioning is invisible to URL-keyed caches.** A CDN or
  `Rack::Cache` layer that doesn't `Vary` on `Accept` will serve a v1 response
  to a v2 request (or the reverse) because, from the cache's point of view,
  `GET /api/orders/42` is a single cache key regardless of headers.
  ```ruby
  # Without Vary: Accept, a shared cache can't tell these apart:
  # GET /api/orders/42, Accept: application/vnd.myapp.v1+json
  # GET /api/orders/42, Accept: application/vnd.myapp.v2+json
  ```
- **Jbuilder's flexibility is also its footgun.** Nothing stops a query method
  from being called inside a loop in the template — the same N+1 shape as
  calling a query method from an instance method (see the
  `n-plus-one-and-query-methods-in-models` sibling concept), except it's less
  visible because it's in a `.jbuilder` file a code reviewer may skim past
  rather than a model method they scrutinize.
  ```erb
  json.array! @orders do |order|
    json.id order.id
    # Fires once per order unless `line_items` was eager-loaded upstream:
    json.line_item_count order.line_items.where(refunded: false).count
  end
  ```
- **`active_model_serializers`'s status is genuinely ambiguous, not settled.**
  It is not archived, and it still gets occasional commits and issue activity
  — but its last tagged release predates most currently-supported Rails
  versions, and its own maintainers' README says they've largely stopped
  active development and point elsewhere. Don't treat either "it's dead" or
  "it's fine, everyone uses it" as settled fact — check its issue tracker and
  commit history yourself before depending on it for a new project.
- **A dedicated serializer or paginator gem is a dependency with its own
  upgrade cadence** — Blueprinter, Alba, and Panko are all actively
  maintained today, but "actively maintained today" is a snapshot, not a
  guarantee; the same AMS history is the reminder that "the current
  recommended gem" and "the gem this codebase will still be comfortably on in
  five years" are not the same claim.
- **Keyset pagination requires a genuinely unique, stable, indexed order
  column** — a non-unique order column produces silently wrong pages, not an
  error:
  ```ruby
  # BUG: created_at has ties (e.g. bulk-imported rows with identical timestamps),
  # so rows sharing a timestamp can be skipped or repeated across pages.
  @pagy, @orders = pagy(:keyset, Order.order(:created_at))

  # Correct: order (and index) on a column guaranteed unique, like id,
  # or a compound (created_at, id) tiebreak.
  @pagy, @orders = pagy(:keyset, Order.order(:id))
  ```
- **Offset pagination's `COUNT(*)` cost is real on large tables** — computing
  `total_pages` means a `COUNT` query on every request unless you opt into a
  countless/approximate mode (Pagy offers `countless`/`COUNTISH` variants
  specifically to avoid this); the naive `page`/`per` call pays that cost by
  default.

## Documentation Links

- [Routing constraints — Rails Guides](https://guides.rubyonrails.org/routing.html) — doc
- [Jbuilder](https://github.com/rails/jbuilder) — doc
- [Kaminari](https://github.com/kaminari/kaminari) — doc
- [Pagy](https://github.com/ddnexus/pagy) — doc
- [Blueprinter](https://github.com/procore-oss/blueprinter) — doc
- [Alba](https://github.com/okuramasafumi/alba) — doc
- [Panko](https://panko.dev/) — doc
- [active_model_serializers — status and alternatives](https://github.com/rails-api/active_model_serializers) — doc
