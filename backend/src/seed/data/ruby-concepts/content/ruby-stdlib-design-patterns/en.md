---
version: 1.0
updatedAt: 2026-08-18
---
## Objective

Three of the Gang of Four patterns Ruby developers hand-roll most often —
Decorator, Observer, and Singleton — already ship with Ruby, tested and
maintained, in `delegate`, `observer`, and `singleton`. Almost every codebase
that grew past a few thousand lines contains a wrapper class forwarding two
dozen methods with `def_delegator`-by-hand, an `@observers = []` array with a
`notify` loop, and a `class << self; def instance; @instance ||= new; end; end`
block that leaks a second instance through `dup`. `SimpleDelegator`,
`Observable`, and `Singleton` are the versions someone already wrote correctly,
including the edge cases the hand-rolled ones forget. The goal here is not to
learn a pattern — it's to recognize the moment you're about to reimplement one
that's already `require`-able.

## Use Cases

- Wrapping an object to add auditing, caching, or formatting *without* touching
  its class or its callers — `SimpleDelegator` forwards everything you didn't
  override.
- Swapping the wrapped target at runtime (`__setobj__`) so one decorator
  instance can follow a moving object: a connection that reconnects, a record
  that gets reloaded.
- Building a collection type with an invariant (always sorted, always unique,
  always bounded) via `DelegateClass(Array)` instead of subclassing `Array` and
  inheriting a hundred methods you never audited.
- Letting several unrelated objects react to a state change — audit log, cache
  invalidation, alerting — without the publisher holding a `require` on any of
  them (`Observable`).
- Guaranteeing exactly one instance of a config loader, feature-flag registry,
  or connection pool, thread-safely, without writing the double-checked locking
  yourself (`Singleton`).

## Deep Dive

### `SimpleDelegator`: Decorator with no boilerplate

`SimpleDelegator` is a class whose entire job is "be someone else." Subclass it,
pass the real object to `new`, and every message you did *not* define is
forwarded to that object:

```ruby
require "delegate"

class Invoice
  attr_reader :number, :cents

  def initialize(number, cents)
    @number = number
    @cents  = cents
  end

  def total = cents / 100.0
  def to_s  = "Invoice #{number} (#{format('%.2f', total)})"
end

class AuditedInvoice < SimpleDelegator
  def initialize(invoice, log)
    super(invoice)      # sets the delegation target
    @log = log
  end

  def total
    @log << "read total of #{number}"   # `number` already delegates
    super                               # `super` reaches Invoice#total
  end
end
```

```ruby
log = []
inv = AuditedInvoice.new(Invoice.new("A-1", 12_50), log)

inv.total    # => 12.5   — our override, which logged first
inv.number   # => "A-1"  — forwarded, we never defined it
inv.cents    # => 1250   — forwarded
inv.to_s     # => "Invoice A-1 (12.50)" — forwarded
log          # => ["read total of A-1"]
```

Two details make this more than syntactic sugar. First, `super` inside an
overridden method reaches the *wrapped object's* implementation, even though
`Invoice` is nowhere in `AuditedInvoice`'s ancestry — `Delegator` implements
that through `method_missing`, so an unmatched `super` lands on the target
instead of raising. Second, the target is swappable:

```ruby
inv.__getobj__            # => the Invoice instance
inv.__setobj__(Invoice.new("A-2", 999))
inv.number                # => "A-2"
inv.total                 # => 9.99, and the log grew again
```

The decorator survived the swap. That is the thing inheritance cannot do.

The identity gotcha is worth memorizing: a delegator is *not* its target.

```ruby
inv.class            # => AuditedInvoice
inv.is_a?(Invoice)   # => false
inv.respond_to?(:number) # => true — Delegator overrides respond_to? properly
```

Code that dispatches on `is_a?` will not see through the wrapper; code that duck
types on `respond_to?` will. This is one more reason the duck-typing chapter's
advice ("ask what it does, not what it is") pays off — decorators are exactly
the objects class checks break on.

