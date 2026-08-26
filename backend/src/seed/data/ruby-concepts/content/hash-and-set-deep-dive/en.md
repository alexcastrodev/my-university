---
version: 1.0
updatedAt: 2026-08-18
---
## Objective

`Hash` and `Set` are the two containers most Ruby developers think they already
know, and both hide behavior that bites in production. `Hash` has a default-value
mechanism with two forms that look interchangeable and are not: one shares a
single object across every missing key, the other builds a fresh one per key.
It also carries a filtering and merging vocabulary — `fetch`, `merge` with a
conflict block, `slice`/`except`, `transform_keys`/`transform_values`,
`Hash#to_proc` — that replaces a lot of hand-written `each_with_object`. `Set`
sits between Array and Hash: unique elements, insertion-ordered, with real set
algebra (`|`, `&`, `-`, `^`), a `<=>` that compares by **subset relation** rather
than magnitude, and `add?`/`delete?` methods that return `nil` instead of `false`.

## Use Cases

- Grouping records under a key without pre-seeding the container — the
  `Hash.new { |h, k| h[k] = [] }` accumulator, and knowing why the one-argument
  form silently corrupts it.
- Reading configuration or params where a missing key is a bug, not a `nil`:
  `fetch` turns the mistake into a `KeyError` at the point of the lookup instead
  of a `NoMethodError` three frames later.
- Merging layered settings (defaults, file, environment, CLI flags) where a key
  present in both sides needs a real resolution rule, not last-writer-wins.
- Reshaping a payload before it crosses a boundary — symbolizing keys, coercing
  values, dropping fields — without writing a `map` that rebuilds pairs by hand.
- Deduplicating and comparing collections of IDs: which permissions did the user
  gain and lose, which tags do two posts share, is this role's set of scopes a
  subset of the allowed ones.

## Deep Dive

### The `Hash` default-value trap

`Hash.new` takes either a default **value** or a default **block**, and the
difference is not stylistic.

```ruby
h = Hash.new([])          # one array object, created once

h[:a] << 1
h[:b] << 2

h[:a]        # => [1, 2]   <- both pushes landed in the same array
h[:b]        # => [1, 2]
h[:zzz]      # => [1, 2]   <- a key never touched sees them too
h.keys       # => []       <- and the hash is still empty!
```

Two separate surprises in one snippet. The default is a *single* object shared by
every missing key, so `<<` mutates the thing all of them point at. And `h[:a] <<
1` never assigns anything — `[]` returns the default, `<<` mutates it, and the
hash itself is never modified, which is why `h.keys` is empty.

The block form fixes both, because it runs on every miss and the body does the
assignment:

```ruby
h = Hash.new { |hash, key| hash[key] = [] }

h[:a] << 1
h[:b] << 2

h[:a]        # => [1]
h[:b]        # => [2]
h.keys       # => [:a, :b]
h[:c]        # => []      and :c now exists — merely reading created it
h.keys       # => [:a, :b, :c]
```

Rule of thumb: **a mutable default (`[]`, `{}`, `""`, a Struct) always needs the
block form.** An immutable default (`0`, `false`, a frozen string, `nil`) is safe
as a plain value, and that's the honest use of `Hash.new(0)` for counters:

```ruby
counts = Hash.new(0)
"mississippi".each_char { |c| counts[c] += 1 }
counts       # => {"m" => 1, "i" => 4, "s" => 4, "p" => 2}
```

`counts[c] += 1` expands to `counts[c] = counts[c] + 1`, which is a real
assignment — integers are immutable so there is nothing to share.

Note the block-form hash grows just by *reading*, which matters when you hand it
to code that probes for keys. `Hash#dig` and `fetch` do not trigger the default
block assignment the same way (`fetch` ignores the default entirely), so a
read-only probe should use `fetch(key, [])` rather than `[]`.

### `fetch`: making a missing key loud

