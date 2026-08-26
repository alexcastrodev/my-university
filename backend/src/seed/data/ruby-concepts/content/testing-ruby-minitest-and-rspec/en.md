---
version: 1.0
updatedAt: 2026-08-21
---
## Objective

Ruby ships a real testing framework in the standard library — Minitest — and
the ecosystem still overwhelmingly reaches for a second one, RSpec, that isn't
in the stdlib at all. That's not indecision: the two encode different bets
about what a test suite should read like, and both bets show up constantly in
production codebases (Rails itself is tested with Minitest internally, while
most Rails *applications* in the wild are tested with RSpec). Knowing only
`assert_equal` or only `expect(x).to eq(y)` means half the Ruby codebases
you'll open are unfamiliar on day one. The other half of this concept —
doubles, verified doubles, and shared examples — is where experienced-looking
test suites quietly go wrong: a `double` that lies about an API, a `let` that
hides a dependency between examples, or a `changed`-style flag equivalent that
fails silently.

## Use Cases

- Reading and extending an existing Rails or gem test suite, whichever
  framework it committed to — recognizing `assert_*` vs `expect(...).to`
  instantly instead of re-deriving the DSL from context.
- Choosing a framework for a new gem: Minitest for something small, dependency
  free, and fast to boot; RSpec when the team already thinks in BDD vocabulary
  and wants matcher composition and shared examples.
- Replacing a hand-rolled fake or a real network call with a test double that
  actually verifies the call happened (`expect(...).to receive`) instead of a
  double that silently accepts any method name.
- Catching an API-drift bug at test time — `instance_double` failing the suite
  the moment a collaborator's method is renamed — instead of at three-in-the-
  morning production time.
- Diagnosing "this test only fails when run after that other test" by
  recognizing test-order coupling introduced by `let` memoization or shared
  mutable state, and using randomized run order (`--seed`) to force it out.

## Deep Dive

### Minitest: assertions, not sentences

Minitest is the framework Ruby itself, and Rails internally, are tested with.
A test is a method whose name starts with `test_`, on a class that inherits
from `Minitest::Test`:

```ruby
require "minitest/autorun"

class InvoiceTest < Minitest::Test
  def setup
    @invoice = Invoice.new("A-1", 12_50)
  end

  def test_total_converts_cents_to_a_float
    assert_equal(12.5, @invoice.total)
  end

  def test_raises_on_negative_cents
    assert_raises(ArgumentError) { Invoice.new("A-2", -1) }
  end

  def teardown
    @invoice = nil
  end
end
```

`require "minitest/autorun"` does two jobs at once: it loads the framework
*and* registers an `at_exit` hook that runs every discovered test — there's no
separate runner script to write. `setup`/`teardown` run before/after **every**
test method in the class, not once per class, so `@invoice` above is a fresh
object per test — no leakage between examples by construction.

Every positive assertion has a negative twin: `assert_equal`/`refute_equal`,
`assert_empty`/`refute_empty`, `assert_nil`/`refute_nil`. The last argument to
any assertion is an optional custom failure message, which matters once a
suite has hundreds of `assert_equal` calls and a failure needs to say *which*
one:

```ruby
assert_equal(expected, actual, "invoice total should already be rounded")
```

Running `ruby -Ilib test/invoice_test.rb -n test_raises_on_negative_cents`
runs one test by exact name; `-n /negative/` runs every test whose name
matches the regex — the day-to-day way to iterate on one failing area without
running the whole suite. `-Ilib` puts `lib/` on the load path so `require
"invoice"` resolves without a relative path hack.

Minitest also ships **mocks**, deliberately minimal:

```ruby
mailer = Minitest::Mock.new
mailer.expect(:deliver, true, [Invoice])

InvoiceSender.new(mailer).send_receipt(invoice)

mailer.verify   # raises if :deliver was never called with a matching arg
```

`expect(method, return_value, expected_args)` records what must happen;
`verify` is where the assertion actually fires — forget to call it and a mock
that was never invoked passes silently. `stub` is the lighter, unverified
sibling — it patches a method for the duration of a block and doesn't care
whether it was called:

```ruby
Time.stub(:now, Time.new(2026, 1, 1)) do
  assert_equal("2026-01-01", Report.new.generated_on)
end
```

Use `stub` for "give me a canned value so the test is deterministic"; use
`Mock`/`expect`/`verify` for "assert this interaction actually happened."

