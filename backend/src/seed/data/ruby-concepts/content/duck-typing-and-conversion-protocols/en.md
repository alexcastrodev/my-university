---
version: 1.0
updatedAt: 2026-08-18
---
## Objective

In Ruby, an object's "type" is not its class — it's the set of messages it
responds to, resolved at the moment a method is called. If it walks like a duck
and quacks like a duck, Ruby treats it like a duck. That single idea is what
lets you pass an `Array` where a file was expected, swap a `String` accumulator
for an `Array` without touching the code that fills it, and validate an object
by asking `respond_to?(:<<)` instead of `is_a?(File)`. On top of it, Ruby layers
a formal set of *conversion protocols* — short-named explicit conversions
(`to_s`, `to_i`) that you call, and long-named implicit conversions (`to_str`,
`to_int`) that the interpreter calls for you — and the difference between the
two is one of the most commonly misunderstood parts of the language.

## Use Cases

- Writing a method that takes "something to write to" and accepting any object
  that responds to `<<`, so tests can pass an `Array` instead of creating,
  reading, and deleting a real temp file.
- Swapping a data structure for a faster one (`String` accumulator → `Array` +
  `join`) without changing the code that builds the content, because that code
  never asked what class it was holding.
- Validating that an argument can do what you need with `respond_to?`, rather
  than pinning callers to one inheritance hierarchy with `kind_of?`.
- Making a custom value object usable in arithmetic that starts with a built-in
  on the left (`3 * roman`) by implementing `coerce`.
- Deciding whether your class should implement `to_s` only, or also `to_str` —
  i.e. whether it merely *renders as* a String or is genuinely substitutable
  for one.

## Deep Dive

### Duck typing makes tests cheap

```ruby
def write_report(rows, out)
  rows.each do |row|
    out << row.join(",")
    out << "\n"
  end
  out
end
```

`write_report` never asks what `out` is. In production it gets a `File`; in a
test it can get anything that responds to `<<`:

```ruby
lines = []
write_report([[1, "a"], [2, "b"]], lines)
lines # => ["1,a", "\n", "2,b", "\n"]

buffer = +""
write_report([[1, "a"]], buffer)
buffer # => "1,a\n"
```

No temp directory, no cleanup, no filesystem in the test at all — and no mock
object either. The method's real contract was never "a File", it was
"responds to `<<`".

### The same flexibility is a performance lever

This is the Pickaxe's war story, and it's worth reconstructing because it shows
duck typing paying off in production rather than in a test. A CSV export built
its output in a `String`:

```ruby
csv = +""
write_report(rows, csv)   # minutes, for a large report
File.write("report.csv", csv)
```

Every `String#<<` on a growing string can force a reallocation and a copy of the
accumulated bytes, so the cost grows with the size of the report and the garbage
collector spends its time chasing ever-larger short-lived strings. The fix
touched exactly zero lines of `write_report`:

```ruby
csv = []
write_report(rows, csv)   # seconds, same report
File.write("report.csv", csv.join)
```

`Array#<<` just pushes a reference — no reallocation of a giant string, far less
garbage. The builder method worked unchanged because it only ever sent `<<`. Had
it contained a single `raise unless out.is_a?(String)`, the optimization would
have required rewriting it.

### `respond_to?` over class checks

```ruby
def write_report(rows, out)
  unless out.respond_to?(:<<)
    raise ArgumentError, "expected an object responding to #<<, got #{out.class}"
  end
  # ...
end
```

`respond_to?(:<<)` asks the question the method actually cares about. `is_a?(IO)`
asks a different, stricter question and would reject the `Array` and the `String`
that work perfectly well. Pass `true` as the second argument
(`respond_to?(:helper, true)`) to include private methods; define
`respond_to_missing?` if your object answers methods through `method_missing`,
or `respond_to?` will lie about them.

### Explicit vs. implicit conversion: the long-name/short-name rule

Explicit conversions have **short names** — `to_s`, `to_i`, `to_a`, `to_h`. You
call them deliberately. They promise a *reasonable representation* in the target
type; they do not claim the object is that type. `nil.to_a` is `[]`, `"3 apples".to_i`
is `3` — helpful, not literal.

Implicit conversions have **long names** — `to_str`, `to_int`, `to_ary`,
`to_hash`. *The interpreter* calls these, on its own, when it needs a value of
that exact type. Implementing one is a much stronger claim: "my object is
substitutable 1:1 for a real String / Integer / Array / Hash."

