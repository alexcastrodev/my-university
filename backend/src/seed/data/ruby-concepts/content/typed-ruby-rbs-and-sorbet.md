---
version: 1.0
updatedAt: 2026-08-18
---
## Objective

Ruby is *dynamically* typed — the type of a value is resolved when a method is
actually called (late binding), never before — and *strongly* typed — it refuses
to silently coerce, so `3 + "3"` raises `TypeError` instead of guessing at `6` or
`"33"`. What Ruby historically lacked was the third axis: an *optional static*
layer, the thing TypeScript added to JavaScript. Two answers now exist and they
are built on opposite philosophies. **RBS** ships with Ruby 3.0+ and keeps type
declarations in separate `.rbs` files with their own syntax, affecting tooling
only and never the running program. **Sorbet** is a third-party gem originated
at Stripe that puts annotations *inside* your `.rb` files as ordinary Ruby method
calls — and checks them at runtime as well as statically. Knowing which one a
codebase uses tells you a lot about what "a type error" even means there.

## Use Cases

- Documenting a library's public API in a way an editor can act on — jump-to-
  definition, autocomplete, and inline errors — without changing a line of the
  implementation (`sig/` + RBS).
- Catching `nil` before production: declaring a method's return as `String?` /
  `T.nilable(String)` so the checker flags every call site that forgets to
  handle the empty case.
- Enforcing a contract at a service boundary where a wrong type must fail *loudly
  and immediately*, not three layers deeper — Sorbet's `sorbet-runtime` turns a
  bad argument into a real `TypeError` at the call.
- Onboarding onto a large Ruby codebase (Stripe's and Shopify's are the
  best-known Sorbet users) where `sig` blocks are the fastest way to read what a
  method actually accepts.
- Bootstrapping types for legacy code with `TypeProf`, then hand-correcting the
  draft `.rbs` instead of writing every signature from scratch.
- Typing duck-typed collaborators structurally: an RBS `interface _Appendable`
  says "anything responding to `<<`", which is the type-level version of the
  `respond_to?` check you were already writing.

## Deep Dive

### RBS: types live beside the code, not in it

RBS files carry the `.rbs` extension and by convention live in a `sig/` folder
mirroring `lib/`. The syntax *looks* like Ruby but is a separate declarative
language — there are no method bodies, only signatures:

```rbs
# sig/report.rbs
class Report
  @rows: Array[Array[String]]

  def initialize: (Array[Array[String]] rows) -> void
  def title: () -> String
  def find_row: (String key) -> Array[String]?
  def to_csv: (separator: String, ?header: bool) -> String
end
```

### The positional/keyword asymmetry that trips everyone up

Look closely at `find_row` versus `to_csv`. For a **positional** argument, the
*type comes first and the name comes second* — and that name is pure
documentation. RBS never checks it against the real method:

```rbs
def find_row: (String key) -> Array[String]?
#              ^^^^^^ type   ^^^ name, not validated
```

You can rename `key` to `banana` in the `.rbs` and nothing complains, because
positional arguments are matched by position. For a **keyword** argument the
order flips — *name first, then type* — and now the name **is** validated,
because that is how callers address it:

```rbs
def to_csv: (separator: String, ?header: bool) -> String
#            ^^^^^^^^^ name, validated against the real signature
```

The leading `?` on `?header:` marks the keyword as optional. Getting a keyword's
name wrong in RBS is a genuine error; getting a positional's name wrong is a
typo in a comment.

### The RBS type vocabulary

| RBS | Means |
| --- | --- |
| `String?` | nilable — `String` or `nil` |
| `Array[String]`, `Hash[String, Integer]` | generics |
| `Integer \| String` | union — either one |
| `bool` | exactly `true \| false` |
| `boolish` | any object, used only for its truthiness |
| `top` | the supertype of everything: a *known* but maximally generic type |
| `untyped` | "I don't know the type" — an explicit marker of ignorance |
| `void` | a return value that exists but must not be used |

The `top` / `untyped` distinction matters more than it looks. `top` is a real
claim ("this can be any object, and I mean it"); the checker will stop you from
calling `String`-only methods on it. `untyped` is an escape hatch that switches
checking *off* for that value — anything goes. A file full of `untyped` type-checks
cleanly while telling you nothing, which is exactly the failure mode of an
auto-generated signature nobody reviewed.

`void` says the method is called for its side effect: `def log: (String) -> void`
means "don't build logic on whatever comes back."

### `interface _Name`: typed duck typing

