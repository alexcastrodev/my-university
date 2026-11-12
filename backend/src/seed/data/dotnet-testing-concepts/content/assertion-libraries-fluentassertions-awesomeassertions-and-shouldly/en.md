---
version: 1.0
updatedAt: 2026-11-12
---
## Objective

Most .NET test suites that have been alive for a few years contain a line like
`total.Should().Be(25.50m)`. Whether that line is allowed to stay is a licensing
question since 2025, and whether a new suite needs it at all is a different one:
MSTest 4 prints the expression it asserted, which was the main reason to reach for
a library. This lesson writes the same six checks with the assertions that ship
with MSTest 4.5.3, with AwesomeAssertions 9.6.0 and with Shouldly 4.3.0, makes
each one fail on purpose, and puts the messages side by side. It also inspects the
FluentAssertions 8.11.0 package to state the license exactly as the package states
it. Everything ran on the .NET 11.0.100 GA SDK (`net10.0` projects, with roll
forward), under Microsoft.Testing.Platform. For the MSTest side in more depth see
the MSTest Fundamentals concept, and for the choice of test framework see Choosing
a Test Framework.

## Use Cases

- Reading a legacy suite full of `.Should().Be(...)` and knowing which package it
  uses and under which license.
- Deciding, for a new suite, whether the `Assert` class of MSTest 4 is enough.
- Moving from FluentAssertions to a fork or to the built-in assertions without
  losing the failure messages the team is used to.
- Choosing assertions for checks that have no good built-in form: object
  equivalence, several failures reported at once, a chain on one subject.

## Deep Dive

### Four packages, four licenses

| Package | Version | License in the package | Notes |
| --- | --- | --- | --- |
| MSTest (`Assert`) | 4.5.3 | part of the test framework | no extra package |
| FluentAssertions | 7.2.2 | `Apache-2.0` (expression) | last 7.x line on NuGet |
| FluentAssertions | 8.11.0 | `LICENSE` file, "XCEED SOFTWARE INC. COMMUNITY LICENSE AGREEMENT ... (for Non-Commercial Use)" | `requireLicenseAcceptance` is `true` |
| AwesomeAssertions | 9.6.0 | `Apache-2.0` | "A fork of FluentAssertions" |
| Shouldly | 4.3.0 | `BSD-3-Clause` | 5.0 exists only as a preview |

The FluentAssertions row for 8.11.0 comes from the `.nuspec` and the `LICENSE`
file inside the package, read after downloading it. The package description says:
"This version is free for open-source projects and non-commercial use, but
commercial use requires a paid license." The license text defines non-commercial
use as use where the primary objective is not to gain commercial advantage, and
lists as outside that definition use "by or for an organisation, group of persons,
legal entity, or company, that charges fees or earns revenues". Read it as
follows: a company suite that tests a product that earns revenue most likely needs the paid
license from Xceed, which holds the copyright on 8.x (the package says "Copyright 2024-2026 Xceed Software Inc."). The 7.x line keeps its
Apache-2.0 license, and AwesomeAssertions continues the code under Apache-2.0
with a new namespace. I am not a lawyer, and the license page is the authority
(links at the end); the point for a team is that the question exists, and that
`dotnet list package` and the package page show which version you are on.

### Six checks in two libraries

The lab model is an invoice (`Invoice` with lines, a total, a rounded discount, a
summary string, `Pay()`, and a `Customer` record). Three of the six checks, first
with MSTest 4, then with AwesomeAssertions:

```csharp
// MSTest 4
Assert.AreEqual(22.93m, _invoice.TotalWithDiscount(10m), 0.005m);
Assert.StartsWith("INV-001", summary);
Assert.Contains("Ada Lovelace", summary);
Assert.AreSequenceEqual(["A-100", "B-200"], _invoice.Lines.Select(l => l.Sku));
var paid = Assert.ThrowsExactly<InvalidOperationException>(() => _invoice.Pay());
Assert.AreEqual("Invoice INV-001 is already paid.", paid.Message);

// AwesomeAssertions 9.6.0
_invoice.TotalWithDiscount(10m).Should().BeApproximately(22.93m, 0.005m);
summary.Should().StartWith("INV-001").And.Contain("Ada Lovelace");
_invoice.Lines.Select(l => l.Sku).Should().Equal("A-100", "B-200");
_invoice.Invoking(i => i.Pay()).Should().ThrowExactly<InvalidOperationException>()
    .WithMessage("Invoice INV-001 is already paid.");
```

All six checks passed in both, 18 tests with a Shouldly copy. Two checks show
where the built-in class stops. A case-insensitive end of a string has no
`Assert` method, so the test falls back to `Assert.IsTrue(summary.EndsWith("eur",
StringComparison.OrdinalIgnoreCase), summary)`, and the second argument matters:
without it the failure says only that `IsTrue` failed. Equivalence of an object
graph has no `Assert` method at all. "The customer matches, ignoring the
e-mail" is two `AreEqual` calls in MSTest and one line in AwesomeAssertions:

