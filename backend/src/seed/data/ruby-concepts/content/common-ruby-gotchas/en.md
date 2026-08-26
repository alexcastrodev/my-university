---
version: 1.0
updatedAt: 2026-08-18
---
## Objective

Most Ruby bugs announce themselves with a `NoMethodError` and a backtrace. This
page is about the other kind — the ones where the interpreter accepts your code,
runs it, and produces the wrong answer without a single warning. A setter that
quietly becomes a local variable. A constructor named `initialise` that is simply
never called. An instance variable spelled `@anwser` that reads as `nil` forever.
A block that attaches to the wrong method because you left out parentheses. These
are not exotic; they are the flat spots in a language that deliberately trades
static verification for flexibility, and they are worth knowing by heart because
no tool will catch them for you. The same appendix that lists them also gives you
three tools for the other direction: `source_location` to find where a method
really came from, `sync = true` to stop trusting output order, and `freeze` to
convert a silent mutation into an immediate exception at the exact line that
caused it.

## Use Cases

- Debugging an object whose attribute stubbornly reads `nil` after a constructor
  that visibly assigns it — the `self.`-less setter and the misspelled ivar are
  the first two things to check.
- Explaining to someone coming from Java or C# why `Point(1, 2)` did not build a
  `Point`, and why `Point.new(1, 2)` is the only spelling that ever does.
- Tracking down a method that exists at runtime but appears nowhere in `grep`,
  because it was created by `define_method` or routed through `method_missing`.
- Making sense of interleaved log output where `$stderr` lines seem to arrive
  before `$stdout` lines that were printed first.
- Pinning down "who is mutating this array?" in a large codebase by freezing the
  object and letting the `FrozenError` backtrace name the culprit.
- Deciding where parentheses are optional style and where they are load-bearing
  syntax.

## Deep Dive

### `Klass()` is a method call, never a constructor

In Ruby, an identifier followed by parentheses is a *method call*, and a constant
starting with a capital letter is just a name. Put them together and you get
something that looks like a constructor in most other languages but is not one:

```ruby
def Point(x, y)
  "the method Point, called with #{x}, #{y}"
end

class Point
  def initialize(x, y) = (@x, @y = x, y)
  def inspect = "#<Point #{@x},#{@y}>"
end

Point(1, 2)      # => "the method Point, called with 1, 2"
Point.new(1, 2)  # => #<Point 1,2>
```

The method and the class coexist happily — they live in different namespaces.
`Point(1, 2)` finds the method; only `Point.new` instantiates. This is not a
quirk to work around, it is a documented idiom: `Integer("42")`, `Array(nil)`,
`String(x)`, and `Rational(1, 3)` are all ordinary `Kernel` methods with
capitalized names, and defining your own is a legitimate way to give a class a
lightweight constructor-shaped factory. Just never assume a capitalized call
built an object.

If no such method exists, you get a clear failure rather than a surprise:
`NoMethodError: undefined method 'Point' for main`. The trap is only dangerous
when a method with that name *does* exist.

### Trailing commas: allowed almost everywhere, fatal in a `def`

Ruby permits a dangling comma in array literals, hash literals, method calls, and
block parameter lists — which is why diff-friendly multi-line literals are so
common in Ruby codebases:

```ruby
[1, 2,]                       # => [1, 2]
{ a: 1, }                     # => {a: 1}
takes(1, 2,)                  # fine
[[1, 2]].map { |a, b,| a + b } # fine
```

There is exactly one place it is a syntax error, and it is the place you would
most expect symmetry:

```ruby
def foo(a, b,)   # SyntaxError: unexpected `,` in parameters
end
```

The file will not even load. It is a parse error, not a runtime one, so it fails
loudly and instantly — but only once you actually try to run the file, which is
why it shows up in a hurry after a "just add one more parameter" edit that
reordered arguments in a call and a definition at the same time.

### The missing `self.`: a setter that silently becomes a local

This is the most expensive gotcha in the list, because it produces no error, no
warning at default verbosity, and a `nil` that surfaces far from the cause.

```ruby
class Person
  attr_accessor :name, :age

  def initialize(name)
    @name = name
    age = 0        # creates a local variable named age — the setter is never called
  end
end

Person.new("Ada").age   # => nil
```

`age = 0` is unambiguous to the parser: an assignment to a bare identifier always
creates or updates a *local variable*. There is no rule that says "if a setter
with that name exists, call it instead" — that would make it impossible to have a
local named `age` in a class that also has an `age=` accessor. The only way to
reach the setter from inside the object is to give it an explicit receiver:

```ruby
def initialize(name)
  @name = name
  self.age = 0     # calls age=(0)
end
```

The asymmetry that makes this so easy to hit: the *getter* needs no receiver.
`age` on the right-hand side does call the reader method (as long as no local by
that name exists). Reading works without `self.`; writing does not.