`[]` returns `nil` for an unknown key, which propagates and fails somewhere else.
`fetch` gives you three explicit choices:

```ruby
config = { host: "localhost", port: 5432 }

config.fetch(:host)                  # => "localhost"
config.fetch(:user, "postgres")      # => "postgres"    (default argument)
config.fetch(:pool) { |key| ENV.fetch("DB_#{key.upcase}", 5) }  # block, gets the key
config.fetch(:password)              # => KeyError: key not found: :password
```

The bare `fetch(key)` form is the point: no default and no block means a
`KeyError` raised at the exact line of the bad lookup, with the key name in the
message. The block form is also the lazy one — its body only runs on a miss, so
`fetch(:conn) { expensive_default }` doesn't pay for the default when the key is
present, unlike `fetch(:conn, expensive_default)` which evaluates the argument
either way.

### Insertion order is a guarantee, not an implementation detail

Ruby hashes iterate in insertion order, and that is specified language behavior —
you can rely on it in serialization, in test assertions, in generated output.

```ruby
h = {}
h[:zebra] = 1
h[:apple] = 2
h[:mango] = 3

h.keys                # => [:zebra, :apple, :mango]
h.first               # => [:zebra, 1]
h.to_a                # => [[:zebra, 1], [:apple, 2], [:mango, 3]]

h[:zebra] = 99        # updating a value does NOT move the key
h.keys                # => [:zebra, :apple, :mango]

h.delete(:zebra)
h[:zebra] = 1         # deleting and re-adding DOES move it to the end
h.keys                # => [:apple, :mango, :zebra]
```

### `merge` with a conflict block

Plain `merge` is last-wins. Pass a block and you decide, per conflicting key,
what the resulting value is — the block receives `|key, old_value, new_value|`
and only fires for keys present in **both** hashes.

```ruby
defaults = { retries: 3, timeout: 10, tags: %w[base] }
override = { timeout: 30, tags: %w[prod urgent] }

defaults.merge(override)
# => {retries: 3, timeout: 30, tags: ["prod", "urgent"]}

defaults.merge(override) { |key, old, new| key == :tags ? old | new : new }
# => {retries: 3, timeout: 30, tags: ["base", "prod", "urgent"]}
```

`merge!` (alias `update`) does the same in place. `merge` also accepts several
hashes at once, applying the block left to right:

```ruby
{ a: 1 }.merge({ a: 2 }, { a: 3 }) { |_k, old, new| old + new }  # => {a: 6}
```

That "sum on conflict" one-liner is the idiomatic way to combine counter hashes.

### Filtering by key: `slice` and `except`

```ruby
params = { id: 7, name: "Ada", email: "ada@example.com", admin: true, _csrf: "x" }

params.slice(:name, :email)      # => {name: "Ada", email: "ada@example.com"}
params.except(:_csrf, :admin)    # => {id: 7, name: "Ada", email: "ada@example.com"}
params.slice(:name, :nonexistent) # => {name: "Ada"}  (missing keys are skipped)
```

Both return a new hash and both take a splat of keys, so an allowlist or a
denylist can live in a constant: `params.slice(*PUBLIC_FIELDS)`. `slice` never
raises on unknown keys, which makes it safe over untrusted input but also means
it won't tell you when your allowlist has a typo.

### `transform_keys` and `transform_values`

`map` over a Hash forces you to handle both halves of the pair and returns an
Array of pairs you then have to `to_h`. When only one side changes, say so:

```ruby
row = { "user_id" => "42", "created_at" => "2026-08-18", "active" => "true" }

row.transform_keys(&:to_sym)
# => {user_id: "42", created_at: "2026-08-18", active: "true"}

row.transform_values(&:strip)
# => same keys, whitespace-trimmed values

row.transform_keys(&:to_sym).transform_values { |v| v == "true" ? true : v }
# => {user_id: "42", created_at: "2026-08-18", active: true}
```