### RSpec: a DSL for hypotheses, not a runner for assertions

RSpec is a separate gem, and it looks nothing like Minitest on the surface —
`describe`/`it`/`expect` instead of a class with `test_` methods:

```ruby
RSpec.describe Invoice do
  subject(:invoice) { described_class.new("A-1", 12_50) }

  it "converts cents to a float total" do
    expect(invoice.total).to eq(12.5)
  end

  it "raises on negative cents" do
    expect { described_class.new("A-2", -1) }.to raise_error(ArgumentError)
  end
end
```

The fluent syntax is not special parser magic — it's ordinary Ruby.
`expect(x).to eq(y)` is `self.expect(x).to(self.eq(y))` underneath: `expect`
returns a wrapper object, `eq` builds a matcher object, and `to` calls
`matches?` on it and raises on failure. `describe`/`it` blocks run via
`instance_eval`, which is the same mechanism this platform's
`instance-eval-and-dsls` concept covers for building internal DSLs — RSpec
*is* that pattern, at scale.

`let(:name) { block }` is the RSpec idiom that replaces an instance variable
set in `before`:

```ruby
RSpec.describe ShoppingCart do
  let(:cart)  { ShoppingCart.new }
  let(:apple) { Item.new("apple", 150) }

  it "sums item prices" do
    cart.add(apple)
    expect(cart.total).to eq(150)
  end
end
```

