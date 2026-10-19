---
version: 1.0
updatedAt: 2026-10-18
---
## Objective

A test double replaces a dependency the code under test talks to: a repository, an email sender, an
SMS gateway. The theory (stubs answer, mocks verify, fakes work) is the same in every language and
lives in the Java concepts on test doubles and mock fragility. This concept is the .NET side of it:
when a hand-written fake is the better tool, how NSubstitute creates stubs and checks calls, what it
returns when you configured nothing, what it cannot replace at all, and how each of those details can
give you a green test that proves nothing. The goal is a suite where every double is there for a reason
and every assertion is about something the user of the code would notice.

## Use Cases

- Testing a service that talks to email and SMS ports without sending a message or opening a socket.
- Writing a small in-memory fake for a port whose behavior the tests read back (a log, a repository).
- Stubbing a gateway that answers "accepted" or "refused" and checking the fallback the service takes.
- Simulating a failure (a faulted `Task`) to prove the service leaves nothing half done.
- Reading an existing suite that uses Moq and translating it to NSubstitute, or the other way around.

## Deep Dive

### Hand-written fake or substitute?

A fake is a working implementation of the port, usually a few lines over a collection. Tests seed it
before the act step and read its state afterwards:

```csharp
internal sealed class InMemoryNotificationLog : INotificationLog
{
    private readonly HashSet<string> _keys = [];

    public IReadOnlyCollection<string> Keys => _keys;

    public Task<bool> ContainsAsync(string key, CancellationToken ct) => Task.FromResult(_keys.Contains(key));

    public Task AddAsync(string key, CancellationToken ct)
    {
        _keys.Add(key);
        return Task.CompletedTask;
    }
}
```

Use a fake when the dependency has state the test cares about ("was it recorded?", "is it stored?").
Use a substitute from a library when the test only needs an answer ("the gateway accepted") or needs to
check that a message left the system through a port (an email to the right address). The lab uses both
in the same test class: the log is a fake, the directory and the two senders are NSubstitute
substitutes.

```xml
<PackageReference Include="MSTest" Version="4.5.1" />
<PackageReference Include="NSubstitute" Version="6.2.0" />
<PackageReference Include="NSubstitute.Analyzers.CSharp" Version="1.0.17" PrivateAssets="all" />
```

NSubstitute 6 (July 2026) targets .NET 8 and .NET Standard 2.0 and removed legacy obsolete APIs. The
analyzer package is optional, and NSubstitute's own documentation recommends it.

### Substitute.For, Returns and argument matchers

`Substitute.For<T>()` creates the substitute. Calling a member on it and then `.Returns(...)` configures
the answer for those arguments. The substitutes live in instance fields, and MSTest creates a new test
class instance per test, so no test sees another test's setup:

```csharp
private readonly ICustomerDirectory _directory = Substitute.For<ICustomerDirectory>();

private void Known(Contact contact) =>
    _directory.FindAsync(Shipment.CustomerId, Arg.Any<CancellationToken>()).Returns(contact);
```

`FindAsync` returns `Task<Contact?>`, and `Returns(contact)` wraps the value in a completed task for
you. The same works for `ValueTask<T>`. Other forms verified with NSubstitute 6.2.0:

```csharp
repo.Count().Returns(1, 2, 3);                              // a sequence; the last value repeats
repo.Find(Arg.Is<int>(id => id < 0)).Returns((Customer?)null);
repo.Find(Arg.Any<int>()).Returns(call => new Customer($"id{call.Arg<int>()}@example.com"));
repo.Exists(0).ReturnsForAnyArgs(false);                    // the arguments in this call are ignored
```

When two setups match the same call, the one configured last wins. The matcher you choose decides what
the stub hides: the lab's `Known` answers for `Shipment.CustomerId` only. With `Arg.Any<Guid>()` it
would also answer when the service looks up the order id by mistake, and the suite stays green (see the
mutation table below).

### What a substitute returns when you configured nothing

A substitute never throws for an unconfigured call. It returns a value, and some of those values look
like real answers. Observed with NSubstitute 6.2.0:

