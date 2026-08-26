---
version: 1.0
updatedAt: 2026-08-18
---
## Objective

Ruby's collection power comes from one protocol with two halves that are easy to
confuse. `Enumerable` is a **module** you mix into your own class: define `each`
and you inherit roughly a hundred methods — `map`, `select`, `reduce`, `sort_by`,
`group_by`, `partition`, `tally`, `zip`, `all?` — for free. `Enumerator` is a
**class**: an object that represents a sequence you can drive from the outside
with `next`/`peek`/`rewind`, build by hand with a yielder, generate infinitely
with `produce`, or make lazy so a chained pipeline pulls one element at a time
instead of materializing every intermediate array.

## Use Cases

- Making a domain class (a playlist, a paginated API client, a parsed log file)
  behave like a first-class collection by implementing a single `each`.
- Walking two sequences in lockstep, where neither one drives the other and
  `zip` isn't enough because you need to advance them independently.
- Modeling an unbounded sequence — an ID generator, a Fibonacci or triangular
  series, a paginated cursor that keeps fetching — as an object instead of a
  `while` loop with mutable state.
- Filtering a huge or infinite source with `.lazy` so only the elements the
  consumer actually asks for ever get computed.
- Writing your own block-taking method that behaves like a core one: returning
  an `Enumerator` when called without a block, so callers can chain
  `.with_index` or `.lazy` onto it.

## Deep Dive

### `Enumerable`: define `each`, get everything else

```ruby
class Playlist
  include Enumerable

  Track = Struct.new(:title, :artist, :seconds)

  def initialize(tracks)
    @tracks = tracks
  end

  def each
    return to_enum(:each) { @tracks.size } unless block_given?
    @tracks.each { |track| yield track }
    self
  end
end

playlist = Playlist.new([
  Playlist::Track.new("Kid A",        "Radiohead", 264),
  Playlist::Track.new("Idioteque",    "Radiohead", 289),
  Playlist::Track.new("Teardrop",     "Massive Attack", 330)
])

playlist.map(&:title)                      # => ["Kid A", "Idioteque", "Teardrop"]
playlist.select { |t| t.seconds > 280 }    # => [Idioteque, Teardrop]
playlist.sum(&:seconds)                    # => 883
playlist.min_by(&:seconds).title           # => "Kid A"
playlist.group_by(&:artist).keys           # => ["Radiohead", "Massive Attack"]
playlist.partition { |t| t.seconds < 300 } # => [[Kid A, Idioteque], [Teardrop]]
playlist.map(&:artist).tally               # => {"Radiohead" => 2, "Massive Attack" => 1}
playlist.each_slice(2).to_a.size           # => 2
```

Not one of those methods was written by hand. `Enumerable` implements all of
them in terms of `each`, which is why it's the highest-leverage mixin in the
stdlib — and why `Range`, `Dir`, `ENV`, `IO`/`File`, `CSV`, and `Struct` all
support the same vocabulary: each of them implements `each` and includes the
module.

Two methods need slightly more than `each`. `sort`, `min`, `max`, `sort_by`'s
tie-breaking, and `include?` compare elements with `<=>` and `==`, so elements
must be mutually comparable (or you pass a block: `sort_by(&:seconds)` is both
more idiomatic and faster than `sort { |a, b| a.seconds <=> b.seconds }` when
sorting by an attribute).

The `return to_enum(:each) { @tracks.size } unless block_given?` line is the
convention every core collection follows: called without a block, an
enumeration method hands back an `Enumerator` rather than doing nothing. The
optional block passed to `to_enum` supplies a lazily-computed `size`, so
`playlist.each.size` answers without iterating.

### `Enumerator` (the class) vs `Enumerable` (the module)

They are not variants of the same thing. `Enumerable` is a set of methods your
class acquires. `Enumerator` is a standalone object holding a *position* in a
sequence — an external iterator. It also includes `Enumerable`, which is why an
Enumerator itself responds to `map`, `select`, and friends.

`to_enum` / `enum_for` build one from **any** block-accepting method, not just
`each`:

```ruby
enum = "hello world".to_enum(:scan, /\w+/)
enum.next   # => "hello"
enum.next   # => "world"

# and any core method called without a block already returns one:
[10, 20, 30].each          # => #<Enumerator: [10, 20, 30]:each>
"cat".each_char.with_index.to_a  # => [["c", 0], ["a", 1], ["t", 2]]
```

That "no block means Enumerator" rule is exactly what makes
`each_char.with_index`, `map.with_index`, and `each_with_object` chain: the
first call returns an object, and the second call decorates it.

### External iteration: `next`, `peek`, `rewind`, and `loop`

```ruby
e = [1, 2, 3].each
e.next    # => 1
e.peek    # => 2   (looks ahead without advancing)
e.next    # => 2
e.rewind
e.next    # => 1
```

The payoff is driving two sequences independently — something no internal
iterator can do, because `each` owns the loop:

```ruby
names  = %w[ada grace alan turing].each
scores = [95, 88, 72].each

loop do
  puts "#{names.next}: #{scores.next}"
end
# ada: 95
# grace: 88
# alan: 72
# (exits cleanly — "turing" is never consumed)
```

When an Enumerator is exhausted, `next` raises `StopIteration`. `Kernel#loop`
rescues that exception specifically and returns normally, which is why the code
above needs no bounds check and no `break`. Any other `while`/`until` loop would
propagate the exception.

### Building an Enumerator by hand