`transform_keys` also takes a hash of explicit renames, with the block handling
whatever isn't listed:

```ruby
row.transform_keys("user_id" => :id) { |k| k.to_sym }
# => {id: "42", created_at: "2026-08-18", active: "true"}
```

The bang versions `transform_keys!` / `transform_values!` mutate in place. Note
the asymmetry with `map`: these return a **Hash**, not an Array, so they chain
with the rest of the Hash vocabulary.

### `Hash#to_proc`: a hash as a lookup function

`&` on an object calls `to_proc`. Everyone knows the `Symbol#to_proc` version
(`map(&:upcase)`); `Hash` implements it too, producing a proc that looks each
element up as a key.

```ruby
ROLE_NAMES = { 0 => "guest", 1 => "member", 2 => "admin" }

[2, 0, 1, 1].map(&ROLE_NAMES)     # => ["admin", "guest", "member", "member"]
[2, 9].map(&ROLE_NAMES)           # => ["admin", nil]   (missing key -> nil)
```

It's the same mechanism, not a special case: `ROLE_NAMES.to_proc.call(2)` is
`ROLE_NAMES[2]`. Because it goes through `[]`, a `Hash.new`-supplied default
applies, so `Hash.new("unknown")` gives you a total function.

### `Set`: between Array and Hash

`Set` stores unique elements and — unlike a mathematical set or Java's
`HashSet` — **iterates in insertion order**. It's backed by a Hash internally,
which is where both the uniqueness semantics and the ordering come from.

```ruby
require "set"   # needed on older rubies; autoloaded since 3.2, core class in 4.0

a = Set[3, 1, 2, 3, 1]
a.to_a                 # => [3, 1, 2]   (order of first insertion, not sorted)
a.size                 # => 3
a.include?(2)          # => true        (O(1), unlike Array#include?)

# Set.new accepts any enumerable
Set.new(1..5)          # => Set[1, 2, 3, 4, 5]
Set.new("hello".chars) # => Set["h", "e", "l", "o"]
Set.new([1, 2, 3]) { |n| n * 10 }  # => Set[10, 20, 30]  (optional block maps first)
```

> ⚠️ **Book vs. today (Ruby 4.0):** `Set#inspect` changed from `#<Set: {1, 2,
> 3}>` to the eval-friendly `Set[1, 2, 3]` — literal syntax that can be fed
> straight back into `eval` to reconstruct the same set, matching how `Array`
> and `Hash` already inspect. A subclass of `Set` itself keeps the old
> `#<MySet: {...}>` format for backward compatibility; only subclasses of the
> new `Set::CoreSet` get the new format. Anything that parses `Set#inspect`
> output in a test or a log — rare, but it happens — needs updating across this
> version boundary. Separately, the `sorted_set` gem (`SortedSet`) was dropped
> from the standard library in 4.0; it depended on the external `rbtree` gem
> and had fallen behind — add `sorted_set` explicitly to your `Gemfile` if you
> still need it.

Membership uses `hash` and `eql?`, exactly like Hash keys — so two distinct but
`eql?` objects collapse into one entry. `compare_by_identity` switches the rule
to `object_id`, making even equal-looking objects distinct:

```ruby
s = Set.new(["ruby", "ruby".dup])
s.size                        # => 1   (eql? strings collapse)

t = Set.new.compare_by_identity
t << "ruby" << "ruby".dup
t.size                        # => 2   (different objects, different ids)
```

### The set operators

```ruby
a = Set[1, 2, 3, 4]
b = Set[3, 4, 5]

a | b     # => #<Set: {1, 2, 3, 4, 5}>   union        (also a.union(b), a + b)
a & b     # => #<Set: {3, 4}>            intersection (also a.intersection(b))
a - b     # => #<Set: {1, 2}>            difference   (also a.difference(b))
a ^ b     # => #<Set: {5, 1, 2}>         symmetric difference (XOR)
```