```csharp
_invoice.Customer.Should().BeEquivalentTo(expected, o => o.Excluding(c => c.Email));
```

AwesomeAssertions finds MSTest by itself and throws MSTest's own
`AssertFailedException`; no setup line was needed. The same five call shapes
(`Be`, `Contain`, `Equal`, `Invoking(...).Should().ThrowExactly`,
`BeEquivalentTo` with `Excluding`) also compiled unchanged against
FluentAssertions 8.11.0 in a scratch project, with only the `using` different,
which is what makes the migration mostly a package swap plus a namespace.

### The same failure, four messages

Each case was a plain statement in a test, run with the invariant culture.
The invoice total is 25.48, the summary is `INV-001 | Ada Lovelace | 2 lines |
25.48 EUR`.

A wrong total, `25.50m` expected:

```text
MSTest 4.5.3
  Assertion failed. Expected values to be equal.
  expected: 25.50
  actual:   25.48
  Assert.AreEqual(25.50m, invoice.Total)

AwesomeAssertions 9.6.0 (FluentAssertions 8.11.0 printed the same line)
  Expected invoice.Total to be 25.50M, but found 25.48M (difference of -0.02).

Shouldly 4.3.0
  invoice.Total
      should be
  25.50m
      but was
  25.48m
```

A missing substring, `"Grace Hopper"`:

```text
MSTest    Assertion failed. Expected string to contain the specified substring.
          expected substring: "Grace Hopper"
          actual:             "INV-001 | Ada Lovelace | 2 lines | 25.48 EUR"
          comparison:         Ordinal
          Assert.Contains("Grace Hopper", invoice.Summary())
Awesome   Expected invoice.Summary() "INV-001 | Ada Lovelace | 2 lines | 25.48 EUR" to contain "Grace Hopper".
Shouldly  invoice.Summary()
              should contain (case insensitive comparison)
          "Grace Hopper"
              but was actually
          "INV-001 | Ada Lovelace | 2 lines | 25.48 EUR"
```

A sequence that differs at index 1, `["A-100", "C-300"]` expected:

```text
MSTest 4.5.3 (Assert.AreSequenceEqual)
  Assertion failed. Expected sequences to be equal.
  Sequences have 2 element(s). 1 element(s) differ. First difference at index 1.
  expected: ["A-100", "C-300"]
  actual:   ["A-100", "B-200"]
  Assert.AreSequenceEqual(["A-100", "C-300"], skus)

AwesomeAssertions
  Expected skus to be equal to {"A-100", "C-300"}, but {"A-100", "B-200"} differs at index 1.

Shouldly
  skus
      should be
  ["A-100", "C-300"]
      but was (case sensitive comparison)
  ["A-100", "B-200"]
      difference
  ["A-100", *"B-200"*]
```

An exception that never came:

```text
MSTest    Assertion failed. Expected exception of exact type InvalidOperationException but no exception was thrown.
          Assert.ThrowsExactly<InvalidOperationException>(() => invoice.Total.ToString())
Awesome   Expected System.InvalidOperationException, but no exception was thrown.
Shouldly  `invoice.Total.ToString()`
              should throw
          System.InvalidOperationException
              but did not
```

Two objects that differ in `Country` and `Email`, with the e-mail excluded in
the libraries that can exclude it:

```text
MSTest (Assert.AreEqual on the records)
  expected: Customer { Name = Ada Lovelace, Email = other@example.com, Country = PT }
  actual:   Customer { Name = Ada Lovelace, Email = ada@example.com, Country = UK }
AwesomeAssertions
  Expected property customer.Country to be the same string, but they differ at index 0:
     (actual) "UK" / "PT" (expected).
  With configuration:
  - Prefer the declared type of the members
  ... (ten configuration lines, including "- Exclude member Email")
FluentAssertions 8.11.0
  Expected property customer.Country to be "PT", but "UK" differs near "UK" (index 0).
Shouldly (ShouldBeEquivalentTo)
  Comparing object equivalence, at path: customer [Billing.Customer] / Email [System.String]
  Expected value to be "other@example.com" but was "ada@example.com"
```

What the five cases show:

- **MSTest 4 closed most of the gap.** It prints expected, actual and the
  source of the call, and `Assert.AreSequenceEqual` reports the length and the
  first difference. That is also what the older `CollectionAssert.AreEqual` did
  not do: for two string arrays it printed `Element at index 0 do not match.
  Expected: C Actual: B`, an index and two characters, not the collections.
- **The Should() libraries name the subject, not the call.** `invoice.Total` and
  `skus` come from the caller's expression, which only works when `Should()` is
  called as an extension method on that expression. Called as a static method,
  `AssertionExtensions.Should(invoice.Total)`, the same libraries printed
  `Expected AA to be`, so write it the usual way.
