---
version: 1.0
updatedAt: 2026-08-17
---
## Objective

Every Ruby object resolves a method call by walking a single ordered chain — its
singleton class, then its class, then the modules mixed into that class, then the
superclass, and so on up to `BasicObject`. `include`, `extend`, and `prepend` all
just insert a module at a different point in that chain. Understanding the chain
(and being able to read it with `Class#ancestors`) is what separates "I mixed in a
module and something is calling the wrong version" from actually knowing why.

## Use Cases

- Deciding whether a cross-cutting behavior (loggable, comparable, cacheable)
  should be a mixin (`include`) or a real superclass — mixins compose, deep
  inheritance chains couple.
- Wrapping/decorating an existing method (e.g. adding instrumentation around a
  library method) without monkey-patching it directly — `prepend` + `super` is the
  clean way to do this.
- Debugging "which method is actually running" when a class includes several
  modules that each define the same method name.
- Understanding why Rails concerns (`ActiveSupport::Concern`, itself just sugar
  over `include`) behave the way they do in a model with several concerns mixed in.

## Deep Dive

### The lookup chain, in order

For an instance method call, Ruby searches in this order:

1. Singleton methods defined directly on the instance (`def obj.foo`).
2. Modules `prepend`ed to the class — most-recently-prepended first.
3. Methods defined directly on the class itself.
4. Modules `include`d into the class — most-recently-included first.
5. Repeat the whole process on the superclass.
6. If nothing is found anywhere in the chain, retry the whole search for
   `method_missing`; if that's not found either, raise `NoMethodError`.

```ruby
module Loud
  def greet = super.upcase
end

class Greeter
  prepend Loud
  def greet = "hello"
end

Greeter.new.greet          # => "HELLO"
Greeter.ancestors           # => [Loud, Greeter, Object, Kernel, BasicObject]
```

`Loud` sits *before* `Greeter` in the ancestor chain because it was `prepend`ed,
not `include`d — so `Loud#greet` runs first, and its `super` call reaches
`Greeter#greet`. If `Loud` had been `include`d instead, `Greeter#greet` would run
first and `Loud#greet` would never be reached from a normal call.

### `include` vs `extend` vs `prepend`

```ruby
module Describable
  def describe = "I am a #{self.class}"
end

class Widget
  include Describable   # adds Describable's methods as *instance* methods
end

class Report
  extend Describable    # adds Describable's methods to Report itself (class-level)
end

Widget.new.describe   # => "I am a Widget"
Report.describe        # => "I am a Report"
```

`include` inserts the module *after* the class in the lookup chain (the class's
own methods win); `prepend` inserts it *before* (the module's methods win, and can
call `super` to reach the class's own version); `extend` adds the module's methods
directly to the receiver's singleton class — the most common use is `extend
SomeModule` inside a class body to add "class methods".

### `super` doesn't mean "the superclass" — it means "the next step in the chain"

```ruby
class Greeter
  prepend Loud
  def greet = "hello"
end
```

Inside `Loud#greet`, `super` resolves to whatever is *next* in `Greeter.ancestors`
after `Loud` — which is `Greeter` itself, not `Loud`'s own superclass. `super`
always continues from where the *current* method was found in the chain, which is
why `prepend`-based decoration works at all: the module doesn't need to know what
class it'll eventually be prepended to.

## Trade-offs

- **Instance variables inside a mixin share the same namespace as the host
  class.** A module that sets `@cache` inside one of its methods can silently
  collide with a `@cache` ivar the including class also uses — mixins are best
  kept stateless, or given deliberately unusual ivar names.
- **Deep `include` chains make "which method actually runs" hard to answer by
  reading the code** — `ancestors` is the actual source of truth, not the file
  where a method is defined.
  ```ruby
  Greeter.ancestors.each { |m| puts m }
  ```
- **`prepend` for decorating a method you don't own (monkey-patching a gem) is
  safer than reopening the class and redefining the method outright**, because
  `super` still reaches the original implementation instead of needing to save
  and re-call it manually — but it still couples your code to that gem's
  internals across version upgrades, so it's a targeted tool, not a default.

## Documentation Links

- [Module#include, #prepend, #extend — Ruby Core docs](https://docs.ruby-lang.org/en/3.3/Module.html) — doc
- [Object#method, #singleton_class — Ruby Core docs](https://docs.ruby-lang.org/en/3.3/Object.html) — doc
- [Programming Ruby 3.3 (Pickaxe) — Sharing Functionality: Inheritance, Modules, and Mixins](https://pragprog.com/titles/ruby5/programming-ruby-3-3-5th-edition/) — doc