| Member returns | Unconfigured substitute returns |
| --- | --- |
| `int`, `bool`, `DateTimeOffset` | `default` (0, `false`, `0001-01-01`) |
| `string`, arrays | `""`, an empty array |
| an interface (`IWidget`, `IEnumerable<int>`) | another substitute (recursive), the same one for the same arguments |
| a class such as `List<int>`, a record | `null` |
| `Task` | a completed task |
| `Task<T>`, `ValueTask<T>` | a completed task with the rule above for `T` (`Task<bool>` gives `false`) |

The last row is the trap. `ISmsSender.SendAsync` returns `Task<bool>`. If the test forgets the setup,
the gateway "refuses", the service falls back to email, and this test still passes:

```csharp
// Broken: passes, and the customer got an email instead of an SMS.
Known(Ana(Channel.Sms));
var outcome = await NotifyAsync();
await _sms.Received(1).SendAsync("+15550100", Arg.Any<string>(), Arg.Any<CancellationToken>());
```

The fix is to configure what the test depends on and to assert the outcome:

```csharp
Known(Ana(Channel.Sms));
_sms.SendAsync("+15550100", Arg.Any<string>(), Arg.Any<CancellationToken>()).Returns(true);

var outcome = await NotifyAsync();

Assert.AreEqual(NotificationOutcome.SentBySms, outcome);
await _email.DidNotReceiveWithAnyArgs().SendAsync(default!, default!, default!, default);
```

Sometimes the default is exactly right. An unknown customer is a directory that returns `null`, so that
test configures nothing and says so in a comment.

### Received and DidNotReceive check calls, not outcomes

`Received(n)` checks that a call with matching arguments happened `n` times; `DidNotReceive()` that it
did not. A failure throws `ReceivedCallsException` and lists the calls that did happen:

```text
Expected to receive exactly 1 call matching:
	Send("z@x", "hi")
Actually received no matching calls.
Received 3 non-matching calls (non-matching arguments indicated with '*' characters):
	Send(*"a@x"*, "hi")
	Send(*"b@x"*, "hi")
	Send(*"boom"*, *""*)
```

A call check is right for a message that leaves the system: an email to `ana@example.com` with the
order number in the subject is the observable behavior. It is weak on its own for a decision. In the
lab, a test for an opted-out customer that only asserts `DidNotReceive` passes when the stub was set up
for another customer id, because the service then answers `UnknownCustomer` and sends nothing either.
Assert the outcome that names the reason first, then the calls:

```csharp
Known(Ana(optedOut: true));

var outcome = await NotifyAsync();

Assert.AreEqual(NotificationOutcome.OptedOut, outcome);
await _email.DidNotReceiveWithAnyArgs().SendAsync(default!, default!, default!, default);
```

Verifying every internal call (`Received` on the directory, on the log, in a given order) ties the test
to the implementation: a harmless refactor turns it red. The Java concepts on observable behavior and
on mocking best practices explain why; in practice, verify calls that cross the boundary of the system
and read state everywhere else.

### Failures, callbacks and void members

A faulted task simulates a dependency that is down. A sequence of tasks lets one test fail first and
succeed on the retry:

```csharp
_email.SendAsync("ana@example.com", Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>())
    .Returns(Task.FromException(new EmailDeliveryException("smtp down")), Task.CompletedTask);

await Assert.ThrowsExactlyAsync<EmailDeliveryException>(NotifyAsync);
Assert.IsEmpty(_log.Keys);
```

`ThrowsAsync` (in `NSubstitute.ExceptionExtensions`) does the same for one call. Plain `Throws` on a
`Task`-returning member throws when the member is called, before any task exists; that differs from a
real async method whenever the caller does not await at once (with `Task.WhenAll`, for example). The
analyzer flags it as NS5003. For `void` members, which cannot take `Returns`, use `When..Do`:

```csharp
repo.When(x => x.Send(Arg.Any<string>(), Arg.Any<string>())).Do(call => sent.Add(call.ArgAt<string>(0)));
repo.When(x => x.Send("boom", Arg.Any<string>())).Throw(new InvalidOperationException("smtp"));
```

