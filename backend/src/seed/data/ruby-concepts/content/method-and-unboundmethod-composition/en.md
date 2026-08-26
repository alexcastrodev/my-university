---
version: 1.0
updatedAt: 2026-08-18
---
## Objective

`obj.method(:name)` does not call anything. It hands you a `Method` object — the
method itself, packaged as a value you can store in a variable, put in a hash,
pass to `map`, compose with other methods, curry, or interrogate for its arity
and source location. `Class.instance_method(:name)` gives you the other half of
the pair: an `UnboundMethod`, the same implementation with the receiver
stripped off, which you can later `bind` onto some *other* object. Between them
they turn method dispatch — normally an event that happens and is gone — into
an object you can hold. That's the difference between "I can call this method"
and "I have this method."

## Use Cases

- Building a small transformation pipeline out of existing methods with `>>`
  instead of wrapping each one in a lambda: `strip >> squish >> truncate`.
- Passing an existing method where a block is expected, without re-typing its
  body: `rows.map(&method(:parse_row))`.
- Storing a dispatch table of `Method` objects (`{ csv: exporter.method(:to_csv) }`)
  so the handler is resolved once and invoked many times.
- Currying a multi-argument method into a partially applied one — pinning the
  first argument now, supplying the rest at each call site later.
- Asking a method how many arguments it wants (`arity`) or what shape they have
  (`parameters`) before invoking it dynamically.
- Reusing a module's method implementation on an object that does not include
  that module, via `UnboundMethod#bind_call`.
- Recovering an original implementation (`Kernel#inspect`) from an object whose
  class has overridden it — the trick debuggers and pretty-printers rely on.

## Deep Dive

### A `Method` is a value with a receiver already attached

```ruby
class TextPipeline
  def strip_tags(html) = html.gsub(/<[^>]+>/, "")
  def squish(text)     = text.strip.gsub(/\s+/, " ")
  def truncate(text)   = text.length > 20 ? "#{text[0, 17]}..." : text
end

pipe  = TextPipeline.new
strip = pipe.method(:strip_tags)

strip.class    # => Method
strip.receiver # => the pipe object itself — the binding is baked in
strip.owner    # => TextPipeline
```

Three call syntaxes invoke it, and they are interchangeable:

```ruby
strip.call("<b>hi</b>")  # => "hi"   — explicit
strip.("<b>hi</b>")      # => "hi"   — the .() shorthand
strip["<b>hi</b>"]       # => "hi"   — the [] shorthand
```

Because a `Method` responds to `to_proc`, it also drops straight into any
block slot with `&`:

```ruby
def shout(s) = s.upcase + "!"
%w[a b].map(&method(:shout))  # => ["A!", "B!"]
```

### Composition: `>>` reads forward, `<<` reads backward

This is the payoff for methods being objects. `Method#>>` and `Method#<<` build
a new `Proc` that chains two callables:

- `a >> b` — **pipeline, left to right**: call `a`, feed its result to `b`.
- `a << b` — **mathematical composition, right to left**: call `b` first, feed
  its result to `a`. This is `f∘g`.

```ruby
strip    = pipe.method(:strip_tags)
squish   = pipe.method(:squish)
truncate = pipe.method(:truncate)

raw = "<p>  Ruby   makes   methods first-class  </p>"

forward = strip >> squish >> truncate
forward.class        # => Proc
forward.call(raw)    # => "Ruby makes method..."

backward = truncate << squish << strip
backward.call(raw)   # => "Ruby makes method..."
```

Both spell the same pipeline in opposite reading orders. Follow `forward`
step by step: `strip_tags` removes `<p>` and `</p>`, leaving
`"  Ruby   makes   methods first-class  "`; `squish` collapses the whitespace to
`"Ruby makes methods first-class"` (30 characters); `truncate` sees 30 > 20 and
returns the first 17 characters plus an ellipsis. `backward` is written
innermost-last — `truncate << squish << strip` says "truncate of squish of
strip" — and executes `strip` first, exactly like the maths notation.

The result is a `Proc`, not a `Method`, so the chain composes further with
anything callable — lambdas and symbol-procs included:

```ruby
double = ->(n) { n * 2 }
def add_ten(n) = n + 10

(method(:add_ten) >> double).call(1)          # => 22  (11, then doubled)
(method(:add_ten) << double).call(1)          # => 12  (2, then +10)
(method(:add_ten) >> :to_s.to_proc).call(1)   # => "11"
```

Note how `>>` and `<<` on the *same* pair produce different answers (22 vs 12)
— the operators are not stylistic variants, they are opposite orders.

### `arity`: what the negative numbers mean

`Method#arity` reports how many arguments the method expects. When every
argument is required, it is a plain positive count. As soon as the method
accepts an *optional* or *variadic* argument, Ruby cannot state one number, so
it encodes "at least n" as **`-n-1`**, where `n` is the count of required
arguments:

