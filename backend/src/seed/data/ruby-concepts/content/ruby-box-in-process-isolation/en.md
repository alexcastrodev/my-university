---
version: 1.0
updatedAt: 2026-08-18
---
## Objective

Ruby has never had a way to say "load this code over here, and keep whatever it
does to itself." A `require` mutates one global constant table; a monkey patch
applied anywhere is applied everywhere; and exactly one version of a gem can be
loaded per process, forever. `Ruby::Box`, the experimental feature that shipped
with Ruby 4.0 (December 2025), is the first real answer to that: a container
inside a single process that gets its own constants, its own classes and
modules, its own global variables, and its own copy of the native extensions it
loads. This concept covers what a box actually isolates, the small API surface
that exists today, and — just as important — why this is *not* a concurrency
feature and not yet something to build critical infrastructure on.

## Use Cases

- Running each test file inside its own box so a monkey patch or a global-state
  change in one test cannot leak into the next one, without paying for a fresh
  process per test.
- Blue-green deployment inside a single process: two versions of the same
  application loaded in parallel boxes, with traffic shifted between them,
  instead of two separately deployed processes.
- Evaluating a dependency upgrade by loading the old and new gem versions into
  two boxes in the same process, sending both the same input, and diffing the
  responses before committing to the bump.
- Multi-tenancy where tenants ship their own plugins or patches — each tenant's
  code loaded into its own box so one customer's `String#blank?` override cannot
  reach another customer's request.
- The classic dependency-hell case: two of your own gems needing incompatible
  versions of a third, which Bundler cannot resolve today because RubyGems can
  only activate one version process-wide.
- Code reloading in a development server, where the goal is "throw away
  everything that file defined" rather than "define it again on top."

## Deep Dive

### Turning it on

Boxing is off by default and is not something you can enable at runtime. It has
to be requested at process boot through an environment variable, and `1` is the
only value that enables it:

```bash
RUBY_BOX=1 ruby app.rb
```

Setting `RUBY_BOX` from inside a running program does nothing — the boxing
infrastructure is initialized during the interpreter's boot sequence, before your
code exists. That opt-in gate is deliberate: isolation has a real cost, so the
core team chose not to make every Ruby process pay it.

Two class methods let code check where it stands:

```ruby
Ruby::Box.enabled?   # => true when the process was booted with RUBY_BOX=1
Ruby::Box.current    # => the box this code is running in, or nil when disabled
```

`Ruby::Box.current` returning `nil` rather than raising is the shape you want for
library code that must run on both boxed and unboxed processes — guard on
`enabled?` and fall back to ordinary `require`.

### Creating a box and loading code into it

A box is an object. You make one, then load code *through it* rather than
through the top-level `require`:

```ruby
box = Ruby::Box.new

box.require("some_gem")            # resolved against the box's own load path
box.require_relative("greetings")  # relative to the current file
box.load("config/patches.rb")      # direct file execution
box.eval("SomeClass.configure!")   # a code string, evaluated inside the box
```

Everything those calls pull in — and everything *those* files require in turn,
recursively — lands inside the box. That includes native extensions: a `.so` /
`.bundle` loaded within a box is confined to it, which is the part that makes
loading two versions of a C-backed gem in one process conceivable at all.

Each box also carries its own load path, which is the hook for the
multiple-versions story:

```ruby
box.load_path   # => the box's local $LOAD_PATH array
```

Constants defined inside a box are reachable from outside using ordinary scope
resolution on the box object itself:

```ruby
box = Ruby::Box.new
box.require_relative("greetings")
puts box::Greetings.say_hello("Edy")
```

That is the whole bridge: the box acts as a namespace you index into. Two boxes
can each define `Greetings`, and `box_a::Greetings` and `box_b::Greetings` are
different classes.

### What is actually isolated

The release notes phrase it as "separation about definitions," and that wording
is worth taking literally. A box separates:

- constants, and therefore class and module definitions;
- global variables and class variables;
- monkey patches applied to core classes;
- loaded Ruby and native libraries.

So a patch applied inside a box simply does not exist outside it:

```ruby
# patches.rb — loaded into a box
class String
  def shout = upcase + "!"
end
```

```ruby
box = Ruby::Box.new
box.require_relative("patches")
box.eval('puts "hello".shout')   # => HELLO!

"hello".shout                    # => NoMethodError in the root box
```

What a box does *not* do is give you a separate object heap. Everything still
lives in one process, sharing memory and one GC. That is the whole reason a box
is cheaper than a second process — and also the reason the sharp edges are
where they are. Passing an object across a box boundary when both boxes have
their own definition of that object's class is precisely the territory the
"experimental" label is covering; treat cross-box object exchange as something
to verify against the current implementation rather than assume.