```ruby
triangular = Enumerator.new do |yielder|
  total = 0
  n = 1
  loop do
    total += n
    yielder.yield total
    n += 1
  end
end

triangular.take(6)   # => [1, 3, 6, 10, 15, 21]
triangular.next      # => 1
triangular.next      # => 3
```

The block contains an infinite loop, yet `take(6)` returns. `yielder.yield`
suspends the block's execution (MRI implements this with a Fiber) and resumes it
only when the consumer asks for another value. The generator is written as if it
runs forever; the consumer decides when it stops.

For the common case — "next value is a pure function of the previous one" —
`Enumerator.produce` says the same thing in one line:

```ruby
Enumerator.produce(1) { |n| n * 2 }.take(5)          # => [1, 2, 4, 8, 16]
Enumerator.produce(Time.now) { |t| t + 86_400 }.first(3)  # today, tomorrow, next day
```

The seed is yielded first, then the block is applied repeatedly. If the block
raises `StopIteration`, the sequence ends there — handy for walking a chain
(parent pointers, paginated cursors) that eventually runs out.

### `.lazy`: restructure the pipeline, don't just delay it

Chained Enumerable methods are eager: each stage runs to completion over the
whole collection and builds a full intermediate array before the next stage
starts.

```ruby
(1..5).map    { |n| print "map #{n} "; n * 2 }
      .select { |n| print "sel #{n} "; n > 4 }
# map 1 map 2 map 3 map 4 map 5 sel 2 sel 4 sel 6 sel 8 sel 10
# => [6, 8, 10]
```

`.lazy` turns that into element-at-a-time flow through the entire pipeline,
driven by demand from the end:

```ruby
(1..5).lazy.map    { |n| print "map #{n} "; n * 2 }
           .select { |n| print "sel #{n} "; n > 4 }
           .first(2)
# map 1 sel 2 map 2 sel 4 map 3 sel 6 map 4 sel 8
# => [6, 8]
```

Same blocks, same result prefix, completely different execution order — and
element 5 is never touched at all. That property is what makes infinite sources
usable:

```ruby
Enumerator.produce(1) { |n| n + 1 }
  .lazy
  .map    { |n| n * n }
  .select { |n| n % 3 == 0 }
  .first(3)              # => [9, 36, 81]
```

Without `.lazy`, `select` over an infinite producer never returns — it tries to
build the complete filtered collection first.

A lazy chain stays lazy until a terminal operation forces it: `first(n)`,
`take(n).force`, `to_a`, `reduce`, `include?`. `force` is just an alias for
`to_a` that reads better at the end of a chain. And `.eager` converts a
`Enumerator::Lazy` back into a normal enumerator, so downstream methods evaluate
eagerly again:

```ruby
lazy_chain = (1..Float::INFINITY).lazy.map { |n| n * 2 }
lazy_chain.class            # => Enumerator::Lazy
lazy_chain.first(3)         # => [2, 4, 6]
lazy_chain.eager.class      # => Enumerator
(1..10).lazy.select(&:even?).force  # => [2, 4, 6, 8, 10]
```

## Trade-offs

- **Enumerable gives you ~100 methods but they all return `Array`, never your
  class** — `playlist.select { ... }` hands back a plain Array of tracks, not a
  `Playlist`. If chaining should preserve your type, you have to override the
  handful of methods you care about (or wrap the result yourself); Ruby has no
  equivalent of a "collection builder" that Enumerable can consult.
- **Enumerable's implementations are generic, so they're linear even when your
  class could do better** — `include?` walks every element via `each`, which is
  the right default but is O(n) on a class that has a hash index internally.
  Overriding `include?`, `size`, or `min`/`max` with a specialized version is
  normal and expected; you keep the rest of the mixin.
- **External iteration (`next`/`peek`) is far more expensive than internal
  iteration** — MRI backs it with a Fiber, so each `next` is a context switch.
  Reach for it when you genuinely need independent control of two sequences, not
  as a general-purpose loop:
  ```ruby
  # internal: one pass, no fiber
  arr.each { |x| use(x) }
  # external: a fiber switch per element
  e = arr.each
  loop { use(e.next) }
  ```
- **`.lazy` is a win for infinite, huge, or expensive-per-element sources and a
  loss for small ones** — every stage adds a block-call indirection per element,
  so a lazy chain over a 20-item array is measurably slower than the eager
  version. Use it when the pipeline would otherwise compute values nobody reads,
  or allocate intermediate arrays you can't afford (see the Memory, GC, and
  Fragmentation concept for why those intermediates matter).
- **A lazy chain that never gets forced looks like it did nothing** — no output,
  no error, no side effects, because none of the blocks ever ran. Forgetting the
  terminal `first(n)`/`force`/`to_a` is the characteristic `Enumerator::Lazy`
  bug, and it fails silently rather than raising.

## Documentation Links

- [Enumerable — Ruby Core docs](https://docs.ruby-lang.org/en/3.3/Enumerable.html) — doc
- [Enumerator — Ruby Core docs](https://docs.ruby-lang.org/en/3.3/Enumerator.html) — doc
- [Enumerator::Lazy — Ruby Core docs](https://docs.ruby-lang.org/en/3.3/Enumerator/Lazy.html) — doc
- [Programming Ruby 3.3 (Pickaxe) — Collections, Blocks, and Iterators](https://pragprog.com/titles/ruby5/programming-ruby-3-3-5th-edition/) — doc
