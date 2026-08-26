---
version: 1.0
updatedAt: 2026-08-18
---
## Objective

`instance_eval`, `class_eval` (and its alias `module_eval`), plus the `_exec`
variants, all do the same core thing: run a block with `self` temporarily
switched to some other object. What they *don't* share is the **default
definee** — the invisible target that a bare `def` inside the block writes to.
`class_eval` on a class defines instance methods; `instance_eval` on that same
class defines class methods. Understanding that one asymmetry is what separates
"I copied a DSL from a blog post" from being able to build and debug one.

## Use Cases

- Building an internal DSL where the block body reads like a mini-language —
  `Turtle#walk { forward(8); left }`, RSpec's `describe`/`it`, a `Gemfile`,
  Rails' `routes.draw` — by running the caller's block with `self` set to the
  builder object, so bare method calls resolve against it.
- Reopening a class computed at runtime (`klass.class_eval { ... }`) when you
  don't have a literal constant name to write `class Foo` against.
- Writing a class-level macro that closes over its arguments, by combining
  `class_exec` with `define_method`.
- Poking at an object's private state from a test or a console session
  (`obj.instance_eval { @cache }`) without adding a reader you don't want in
  production code.
- Diagnosing the classic DSL bug report: "my `@config` is `nil` inside the
  block, but it's set right before the call."

## Deep Dive

### Same `self` switch, different `def` target

```ruby
class Widget; end

Widget.class_eval do
  self          # => Widget
  def render = "an instance method"
end

Widget.instance_eval do
  self          # => Widget  (identical!)
  def build = "a class method"
end

Widget.new.render  # => "an instance method"
Widget.build       # => "a class method"
```

`self` is `Widget` in both blocks, yet `def` lands in two different places.
`class_eval` sets the default definee to the receiver itself, so `def` behaves
exactly as if you'd typed it inside `class Widget ... end`. `instance_eval` sets
the default definee to the receiver's **singleton class** — which for a class
object is where class methods live. `Widget.instance_eval { def build; end }`
and `Widget.singleton_class.class_eval { def build; end }` are the same thing
written two ways.

The corollary trips people up constantly: `define_method` is a normal method
call on `self`, not a `def`, so it ignores the default definee entirely.

```ruby
Widget.instance_eval { define_method(:oops) { 1 } }
Widget.new.oops  # => 1  — an INSTANCE method, despite instance_eval
```

Inside `instance_eval`, `def` follows the singleton class but `define_method`
follows `self`. If you want a dynamically named class method, be explicit:
`Widget.define_singleton_method(:oops) { 1 }`.

### `_exec`: passing values in instead of capturing them

Because `self` changes, instance variables inside the block are read off the
*new* `self`, not the scope where the block was written. Local variables still
work (blocks are closures), but ivars silently become `nil`:

```ruby
class Report
  def initialize(title) = @title = title

  def render_into(target)
    target.instance_eval { @title }   # @title is looked up on `target`!
  end

  def render_into_fixed(target)
    target.instance_exec(@title) { |title| title }  # evaluated before the switch
  end
end

Report.new("Q3").render_into(Object.new)        # => nil, silently
Report.new("Q3").render_into_fixed(Object.new)  # => "Q3"
```

`instance_exec` / `class_exec` / `module_exec` are identical to their `_eval`
siblings except that they forward their arguments to the block. That makes them
the correct tool whenever the block needs data from the calling scope: compute
the value *outside* (where `self` is still the original object) and hand it in
as a block parameter. `class_exec` plus `define_method` is the standard recipe
for a macro that captures its own arguments:

```ruby
module Auditable
  def self.add_audit(klass, label)
    klass.class_exec(label) do |captured|
      define_method(:audit_tag) { "#{captured}:#{object_id}" }
    end
  end
end
```

### Building an internal DSL