```ruby
def two(a, b)                  = nil
def opt(a, b = 1)              = nil
def tag(name, content, *attrs) = nil

method(:two).arity   # =>  2   — exactly 2
method(:opt).arity   # => -2   — 1 required, then optional  (-1-1)
method(:tag).arity   # => -3   — 2 required, then a splat   (-2-1)
```

`method(:tag).arity == -3` therefore means "two mandatory arguments and an
open-ended tail". Reading it back: drop the sign, subtract one → 2 required.

Keyword arguments collapse into a *single* extra slot, mandatory only if any
keyword is mandatory:

```ruby
def kw(a, b:)     = nil
def kwopt(a, b: 1) = nil

method(:kw).arity     # =>  2   — a, plus one mandatory keyword bundle
method(:kwopt).arity  # => -2   — a required, the keyword bundle optional
```

When you need real detail rather than a count, `parameters` gives the full
shape and is what you should reach for in dynamic dispatch code:

```ruby
method(:tag).parameters
# => [[:req, :name], [:req, :content], [:rest, :attrs]]
```

### `curry`: feed the arguments one at a time

`Method#curry` returns a `Proc` that accumulates arguments and only invokes the
underlying method once it has enough:

```ruby
class Notifier
  def initialize(from) = @from = from
  def deliver(channel, subject, body)
    "[#{channel}] #{@from} -> #{subject}: #{body}"
  end
end

deliver = Notifier.new("billing@acme.io").method(:deliver)
deliver.arity   # => 3

curried = deliver.curry          # a Proc awaiting 3 arguments
email   = curried[:email]        # a Proc awaiting 2  — channel pinned
invoice = email["Invoice #42"]   # a Proc awaiting 1  — subject pinned too

invoice.call("Due in 7 days")
# => "[email] billing@acme.io -> Invoice #42: Due in 7 days"

curried[:sms]["Invoice #42"]["Due in 7 days"]
# => "[sms] billing@acme.io -> Invoice #42: Due in 7 days"
```

`email` and `invoice` are ordinary values: hand them to collaborators that know
nothing about `Notifier`, and each call site supplies only the piece it owns.

Currying needs to know when "enough" is reached, so a variadic method — whose
arity is negative and therefore ambiguous — requires you to name the target
arity explicitly:

```ruby
def sum_all(a, b, *rest) = ([a, b] + rest).sum
method(:sum_all).arity                  # => -3, so curry can't guess
method(:sum_all).curry(4)[1][2][3][4]   # => 10
```

### Introspection, and the debugging connection

