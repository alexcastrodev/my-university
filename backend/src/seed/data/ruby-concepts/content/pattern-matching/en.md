---
version: 1.0
updatedAt: 2026-08-17
---
## Objective

Pattern matching (`case/in`, standalone `in`, and rightward assignment `=>`)
lets you deconstruct arrays, hashes, and custom objects while checking their
shape in one expression, instead of a chain of `is_a?`/`[]`/`dig` calls. It
reuses the same `===` semantics as `case/when` for scalar matches, but adds
structural matching, variable binding, and guard clauses on top — it's the
one genuinely new control-flow feature Ruby has added in recent versions,
and it shows up increasingly often in real codebases handling JSON-shaped
data (API responses, config).

## Use Cases

- Deconstructing an API response or parsed JSON hash into local variables
  in one line, with a built-in check that required keys are present.
- Handling a family of result objects (`Success`/`Failure`, a tagged union)
  with `case/in` instead of a chain of `is_a?` checks.
- Validating input shape and extracting values at the same time — a single
  `in` expression replaces separate "is this the right shape" and "now
  extract the fields" steps.
- Searching for an element in a specific position inside an array without a
  manual index/loop, using a find pattern.

## Deep Dive

### Array and hash patterns

```ruby
config = { host: "db.internal", port: 5432, ssl: true }

case config
in { host:, port:, ssl: true }
  puts "Connecting to #{host}:#{port} over SSL"
in { host:, port: }
  puts "Connecting to #{host}:#{port} without SSL"
end
# => "Connecting to db.internal:5432 over SSL"
```

Hash patterns only require the keys they mention — extra keys in the target
don't break the match. `{host:, port:, ssl: true}` both binds `host`/`port`
as local variables (shorthand for `{host: host, port: port}`) and requires
`ssl` to literally equal `true`. To require an *exact* hash shape with no
extra keys, add `**nil` to the pattern.

```ruby
case [1, 2, 3]
in [Integer, Integer, Integer] => all_ints
  puts "three ints: #{all_ints}"
end
# => "three ints: [1, 2, 3]"
```

Array patterns match element-by-element and can check types via `===`
(`Integer` matches any Integer). `=> all_ints` binds the whole matched value
to a variable — the same `=>` binding syntax works at any nesting level.

### Find patterns: searching inside an array

```ruby
log_line = ["INFO", "2026-08-17", "user_id=42", "checkout", "completed"]

case log_line
in [*, /user_id=(\d+)/ => match, *]
  puts "Found a user_id field: #{match}"
end
```

The `*` on both sides of a pattern element means "search anywhere in the
array for this," rather than requiring the match at a fixed position —
useful for pulling one known field out of a loosely-structured array
without knowing its exact index.

### Guard clauses and the pin operator

```ruby
def classify(pair)
  case pair
  in [a, b] if a == b
    "equal"
  in [a, b] if a > b
    "descending"
  else
    "ascending"
  end
end
```

```ruby
expected = 5
case [5, "five"]
in [^expected, label]
  puts "Matched the expected value, label is #{label}"
end
```

`if`/`unless` after a pattern adds a boolean condition that can reference
variables the pattern just bound. The pin operator `^` does the opposite of
binding — `^expected` matches against the **current value** of `expected`
instead of creating a new local variable, which is how you compare against
something already known rather than capturing whatever's there.

### Custom objects: `deconstruct` and `deconstruct_keys`

```ruby
Point = Struct.new(:x, :y)

case Point.new(0, 5)
in { x: 0, y: }
  puts "On the y-axis at #{y}"
end
```

`Struct` (and `Data`) implement `deconstruct`/`deconstruct_keys`
automatically, which is why they work directly in patterns. Any class can
opt in by defining these methods itself — `deconstruct` returns an Array
for array patterns, `deconstruct_keys(keys)` returns a Hash for hash
patterns (the `keys` argument is the subset of keys the pattern actually
asked for, useful as an optimization hint).

## Trade-offs

- **`in` (standalone or in `case/in`) returns `false` silently on no match;
  the standalone rightward form `value => pattern` raises
  `NoMatchingPatternError` instead** — picking the wrong one either hides a
  bug behind a falsy value or crashes where a graceful check was intended.
  ```ruby
  "text" in Integer   # => false, no error
  "text" => Integer   # NoMatchingPatternError
  ```
- **Variable bindings inside a pattern that partially matched before
  failing are explicitly undefined behavior** — don't rely on any variable
  a failed `in`/`case in` branch might have started binding.
- **You can't bind a variable inside a `|` alternation pattern** (`[Integer,
  Integer] | [String, String] => pair` binds `pair` to the whole match, but
  you can't bind pieces *within* each alternative) — patterns needing that
  level of per-branch binding have to be split into separate `in` clauses
  instead of combined with `|`.

## Documentation Links

- [Pattern matching — Ruby Core syntax docs](https://docs.ruby-lang.org/en/3.3/syntax/pattern_matching_rdoc.html) — doc
- [Object#deconstruct, #deconstruct_keys — Ruby Core docs](https://docs.ruby-lang.org/en/3.3/Object.html) — doc
