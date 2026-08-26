---
version: 1.0
updatedAt: 2026-08-18
---
## Objective

`self` is a read-only internal variable that controls exactly two things: where a
bare `@var` is read from and written to, and who receives a method call written
without an explicit receiver. Every object can also have a *singleton class* — an
anonymous class inserted directly above it, holding methods that belong to that
one object. Put those two facts together and "class methods" stop being a special
feature: inside `class Foo`, `self` **is** the class object `Foo`, so `def
self.bar` is just a singleton method defined on one particular object that happens
to be a class.

## Use Cases

- Debugging the classic `class Foo; @count = 0; end` surprise, where the ivar is
  invisible from every instance method because it lives on the class object.
- Writing class-level configuration for a gem or service object
  (`class << self; attr_accessor :logger; end`) instead of reaching for globals.
- Attaching behavior to exactly one object — a stub in a test, a one-off callback
  handler — with `def obj.method` or `obj.extend(SomeModule)`.
- Explaining why class methods are inherited by subclasses without anyone writing
  code to make that happen.
- Building classes at runtime with `Struct.new`, `Data.define`, or `Class.new`
  and assigning them to constants, subclassing them, or reopening them with a
  block.

## Deep Dive

### What `self` actually controls

```ruby
class Counter
  def initialize = @count = 0

  def increment
    @count += 1   # @count is looked up on self — the Counter instance
    report        # no receiver: sent to self
    self          # the object the method was called on
  end

  private

  def report = puts("count is now #{@count}")
end

c = Counter.new
c.increment   # prints "count is now 1"
```

Calling `c.increment` sets `self` to `c` for the duration of the method, and
restores the previous `self` when it returns. That single rule explains both
behaviors above: `@count` resolves against `c`'s own instance variables, and the
receiverless call to `report` is sent to `c` (which is also why a `private`
method can be called this way — there is no explicit receiver).

### The class-body trap: `self` is the class object

Inside a class or module body — outside any method definition — `self` is the
class object itself. So an assignment there creates an instance variable **on the
class**, not on future instances:

```ruby
class Config
  @setting = "class-level"

  def setting = @setting        # self here is a Config *instance*
  def self.setting = @setting   # self here is the Config *class*
end

Config.new.setting   # => nil
Config.setting       # => "class-level"
```

Both methods contain the identical source text `@setting`, and they read two
different variables, because they run with two different values of `self`. The
`nil` from `Config.new.setting` is not an error — an unset instance variable just
reads as `nil`, which is why this bug is quiet rather than loud.

### Singleton methods and the singleton class

`def obj.method` tells Ruby to create an anonymous class specific to `obj` (the
*singleton class*, also called the eigenclass), put the method there, and make
`obj`'s original class the superclass of that singleton class:

```ruby
greeting = "hello"

def greeting.shout = upcase + "!"

greeting.shout                       # => "HELLO!"
"hello".shout                        # NoMethodError — a different String object
greeting.singleton_class             # => #<Class:#<String:0x000000010a3c4d20>>
greeting.singleton_class.superclass  # => String
greeting.singleton_methods           # => [:shout]
```

`class << obj` is the alternative syntax for opening that same singleton class,
and it is the one to reach for when defining several methods at once. Inside that
block, `self` is the singleton class itself:

```ruby
class << greeting
  def whisper = downcase
  def shout = upcase + "!!!"
end
```

This is also what `extend` does under the hood: `obj.extend(SomeModule)` mixes the
module into `obj`'s singleton class, which is why the module's methods become
available on that one object and nowhere else.

### "Class methods" are singleton methods on the class object

Since `self` inside `class Foo` is the object `Foo`, these three definitions are
the same thing written three ways:

```ruby
class Registry
  def self.register(x) = entries << x   # most common
end

def Registry.register(x) = entries << x # explicit receiver, identical result

class Registry
  class << self
    def register(x) = entries << x      # opening the singleton class directly
  end
end
```

There is no separate "class method" storage anywhere in the interpreter — all
three put `register` in `Registry.singleton_class`'s method table. And because
Ruby keeps the singleton-class hierarchy parallel to the normal class hierarchy,
class-method inheritance falls out for free:

```ruby
class Base
  def self.describe = "I am #{name}"
end

class Child < Base; end

Child.describe                              # => "I am Child"
Child.singleton_class.superclass == Base.singleton_class  # => true
```

`Child.describe` is found by the ordinary lookup walk, just starting from
`Child`'s singleton class instead of from `Child`. Note that `self` inside
`describe` is `Child` when called that way — which is what makes `name` return
`"Child"`.

### The `class << self; attr_accessor; end` idiom

Because `attr_accessor` defines methods on whatever `self` is at the time, calling
it inside `class << self` defines them on the singleton class — producing
getters and setters for class-level instance variables:

```ruby
class HttpClient
  class << self
    attr_accessor :base_url, :timeout
  end

  self.timeout = 5

  def initialize(url: self.class.base_url) = @url = url
end

HttpClient.base_url = "https://api.example.com"
HttpClient.base_url   # => "https://api.example.com"
HttpClient.timeout    # => 5
```

Written as a plain `attr_accessor :base_url` in the class body, you would get
instance-level accessors instead — same method, different `self`, different place
the methods land.

### Visibility of an inherited method

Changing the visibility of an inherited method in a subclass works without
touching the parent:

```ruby
class Parent
  private def secret = "shh"
end

class Child < Parent
  public :secret   # now callable with an explicit receiver on Child instances
end
```

Ruby handles this by inserting a hidden proxy method in `Child` that simply calls
`super` at the new visibility. `Parent#secret` itself is untouched, so other
subclasses (and `Parent` instances) keep the original visibility.

### Classes are objects, so anything returning a class works

`Struct.new`, `Data.define`, and `Class.new` are ordinary method calls that return
real class objects. Anywhere Ruby expects a class, an expression evaluating to one
is equally valid:

```ruby
# Assigned to a constant — the class picks up the constant's name
Person = Struct.new(:name, :address) do
  def to_s = "#{name} of #{address}"
end

# Used directly as a superclass
class Employee < Struct.new(:name, :salary)
  def annual = salary * 12
end

# Immutable value object (Ruby 3.2+)
Point = Data.define(:x, :y)
p1 = Point.new(x: 1, y: 2)
p2 = p1.with(y: 9)   # => #<data Point x=1, y=9> — a new instance
p1.to_h              # => {x: 1, y: 2}

# Fully dynamic
audit_log = Class.new(Employee) do
  def self.kind = "audit"
end
audit_log.name           # => nil, it's anonymous
AuditLog = audit_log
AuditLog.name            # => "AuditLog" — naming happens on constant assignment
```

An anonymous class stays nameless until it is assigned to a constant, at which
point it permanently adopts that constant's name. If you want a readable name for
debugging without introducing a constant, `Module#set_temporary_name` (Ruby 3.3+)
gives one that a later constant assignment can still overwrite.

> ⚠️ **Book vs. today (Ruby 3.4+):** the book prints hashes the old way, so
> examples show `to_h` output as `{:x=>1, :y=>2}`. Ruby 3.4 changed
> `Hash#inspect` to render symbol keys in the shorthand form, so the same call now
> prints `{x: 1, y: 2}`. Only the display changed — the hash is identical — but
> it will bite any test that asserts on `inspect` output or on an interpolated
> hash string.

## Trade-offs

- **A class-level instance variable is not inherited, even though the class
  method that reads it is.** `@setting` lives on one specific class object, so a
  subclass starts with `nil` for it:
  ```ruby
  class Base
    @format = :json
    def self.format = @format
  end
  class Child < Base; end

  Base.format    # => :json
  Child.format   # => nil — Child is a different object with its own ivars
  ```
  This is exactly the gap Rails' `class_attribute` exists to fill; in plain Ruby
  you either accept it or write an `inherited` hook to copy the value down.
- **`private` behaves differently for class methods than instance methods.** A
  bare `private` in the class body has no effect on subsequently defined
  `def self.` methods — you need `private_class_method :name`, or a `private`
  inside a `class << self` block, which is one more reason to prefer the
  `class << self` form when several class methods are involved.
- **Per-object singleton methods make objects non-uniform, and that has real
  costs.** They are invisible when reading the class definition, they don't show
  up in `SomeClass.instance_methods`, and they defeat the interpreter's
  class-based method caching for that object. They also simply don't exist for
  some values: immediate objects and frozen objects reject them.
  ```ruby
  n = 42
  def n.double = self * 2       # TypeError: can't define singleton

  s = "frozen".freeze
  def s.shout = upcase          # TypeError: can't define singleton
  ```
  Reserve them for genuinely one-off cases (test stubs, a single configured
  instance); when several objects need the behavior, a module or a subclass is
  clearer.
- **`class << self` is powerful but opaque to newcomers.** For a single class
  method, `def self.foo` communicates the intent with no metaprogramming
  vocabulary required; the singleton-class syntax earns its keep when you need
  visibility control, `attr_accessor`, or a block of several definitions.

## Documentation Links

- [Object#singleton_class, #singleton_methods, #extend — Ruby Core docs](https://docs.ruby-lang.org/en/3.3/Object.html) — doc
- [Module#private_class_method, #attr_accessor, #define_method — Ruby Core docs](https://docs.ruby-lang.org/en/3.3/Module.html) — doc
- [Data — Ruby Core docs](https://docs.ruby-lang.org/en/3.3/Data.html) — doc
- [Programming Ruby 3.3 (Pickaxe) — The Ruby Object Model and Metaprogramming](https://pragprog.com/titles/ruby5/programming-ruby-3-3-5th-edition/) — doc
