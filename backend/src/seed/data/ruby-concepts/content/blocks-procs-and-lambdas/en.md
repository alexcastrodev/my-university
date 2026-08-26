---
version: 1.0
updatedAt: 2026-08-17
---
## Objective

Blocks are Ruby's most-used feature and its least obviously named: `{ ... }` or
`do...end` attached to a method call is a closure — it captures the local
variables around it — and `yield` inside a method invokes whichever block was
passed. `Proc` and `Lambda` are the two ways to turn that block into a first-class
object you can store and pass around, and they differ in exactly two ways that
matter: how strict they are about the number of arguments, and what `return`
does inside them.

## Use Cases

- Writing your own methods that accept a block (custom iterators, resource
  wrappers with automatic cleanup, DSL-style configuration methods).
- Choosing `proc`/`->(x)` vs `lambda`/`->(x)` correctly — most of the time you
  want lambda semantics (strict arity, local `return`), so `->(x) { }` is the
  idiomatic default in modern Ruby.
- Converting a method or symbol into a block with `&` (`arr.map(&:upcase)`,
  `arr.map(&method(:process))`) instead of writing an equivalent block by hand.
- Using `Enumerator::Lazy` to compose `map`/`select` over a sequence that may be
  infinite, without materializing it.

## Deep Dive

### Blocks are closures

```ruby
def with_total
  total = 0
  yield ->(n) { total += n }
  total
end

with_total { |add| add.(3); add.(4) }   # => 7
```

The block captures `total` from the surrounding scope directly — it's not copied,
it's the same variable. This is what makes idioms like a running accumulator, a
memoized cache, or a counter closure work without any object needed to hold the
state.

### Proc vs Lambda: arity and `return`

```ruby
add_proc   = proc   { |a, b| (a || 0) + (b || 0) }
add_lambda = lambda { |a, b| a + b }
# or, the idiomatic form:
add_lambda = ->(a, b) { a + b }

add_proc.call(1)          # => 1  (missing arg silently becomes nil)
add_lambda.call(1)        # ArgumentError: wrong number of arguments (given 1, expected 2)
```

```ruby
def proc_return
  p = proc { return 10 }   # returns from proc_return itself
  p.call
  20                        # never reached
end

def lambda_return
  l = -> { return 10 }      # returns only from the lambda
  l.call
  20                        # this IS reached
end

proc_return    # => 10
lambda_return  # => 20
```

A `return` inside a `proc` returns from the **enclosing method** — which raises
`LocalJumpError` if that proc outlives the method it was created in and gets
called later. A `return` inside a `lambda` returns only from the lambda itself,
behaving like a normal method call. This is the single most common source of
"why did my proc explode" bugs, and it's the main reason `->(x) { }` (lambda) is
the safer default over `proc { |x| }` unless you specifically want the
proc's looser, non-strict behavior.

### `Symbol#to_proc` and method references as blocks

```ruby
%w[a b c].map(&:upcase)              # equivalent to .map { |s| s.upcase }
%w[1 2 3].map(&method(:Integer))     # any object with #to_proc works with &
```

`&` converts whatever follows it into a block using `to_proc` — `Symbol#to_proc`
turns `:upcase` into `->(x) { x.upcase }`, and `Method#to_proc` does the same for
an existing method reference, which is often more readable than an inline block
for a one-argument transformation that already has a name.

### `.lazy` for sequences that don't fit in memory

```ruby
(1..Float::INFINITY).lazy
  .select(&:even?)
  .map { |n| n * n }
  .first(3)   # => [4, 16, 36]
```

Without `.lazy`, `select` on an infinite range would never return — it tries to
build the whole filtered array before `map` even starts. `.lazy` chains each
step as a pending transformation and only pulls values through the pipeline when
something (`.first(n)`, `.take(n)`, etc.) actually asks for them.

## Trade-offs

- **Proc's loose arity checking is occasionally useful (event handlers with a
  variable-length payload) but is a footgun everywhere else** — prefer lambda
  syntax (`->(x) { }`) unless you deliberately want a proc's "pad missing args
  with nil" behavior.
- **A block parameter with the same name as an outer local variable shadows it
  inside the block, but a block *without* that parameter reads and mutates the
  outer one** — this is the exact mechanism that makes closures useful and also
  the exact mechanism that causes accidental variable capture in loops that spawn
  threads or procs (see the GVL & Concurrency concept for the threaded version of
  this bug).
- **`return` inside a proc stored past the lifetime of its defining method
  raises at call time, not at definition time** — the bug only shows up when the
  proc is actually invoked, which can be far from where it was written:
  ```ruby
  def make_proc
    proc { return 1 }
  end
  make_proc.call   # LocalJumpError: unexpected return
  ```

## Documentation Links

- [Proc — Ruby Core docs](https://docs.ruby-lang.org/en/3.3/Proc.html) — doc
- [Enumerable — Ruby Core docs](https://docs.ruby-lang.org/en/3.3/Enumerable.html) — doc
- [Symbol#to_proc — Ruby Core docs](https://docs.ruby-lang.org/en/3.3/Symbol.html#method-i-to_proc) — doc