`^` is "in one or the other but not both" — it's exactly `(a | b) - (a & b)`, and
it's the operator that answers "what changed?" in one step:

```ruby
before = Set[:read, :write, :admin]
after  = Set[:read, :write, :billing]

after - before   # => #<Set: {:billing}>   gained
before - after   # => #<Set: {:admin}>     lost
before ^ after   # => #<Set: {:billing, :admin}>  everything that moved
```

All of these accept any enumerable on the right, not just another Set:
`a | [7, 8]` works.

### `<=>` compares by subset, and can return `nil`

This is the one that surprises people coming from other collection libraries.
`Set#<=>` does not compare size or contents lexically — it reports the **subset
relation**, and returns `nil` when neither set contains the other.

```ruby
Set[1, 2]    <=> Set[1, 2, 3]   # => -1    proper subset
Set[1, 2, 3] <=> Set[1, 2]      # => 1     proper superset
Set[1, 2]    <=> Set[2, 1]      # => 0     equal (order irrelevant to equality)
Set[1, 2]    <=> Set[2, 3]      # => nil   overlapping, neither contains the other
Set[1, 2]    <=> Set[8, 9]      # => nil   disjoint — still nil, not -1
```

Note that last pair: `Set[1, 2]` and `Set[8, 9]` are the same size and have no
relationship, so there is no answer — `nil`. The practical consequence is that
`Set` is **not** meaningfully `Comparable`: `sets.sort` raises `ArgumentError`
the moment two of them are unrelated, because `sort` can't handle a `nil`
comparison. Sort by an explicit key instead (`sets.sort_by(&:size)`), and use the
named predicates when you want a boolean:

```ruby
Set[1, 2].subset?(Set[1, 2, 3])         # => true
Set[1, 2].proper_subset?(Set[1, 2])     # => false
Set[1, 2].superset?(Set[1])             # => true
Set[1, 2].disjoint?(Set[8, 9])          # => true
Set[1, 2].intersect?(Set[2, 3])         # => true
```

### `add?` and `delete?` return `nil`, not `false`

Ruby's convention is that a `?` method returns a boolean. `Set#add?` and
`Set#delete?` break it: they return `self` when the set changed, and **`nil`**
when it didn't.

```ruby
s = Set[1, 2]

s.add(3)      # => #<Set: {1, 2, 3}>   always returns self
s.add(3)      # => #<Set: {1, 2, 3}>   no way to tell it was already there

s.add?(4)     # => #<Set: {1, 2, 3, 4}>   truthy: it was actually added
s.add?(4)     # => nil                    already present, nothing changed

s.delete?(4)  # => #<Set: {1, 2, 3}>      truthy: it was removed
s.delete?(99) # => nil                    wasn't there
```

That makes them the idiomatic "insert if new" primitive — a dedup guard that
costs one lookup instead of `include?` followed by `add`:

```ruby
seen = Set.new
urls.each do |url|
  next unless seen.add?(url)   # skip duplicates in one operation
  crawl(url)
end
```

The `nil` return is fine for `if`/`unless`/`next unless`, since `nil` is falsy.
It breaks the moment you compare against `false` explicitly:

```ruby
s.add?(4) == false    # => false  — WRONG, nothing was added but this says "false"
s.add?(4).nil?        # => true   — correct test for "no change"
!s.add?(4)            # => true   — correct, nil is falsy
```

So `if set.add?(x) == false` is a bug that reads as correct. Test truthiness, or
test `nil?`.

### `classify` and `divide`

`classify` runs a block over every element and returns a **Hash of Sets**, keyed
by the block's return value — `group_by` for sets, with set-typed buckets:

```ruby
words = Set["apple", "avocado", "banana", "blueberry", "cherry"]

words.classify { |w| w[0] }
# => {"a" => #<Set: {"apple", "avocado"}>,
#     "b" => #<Set: {"banana", "blueberry"}>,
#     "c" => #<Set: {"cherry"}>}

words.classify(&:length)
# => {5 => #<Set: {"apple"}>, 7 => #<Set: {"avocado"}>, 6 => #<Set: {"banana", "cherry"}>, 9 => #<Set: {"blueberry"}>}
```