### What cannot be substituted

NSubstitute (through Castle DynamicProxy) creates a class at run time that implements the interface or
derives from the class. That has consequences:

- **Interfaces** are always safe.
- **Sealed classes** cannot be derived from: `Substitute.For<HttpSmsSender>(...)` throws
  `TypeLoadException` ("the parent type is sealed").
- **Non-virtual members** of a class run the real code, and NSubstitute cannot see the call. Worse,
  configuring one does not fail. In this run, `Returns` attached itself to the last call the substitute
  did see:

```csharp
var c = Substitute.For<Concrete>();
c.Virtual();                 // intercepted, returns 0
c.NonVirtual().Returns(1);   // real code runs; no exception
// c.NonVirtual() still returns 42, and c.Virtual() now returns 1
c.Received().NonVirtual();   // passes without checking anything
```

- **Static members** (`DateTime.UtcNow`, `File.ReadAllText`) are not on any instance, so there is
  nothing to substitute.

The analyzer reports the first two misuses at build time (NS1000 for setup, NS1001 for `Received`). The
design consequence is the real lesson: depend on an interface you own (`ISmsSender`), keep the sealed
adapter (`HttpSmsSender`) behind it, and test the adapter separately. The lab tests it with a
hand-written `HttpMessageHandler`, because `HttpMessageHandler.SendAsync` is `protected`. Time is the
best-known static dependency, and the next concept replaces it with `TimeProvider`.

### NSubstitute and Moq side by side

Moq is the other common library, so existing code often uses it. These equivalents were compiled and
run with NSubstitute 6.2.0 and Moq 4.21.0:

| Task | NSubstitute | Moq |
| --- | --- | --- |
| create | `var r = Substitute.For<IRepo>();` | `var m = new Mock<IRepo>(); var r = m.Object;` |
| stub a value | `r.Exists(5).Returns(true);` | `m.Setup(x => x.Exists(5)).Returns(true);` |
| any / matching argument | `Arg.Any<int>()`, `Arg.Is<int>(id => id < 0)` | `It.IsAny<int>()`, `It.Is<int>(id => id < 0)` |
| async value | `r.CountAsync().Returns(5);` | `m.Setup(x => x.CountAsync()).ReturnsAsync(5);` |
| async failure | `r.Save().ThrowsAsync(ex);` | `m.Setup(x => x.Save()).ThrowsAsync(ex);` |
| sequence | `r.Count().Returns(1, 2);` | `m.SetupSequence(x => x.Count()).Returns(1).Returns(2);` |
| callback | `r.When(x => x.Send(...)).Do(...)` | `m.Setup(x => x.Send(...)).Callback<string, string>(...)` |
| verify | `r.Received(1).Send("a", Arg.Any<string>());` | `m.Verify(x => x.Send("a", It.IsAny<string>()), Times.Once());` |
| verify none | `r.DidNotReceive().Send(...)` | `m.Verify(x => x.Send(...), Times.Never());` |
| unconfigured `string` | `""` | `null` |
| unconfigured interface | a recursive substitute | `null` |
| failed verification | `ReceivedCallsException` | `MockException` |

Moq 4.20.0 (August 2023) added SponsorLink, which used a SHA256 hash of the developer's email address
to check for sponsorship. Version 4.20.2, a day later, removed it; its release notes cite a restore
failure on macOS and the privacy concerns raised about the hashing. The episode still comes up when a
team chooses a library. Both are maintained today (Moq 4.21.0 and NSubstitute 6.2.0 were released in
2026).

With xUnit or NUnit nothing changes: substitutes are plain objects, and xUnit also creates a new test
class instance per test, so the same fields work there.

### Do the tests protect the rules?

Break the production code on purpose, one change at a time, and see what turns red. These are the
results for the lab's solution (11 tests):