`Method` objects carry their own metadata: `name`, `owner` (the class or module
where the definition actually lives — not necessarily the receiver's class),
`receiver`, `parameters`, and `source_location`, which returns `[file, line]`.

```ruby
m = Money.new(1999).method(:formatted)
m.owner            # => Money
m.source_location  # => ["/app/lib/money.rb", 5]
```

`source_location` is the "where on earth did this method come from" tool; this
platform's `common-ruby-gotchas` concept already covers using it on
dynamically defined and `method_missing`-routed methods, so it isn't repeated
here. One forward-looking caveat worth knowing: Ruby 4.0 widens the return
value to `[path, start_line, start_col, end_line, end_col]`. Destructuring as
`file, line = m.source_location` keeps working, but code that assumes the array
has exactly two elements does not.

### `unbind` and `UnboundMethod`: the implementation without the receiver

`Method#unbind` strips the receiver off; `Module#instance_method` gets you the
same thing without ever having an instance:

```ruby
um = deliver.unbind                     # from an existing Method
um = Notifier.instance_method(:deliver) # or straight from the class
um.class  # => UnboundMethod
```

An `UnboundMethod` exposes the same introspection surface — `name`, `arity`,
`owner`, `parameters` — but it is inert. There is no receiver, so there is
nothing to call it *on*:

```ruby
um.call(:sms, "Ping", "up?")
# NoMethodError: undefined method 'call' for an instance of UnboundMethod
```

Two ways to make it callable again:

```ruby
target = Notifier.new("ops@acme.io")

um.bind(target).call(:sms, "Ping", "up?")   # bind -> Method -> call
um.bind_call(target, :sms, "Ping", "up?")   # one step
# both => "[sms] ops@acme.io -> Ping: up?"
```

`bind_call` is not just shorter. `bind` must *allocate* a `Method` object to
hold the pairing, which you then immediately call and throw away; `bind_call`
performs the binding and the dispatch in one operation with no intermediate
object. In a tight loop that is a measurable difference — a million iterations
of `um.bind(obj).call` takes roughly 0.26s against 0.22s for
`um.bind_call(obj)` on the same machine — and, more importantly, it produces
zero garbage per call. If you are binding once and calling many times, keep the
`Method` from `bind`; if you are binding per call, use `bind_call`.

### Rebinding: borrowing an implementation for an unrelated object

Binding is not unrestricted. A method **owned by a class** can only be bound to
an instance of that class or a subclass:

```ruby
class Money
  def initialize(cents) = @cents = cents
  def formatted = format("$%.2f", @cents / 100.0)
end

fmt = Money.instance_method(:formatted)

class Discounted < Money; end
fmt.bind_call(Discounted.new(1999))  # => "$19.99" — a subclass instance is fine

fmt.bind_call(Object.new)
# TypeError: bind argument must be an instance of Money
```

A method **owned by a module** has no such restriction (Ruby 3.0 lifted it):
since a module can be mixed into anything, its instance methods can be bound to
*any* object. That makes a plain module a reusable, transplantable bag of
behavior:

```ruby
module Sluggable
  def slug
    title.downcase.strip.gsub(/[^a-z0-9]+/, "-").delete_prefix("-").delete_suffix("-")
  end
end

slugify = Sluggable.instance_method(:slug)

Article = Struct.new(:title)          # neither of these
Video   = Struct.new(:title, :duration)  # includes Sluggable

slugify.bind_call(Article.new("  Hello, Ruby World!  "))  # => "hello-ruby-world"
slugify.bind_call(Video.new("Method Objects 101", 300))   # => "method-objects-101"
```

The only contract is duck typing: `slug` sends `title`, so anything responding
to `title` works. You get the module's exact behavior on objects you never
modified — no `include`, no monkey patch, no change to `Article` or `Video` at
all. This is how a serializer or presenter can apply one canonical
implementation across types it doesn't own.

The same lever recovers an implementation an object has overridden. `Kernel`
is a module, so its instance methods bind to anything:

```ruby
class Sneaky
  def inspect = "<totally normal object>"
end

s = Sneaky.new
s.inspect                                  # => "<totally normal object>"
Kernel.instance_method(:inspect).bind_call(s)
# => "#<Sneaky:0x00000001042b17b8>"
```

The object cannot lie to you, because you went around its method table entirely
— which is precisely why debuggers, `pp`, and test frameworks reach for
`bind_call` when they need the truth about an object rather than its
self-description.

## Trade-offs

- **Composition is elegant but opaque in a backtrace** — `(strip >> squish >>
  truncate).call(raw)` raising inside `squish` gives you a stack through
  anonymous `Proc` frames, not the readable `squish(strip_tags(raw))` nesting.
  For two or three steps the pipeline reads better; for a long chain a plain
  method with named intermediate variables is usually easier to debug.
- **`>>` and `<<` are easy to get backwards** — they are opposite orders, and on
  a symmetric-looking pair of transformations the wrong operator produces a
  plausible-but-wrong value rather than an error. Pick one direction as a house
  style (`>>` reads in execution order and is the safer default) instead of
  mixing both.
- **`arity` is a lossy summary** — a single negative integer cannot tell you
  which arguments are optional, which are keywords, or their names. It's fine
  for a quick "does this take a block argument?" check; anything making real
  decisions should read `parameters`.
- **Currying trades call-site clarity for reuse** — `curried[:email]["Invoice"]`
  hides which parameter each bracket fills, and a wrong count fails only when
  the last argument finally arrives. It pays off when the partially applied
  proc genuinely travels somewhere; for a local call, keyword arguments are
  clearer than a curried chain.
- **Holding `Method` objects keeps their receivers alive** — a dispatch table of
  bound `Method`s pins every one of those receivers in memory for as long as
  the table lives. `UnboundMethod` avoids that, at the cost of needing a
  receiver at call time.
- **Rebinding module methods is powerful and easy to abuse** — reusing an
  implementation on an object that never opted in couples that object to an
  invisible contract (`slug` requires `title`), and no `ancestors` listing will
  ever reveal the relationship. It is the right tool for framework and tooling
  code; in application code, `include` states the same intent where a reader can
  see it.
- **`bind_call` is faster but only meaningfully so in hot paths** — the win is a
  skipped allocation. Reaching for it as a micro-optimization in code that runs
  once is noise; reaching for it inside a serializer that runs per record is
  real.

## Documentation Links

- [Method — Ruby Core docs](https://docs.ruby-lang.org/en/3.3/Method.html) — doc
- [UnboundMethod — Ruby Core docs](https://docs.ruby-lang.org/en/3.3/UnboundMethod.html) — doc
- [Object#method — Ruby Core docs](https://docs.ruby-lang.org/en/3.3/Object.html#method-i-method) — doc
- [Module#instance_method — Ruby Core docs](https://docs.ruby-lang.org/en/3.3/Module.html#method-i-instance_method) — doc
- [Proc#curry and Proc#>> / #<< — Ruby Core docs](https://docs.ruby-lang.org/en/3.3/Proc.html#method-i-curry) — doc
- [Programming Ruby 3.3 (Pickaxe) — Ruby's Object Model](https://pragprog.com/titles/ruby5/programming-ruby-3-3-5th-edition/) — doc
