---
version: 1.0
updatedAt: 2026-08-18
---
## Objective

`includes` is usually taught as the one-line cure for N+1 queries, which hides
two facts that matter in production: it is not one strategy but a *choice*
between two (`preload` and `eager_load`) that Rails makes on your behalf, and
loading more associations is not monotonically better — nested eager loading
multiplies the number of Ruby objects instantiated, so it can end up slower than
the lazy loading it replaced. The same instinct applies on the write side: a
loop that calls `save` per record turns one logical operation into thousands of
round-trips, when the database and `activerecord-import` can express it in a
handful of statements.

## Use Cases

- Deciding whether a slow index page needs `preload(:author)`, `eager_load(:author)`,
  or neither, when the query already filters or sorts on the association's columns.
- Reviewing a PR where a linter such as `bullet` suggested adding an association
  to `includes`, and judging whether that suggestion actually helps at production
  data volumes or just triples the object count per row.
- Replacing a report that loads a collection and sums a column in Ruby with a
  single database-side aggregate.
- Writing a seed script, importer, or backfill that has to create hundreds of
  thousands of rows, or mutate a whole table's worth of records at once.

## Deep Dive

### Three strategies, not one

```ruby
# 1. preload — one query per association, stitched together in Ruby
Book.preload(:author)
# SELECT * FROM books
# SELECT * FROM authors WHERE id IN (1, 2, 3, ...)

# 2. eager_load — a single LEFT OUTER JOIN
Book.eager_load(:author)
# SELECT books.*, authors.* FROM books LEFT OUTER JOIN authors ON authors.id = books.author_id

# 3. includes — Rails picks one of the two above
Book.includes(:author)                                   # behaves as preload
Book.includes(:author).where(authors: { country: "BR" })
    .references(:authors)                                # behaves as eager_load
```

The rule Rails applies for `includes` is straightforward: if the query
**references** the association's table — through `references(:authors)`, or
implicitly through `joins`/`merge` on it — it must use a JOIN, so it falls back
to `eager_load`. Otherwise it uses `preload`. This is why `includes(:author).where(authors: { country: "BR" })`
without `references` raises an error rather than silently working: the `WHERE`
clause names a table that the `preload` strategy never puts in the query.

When each strategy wins:

- **`eager_load`** wins when the query has to filter or sort by the associated
  table's columns. The JOIN is the only way to express that in one statement, and
  it is one round-trip instead of two. It loses when the association is
  `has_many` and the parent has wide columns: the JOIN repeats every parent
  column once per child row on the wire.
- **`preload`** wins when the association is a large `has_many` and the parent
  rows are heavy — two narrow queries move far fewer bytes than one JOIN that
  duplicates the parent. It is the only option that cannot be combined with
  conditions on the association. It is also the slowest of the three in the
  common case, because it always costs an extra round-trip plus the Ruby work of
  matching children to parents by foreign key.
- **`includes`** is the right default precisely because you usually do not know
  in advance which shape the query will take as it evolves. Reach for the
  explicit method when you have measured and know better than the heuristic.

### Nested eager loading multiplies objects

The cost of eager loading is not just query count — it is object instantiation.
Consider eager-loading a driver's `cars`, each car's `drivers`, and each car's
`parts` with their `vendors`:

```ruby
Car.includes(:drivers, parts: :vendor)
```

This does not instantiate `cars + drivers + parts + vendors` objects. It
instantiates roughly:

```
cars * drivers  +  cars * parts * vendors
```

With 50 cars, 3 drivers each, 40 parts each and a vendor per part, that is
150 + 6,000 = 6,150 ActiveRecord objects built, each with its attribute hash and
type casting, for a page that may render a dozen of them. The N+1 version would
have fired more queries but built far fewer objects — and object allocation plus
the garbage collection pressure behind it is frequently the larger cost.

This is why a `bullet` warning is a *hypothesis*, not an instruction. The
question it cannot answer is whether the view actually renders every one of
those associated records. Measure the endpoint both ways at realistic data
volume before committing to the eager-loaded version.

### Aggregate in the database, not in Ruby

```ruby
# Instantiates every order just to read one attribute off each:
Order.where(state: "paid").map(&:total).sum

# One SQL statement, no ActiveRecord objects at all:
Order.where(state: "paid").sum(:total)

Order.average(:total)
Order.minimum(:total)
Order.maximum(:total)
Order.count
Order.calculate(:sum, :total)

# Grouped aggregates come back as a Hash, still one query:
Order.group(:state).sum(:total)
# => { "paid" => 91_240.0, "pending" => 3_100.0 }
```

`sum`, `average`, `count`, `minimum`, `maximum` and the generic `calculate` all
compile to SQL aggregate functions and return a scalar (or a `Hash` when combined
with `group`). Nothing is instantiated. The Ruby version's cost is not the
addition — it is building thousands of model objects and then discarding them.

### Bulk inserts with activerecord-import

A seed for 100 publishers, each with 10,000 books, each with 3 reviews, written
the obvious way, is about four million individual `INSERT` statements:

```ruby
# ~4,000,000 round-trips
100.times do
  publisher = Publisher.create!(name: Faker::Company.name)
  10_000.times do
    book = publisher.books.create!(title: Faker::Book.title)
    3.times { book.reviews.create!(rating: rand(1..5)) }
  end
end
```

The `activerecord-import` gem collapses each level into one multi-row statement:

```ruby
publishers = 100.times.map { Publisher.new(name: Faker::Company.name) }
Publisher.import(publishers)                 # 1 INSERT, returns records with ids

books = publishers.flat_map do |publisher|
  10_000.times.map { Book.new(publisher_id: publisher.id, title: Faker::Book.title) }
end
Book.import(books)                           # 1 INSERT

reviews = books.flat_map do |book|
  3.times.map { Review.new(book_id: book.id, rating: rand(1..5)) }
end
Review.import(reviews)                       # 1 INSERT
```

Three statements instead of four million. `import` also accepts a
columns-and-values form that never builds models at all, and options for
validation and upsert behaviour:

```ruby
Book.import(
  [:publisher_id, :title],
  [[1, "Ruby Under a Microscope"], [1, "Metaprogramming Ruby"]],
  validate: false,
  batch_size: 5_000
)

Book.import(
  books,
  on_duplicate_key_update: { conflict_target: [:isbn], columns: [:title, :price] }
)
```

`validate: false` skips ActiveModel validations for the whole batch (a large part
of the speedup, and a real risk if the data is not already trusted), and
`batch_size` keeps a single statement from exceeding the database's query size or
parameter limits.

### Mass updates and deletes

```ruby
# N UPDATEs, N sets of validations, N sets of callbacks:
Book.where(discontinued: true).each { |b| b.update!(price: 0) }

# One UPDATE statement:
Book.where(discontinued: true).update_all(price: 0)

# One UPDATE, with an expression evaluated by the database:
Book.where(discontinued: true).update_all("price = price * 0.5")

# One DELETE statement:
Book.where(discontinued: true).delete_all

# Instantiates each record and runs its destroy callbacks — N statements,
# but dependent: :destroy associations and callbacks are honoured:
Book.where(discontinued: true).destroy_all
```

`update_all` and `delete_all` compile to a single statement and never
instantiate a model. `destroy_all` is the mass-mutation method that still runs
per-record `before_destroy`/`after_destroy` callbacks and cascades
`dependent: :destroy` — it is the correct choice when those callbacks carry real
behaviour, but it is not a bulk operation in the SQL sense, and on a large scope
it should be driven through batching rather than run in one shot.

## Trade-offs

- **`update_all` and `delete_all` skip validations, callbacks, and timestamps.**
  This is the entire reason they are fast, and the entire reason they are
  dangerous: a `before_save` that keeps a denormalized counter in sync, a
  `paper_trail` audit hook, or a search-index `after_commit` will simply not
  fire. `updated_at` is not touched either, which silently breaks anything keyed
  on it — including Russian doll caching.
  ```ruby
  Book.where(discontinued: true).update_all(price: 0, updated_at: Time.current)
  ```
- **`destroy_all` is safe but not bulk.** It preserves callbacks at the cost of
  instantiating and deleting one record at a time; on a 500k-row scope that is
  500k `DELETE` statements. Choosing between it and `delete_all` is a question
  about your callbacks, not about performance — and if the callbacks matter, the
  honest answer is often to keep `destroy_all` and move the work to a background
  job rather than to reach for `delete_all` and lose the behaviour.
- **`eager_load`'s JOIN duplicates parent columns across child rows.** For a
  `has_many` with wide parent records, one JOIN can transfer several times more
  bytes than the two queries `preload` would issue. The "one query is better than
  two" instinct is wrong here often enough that it is worth checking the row
  counts before forcing the strategy.
- **`preload` cannot be filtered.** Because the association is fetched in a
  separate `WHERE id IN (...)` query, there is no way to constrain the parent
  rows by the association's columns. If a query needs that, `preload` is not
  merely slower — it is unavailable, and `includes` will have silently switched
  to `eager_load` anyway.
- **`import` with `validate: false` moves data integrity entirely onto the
  database.** Any rule that lives only in an ActiveModel validation and not in a
  `NOT NULL`, `CHECK`, or unique index is unenforced for that batch. The
  performance win is real, but it is an argument for putting the constraints in
  the schema, not for trusting the input.
- **Bulk statements hold locks longer.** A single `UPDATE` over a million rows is
  one transaction holding row locks for its full duration, which can block
  concurrent writers far more disruptively than a thousand small updates would.
  `in_batches` combined with `update_all` gives most of the speed while keeping
  each transaction short.

## Documentation Links

- [Active Record Query Interface — Eager Loading Associations — Rails Guides](https://guides.rubyonrails.org/active_record_querying.html#eager-loading-associations) — doc
- [ActiveRecord::QueryMethods — Rails API docs](https://api.rubyonrails.org/classes/ActiveRecord/QueryMethods.html) — doc
- [activerecord-import — GitHub](https://github.com/zdennis/activerecord-import) — doc
- [The Complete Guide to Rails Performance — Common ActiveRecord Pitfalls](https://pragprog.com/titles/nragilperf/the-complete-guide-to-rails-performance/) — doc
