---
version: 1.0
updatedAt: 2026-11-12
---
## Objective

Every test needs data, and the way you build it decides what the test says. A
long constructor call buries the one value that matters; random data without a
seed makes a failure impossible to reproduce; fully anonymous data hides which
input the assertion depends on. The goal is to build test data three ways, with
MSTest 4: a Test Data Builder written by hand, Bogus with a fixed seed, and
AutoFixture with AutoNSubstitute, and to know when each one makes the intent of
a test clearer and when it makes it vaguer.

## Use Cases

- Writing a rule test that names only the fact the rule depends on (a premium
  customer, an order of exactly 500) and leaves everything else at a valid default.
- Generating a few hundred realistic orders to check a property ("the discount
  is always one of four rates") in a way you can replay when it fails.
- Creating a service with five constructor dependencies in one line, with every
  interface already a substitute, when the test only cares about one of them.
- Seeding an integration test database with plausible names and e-mails.

## Deep Dive

### A Test Data Builder says only what matters

The rule under test: premium customers get 10%, orders of 500 or more get
another 5%, and the two add up. Without a builder every test repeats the whole
graph:

```csharp
var order = new Order(Guid.NewGuid(),
    new Customer(Guid.NewGuid(), "Ana", "ana@example.com", IsPremium: true),
    [new OrderLine("SKU-1", 1, 50m)]);
```

Which of those values does the test depend on? You have to read the rule to
know. A builder has a valid default and one method per fact a test wants to
state:

```csharp
public sealed class OrderBuilder
{
    private bool _premium;
    private List<OrderLine> _lines = [new("SKU-1", 1, 10m)];

    public OrderBuilder Premium() { _premium = true; return this; }
    public OrderBuilder Worth(decimal total) => WithLines(new OrderLine("SKU-1", 1, total));
    public OrderBuilder WithLines(params OrderLine[] lines) { _lines = [.. lines]; return this; }

    public Order Build() => new(
        new Guid("00000000-0000-0000-0000-000000000001"),
        new Customer(new Guid("00000000-0000-0000-0000-0000000000c1"), "Ana", "ana@example.com", _premium),
        _lines);
}
```

```csharp
var order = new OrderBuilder().Premium().Worth(500m).Build();
Assert.AreEqual(0.15m, DiscountPolicy.RateFor(order));
```

The test now reads as the rule. Two details make a builder trustworthy. The
defaults are fixed values: a literal `Guid`, not `Guid.NewGuid()`, and no clock,
so a failing test fails the same way every time. And the number in the test is
chosen for the rule: `Worth(500m)` sits exactly on the threshold, while
`Worth(600m)` would still pass if the production check were `> 500`.

An Object Mother (`Orders.Premium()`, `Orders.Bulk()`) is the same idea with
named, ready-made objects. It starts fine and ends as a catalog of near-duplicates
("PremiumBulkOrderWithTwoLines"). Prefer the builder when tests need variations,
and keep an Object Mother only for a handful of stable, meaningful fixtures.

### Bogus: realistic data you can replay

Bogus generates names, e-mails, addresses and numbers. Used for unit tests, its
risk is randomness: if the data changes on every run, a failure on CI is data
you will never see again. `UseSeed` removes the problem:

```csharp
using Bogus;

public static Faker<Customer> Customers(int seed = 1234) =>
    new Faker<Customer>("en")
        .UseSeed(seed)
        .CustomInstantiator(f => new Customer(f.Random.Guid(), f.Name.FullName(), f.Internet.Email(), f.Random.Bool()));
```

With the same seed two fakers produce equal lists, which is a test worth
writing once, because the rest of your suite relies on it:

```csharp
CollectionAssert.AreEqual(Fakes.Customers(7).Generate(5), Fakes.Customers(7).Generate(5));
CollectionAssert.AreNotEqual(Fakes.Customers(7).Generate(5), Fakes.Customers(8).Generate(5));
```

A seeded faker is deterministic, not meaningful: it gives you broad coverage of
the input space, not a reason. It fits property-style checks over many objects.
Prove the generated data covers both branches before trusting the assertion,
otherwise "all 200 orders give a valid rate" could be 200 non-premium small
orders:

```csharp
var orders = Fakes.Orders(42).Generate(200);
Assert.IsTrue(orders.Any(o => o.Customer.IsPremium) && orders.Any(o => !o.Customer.IsPremium));
Assert.IsTrue(orders.Any(o => o.Total >= DiscountPolicy.BulkThreshold) && orders.Any(o => o.Total < DiscountPolicy.BulkThreshold));

decimal[] allowed = [0m, 0.05m, 0.10m, 0.15m];
foreach (var order in orders) CollectionAssert.Contains(allowed, DiscountPolicy.RateFor(order));
```

Do not recompute the rule in the test (`expected = premium ? 0.1 : 0 ...`): that
is a copy of the production code, and it passes when both are wrong the same way.
Bogus also fits seeding a development or integration database. The current
version is 35.6.5.

### AutoFixture and AutoNSubstitute: anonymous values, automatic doubles

AutoFixture creates any object graph with arbitrary values, and
`AutoNSubstituteCustomization` turns every interface it meets into an NSubstitute
substitute. A service with two interface dependencies becomes one line:

```csharp
using AutoFixture;
using AutoFixture.AutoNSubstitute;

var fixture = new Fixture().Customize(new AutoNSubstituteCustomization());
var repository = fixture.Freeze<IOrderRepository>();   // the instance the service receives
var email = fixture.Freeze<IEmailSender>();
var order = fixture.Create<Order>();
var sut = fixture.Create<OrderService>();

await sut.PlaceAsync(order, ct);

await repository.Received(1).SaveAsync(order, ct);
await email.Received(1).SendAsync(order.Customer.Email, Arg.Any<string>(), ct);
```

`Freeze` is the key call: without it the fixture would give the service one
substitute and hand you another. Here the order is anonymous on purpose, because
nothing in the test depends on its values. That is AutoFixture at its best: the
test states "any order", and a reader knows it does not matter.

It stops being clear when the assertion does depend on a value. AutoFixture
chooses strings, numbers and booleans for you, so a test of the discount with a
fully anonymous order checks a result that depends on data it never wrote down.
Pin exactly the facts the expectation needs, with a `with` expression on the
record, and leave the rest anonymous:

```csharp
var order = fixture.Create<Order>() with
{
    Customer = fixture.Create<Customer>() with { IsPremium = true },
    Lines = [new OrderLine("SKU-1", 1, 100m)],
};

Assert.AreEqual(90m, await sut.PlaceAsync(order, ct));
```

The same fixture sets `Lines = []` in the test that rejects an order without
lines: one pinned value, the thing the test is about.

On version: the stable line on NuGet is AutoFixture 4.18.1 and
`AutoFixture.AutoNSubstitute` 4.18.1 (the lab runs them on net10.0). Version 5.0.0-rc.1 exists but is a
release candidate, so teach and use 4.x. Restoring 4.18.1 with NSubstitute 6.2.0
prints warning NU1608 (the package declares NSubstitute below 6.0.0); the tests in
the lab run fine with 6.2.0 anyway.

### When each one hides the intent

- **Builder:** hides nothing, but hides the defaults. Keep them small and fixed,
  and name methods after domain facts (`Premium()`), not fields (`WithIsPremium(true)`).
- **Bogus:** hides the value a failure depends on. When a seeded test fails, print the
  seed and the offending object in the message, or turn the case into a builder
  test with that exact data.
- **AutoFixture:** hides what the assertion needs. If you cannot say which anonymous
  value the result depends on, the test is not finished: pin it.

A useful rule: a reader should be able to tell, from the test alone, which input
makes the assertion true. Whatever tool you use, the values that matter appear in
the test and everything else is allowed to be boring.

## Trade-offs

- **Builders are code you maintain.** Each domain concept gets a builder, and a
  change to a constructor touches one builder instead of 200 tests. That is the
  point, and the cost: do not build one for a type used in two tests.
- **Determinism versus coverage.** A fixed seed gives a replayable run, but the same
  inputs every time. Rotating the seed per run finds more bugs and makes failures
  harder to reproduce unless the seed is logged. Pick a fixed seed for the normal
  suite and a rotating one for a nightly run that prints it.
- **Realistic data is not representative data.** Bogus names look real and say
  nothing about the edge cases (a 255-character name, an empty list). Edge cases
  are still written by hand.
- **AutoFixture couples tests to construction.** A new required constructor
  parameter is created automatically, so tests keep compiling, which is good, and
  also means a test can silently start depending on a value nobody chose. A
  rule test that stays fully anonymous is a smell.
- **AutoFixture 5 is not stable yet.** Pinning to 4.18.1 is safe today; plan for
  a migration when 5.x ships.
- **Anonymous data does not replace a boundary.** `fixture.Create<int>()` will
  never land exactly on 500. Boundaries are chosen, not generated.

## Lab

The shop is already implemented: a `DiscountPolicy` and an `OrderService` that saves an order and e-mails the customer. Your job is to build the test data three ways and see what each one says about the test.

**What you will practice**

- A Test Data Builder with fixed defaults and a boundary test at exactly 500.
- A seeded Bogus faker, a determinism test and a property check over generated orders.
- AutoFixture with `AutoNSubstituteCustomization`, `Freeze`, and `with` expressions that pin only what matters.

**Prerequisites:** the Test Doubles with NSubstitute concept, MSTest basics, .NET 10 SDK.

**How it works:** the production code is ready; every test method fails with `TODO-NN: write this test` until you write it, and `OrderBuilder` and `Fakes` are stubs for you to implement.

## Documentation Links

- [Bogus on GitHub](https://github.com/bchavez/Bogus) (doc)
- [AutoFixture on GitHub](https://github.com/AutoFixture/AutoFixture) (doc)
- [AutoFixture.AutoNSubstitute on NuGet](https://www.nuget.org/packages/AutoFixture.AutoNSubstitute) (doc)
- [Bogus on NuGet](https://www.nuget.org/packages/Bogus) (doc)
- [NSubstitute documentation](https://nsubstitute.github.io/help/getting-started/) (doc)