```ruby
class Turtle
  MOVES = { north: [0, 1], east: [1, 0], south: [0, -1], west: [-1, 0] }.freeze
  TURNS = %i[east north west south].freeze

  attr_reader :trail

  def initialize
    @x = @y = 0
    @heading = :east
    @trail = []
  end

  def walk(&block)
    instance_eval(&block)   # the block's `self` becomes this turtle
    self
  end

  def forward(steps = 1)
    dx, dy = MOVES.fetch(@heading)
    @x += dx * steps
    @y += dy * steps
    @trail << [@x, @y]
  end

  def left
    @heading = TURNS[(TURNS.index(@heading) + 1) % TURNS.size]
  end
end

Turtle.new.walk do
  forward(8)
  left
  forward(3)
end.trail
# => [[8, 0], [8, 3]]
```

`forward` and `left` have no explicit receiver, and they resolve because `self`
inside the block *is* the turtle. That is the whole trick behind RSpec:
`describe` builds an example group object and `instance_eval`s your block
against it, which is why `it`, `let`, and `subject` are callable bare inside it
but are not global methods.

### Constants are looked up lexically, not through `self`

```ruby
LABEL = "top level"

class Widget
  LABEL = "widget"
end

Widget.instance_eval { LABEL }   # => "top level"
Widget.class_eval    { LABEL }   # => "top level"
Widget.class_eval("LABEL")       # => "widget"
```

`self` moved to `Widget`, but constant resolution uses the **lexical** scope of
the place the block was *written* — here, top level — so `Widget::LABEL` is
never consulted. Only the (discouraged) string form re-roots constant lookup at
the receiver, because a string is parsed fresh with the receiver as its lexical
scope. When a block-form `class_eval` can't see a constant you expected, name it
fully (`Widget::LABEL`) rather than reaching for the string form.

### Why the string form is discouraged

```ruby
# Avoid: parsed at runtime, unreadable backtraces, injection risk
klass.class_eval("def #{name}; @#{name}; end", __FILE__, __LINE__)

# Prefer: same effect, no parsing, no interpolation of untrusted text
klass.class_eval { define_method(name) { instance_variable_get(:"@#{name}") } }
```

String `eval` re-invokes the parser on every call, produces backtraces pointing
at `(eval)` unless you pass `__FILE__`/`__LINE__`, and turns any externally
supplied `name` into arbitrary code execution. The block form has none of those
problems and is almost always expressible.

## Trade-offs

- **A DSL block is a hostile environment for the caller's code.** Inside
  `instance_eval`, the caller loses their own `self`: their ivars, private
  helpers, and any method whose name the DSL target also defines. The explicit
  alternative — yielding the builder as a block argument
  (`config.database { |db| db.pool = 5 }`) — is a few characters noisier but
  keeps `self` intact and never surprises anyone. Reserve `instance_eval` for
  DSLs whose blocks are meant to be *declarative data*, not general code.
- **`instance_eval` on someone else's object bypasses encapsulation.** Handy in
  a console or a test, corrosive in production code: it couples you to private
  ivar names that the owner is free to rename in a patch release.
- **The `_eval` / `_exec` choice is not stylistic.** If the block needs values
  from the calling scope, `_exec` is the only correct option; relying on
  captured ivars produces a `nil` that no test may catch until much later.
- **Metaprogrammed methods are invisible to grep and to your editor.** A method
  created inside a `class_eval` string, or by a computed `define_method` name,
  can't be jumped to. `Widget.instance_method(:render).source_location` is your
  fallback — budget for the extra debugging cost before making an API dynamic.

## Documentation Links

- [BasicObject#instance_eval — Ruby Core docs](https://docs.ruby-lang.org/en/3.3/BasicObject.html#method-i-instance_eval) — doc
- [BasicObject#instance_exec — Ruby Core docs](https://docs.ruby-lang.org/en/3.3/BasicObject.html#method-i-instance_exec) — doc
- [Module#class_eval, #class_exec, #module_eval — Ruby Core docs](https://docs.ruby-lang.org/en/3.3/Module.html#method-i-class_eval) — doc
- [Programming Ruby 3.3 (Pickaxe) — The Ruby Object Model and Metaprogramming](https://pragprog.com/titles/ruby5/programming-ruby-3-3-5th-edition/) — doc