Ruby's `-w` flag catches this specific shape when the local is never read again:

```
$ ruby -w person.rb
person.rb:6: warning: assigned but unused variable - age
```

That warning is one of the strongest arguments for running your test suite with
warnings enabled. It does not fire if the local happens to be used later in the
method, so it is a good net, not a guarantee.

### Typos Ruby will never tell you about

Two names in Ruby have no static verification at all, and getting either wrong is
completely silent.

```ruby
class Answer
  def initialise(value)   # British spelling — not the constructor Ruby calls
    @answer = value
  end

  def answer
    @anwser               # typo — this ivar was never assigned
  end
end

a = Answer.new
a.answer               # => nil
a.instance_variables   # => []
```

`Answer.new` runs `Object#initialize`, which takes no arguments and does nothing;
`initialise` sits there as a perfectly valid, never-called instance method. And
`@anwser` is not an error — reading an unassigned instance variable returns `nil`
by design, because that is what makes lazy initialization (`@cache ||= compute`)
work. Ruby 2.x used to warn about uninitialized ivars under `-W`; that warning was
removed in Ruby 3.0, so today even verbose mode is silent here.

Practical defenses: run RuboCop in CI (`Lint/UselessAssignment` and
`Lint/UselessMethodDefinition` catch a fair share of both shapes), prefer
`attr_reader` over hand-written readers that repeat the ivar name by hand, and
write at least one test that asserts on a *constructed object's state* rather than
only on the presence of its methods — a constructor that never runs is invisible
to a test that only checks `respond_to?`.

### `{}` versus `do...end`: the block can attach to the wrong call

Braces bind tighter than `do...end`. With parentheses, that never matters. Without
them, it decides *which method receives the block*:

```ruby
def one(arg = nil)
  "one(#{arg.inspect}#{block_given? ? ', &block' : ''})"
end

def two(&blk)
  "two(#{blk ? '&block' : 'nil'})"
end

one two { "three" }      # => "one(\"two(&block)\")"  — block went to two
one two do "three" end   # => "one(\"two(nil)\")"     — block went to one
```

Same tokens, same order, different method got the block. `{ }` grabs the nearest
call — `two` — while `do...end` binds loosely and attaches to the outer call,
`one`. Neither is wrong; they are different operators.

The fix is not to memorize the precedence, it is to remove the ambiguity:

```ruby
one(two { "three" })     # block clearly belongs to two
one(two) { "three" }     # block clearly belongs to one
```

This is why the common style rule — braces for single-line functional blocks,
`do...end` for multi-line procedural ones — is safe advice only when the receiver
call already has parentheses. As soon as you write a bare method call with an
argument and a block, add the parentheses.

### `source_location`: where did this method actually come from?

When a method exists at runtime but `grep` finds nothing, ask the method object
itself. `Object#method` returns a `Method`, and `Method#source_location` gives you
the file and line — including for methods that were never typed out literally:

```ruby
class Widget
  [:width, :height].each do |dim|
    define_method(dim) { 42 }
  end

  def respond_to_missing?(name, priv = false)
    name.to_s.start_with?("legacy_") || super
  end

  def method_missing(name, *args)
    return "legacy #{name}" if name.to_s.start_with?("legacy_")
    super
  end
end

w = Widget.new
w.method(:width).source_location   # => ["widget.rb", 3]  — the define_method block
w.method(:width).owner             # => Widget
```

For a `define_method` method, `source_location` points at the *block* that defined
it — line 3, inside the `each` loop. That is exactly the line you needed to find.

Methods routed through `method_missing` behave differently, and the difference is
itself the diagnosis:

```ruby
w.method(:legacy_color).source_location  # => nil
w.method(:legacy_color).owner            # => Widget
w.method(:legacy_color).call             # => "legacy legacy_color"
```

You only get a `Method` object at all because `respond_to_missing?` is defined —
without it, `method(:legacy_color)` raises `NameError`, which is one more reason
always to pair `method_missing` with `respond_to_missing?`. And the `nil`
`source_location` tells you there is no Ruby source behind this name: it is either
synthesized dynamically or implemented in C (`1.method(:+).source_location` is
`nil` for the same reason). Combine it with `owner` to find which module in the
ancestor chain is responsible, and `Class.instance_method(:name)` to ask the same
questions without needing an instance.

### Buffered output lies about ordering

`$stdout` and `$stderr` are separate streams with separate buffering policies, so
the order in which lines *appear* is not necessarily the order in which they were
written:

```ruby
$stdout.sync   # => true on a terminal, false when redirected to a file or pipe
$stderr.sync   # => true (stderr is unbuffered by default)

$stdout.print "out1 "
$stderr.print "err1 "
$stdout.print "out2 "
$stderr.puts  "err2"
```

