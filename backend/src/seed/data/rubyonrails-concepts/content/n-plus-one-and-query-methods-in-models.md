---
version: 1.0
updatedAt: 2026-08-17
---
## Objective

The most common cause of a "surprise" N+1 query in a Rails app isn't a missing
`includes` in a controller — it's an ActiveRecord query method (`where`,
`find_by`, `joins`, `select`, `order`, `pluck`, and about fifteen others) called
from inside a **model instance method**. The method looks perfectly innocent in
isolation; the problem only appears once it's called once per element inside a
loop or a view partial, at which point it fires one query per record instead of
one query total.

## Use Cases

- Code-reviewing a new instance method on an ActiveRecord model that reads like
  `def recent_reviews; Review.where(user: self).order(created_at: :desc); end` —
  recognizing this shape as an N+1 risk before it ships, not after a profiler
  finds it in production.
- Choosing between `find_each`/`in_batches` and `.all.each` when iterating a
  large table, to avoid loading the entire result set into memory at once.
- Deciding when eager loading (`includes`/`preload`/`eager_load`) actually
  helps versus when it over-fetches and instantiates more objects than the code
  needs.
- Auditing a slow endpoint by counting SQL queries in development logs against a
  volume of data that actually resembles production, not a handful of seed rows.

## Deep Dive

### The hidden N+1: a query method inside an instance method

```ruby
class User < ApplicationRecord
  has_many :reviews

  # Looks harmless on its own...
  def recent_reviews
    reviews.where("created_at > ?", 1.week.ago).order(created_at: :desc)
  end
end
```

```erb
<% @users.each do |user| %>
  <%= user.recent_reviews.count %>
<% end %>
```

Even though `@users` was loaded with a single query, `user.recent_reviews` re-runs
a `WHERE`/`ORDER BY` query **per user**, because `reviews.where(...)` is a fresh
ActiveRecord query, not a filter over an already-loaded association. Nothing in
this code is individually wrong — the method reads fine, the view reads fine —
the N+1 only exists at the intersection of the two.

The fix isn't necessarily "add `includes(:reviews)`" (that would still leave the
`WHERE`/`ORDER BY` filtering to happen once per user in Ruby, which is fine for a
handful of associated records but wasteful for thousands). Often the better fix
is to push the filtering logic into a **scope** on `Review` and call it explicitly
from the controller with eager loading, keeping the model's instance method free
of query calls entirely:

```ruby
class Review < ApplicationRecord
  scope :recent, -> { where("created_at > ?", 1.week.ago).order(created_at: :desc) }
end

# controller
@users = User.includes(:reviews).map { |u| [u, u.reviews.select { |r| r.created_at > 1.week.ago }] }
```

### `find_each` / `in_batches` instead of `.all.each`

```ruby
# Loads every row into memory before iterating at all:
User.all.each { |u| u.update!(normalized_email: u.email.downcase) }

# Loads and processes in batches of 1000 by default:
User.find_each { |u| u.update!(normalized_email: u.email.downcase) }

# Same batching, but yields an ActiveRecord::Relation per batch — good for update_all:
User.in_batches { |batch| batch.update_all("normalized_email = LOWER(email)") }
```

`.all.each` materializes the entire table as Ruby objects before the block runs
once. On a 100k-row table that's the difference between a script that runs in
constant memory and one that balloons to hundreds of megabytes before doing any
work.

### `select`/`pluck` to avoid instantiating what you don't need

```ruby
User.select(:id, :email)   # ActiveRecord objects, but only 2 attributes loaded
User.pluck(:id, :email)    # raw arrays, no ActiveRecord objects instantiated at all
```

`pluck` skips ActiveRecord object instantiation entirely, which matters when the
table is large and the code only needs the raw values (building a `Hash`, a CSV
export, a `where(id: ...)` filter for a second query).

## Trade-offs

- **`select(:col1, :col2)` means accessing any other attribute raises
  `ActiveModel::MissingAttributeError`** instead of silently returning `nil` —
  this is usually a feature (it surfaces a real bug at the exact call site) but
  it does mean you can't half-select and expect the rest of the model's methods
  to keep working.
  ```ruby
  user = User.select(:id).first
  user.email  # ActiveModel::MissingAttributeError
  ```
- **Eager loading nested associations multiplies instantiated objects, not just
  queries** — `includes(cars: { parts: :vendor })` can instantiate
  `cars.length * parts.length * vendors.length` objects for a single top-level
  record. Two or three levels deep, blindly eager-loading everything a linter
  flags can be *slower* than the N+1 it was meant to fix — always measure rather
  than eager-load reflexively.
- **Moving query logic out of instance methods and into scopes is a design
  choice with a real cost**: it means the controller (or wherever the scope is
  called) has to know more about how to assemble the data than it did when the
  model exposed a single convenient method — the payoff only shows up at
  N-times-called scale, not in a one-off script.

## Documentation Links

- [Active Record Query Interface — Rails Guides](https://guides.rubyonrails.org/active_record_querying.html) — doc
- [Active Record Basics — find_each / in_batches — Rails Guides](https://guides.rubyonrails.org/active_record_basics.html) — doc
- [The Complete Guide to Rails Performance — Common ActiveRecord Pitfalls](https://pragprog.com/titles/nragilperf/the-complete-guide-to-rails-performance/) — doc