Because the buckets are Sets, you can feed them straight back into the operators:
`by_letter["a"] & allowed`. Its sibling `divide` takes a one- or two-arity block
and returns a set of sets, partitioning by an equivalence relation rather than a
key — `divide { |a, b| (a - b).abs == 1 }` groups consecutive numbers into runs.

## Trade-offs

- **The convenient `Hash.new(value)` form is the wrong one for anything
  mutable** — and it fails silently, producing plausible-looking data where every
  key shares state. There is no warning and no error; you notice when two
  unrelated groups contain each other's records. Reserve the value form for
  immutable defaults (`0`, `false`, frozen strings) and reach for the block form
  everywhere else.
- **The block form makes reads mutate the hash** — `h[:missing]` inserts the key.
  That's usually what you want in an accumulator and exactly what you don't want
  in code that probes for optional keys, since the hash grows on every miss and
  `h.key?` starts reporting keys nobody set. Probe with `fetch(key, default)` or
  `dig`, which don't assign.
- **`fetch` trades convenience for a stack trace at the right place** — it's more
  typing than `[]` and it raises, so it's wrong for genuinely optional lookups.
  The payoff is that a required-key mistake surfaces as `KeyError: key not found:
  :password` at the lookup, instead of `undefined method for nil` in whatever
  code received the `nil`.
- **`slice`/`except`/`transform_*` all allocate a new hash** — they're clear, but
  a chain of four of them over a large hash makes four copies. The bang versions
  exist for `transform_keys!`/`transform_values!`; for the rest, a single
  `each_with_object` pass is the escape hatch when the hash is big enough that it
  shows up in a profile.
- **`Set` costs an object and a hash lookup to buy O(1) membership** — for a
  handful of elements, `Array#include?` on 5 items beats building a Set, and the
  Array is cheaper to allocate. Set wins when membership is tested repeatedly or
  the collection is large; converting an Array to a Set for one `include?` is a
  net loss (see the Memory, GC, and Fragmentation concept on allocation cost).
- **`Set` is insertion-ordered but that order is not part of set equality** —
  `Set[1, 2] == Set[2, 1]` is `true` while `[1, 2] == [2, 1]` is `false`. Handy
  for comparison, misleading if you were relying on ordering as a semantic
  signal; if order carries meaning, you wanted an Array (or an Array plus a Set
  used only as a membership index).
- **`Set#<=>` returning `nil` makes `sort`, `min`, `max`, and `Comparable`-style
  chaining unsafe on sets** — they raise `ArgumentError` on the first unrelated
  pair, and whether they raise depends on the data, so it can pass in tests and
  fail in production. Sort sets by an explicit key with `sort_by`, and express
  intent with `subset?`/`superset?`/`disjoint?` instead of the operator.
- **`add?`/`delete?` returning `nil` rather than `false` violates the `?`
  convention** — the upside is a single-operation "insert if absent" idiom; the
  downside is that any explicit `== false` or `is_a?(FalseClass)` check against
  them is wrong. Use them in boolean position (`next unless seen.add?(x)`) and
  never compare their result to a literal.

## Documentation Links

- [Hash — Ruby Core docs](https://docs.ruby-lang.org/en/3.3/Hash.html) — doc
- [Set — Ruby Core docs](https://docs.ruby-lang.org/en/3.3/Set.html) — doc
- [Programming Ruby 3.3 (Pickaxe) — Enumerators and Containers](https://pragprog.com/titles/ruby5/programming-ruby-3-3-5th-edition/) — doc
- [Ruby 4.0.0 Released — ruby-lang.org](https://www.ruby-lang.org/en/news/2025/12/25/ruby-4-0-0-released/) — doc