Run interactively, that prints in source order. Pipe it — `ruby demo.rb 2>&1 | cat`
— and you get:

```
err1 err2
out1 out2
```

`$stdout` stopped being a TTY, switched to block buffering, and flushed everything
at exit; `$stderr` went out immediately. Every `puts`-based debugging session
against a log file, a Docker log, or a CI job is running in exactly that mode, and
"the error happened before the thing that caused it" is a mirage.

```ruby
$stdout.sync = true   # flush after every write
$stderr.sync = true
```

Set both at the top of the program while debugging, and interleaving becomes
truthful again. It costs a syscall per write, which is why it is not the default
for redirected output — but during a debugging session that price is nothing
compared to reading a misleading log. The alternative is to send debug output to
one stream only, which sidesteps the cross-stream ordering question entirely.

### `freeze` as a debugging tool

The usual pitch for `freeze` is immutability and thread safety. Its underrated use
is diagnostic: when you suspect *something, somewhere* is mutating an object it
should not, freeze it and let Ruby find the line for you.

```ruby
CONFIG = { retries: 3 }.freeze

def sneaky(h)
  h[:retries] = 99
end

sneaky(CONFIG)
# FrozenError: can't modify frozen Hash: {retries: 3}
#   from config.rb:4:in 'Object#sneaky'
```

Instead of a wrong value discovered three modules later, you get an exception
whose backtrace names the exact statement that violated your assumption. This
works on any object — `String`, `Array`, `Hash`, your own classes — and it is
worth doing temporarily even when you have no intention of shipping the `freeze`.

Two things to know before relying on it:

```ruby
config = { hosts: ["a", "b"] }.freeze
config[:hosts] << "c"     # no error — freeze is shallow
config                    # => {hosts: ["a", "b", "c"]}
```

`freeze` protects only the object you called it on, not the objects it references.
For a deep freeze you have to walk the structure yourself (or use `Ractor.make_shareable`,
which freezes transitively and is the closest thing the core library offers).

Second, freezing is one-way — there is no `unfreeze` — and `dup` returns an
unfrozen copy while `clone` preserves frozen state:

```ruby
s = "config".freeze
s.dup.frozen?     # => false
s.clone.frozen?   # => true
s.clone(freeze: false).frozen?  # => false
```

## Trade-offs

- **The `self.`-less setter is the price of having local variables at all** — Ruby
  cannot let a bare assignment sometimes mean "call a setter", or every class with
  an accessor would forbid a local of the same name. Running the test suite with
  `-w` recovers most of the safety, since the shape almost always leaves an
  assigned-but-unused local, but it is a heuristic and not a check.
- **Silent `nil` for unset ivars enables lazy initialization and hides typos** —
  `@cache ||= expensive` only reads well because an unassigned `@cache` is `nil`.
  The same rule makes `@anwser` a legal expression. Ruby chose the idiom and
  removed the old verbose-mode warning in 3.0; the compensation is linting and
  tests that assert on constructed state.
- **Optional parentheses buy readable DSLs and cost you block-binding certainty** —
  `one two { }` and `one two do end` differ only in the block delimiter, and no
  amount of style guide fixes that. Parentheses at the ambiguous call site are the
  cheap, local, permanent fix.
- **`sync = true` trades throughput for honest ordering** — a flush per write is
  real syscall overhead in a hot logging path, which is exactly why redirected
  output is block-buffered by default. Turn it on while debugging, and reach for a
  proper logger rather than leaving it on in production.
- **`freeze` turns silent mutation into a loud failure, but only one level deep** —
  it converts a hunt into a backtrace, which is a superb trade during debugging.
  Left in permanently it can also break legitimate callers that dup-and-mutate,
  and its shallowness means a frozen container full of mutable values gives you
  less protection than it appears to.
- **`source_location` is diagnostic, not exhaustive** — it nails `define_method`
  and ordinary definitions, and returns `nil` for C-implemented and
  `method_missing`-routed methods. The `nil` is still information, but you need
  `owner` and the ancestor chain to finish the story.

## Documentation Links

- [Programming Ruby 3.3 (Pickaxe) — Troubleshooting Ruby](https://pragprog.com/titles/ruby5/programming-ruby-3-3-5th-edition/) — doc
- [Method#source_location and Method#owner — Ruby Core docs](https://docs.ruby-lang.org/en/3.3/Method.html#method-i-source_location) — doc
- [Object#freeze and Object#frozen? — Ruby Core docs](https://docs.ruby-lang.org/en/3.3/Object.html#method-i-freeze) — doc
- [IO#sync and IO#sync= — Ruby Core docs](https://docs.ruby-lang.org/en/3.3/IO.html#method-i-sync) — doc
- [BasicObject#method_missing and respond_to_missing? — Ruby Core docs](https://docs.ruby-lang.org/en/3.3/BasicObject.html#method-i-method_missing) — doc