An `interface` declares a set of methods without naming a class. Any object with
those methods satisfies it — structural typing, the same idea as a TypeScript
interface. The convention is a leading underscore:

```rbs
interface _Appendable
  def <<: (String) -> self
end

class Report
  def write_to: (_Appendable out) -> void
end
```

`String`, `Array`, `File`, and `StringIO` all satisfy `_Appendable` without
declaring anything, so `write_to` stays as substitutable as it was — you have
just written down the contract that duck typing left implicit.

### RBS does nothing at runtime

This is the single most important fact about RBS: it is **static analysis and
tooling only**. Ruby does not read your `sig/` folder while executing, and no
declaration in an `.rbs` file can ever raise. Violations surface when you run a
type checker (Steep is the usual one) or in your editor — never in production.
A stale `.rbs` is silently wrong, and only the checker in CI keeps it honest.

### `TypeProf` writes the first draft

`typeprof` generates an `.rbs` skeleton by *abstractly executing* your code: it
walks the paths tracking **types rather than values**, and reports what flows
where.

```console
$ typeprof lib/report.rb -o sig/report.rbs
```

It is a genuinely good starting point and a bad finishing point. Two limits show
up immediately: it emits a lot of `untyped` wherever it cannot decide, and it
gets lost in metaprogramming — a `send` with a dynamically built method name has
no static answer, so everything downstream degrades to `untyped`. Treat the
output as a draft to correct, not a signature to commit unread.

### The stdlib is already typed, and the CLI can query it

Every class in Ruby's standard library ships with RBS definitions, which is why
tooling works usefully from day one. The `rbs` CLI reads them:

```console
$ rbs ancestors ::String
::String
::Comparable
::Object
::Kernel
::BasicObject

$ rbs method ::String gsub
::String#gsub
  defined_in: ::String
  implementation: ::String
  accessibility: public
  types:
    (Regexp | String pattern, String replacement) -> String
  | (Regexp | String pattern) { (String match) -> _ToS } -> String
```

That second overload is worth reading as documentation in its own right: it says
the block form takes the matched `String` and accepts anything that can render
as a string back.

### Sorbet: annotations are real Ruby

Sorbet takes the opposite bet. There is no separate file for your own code —
`sig` is an actual method call, evaluated when the class is loaded. Three pieces
turn it on: the `sorbet-runtime` gem, a `# typed:` magic comment at the top of
the file, and `extend T::Sig` in the class.

```ruby
# typed: true
require "sorbet-runtime"

class Report
  extend T::Sig

  sig { params(rows: T::Array[T::Array[String]]).void }
  def initialize(rows)
    @rows = rows
    @counts = T.let({}, T::Hash[String, Integer])
  end

  sig { params(key: String).returns(T.nilable(T::Array[String])) }
  def find_row(key)
    @rows.find { |row| row.first == key }
  end

  sig { params(separator: String, header: T::Boolean).returns(String) }
  def to_csv(separator: ",", header: true)
    lines = @rows.map { |row| row.join(separator) }
    header ? ["key#{separator}value", *lines].join("\n") : lines.join("\n")
  end
end
```

The magic comment is a **sigil** with levels: `# typed: false` reports only
syntax-level problems, `# typed: true` is the normal checking level,
`# typed: strict` additionally requires a `sig` on every method and a declared
type for every instance variable, and `# typed: strong` rejects `T.untyped`
entirely. Per-file sigils are what make Sorbet adoptable incrementally in a big
codebase — you raise the level file by file.

`.void` replaces `.returns(...)` when the return value is not meant to be used —
the same idea as RBS's `void`.

### The Sorbet type vocabulary, mapped to RBS

| Sorbet | RBS equivalent |
| --- | --- |
| `T::Array[String]`, `T::Hash[String, Integer]` | `Array[String]`, `Hash[String, Integer]` |
| `T::Boolean` | `bool` |
| `T.nilable(String)` | `String?` |
| `T.any(Integer, String)` | `Integer \| String` |
| `T.untyped` | `untyped` |
| `.void` | `-> void` |

Semantically these line up closely; the difference is syntactic. RBS invents a
grammar, Sorbet reuses Ruby's — `T.nilable(String)` is a method call returning a
type object, which is why it composes with ordinary Ruby (`T.any(*TYPES)` works).

### `T.let` when inference has nothing to work with

Sorbet infers the type of an instance variable from its first assignment. That
fails whenever the initial value is empty, because `{}` reveals nothing about
what will go in it:

```ruby
@counts = {}                                  # Hash[T.untyped, T.untyped]
@counts = T.let({}, T::Hash[String, Integer]) # declared, and checked from here on
```

`T.let(value, Type)` asserts the type and, under `sorbet-runtime`, verifies it
right there. Use it for empty collections, for `nil` initializers
(`T.let(nil, T.nilable(Report))`), and anywhere a value's static type is broader
than what you know it to be.

### Splats are annotated per element

A common misreading. For `*args` and `**opts`, the type you write describes
**each element**, not the resulting Array or Hash:

```ruby
sig { params(parts: String, options: T::Boolean).returns(String) }
def self.join_path(*parts, **options)
  parts.join("/")
end
```

`params(parts: String)` means "every element of `parts` is a `String`" — not
"`parts` is a `String`". Writing `T::Array[String]` there would be wrong: it
would mean each element is itself an array of strings.

### The real differentiator: Sorbet checks at runtime too

RBS can only ever be wrong quietly. Sorbet, because `sig` is executed code,
wraps the method and validates arguments and return values **while the program
runs**:

```ruby
Report.new([["a", "1"]]).find_row(:a)
# TypeError: Parameter 'key': Expected type String, got type Symbol with value :a
```

That is a genuine exception from a genuine `TypeError`, at the call site, in
development and production alike — not a report from a linter. The static pass
is separate and runs on demand:

```console
$ bundle exec srb tc
```

Dependencies you don't own are handled by **Tapioca** (a Shopify gem), which
generates `.rbi` files — Sorbet's interface format — for your gems into
`sorbet/rbi/`:

```console
$ bundle exec tapioca init
$ bundle exec tapioca gems
```

The runtime layer is also the part with a cost: every typed method call pays for
validation. `sorbet-runtime` lets you dial that down (checked levels, or
disabling validation in production) precisely because the safety is not free.

## Trade-offs

- **Typing buys communication and tooling, and charges verbosity** — this is the
  Pickaxe's own framing. A `sig` or an `.rbs` line tells the next reader (and the
  editor, and CI) exactly what a method accepts, which is worth a lot on a large
  team. It also means every signature change is now two edits instead of one, and
  a three-line method can end up with a two-line annotation.
- **Neither solution has won the community** — unlike TypeScript in the JavaScript
  world, typed Ruby is not the default. Sorbet is used seriously at scale (Stripe
  originated it, Shopify builds tooling on it), and RBS ships with Ruby itself,
  but plenty of production Ruby uses neither. Expect to meet both conventions and
  to choose per project rather than inherit an industry standard.
- **Separate files (RBS) vs. inline annotations (Sorbet) is a maintenance
  trade** — RBS keeps your `.rb` files clean and lets you type a gem you don't
  own, at the price of a second file that can drift out of sync unchecked.
  Sorbet's annotations cannot drift from the method they sit above, but they put
  type declarations in the middle of the code you are trying to read.
- **Runtime checking is a real guarantee with a real bill** — Sorbet catching a
  wrong argument as an actual `TypeError` is strictly more than RBS can offer,
  and it is also work done on every call, plus a new class of production failure
  (a signature that is merely *too strict* now raises where the code would have
  worked). RBS's inability to raise is a limitation and a safety property at once.
- **Auto-generated types are a draft, not an answer** — `TypeProf` and Tapioca
  save enormous typing effort, but `untyped` everywhere type-checks perfectly
  while proving nothing, and metaprogramming defeats both. Unreviewed generated
  signatures buy the ceremony of typing without the benefit.
- **Static types fight the dynamism people came to Ruby for** — `method_missing`,
  `define_method`, `send` with a computed name, and DSLs that build classes at
  load time are all hard or impossible to express statically. Adopting types
  often means writing less dynamic Ruby, which is a design change, not just an
  annotation change.

## Documentation Links

- [RBS — ruby/rbs on GitHub](https://github.com/ruby/rbs) — doc
- [Sorbet — official documentation](https://sorbet.org/) — doc
- [Tapioca — Shopify/tapioca on GitHub](https://github.com/Shopify/tapioca) — doc
- [TypeProf — ruby/typeprof on GitHub](https://github.com/ruby/typeprof) — doc
- [Steep: static type checker for Ruby using RBS](https://github.com/soutaro/steep) — doc
- [Programming Ruby 3.3 (Pickaxe) — Typed Ruby](https://pragprog.com/titles/ruby5/programming-ruby-3-3-5th-edition/) — doc
