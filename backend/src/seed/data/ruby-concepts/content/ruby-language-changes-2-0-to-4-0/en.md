---
version: 1.0
updatedAt: 2026-08-21
---
## Objective

Ruby has shipped a real breaking change roughly every three years since 2.0 —
not deprecation-cycle churn, but semantic changes that turn working code into
a `NoMethodError` or a silently different result. Someone who last wrote Ruby
seriously in the 2.3–2.5 era and picks it back up today is missing keyword
argument separation (3.0), Ractors (3.0), a completely different default
parser (3.4's Prism), and a splat-on-`nil` behavior change (4.0) — each one a
plausible source of "this tutorial doesn't work" or "this StackOverflow
answer is wrong now." This concept is the timeline other concepts on this
platform assume: it's the map; the dedicated concepts on Ractors, `Set`,
pattern matching, RBS, and Ruby Box are the territory.

## Use Cases

- Reading an old blog post, Stack Overflow answer, or internal wiki page and
  knowing which parts are version-dependent before copying code from it.
- Explaining why a gem's `Gemfile` pins `ruby ">= 3.0"` — recognizing which
  language feature the code actually depends on (keyword arg separation?
  pattern matching? Ractors?) instead of treating the constraint as arbitrary.
- Migrating a codebase across a major version boundary (2.7→3.0 is the
  infamous one) and knowing in advance which category of bug to expect.
- Reading a method signature and immediately placing which Ruby introduced the
  syntax (`def initialize(x:) = @x = x`, `case x in [Integer => n]`, `def
  greet(...) = other(...)`), rather than treating it as unfamiliar dialect.
- Deciding how conservatively to write library code that has to run across a
  wide version range (a gem supporting 3.0 through 4.0 cannot casually use a
  4.0-only Ractor API).

## Deep Dive

### 2.0 – 2.7: the era that built today's idioms

Ruby 2.0 (2013) shipped **`Module#prepend`** (the mechanism the object-model
concept on this platform explains in depth), a UTF-8 default source encoding,
keyword arguments (first version — a default value was mandatory), and lazy
enumerators. 2.1 relaxed keyword args to allow no default. Small but durable
additions kept landing every year after: `Object#itself` (2.2), safe
navigation `&.` and `dig` and the `<<~` squiggly heredoc (2.3), `Fixnum`/
`Bignum` unifying into a single `Integer` class and `String#match?` (2.4),
keyword-argument-friendly `Struct.new(keyword_init: true)` (2.5).

2.6 added `Object#then`/`#yield_self` and endless ranges (`5..`). 2.7 is the
one worth remembering by name — it previewed **pattern matching** (`case/in`,
stabilized properly in 3.0 — see this platform's dedicated concept),
introduced **numbered block parameters** (`_1`, later joined by the `it`
shorthand in 3.4), and allowed **argument forwarding with `...`**
(`def wrapper(...) = target(...)`, forwarding all positional, keyword, and
block arguments without naming any of them). 2.7 also made `**nil` legal as
"explicitly no keyword arguments" — a small addition that mattered a lot one
version later.

### 3.0: the version that broke things on purpose

Ruby 3.0 (2020) is the one migration guides warn about, for one specific
reason: **positional Hash arguments and keyword arguments became fully
separate**. Before 3.0, a trailing Hash argument and keyword arguments were
largely interchangeable — a method defined with `def foo(opts = {})` could be
called `foo(a: 1)` and just see `{a: 1}` as `opts`. From 3.0 on, that
implicit conversion is gone: a method has to declare `**opts` to receive
keyword arguments as a hash, and calling a keywords-only method with a
literal hash argument (without `**`) raises `ArgumentError`. This is the
single most common source of "worked on Ruby 2.7, breaks on 3.0" bug reports,
and it's why so many gems from that era needed a real code change, not just a
version bump, to support 3.0.

3.0 also shipped the two headline additions covered as their own concepts on
this platform: **Ractors**, the first real intra-process parallelism
mechanism (see the GVL/concurrency concept), and **RBS**, Ruby's own type
signature language (see the typed-Ruby concept). Alongside them: **endless
methods** (`def double(x) = x * 2`), the **rightward assignment** operator
(`expr => variable`), `in` usable as a standalone boolean pattern-match check
outside `case`, the **find pattern** (`case arr; in [*, target, *]`), and
non-blocking Fibers with a pluggable **Fiber scheduler** for cooperative
async I/O (its own concept covers `async`/Falcon built on top of this).

3.1 added the **pin operator** `^` accepting arbitrary expressions in pattern
matches, the `{x:}` hash/keyword shorthand that infers the value from a
same-named local variable, and anonymous block-argument forwarding with a
bare `&`. 3.2 promoted **`Set` into the core library** (autoloaded, no
`require "set"` needed — though `require` still works and is what older code
expects), added anonymous forwarding of positional/keyword splats (`*`/`**`
alone, without a name), and introduced **`Data`**, a lighter-weight,
immutable sibling to `Struct`. 3.3 introduced **Prism**, a new hand-written
recursive-descent parser meant to eventually replace the long-standing
`parse.y` grammar, alongside continued year-over-year YJIT performance work.

### 3.4 and 4.0: the current line, and what's genuinely new

3.4 (December 2024) made two changes worth knowing on sight: **`Hash#inspect`
changed its default output format** from `{:x=>1, :y=>2}` to `{x: 1, y: 2}`
(the platform's `self-and-singleton-classes` concept flags exactly where this
shows up), and **`it`** became a documented, stable synonym for the single
numbered block parameter `_1` — so `list.map { it * 2 }` and `list.map { _1 *
2 }` are the same thing, with `it` reading closer to plain English. 3.4 also
switched the **default parser to Prism**, and reworked garbage collection
internals into a more modular structure ("GC modular"), plus a **Happy
Eyeballs v2** implementation for faster dual-stack (IPv4/IPv6) TCP connection
attempts in `Socket`/`Net::HTTP`.

4.0 (December 2025) is the largest jump since 3.0, and most of its individual
changes already have a dedicated concept elsewhere on this platform, so this
is the index rather than the full explanation:

- **`Ractor.yield`/`Ractor#take` were removed**, replaced by the explicit
  `Ractor::Port` API combined with `Ractor#join`/`Ractor#value` — see the
  GVL/concurrency concept for the migration shape.
- **`Ruby::Box`** shipped as an experimental in-process namespace isolation
  mechanism, distinct from Ractors — its own concept covers what it isolates
  and what it doesn't.
- **`*nil` no longer calls `nil.to_a`** — splatting `nil` as an argument is
  now just "zero arguments" instead of silently converting via `to_a`; the
  duck-typing concept covers this as part of the broader implicit-conversion
  protocol story.
- **`SortedSet` was removed** from the standard library (it depended on the
  external `rbtree` gem); `Set`, like `Pathname`, is now a true core class
  rather than an autoloaded stdlib file.
- **RJIT was removed entirely**; **ZJIT**, a new experimental method-level
  JIT from the YJIT team, ships but is not enabled by default — the
  runtimes-comparison concept covers where it sits relative to YJIT.
- Smaller but real: clearer `ArgumentError` backtraces for wrong-arity calls,
  a new `instance_variables_to_inspect` hook `p`/`pp` respect, multi-line
  logical operators (a trailing `&&`/`||` at end-of-line no longer needs a
  backslash to continue), `source_location` returning a 5-element array
  (adding end-line/end-column), and `String#strip` accepting arguments to
  strip characters beyond whitespace.

## Trade-offs

- **A version-agnostic mental model of Ruby doesn't exist above roughly the
  3.0 line** — code that relies on keyword/hash interchangeability, an
  old-style `Ractor.yield`/`take` example, or `Hash#inspect`'s old format
  needs a version number attached before you trust it, not just "recent
  Ruby."
- **Skipping straight from 2.6/2.7 to 4.0 concentrates all of this into one
  migration** — the keyword-argument separation from 3.0 alone is often a
  multi-week fix in a large Rails app; doing it alongside the 4.0 Ractor API
  change and the splat-on-`nil` change at once is strictly harder to bisect
  than upgrading through intermediate versions.
- **New parsers and JIT tiers (Prism, YJIT, ZJIT) are usually safe to ignore
  until they aren't** — most application code never touches parser or JIT
  internals directly, but a gem doing anything with `RubyVM::AbstractSyntaxTree`,
  custom instrumentation, or manual JIT flags needs to track these
  transitions explicitly rather than assume behavior is stable.
- **Following the "book vs. today" pattern used across this platform's Ruby
  concepts is the practical defense** — treat any single source (a book, a
  tutorial, a training dataset) as accurate as of its cutoff, and check the
  release notes for the version actually installed before shipping code that
  depends on a detail from one of the eras above.

## Documentation Links

- [Ruby 3.0.0 Released — ruby-lang.org](https://www.ruby-lang.org/en/news/2020/12/25/ruby-3-0-0-released/) — doc
- [Ruby 3.2.0 Released — ruby-lang.org](https://www.ruby-lang.org/en/news/2022/12/25/ruby-3-2-0-released/) — doc
- [Ruby 3.4.0 Released — ruby-lang.org](https://www.ruby-lang.org/en/news/2024/12/25/ruby-3-4-0-released/) — doc
- [Ruby 4.0.0 Released — ruby-lang.org](https://www.ruby-lang.org/en/news/2025/12/25/ruby-4-0-0-released/) — doc
- [Ruby Changes — a version-by-version community changelog](https://rubyreferences.github.io/rubychanges/) — doc
- [Programming Ruby 3.3 (Pickaxe) — Ruby Changes appendix](https://pragprog.com/titles/ruby5/programming-ruby-3-3-5th-edition/) — doc