> ⚠️ **Book vs. today (Ruby 4.0):** the splat operator itself used to break
> this rule. `[*nil]` and a bare `*nil` argument silently called `nil.to_a`
> under the hood — invoking the *explicit* conversion from a position that, by
> this file's own rule, should only ever trigger the *implicit* one (`to_ary`).
> That mismatch is exactly the kind of "magical and inconsistent" behavior the
> long-name/short-name split exists to prevent:
> ```ruby
> def nil.to_a = [1, 2, 3]
> def m(*args) = args
>
> m(*nil)   # Ruby 3.4: [1, 2, 3] — silently ran nil.to_a
>           # Ruby 4.0: []        — *nil is just "no arguments," to_a never runs
> ```
> Ruby 4.0 fixed it: `*nil` is now treated as "nothing," with no conversion
> call at all — bringing `*` in line with how `**nil` already skipped
> `nil.to_hash` since Ruby 3.4. If you ever relied on `*obj` triggering a
> custom `to_a`, that reliance now needs `to_ary` instead, which is the
> conversion splat was always supposed to use.

```ruby
class RomanNumeral
  VALUES = { "M" => 1000, "D" => 500, "C" => 100, "L" => 50,
             "X" => 10, "V" => 5, "I" => 1 }.freeze

  def initialize(string)
    @string = string
  end

  def to_s  = @string
  def to_i
    @string.chars.map { VALUES.fetch(_1) }.each_cons(2).sum { |a, b| a < b ? -a : a } +
      VALUES.fetch(@string.chars.last)
  end
  alias to_int to_i   # yes: a Roman numeral IS an integer
  # NO to_str: "XIV" renders as a string, but this object is not a String
end

xiv = RomanNumeral.new("XIV")
xiv.to_i         # => 14
[1, 2, 3][xiv]   # nil — Array#[] called to_int for us, no explicit conversion written
"ab" * xiv       # works: String#* wants an Integer, finds to_int
```

Because `RomanNumeral` implements `to_int`, it slides into every place Ruby
expects an Integer. Because it does *not* implement `to_str`, `"total: " + xiv`
still raises `TypeError` — correctly, since a numeral is not a string.

The implicit conversions the interpreter knows about:

| Method | Interpreter asks for it when it needs |
| --- | --- |
| `to_ary` | an `Array` — splat, multiple assignment, destructuring block params |
| `to_hash` | a `Hash` — `**` double-splat, keyword expansion |
| `to_int` | an `Integer` — indexing, repetition, numeric APIs |
| `to_io` | an `IO` object |
| `to_open` | an `IO` — used by `IO.open` / `open` |
| `to_path` | a filename `String` — `File.new`, `File.open`, `require` |
| `to_proc` | a `Proc` — the `&obj` argument prefix |
| `to_regexp` | a `Regexp` |
| `to_str` | a `String` — almost everywhere, *except* interpolation, which uses `to_s` |
| `to_sym` | a `Symbol` |

`File.new` is the classic demonstration of two of these at once: it accepts
anything responding to `to_int` (treating it as a file descriptor) *or* to
`to_path`/`to_str` (treating it as a filename), and picks its behavior from
which protocol the argument implements.

### `Kernel#Integer()` and friends: the conversions to reach for

When *you* are the one converting, prefer the capitalized `Kernel` methods —
`Array()`, `Integer()`, `Float()`, `String()`, `Hash()`, `Complex()`,
`Rational()`. Each tries the implicit conversion first, falls back to the
explicit one, and raises a clear exception instead of quietly producing junk:

```ruby
Integer("42")      # => 42
Integer("0x1f", 16) # => 31
Integer("42abc")   # ArgumentError — unlike "42abc".to_i, which returns 42
Integer(nil)       # TypeError    — unlike nil.to_i, which returns 0
Integer(xiv)       # => 14, via to_int

Array(nil)         # => []
Array([1, 2])      # => [1, 2]
Array("a\nb")      # => ["a\nb"]
Array(a: 1)        # => [[:a, 1]]
```

`"42abc".to_i` returning `42` is the right behavior for a *lenient* conversion
and the wrong behavior for parsing user input. `Integer()` is the one that fails
loudly, which is what you almost always want at a system boundary.