### `DelegateClass(Array)`: composition where you'd reach for inheritance

`DelegateClass(SomeClass)` returns a brand-new class that forwards `SomeClass`'s
public instance methods to a target you hand it via `super` in `initialize`:

```ruby
require "delegate"

class SortedList < DelegateClass(Array)
  def initialize(items = [])
    @items = items.sort
    super(@items)          # @items is the delegation target
  end

  def <<(item)
    @items << item
    @items.sort!
    self
  end

  def push(*) = raise(NoMethodError, "use #<< so the list stays sorted")
end
```

```ruby
list = SortedList.new([3, 1, 2])
list.to_a          # => [1, 2, 3]
list << 0
list.to_a          # => [0, 1, 2, 3]
list.first         # => 0    — Array's method, on our target
list.include?(2)   # => true
list.sum           # => 6
list.map { _1 * 10 }        # => [0, 10, 20, 30] (a plain Array)
list.push(9)       # NoMethodError: use #<< so the list stays sorted
```

This is "nearly the same as `class SortedList < Array`" — with three differences
that matter.

**You choose what's exposed, explicitly.** With inheritance, every current and
*future* public `Array` method is part of your class's API by default, including
`replace`, `fill`, `unshift`, and `[]=`, each of which can break the sorted
invariant. With `DelegateClass` the forwarded set is still broad, but your class
body is the single place that decides overrides — and defining a method that
raises actually removes it from the API. (`undef_method` does *not* work here:
undefining a method on a delegator just routes the call into `method_missing`,
which forwards it to the target anyway. Define a raising method instead.) When
you want a strict allowlist rather than "everything," `Forwardable` and
`def_delegators` are the right tool — same file family, opposite default.

**You are not bound to `Array`'s internals.** Core classes are implemented in C
and their methods call each other through C paths, not through your Ruby
overrides, so a subclass's override is silently skipped by code you never see.
Since Ruby 3.0 the situation got stranger, not better: `Array` subclass methods
return plain `Array`s, so inheriting buys you less than it used to.

```ruby
class BadList < Array
  def <<(x) = (super; sort!; self)
end

b = BadList.new
b << 3
b << 1                    # => [1, 3]  — our override ran
b.push(0)                 # => [1, 3, 0] — bypassed it entirely
(b + [9]).class           # => Array   — not BadList
b.select { _1 > 1 }.class # => Array   — not BadList
```

**Your type stays yours.** `SortedList` is not an `Array`, so nothing downstream
mistakes it for one and mutates it through an `Array`-only path. Where you *do*
want array-ness, it's still there through the delegated `to_ary`, so splats and
destructuring keep working:

```ruby
[*list]          # => [0, 1, 2, 3]
a, b = list      # a => 0, b => 1
list.is_a?(Array) # => false
```

That combination — behaves like an `Array` at the call sites that ask nicely,
isn't one at the call sites that check — is the practical argument for
composition over inheritance in Ruby, and `DelegateClass` is the two-word way to
get it.

### `Observable`: the Observer pattern, and the `changed` flag

`require "observer"` gives you a mixin. `include Observable` in the publisher;
observers are any objects responding to `update`:

```ruby
require "observer"

class Ticker
  include Observable

  def initialize(symbol)
    @symbol = symbol
    @price  = nil
  end

  def price=(new_price)
    return if new_price == @price
    @price = new_price
    changed                                     # 1. mark "I changed"
    notify_observers(@symbol, new_price, Time.now)  # 2. fire update on everyone
  end
end

class Alarm
  def initialize(limit) = @limit = limit

  def update(symbol, price, _at)
    puts "ALARM: #{symbol} at #{price} (limit #{@limit})" if price < @limit
  end
end

class AuditLog
  def initialize = @entries = []
  attr_reader :entries

  def update(symbol, price, _at) = @entries << [symbol, price]
end
```