### The file is the boundary

The rule that surprises people: a `.rb` file executes entirely within one box,
and the methods and procs it defines stay bound to that box *no matter who calls
them later*. A method loaded into a box and invoked from the root box still
resolves its constants through the box's lookup path.

```ruby
box.require_relative("helper")
box.eval("process(my_data)")     # `process` runs with the box's constants
```

This is a feature, not an accident — it is what keeps isolation from unravelling
the moment a callback crosses the boundary. But it means "which box am I in" is
determined by where the code was *loaded*, not by where the call came from,
which is a different mental model from `instance_eval`-style scope changes that
follow the caller. If you are used to reasoning about `self` and singleton
classes to predict lookup, note that a box sits one level above all of that: it
swaps out the constant table the whole lookup walks, rather than changing which
object you are talking to.

### Boxes are not Ractors

The single most important thing to get straight. Ractors exist to escape the
GVL and run Ruby code on multiple cores in parallel; they buy isolation as the
*price* of parallelism, which is why they impose the shareability rules that make
them so awkward to adopt. `Ruby::Box` is the opposite trade: it buys isolation
and asks for nothing in the way of object-shareability discipline, but it gives
you no parallel execution whatsoever. Code in a box runs on the same threads,
under the same GVL, as everything else.

Concretely: "running two app versions in parallel boxes" means two versions
*coexisting*, not two versions executing simultaneously on two cores. If your
problem is CPU-bound throughput, a box does nothing for you. If your problem is
"these two chunks of code cannot agree on what `Foo` means," a box is exactly the
tool — and Ractors were never it.

## Trade-offs

- **Experimental means experimental** — Ruby 4.0 ships this with an explicit
  warning about rough edges and instability, and the API is described as still
  evolving. The methods above are what 4.0 documents; check the current docs
  before writing anything load-bearing against them, because this is one of the
  few Ruby features where a point release could reasonably change the surface.
- **Isolation is not free** — there is real performance overhead, which is why
  the whole subsystem is behind an environment variable rather than on by
  default. A test suite that boxes every file is trading wall-clock time for
  cross-test independence; that trade is often worth it, but measure rather than
  assume it is cheaper than the forking you already do.
- **Not a parallelism mechanism** — worth repeating because the "run two app
  versions in parallel" framing invites the misreading. Boxes give namespace
  separation without concurrency. Ractors give parallelism with painful
  shareability constraints. Neither substitutes for the other, and reaching for
  a box to fix a throughput problem will produce a slower program.
- **The `RUBY_BOX=1` gate is a deployment concern, not a code concern** — a
  library cannot turn boxing on for itself. Anything you build on boxes only
  works if whoever launches the process cooperates, so library code needs an
  `enabled?` fallback path and you need the flag wired into every place the app
  boots: Procfile, systemd unit, Dockerfile, CI, and the test runner.
- **Shared heap, separated definitions** — the memory saving versus running two
  processes is the whole point, but it also means a box is not a security
  boundary. Untrusted code in a box still shares the process, the GC, the file
  descriptors, and the ability to exit. Use boxes to isolate *your* code from
  itself; use processes or containers to isolate code you do not trust.
- **Ecosystem readiness lags the feature** — the interesting use cases
  (multi-version gems, per-tenant plugins, reloading) all assume gems and
  frameworks behave when loaded more than once in a process. Plenty of gems keep
  state in ways that predate this feature ever existing. Expect to find the
  breakage yourself rather than to find it documented.

## Documentation Links

- [Ruby 4.0.0 Released — ruby-lang.org (Ruby Box)](https://www.ruby-lang.org/en/news/2025/12/25/ruby-4-0-0-released/) — doc
- [Ruby::Box — Ruby Core docs](https://docs.ruby-lang.org/en/4.0/Ruby/Box.html) — doc
- [Ruby 4.0.0 introduces ZJIT compiler, Ruby Box isolation — InfoWorld](https://www.infoworld.com/article/4113436/ruby-4-0-0-introduces-zjit-compiler-ruby-box-isolation.html) — doc
- [Ruby 4.0 Introduces Ruby::Box for In-Process Isolation — Prateek Codes](https://prateekcodes.com/ruby-4-introduces-ruby-box-for-in-process-isolation-part-1/) — doc
- [Everything you need to know about Ruby 4.0 — Honeybadger](https://www.honeybadger.io/blog/ruby-4/) — doc