| Change to the production code | Tests that fail |
| --- | --- |
| The directory is queried with the order id | 7 service tests |
| Every SMS counts as delivered | the fallback test |
| The opt-out check is removed | the opt-out test |
| The log entry is written before delivery | the retry test and the "cannot be reached" test |
| The log is never checked | the "only once" test |
| The HTTP adapter ignores the status code | the "refused" adapter test |

And the weak versions of the tests, run the same way: `Known` with `Arg.Any<Guid>()` lets the first
mutation through (11 of 11 green), the SMS test without `.Returns(true)` passes while the customer gets
an email, and an opt-out test that only checks `DidNotReceive` with a stub for the wrong id passes when
the opt-out check is gone.

## Trade-offs

- **Fakes cost code; substitutes cost attention.** A fake grows with the interface and can drift from
  the real implementation. A substitute is one line, but its defaults answer silently and its matchers
  decide what the test can see. Use fakes for stateful ports, substitutes for answers and outgoing calls.
- **Call verification couples tests to the implementation.** Verify messages that leave the system;
  assert outcomes and state for everything else. A suite full of `Received` on internal collaborators
  breaks on every refactor.
- **`ReturnsForAnyArgs` and `Arg.Any` are convenient and blind.** Prefer the exact argument when the
  argument is part of the rule (the customer id, the recipient).
  ```csharp
  _directory.FindAsync(Arg.Any<Guid>(), Arg.Any<CancellationToken>()).Returns(contact); // answers for the wrong id too
  ```
- **Library limits push the design.** Sealed types, static members and non-virtual methods cannot be
  replaced. That is usually a good push (depend on an interface you own), but it also means adapters
  need their own tests against a stubbed transport or a real dependency.
- **The analyzer is cheap insurance.** NS1000, NS1001 and NS5003 catch misuses that otherwise produce
  green tests that check nothing.
- **NSubstitute or Moq is a team choice.** The concepts are the same, the syntax differs, and the
  defaults differ (`""` and recursive substitutes against `null`). Do not mix both in one project.

## Lab

A notification service that tells customers their order shipped is already implemented, with ports for
the customer directory, email, SMS and a log. Your job is to write the MSTest tests, with a hand-written
fake for the log and NSubstitute for the rest, and to find out where a test double makes a test pass
for the wrong reason.

**What you will practice**

- Writing a hand-written in-memory fake and reading its state in assertions.
- Configuring NSubstitute stubs with exact arguments, sequences and faulted tasks.
- Asserting outcomes first and calls second, with `Received` and `DidNotReceive`.
- Testing a sealed HTTP adapter with a hand-written `HttpMessageHandler` (optional).

**Prerequisites:** the MSTest Fundamentals concept and lab, basic `async`/`await`, .NET 10 SDK.

**How it works:** every test method is already declared with a hint and fails with `TODO-NN: write this test` until you write it. Three hints ask you to write the weak version first and see it pass. The optional TODOs cover the adapter, a learning test about sealed classes, and a mutation check.

## Documentation Links

- [NSubstitute: Getting started](https://nsubstitute.github.io/help/getting-started/) (doc)
- [NSubstitute: Creating a substitute](https://nsubstitute.github.io/help/creating-a-substitute/) (doc)
- [NSubstitute: Auto and recursive mocks](https://nsubstitute.github.io/help/auto-and-recursive-mocks/) (doc)
- [NSubstitute: Throwing exceptions](https://nsubstitute.github.io/help/throwing-exceptions/) (doc)
- [NSubstitute: Callbacks, void calls and When..Do](https://nsubstitute.github.io/help/callbacks/) (doc)
- [NSubstitute 6.0.0 release notes](https://github.com/nsubstitute/NSubstitute/releases/tag/v6.0.0) (doc)
- [NSubstitute.Analyzers rules](https://github.com/nsubstitute/NSubstitute.Analyzers/tree/master/documentation/rules) (doc)
- [Moq 4.20.2 release notes (SponsorLink removed)](https://github.com/devlooped/moq/releases/tag/v4.20.2) (doc)
- [MSTest assertions, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-writing-tests-assertions) (doc)