```ruby
log    = AuditLog.new
ticker = Ticker.new("AAPL")
ticker.add_observer(Alarm.new(180))
ticker.add_observer(log)
ticker.count_observers   # => 2

ticker.price = 190       # (no alarm — above the limit)
ticker.price = 175       # prints: ALARM: AAPL at 175 (limit 180)
log.entries              # => [["AAPL", 190], ["AAPL", 175]]
```

`Ticker` knows nothing about alarms or audit logs. It knows how to say "I
changed, here's what to." That's the whole point of the pattern, and here it
costs one `include` and two method calls.

**The `changed` flag is the classic bug.** `notify_observers` does nothing
unless `changed` was called since the last notification, and it *resets the flag
on the way out*. Both halves bite:

```ruby
class Broken
  include Observable

  def fire(v)
    notify_observers(v)     # no `changed` first — silently does nothing
  end

  def fire_twice(v)
    changed
    notify_observers(v)     # runs
    notify_observers(v)     # flag already reset — silently does nothing
  end
end
```

No exception, no warning: the observers just don't run. When a pub/sub bug
reports as "the callback fired once instead of twice" or "the callback never
fires," a missing `changed` is the first thing to check. You can inspect and
control the flag directly — `changed?` reads it, `changed(false)` clears it,
which is how you abort a notification mid-computation.

Two smaller affordances: `add_observer` takes a second argument to use a
different callback name, and it validates eagerly.

```ruby
ticker.add_observer(handler, :on_price_change)  # calls handler.on_price_change
ticker.add_observer(Object.new)
# NoMethodError: observer does not respond to `update'
```

Also useful: `delete_observer(obj)`, `delete_observers`, `count_observers`. Note
that notification is synchronous and in-process — every `update` runs on the
caller's thread before `price=` returns. `Observable` is an in-memory
coordination tool, not a message queue.

### `Singleton`: the hand-rolled idiom, done right

`include Singleton` makes `new` and `allocate` private and adds `.instance`:

```ruby
require "singleton"

class FeatureFlags
  include Singleton

  def initialize
    # runs exactly once, lazily, on the first .instance call
    @flags = JSON.parse(File.read("config/flags.json"))
  end

  def enabled?(name) = @flags.fetch(name, false)
  def enable(name)   = @flags[name] = true
end
```

```ruby
FeatureFlags.instance.equal?(FeatureFlags.instance)  # => true
FeatureFlags.instance.enable("dark_mode")
FeatureFlags.instance.enabled?("dark_mode")          # => true

FeatureFlags.new    # NoMethodError: private method 'new' called for class FeatureFlags
```

The interesting part is everything it closes off besides `new`. A hand-rolled
singleton usually looks like this — and this platform's
`self-and-singleton-classes` concept covers the `class << self` mechanism itself
in depth, so treat it as known here:

```ruby
class HandRolled
  class << self
    def instance = @instance ||= new
  end
end
```

Functionally the same idea: `@instance` is an ivar on the class object, memoized
by `||=`. But compare the escape hatches:

```ruby
# hand-rolled
HandRolled.new.equal?(HandRolled.instance)             # => false — `new` is public
HandRolled.instance.dup.equal?(HandRolled.instance)    # => false — a second instance
HandRolled.instance.clone.equal?(HandRolled.instance)  # => false
Marshal.load(Marshal.dump(HandRolled.instance))
  .equal?(HandRolled.instance)                         # => false

# stdlib Singleton
FeatureFlags.instance.dup    # TypeError: can't dup instance of singleton FeatureFlags
FeatureFlags.instance.clone  # TypeError: can't clone instance of singleton FeatureFlags
Marshal.load(Marshal.dump(FeatureFlags.instance))
  .equal?(FeatureFlags.instance)                       # => true