`let` is **lazy** (the block runs only the first time `apple` is referenced
inside an example, not for every example that doesn't use it) and
**memoized per example** (calling `apple` twice in the same `it` returns the
same object; the next `it` gets a fresh one). That combination is the whole
appeal over `@apple = Item.new(...)` in a `before` block — expensive fixtures
that aren't needed by every example in the file aren't built for free. It's
also the classic footgun: `let` creates a *method*, so a typo in the name
(`aple` instead of `apple`) is a `NoMethodError`, not a silent `nil` the way a
typo'd instance variable would be — usually a feature, occasionally a
confusing failure in a huge shared spec file.

`before(:example)` (the default) is RSpec's `setup`; `before(:context)` runs
once for the whole `describe` block instead of once per example — useful for
genuinely expensive, read-only fixtures, dangerous for anything a test
mutates, since mutations then leak across examples that assumed isolation.

### Matchers, including the ones that read your object's methods

RSpec's matcher library goes well past `eq`:

```ruby
expect(cart).to be_empty
expect(price).to be_between(0, 1000)
expect(price).to be > 0
expect(list).to contain_exactly(1, 2, 3)      # same elements, any order
expect(list).to include(2)
expect(name).to start_with("A")
expect(record).to have_attributes(id: 1, active: true)
expect { cart.add(nil) }.to raise_error(ArgumentError)
expect { cart.add(apple) }.to change { cart.total }.from(0).to(150)
```

`be_*` and `have_*` are not a fixed list — RSpec parses the matcher name at
call time and turns it into a predicate-method call on the object:
`expect(book).to be_a_paperback` calls `book.paperback?`;
`expect(book).to have_cover` calls `book.has_cover?`. Nothing needs to be
declared for this to work; it's dynamic dispatch on the matcher name, the same
family of trick as `method_missing`-based DSLs. It also means a matcher
failure like `expected #<Book> to be a paperback` is really reporting that
`paperback?` returned falsy — worth remembering when the matcher name in a
failure doesn't obviously map to a method in the class you're looking at.

### Test doubles: the difference between a double and a lie

`double` creates a bare object that responds to nothing until you tell it to:

```ruby
mailer = double("mailer")
allow(mailer).to receive(:deliver).and_return(true)
```

`allow(...).to receive` is a **stub**: it doesn't fail the example if
`:deliver` is never called. `expect(...).to receive` is a **mock
expectation**: the example fails if `:deliver` is *not* called by the time the
example ends. This is the same stub-vs-mock distinction Minitest draws
between `stub` and `Mock#expect` + `verify` — RSpec just folds the
verification into the matcher instead of a separate `verify` call.

The trap with a bare `double` is that it will happily respond to a method the
real object doesn't have, or with an arity the real method doesn't take —
the test suite is green against an API that no longer exists. **Verified
doubles** close that hole:

```ruby
mailer = instance_double(Mailer, deliver: true)
allow(Mailer).to receive(:new).and_return(mailer)
```

`instance_double(Mailer, ...)` checks, at the moment the double is defined
and the moment each stubbed method is called, that `Mailer` actually defines
an instance method with that name and a compatible signature. Rename
`Mailer#deliver` to `Mailer#send_email` in production code and every verified
double calling `:deliver` fails immediately — a bare `double` would keep
passing. The cost is real: `Mailer` has to be loaded (autoloadable, in a
Rails app) for verification to run, which is occasionally awkward in a truly
isolated unit test, but the safety is almost always worth it in a codebase
above toy size.

### Shared examples: DRY across many implementations

When several classes are expected to satisfy the same contract — several
adapters, several `Comparable`-like objects — repeating the same `it` blocks
per class is the kind of duplication `shared_examples` exists to remove:

```ruby
RSpec.shared_examples "a storage backend" do
  it "round-trips a value" do
    subject.write("k", "v")
    expect(subject.read("k")).to eq("v")
  end

  it "returns nil for a missing key" do
    expect(subject.read("missing")).to be_nil
  end
end

RSpec.describe RedisBackend do
  subject { described_class.new(fake_redis) }
  it_behaves_like "a storage backend"
end

RSpec.describe FileBackend do
  subject { described_class.new(tmp_dir) }
  it_behaves_like "a storage backend"
end
```

The contract is written once; every backend that claims to implement it gets
run against the same assertions. The trade-off is discoverability — a failure
reports against the shared example's file and line, one step removed from the
`describe` block that actually failed, which costs a little time the first
time someone unfamiliar with the suite has to trace it.

### Order dependence: the bug randomized run order exists to find

RSpec (and, via a plugin, Minitest) can run examples in random order per run,
seeded by `--seed N`. This exists because `let`, shared `before(:context)`
fixtures, and plain global/class-level state make it easy to write a test
that only passes because an earlier test happened to run first and leave
something set up. A suite that's green in alphabetical/definition order and
red under `--seed random` has a real isolation bug, not a flaky test — the
seed reported on failure lets you reproduce the exact ordering that broke it.

## Trade-offs

- **RSpec's readability is bought with indirection** — `expect(x).to
  raise_error` is more natural to read aloud than `assert_raises`, but a
  failure's backtrace runs through several layers of matcher machinery before
  it reaches your code, and the `be_*`/`have_*` dynamic dispatch means the
  matcher name in a failure message doesn't always literally match a method
  name in your class. Minitest's assertions are one method call away from the
  actual check.
- **Minitest boots faster and depends on nothing** — no gem to add, no DSL to
  learn beyond `assert_*`, which matters for a small gem's test suite or a CI
  pipeline sensitive to boot time. RSpec's richer matcher/double/shared-example
  vocabulary pays for itself mainly at the scale of "many contributors, many
  files, contracts shared across several classes."
- **`let`'s laziness is also its footgun** — memoization per example prevents
  redundant setup, but a chain of `let`s referencing each other can hide how
  much actually runs per test, and a typo silently becomes "undefined method"
  instead of "unexpected nil," which is usually clearer but occasionally
  surprising to someone used to instance variables.
- **A bare `double` is cheap and can lie; a verified double costs a real
  class load and tells the truth** — default to `instance_double`/
  `class_double` once the collaborator class is loadable in the test
  environment; keep bare `double` for genuinely fictional collaborators (a
  protocol object that has no real implementation yet).
- **`allow` vs `expect` on a double is a decision about what the test is
  actually asserting** — stubbing with `allow` when the interaction itself is
  the behavior under test lets a broken caller pass silently; using `expect`
  everywhere, including on collaborators nobody cares whether they were
  called, makes refactors break unrelated tests for no behavioral reason.
- **Shared examples remove duplication at the cost of one extra indirection
  when a shared assertion fails** — worth it once three or more classes
  genuinely share a contract; premature for two classes that merely look
  similar today.

## Documentation Links

- [Minitest — GitHub (seattlerb/minitest)](https://github.com/minitest/minitest) — doc
- [RSpec — Core documentation (rspec.info)](https://rspec.info/documentation/) — doc
- [RSpec Mocks — verifying doubles](https://rspec.info/features/3-13/rspec-mocks/verifying-doubles/) — doc
- [RSpec Expectations — built-in matchers](https://rspec.info/features/3-13/rspec-expectations/built-in-matchers/) — doc
- [Programming Ruby 3.3 (Pickaxe) — Testing Ruby Code](https://pragprog.com/titles/ruby5/programming-ruby-3-3-5th-edition/) — doc
