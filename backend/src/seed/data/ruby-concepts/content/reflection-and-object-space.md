---
version: 1.0
updatedAt: 2026-08-17
---
## Objective

Ruby lets you inspect and manipulate nearly everything about a running
program from within the program itself: every live object, every method's
source location and parameters, every class's ancestry, and — via
`method_missing` and `define_method` — the ability to fabricate methods
that were never written down at all. This is the machinery underneath
DSLs, ORMs, and mocking libraries, and understanding it is what makes
"how does ActiveRecord know about columns it never declared as methods"
stop being magic.

## Use Cases

- Building a DSL or configuration API where method calls should map
  dynamically to data (the mechanism behind `OpenStruct`, and behind
  ActiveRecord's attribute accessors).
- Debugging "where does this method actually come from" for a method
  defined via metaprogramming, using `source_location` and `owner`.
- Writing a mock/stub library, or understanding how one works, via
  `define_singleton_method` and method introspection.
- Auditing memory usage by walking all live objects of a given class with
  `ObjectSpace.each_object`.

## Deep Dive

### `method_missing`: methods that don't exist until they're called

```ruby
class DynamicConfig
  def initialize(data) = @data = data

  def method_missing(name, *args)
    key = name.to_s.chomp("=")
    return @data[key] = args.first if name.to_s.end_with?("=")
    @data.fetch(key) { super }
  end

  def respond_to_missing?(name, include_private = false)
    true
  end
end

config = DynamicConfig.new({})
config.timeout = 30
config.timeout   # => 30
```

`method_missing` is the last step of Ruby's method lookup chain — it only
runs when nothing else in the ancestor chain matched. Every override should
pair with `respond_to_missing?`; skipping it means `respond_to?` lies about
what the object can actually do, which breaks anything that checks before
calling (including plain debugging).

### `define_method`: methods generated at class-definition time

```ruby
class Product
  %i[name price stock].each do |attr|
    define_method(attr) { instance_variable_get("@#{attr}") }
    define_method("#{attr}=") { |v| instance_variable_set("@#{attr}", v) }
  end
end
```

Unlike `method_missing` (which intercepts calls at runtime, on every call),
`define_method` generates real, ordinary methods once, at class-load time —
faster per call, and visible in `instance_methods`/`respond_to?` without
any extra work. Prefer `define_method` over `method_missing` whenever the
full set of method names is known up front (as it is here); reach for
`method_missing` only when names are genuinely unbounded or unknown ahead
of time.

### Introspecting objects, classes, and methods

```ruby
"hello".method(:upcase).source_location   # => nil (C-implemented, no Ruby source)
config.method(:timeout).owner              # => DynamicConfig
Product.instance_methods(false)            # methods defined directly on Product
ObjectSpace.each_object(Product).count     # every live Product instance right now
```

`Method#source_location` and `#owner` work even for methods defined
dynamically via `define_method` or dispatched through `method_missing` —
this is the practical way to answer "where did this method actually come
from" in code that uses heavy metaprogramming, rather than grepping source
files. `ObjectSpace.each_object` walks every live object of a class,
useful for one-off memory audits (`require "objspace"` first for the
heavier introspection methods; the basic enumeration doesn't need it).

### Hook methods: reacting to class-level events

```ruby
module Trackable
  def self.included(base)
    base.extend(ClassMethods)
  end

  module ClassMethods
    def track_changes_for(*attrs)
      attrs.each { |a| puts "Tracking #{a} on #{self}" }
    end
  end
end

class Order
  include Trackable
  track_changes_for :status, :total
end
```

`included`/`extended`/`inherited` are hooks Ruby calls automatically at the
moment a module is mixed in or a class is subclassed — the standard way a
mixin adds class-level behavior (`ClassMethods`) at the same time it adds
instance-level behavior, which is the mechanism behind
`ActiveSupport::Concern`.

## Trade-offs

- **`method_missing` pays a real per-call cost versus a real method**,
  because every call first fails the normal lookup chain before falling
  through to it — for a hot path with a known, fixed set of method names,
  `define_method` at class-load time is both faster and more introspectable.
- **Overriding `method_missing` without `respond_to_missing?` makes
  `respond_to?` lie** — any code (including a debugger, or a library doing
  duck-typing checks) that asks "can this object do X?" before calling X
  gets a wrong answer.
- **`ObjectSpace.each_object` and friends carry real overhead and are a
  development/diagnostic tool, not something to call on a hot request
  path** — `require "objspace"` in particular adds tracing overhead that
  should stay out of production code.

## Documentation Links

- [Object#method_missing, #respond_to_missing? — Ruby Core docs](https://docs.ruby-lang.org/en/3.3/BasicObject.html#method-i-method_missing) — doc
- [Module#define_method — Ruby Core docs](https://docs.ruby-lang.org/en/3.3/Module.html#method-i-define_method) — doc
- [ObjectSpace — Ruby Core docs](https://docs.ruby-lang.org/en/3.3/ObjectSpace.html) — doc