```

`Singleton` defines `dup` and `clone` to raise, and defines `_dump`/`_load` so a
Marshal round-trip returns the *same* object rather than a copy — a real leak in
anything that caches or serializes objects. Inheritance is handled too: a
subclass doesn't share or duplicate the parent's instance, it gets its own,
still with `new` private.

```ruby
class Base; include Singleton; end
class Sub < Base; end

Base.instance.equal?(Sub.instance)  # => false — Sub has its own
Sub.new                             # NoMethodError — still private
```

And the one that actually matters in a threaded server: `Singleton.instance` is
mutex-guarded with a double-checked lock, so two threads racing on first access
get the same object. The hand-rolled `@instance ||= new` is a read, a branch,
and a write with no synchronization — two threads can both see `nil` and both
call `new`, and if `initialize` is slow (loading a file, opening a connection),
that race is not theoretical.

> ℹ️ **Book vs. today:** the Pickaxe covers Ruby 3.3. Ruby 3.4 added
> `RactorLocalSingleton` alongside `Singleton` in the same file — same API
> (`include RactorLocalSingleton`, then `.instance`), but the instance is
> per-Ractor rather than per-process, since a process-wide mutable singleton is
> exactly what Ractor isolation forbids.

## Trade-offs

- **A delegator gains transparency and loses identity** — everything forwards,
  but `is_a?` and `case/when` see the wrapper, not the target, and a backtrace
  through `method_missing` is one frame further from the real code. Wrapping is
  the right call when callers duck type; it's a trap in a codebase that
  dispatches on class.
- **`method_missing` forwarding costs a lookup miss on every delegated call** —
  fine for a decorator around business objects, measurable if you wrap a hot
  collection and call through it in a tight loop. `Forwardable`'s
  `def_delegators` generates real methods and avoids that cost, at the price of
  listing every method you want.
- **`DelegateClass` gives you composition but not encapsulation by default** —
  it forwards the whole public API, so "I only wanted `each` and `<<`" still
  means every `Array` method is callable until you override it to raise. If the
  allowlist is short, `Forwardable` says what you mean; if it's long,
  `DelegateClass` does.
- **`Observable` decouples the publisher and hides the cost** — the publisher
  stops knowing its consumers, which is the win, but every `update` runs
  synchronously on the publisher's thread, exceptions from one observer abort
  the rest of the notification, and ordering is registration order. For anything
  slow or failure-prone, the observer should enqueue, not work.
- **The `changed` flag fails silently in both directions** — forget it and
  nothing fires; call `notify_observers` twice and only the first runs. There is
  no warning, so the failure mode is a missing side effect discovered much later
  rather than an exception at the call site.
- **`Singleton` is a correct implementation of a pattern that is often the wrong
  choice** — it's global mutable state with a nicer name: hard to substitute in
  tests, order-dependent at boot, and shared across everything in the process.
  Reach for it when the single instance is genuinely a property of the process
  (a config registry, a connection pool); pass an instance explicitly when it
  isn't. Its real advantage over the hand-rolled version is thread safety and
  the closed `dup`/`clone`/`Marshal` paths, not the pattern itself.

## Documentation Links

- [Delegator, SimpleDelegator, DelegateClass — Ruby stdlib docs](https://docs.ruby-lang.org/en/3.3/Delegator.html) — doc
- [Observable — Ruby stdlib docs](https://docs.ruby-lang.org/en/3.3/Observable.html) — doc
- [Singleton — Ruby stdlib docs](https://docs.ruby-lang.org/en/3.3/Singleton.html) — doc
- [Forwardable — Ruby stdlib docs](https://docs.ruby-lang.org/en/3.3/Forwardable.html) — doc
- [Programming Ruby 3.3 (Pickaxe) — Ruby on Ruby](https://pragprog.com/titles/ruby5/programming-ruby-3-3-5th-edition/) — doc
- [Ruby 3.4.0 Released — ruby-lang.org](https://www.ruby-lang.org/en/news/2024/12/25/ruby-3-4-0-released/) — doc