### `Symbol#to_proc`: what `&:upcase` actually does

The `&` prefix on an argument does not require a `Proc` — it requires something
that can *become* one, via `to_proc` (another implicit conversion):

```ruby
%w[a b c].map(&:upcase)  # => ["A", "B", "C"]
```

`Symbol#to_proc` returns roughly:

```ruby
proc { |obj, *args| obj.send(self, *args) }
```

"Send this message to whatever you're given." Nothing about `map` knows the
symbol trick exists — it just receives a block, because `&` performed a
conversion. The same mechanism means any object of yours can be passed with `&`
if it defines `to_proc`:

```ruby
class Multiplier
  def initialize(n) = @n = n
  def to_proc = proc { |x| x * @n }
end

[1, 2, 3].map(&Multiplier.new(3))  # => [3, 6, 9]
```

### Numeric coercion: double dispatch for arithmetic

`1 + 2.3` works even though `Integer#+` cannot add a `Float` directly. When the
left operand doesn't know how to handle the right one, it asks the right one to
level the playing field by calling `coerce`, which returns
`[converted_argument, converted_receiver]` — both now the same type — and the
original operation is retried on that pair. The result depends on *both*
classes: that's double dispatch.

```ruby
2.3.coerce(1)  # => [1.0, 2.3]
```

Implementing `coerce` is what makes a custom numeric-like object work with the
built-in literal on the *left*, where your class controls nothing:

```ruby
class RomanNumeral
  def coerce(other)
    [other, to_i]   # coerce toward the more general type: Integer
  end
end

xiv = RomanNumeral.new("XIV")
xiv.to_i * 3   # => 42, trivially — your class is the receiver
3 * xiv        # => 42, only because Integer#* asked xiv.coerce(3)
```

Always coerce *toward the more general type*. If `A#coerce` converts to `B` while
`B#coerce` converts back to `A`, the two classes hand the operation to each other
forever and you get an infinite coercion loop instead of a `TypeError`.

## Trade-offs

- **Duck typing removes compile-time guarantees in exchange for substitutability**
  — nothing tells you ahead of time that a caller will pass an object missing
  `<<`; you find out at the call site, at runtime, as a `NoMethodError`. The
  payoff is that swapping `String` for `Array` (or a real file for a fake one)
  costs nothing.
- **`respond_to?` guards are cheap but easy to overdo** — a check at a public API
  boundary buys a good error message instead of a confusing `NoMethodError` deep
  in a call stack. Sprinkling one before every internal call just reimplements
  static typing badly; letting `NoMethodError` fire is often the honest answer.
- **Implementing an implicit conversion is a promise you may not want to make** —
  `to_str` means "usable anywhere a String is", including string concatenation
  and file APIs. If that isn't true of your object, ship `to_s` only; a wrong
  `to_str` turns clear `TypeError`s into surprising behavior far from the cause.
- **Explicit conversions are lenient by design, which makes them wrong for
  parsing** — `to_i` never raises, so bad input becomes `0` and flows onward
  silently. `Integer()` costs an exception handler and gives you a failure at the
  boundary instead of a wrong number three layers in.
- **`coerce` unlocks natural arithmetic but adds a mutual-recursion hazard** — it
  must always convert toward a more general type, and it's called from code you
  don't control, so a mistake surfaces as a hang or a stack overflow rather than
  a local test failure.

## Documentation Links

- [Object#respond_to? — Ruby Core docs](https://docs.ruby-lang.org/en/3.3/Object.html#method-i-respond_to-3F) — doc
- [Kernel#Integer, #Array, #String, #Hash — Ruby Core docs](https://docs.ruby-lang.org/en/3.3/Kernel.html) — doc
- [Numeric#coerce — Ruby Core docs](https://docs.ruby-lang.org/en/3.3/Numeric.html#method-i-coerce) — doc
- [Symbol#to_proc — Ruby Core docs](https://docs.ruby-lang.org/en/3.3/Symbol.html#method-i-to_proc) — doc
- [Programming Ruby 3.3 (Pickaxe) — Ruby Style: Duck Typing](https://pragprog.com/titles/ruby5/programming-ruby-3-3-5th-edition/) — doc
- [Ruby 4.0.0 Released — ruby-lang.org](https://www.ruby-lang.org/en/news/2025/12/25/ruby-4-0-0-released/) — doc