- **Only the equivalence check is missing from MSTest.** Everything else is a
  matter of taste and of how many lines the intent takes.
- **Shouldly prints code as the message.** It prints the source line of the
  failing call, so the message is as readable as the line you wrote.

### Reporting several failures, and a reason

AwesomeAssertions has an `AssertionScope` that turns the first failure into the
last: all failures inside it are reported by one exception when the scope is
disposed.

```csharp
using var scope = new AssertionScope();
invoice.Total.Should().Be(1m);
invoice.Summary().Should().Contain("Grace");
```

```text
Expected invoice.Total to be 1M, but found 25.48M (difference of 24.48).
Expected invoice.Summary() "INV-001 | Ada Lovelace | 2 lines | 25.48 EUR" to contain "Grace".
```

`Be(1m, "the {0} must match", "total")` inserts the reason: `Expected
invoice.Total to be 1M because the total must match, but found 25.48M`. MSTest's `Assert`
stops at the first failure, so with the built-in class keep one logical check
per test, as the lab does.

### Two traps that cost a debugging session

Shouldly's string `ShouldContain` ignored case by default in 4.3.0. The failing
message above says so, `should contain (case insensitive comparison)`, and
`summary.ShouldContain("ada lovelace")` against `Ada Lovelace` did not fail. With
`Case.Sensitive` it did, and the message lost the parenthesis. A default that
differs from `string.Contains` is worth knowing before it hides a casing bug.

Shouldly also formats numbers with the current culture. On the machine used
here `25.50m` was printed as `25,50m` until the test pinned the culture, and the
lab's `Summary()` also formats with the invariant culture for the same reason.
When a test pins a failure message, pin the culture as well. Shouldly prints the
source line of the failing call too, so a one-line lambda inside
`Assert.ThrowsExactly<...>(` printed that whole prefix as part of the message.

### Reading `x.Should().Be(...)` in legacy code

Open the project file. `FluentAssertions` 7.x is Apache-2.0 and may stay. 8.x
needs the paid license for commercial use, and shows `requireLicenseAcceptance`.
`AwesomeAssertions` is a drop-in with the namespace `AwesomeAssertions`, and the
failure text is the same for the checks above. Replacing with the built-in
`Assert` is a rewrite per line, so do it where a check is simple: equality,
substring, sequence, exception. Keep a library for equivalence and scopes.

## Trade-offs

- **Fluent readability vs a dependency.** `Should().StartWith(...).And.Contain(...)`
  reads like the requirement and chains on one subject. The cost is a package, a
  second vocabulary for new teammates, and, for FluentAssertions 8, a license.
- **Built-in assertions have the lowest friction.** They ship with MSTest, print
  the call, and need no license review. They have no equivalence,
  no scope, and a few forms (case-insensitive end) need a fallback.
- **A fork is a bet on a maintainer.** AwesomeAssertions has the same code shapes
  and an open license, and its roadmap is its own. Shouldly is a different
  vocabulary, so a move to it rewrites every line.
- **Messages are part of the product.** A failure that says only "Expected True"
  costs minutes in CI. Pin one message per library in a test, as the lab does,
  after reading what it prints.
- **Culture and defaults leak into messages.** Case rules and number formats
  changed what Shouldly printed. Pin both in tests that assert on a message.

## Lab

The billing model is already implemented. Your job is to write the same six checks in two libraries and to read the messages they print when you break them.

**What you will practice**

- Writing equality, tolerance, string, sequence, exception and equivalence checks with MSTest 4 `Assert`.
- Writing the same six with AwesomeAssertions `Should()`, using chains and `BeEquivalentTo`.
- Reading and pinning failure messages: expression capture, `AssertionScope`, the reason argument.
- Optionally, the same checks in Shouldly, and its case and culture defaults.

**Prerequisites:** MSTest Fundamentals: Lifecycle and TestContext, .NET 10 SDK.

**How it works:** the starter has 17 failing tests, each with a `TODO-NN` message and a hint. `MSTest.Sdk` 4.5.3, AwesomeAssertions 9.6.0 and Shouldly 4.3.0 are already referenced, and `global.json` selects the Microsoft.Testing.Platform mode of `dotnet test`.

## Documentation Links

- [Assertions, MSTest on Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-writing-tests-assertions) (doc)
- [FluentAssertions 8.11.0 package page, NuGet](https://www.nuget.org/packages/FluentAssertions/8.11.0) (doc)
- [FluentAssertions license and pricing, Xceed](https://xceed.com/products/unit-testing/fluent-assertions/) (doc)
- [AwesomeAssertions, GitHub](https://github.com/AwesomeAssertions/AwesomeAssertions) (doc)
- [Shouldly documentation](https://docs.shouldly.org/) (doc)
