---
version: 1.0
updatedAt: 2026-10-18
---
## Objective

Code that reads `DateTime.UtcNow` or waits with `Task.Delay(TimeSpan)` gives its tests two bad options:
wait for real time to pass, or check "close enough to now". Since .NET 8 the runtime has an abstraction
for time, `TimeProvider`, and the overloads that accept one: `Task.Delay`, `Task.WaitAsync`,
`CancellationTokenSource` and `PeriodicTimer`. In tests, `FakeTimeProvider` from
`Microsoft.Extensions.TimeProvider.Testing` replaces it with a clock that only moves when the test says
so. The goal is to inject time everywhere it is read, test every limit exactly at its boundary, drive
timers and delays without sleeping, and know what `FakeTimeProvider` really does when you call
`Advance`.

## Use Cases

- Testing a 14-day trial, a 15-minute token or a coupon at the exact instant it expires.
- Testing a rate limit or a cache whose window is reset by a timer.
- Testing a retry with backoff and a deadline in milliseconds instead of seconds.
- Testing rules that depend on the local time of a user (quiet hours, "today") on any machine.
- Replacing `ISystemClock`, which ASP.NET Core 8 made obsolete, with `TimeProvider`.

## Deep Dive

### The hidden clock

A static clock is invisible in the signature, and a test cannot replace it:

```csharp
// Broken: the expiry depends on the moment the test runs.
public sealed class CouponBroken
{
    public DateTime ExpiresAt { get; } = DateTime.UtcNow.AddDays(7);
    public bool IsValid => DateTime.UtcNow < ExpiresAt;
}
```

The fix takes time as a dependency. `TimeProvider` is an abstract class in the runtime (in the
`Microsoft.Bcl.TimeProvider` package for .NET Framework, .NET Standard 2.0 and .NET 5 to 7), and
`TimeProvider.System` is the real clock:

```csharp
public sealed class Coupon(TimeProvider time)
{
    public DateTimeOffset ExpiresAt { get; } = time.GetUtcNow().AddDays(7);
    public bool IsValid => time.GetUtcNow() < ExpiresAt;
}
```

Its members cover what code usually needs: `GetUtcNow`, `GetLocalNow` and `LocalTimeZone`,
`GetTimestamp` and `GetElapsedTime` for measuring, and `CreateTimer`, which returns an `ITimer`.

Register it once and let the container inject it. The generic host does not register a
`TimeProvider` by itself (checked with `Host.CreateApplicationBuilder` on .NET 10), so add it:

```csharp
builder.Services.AddSingleton(TimeProvider.System);
```

A test that builds the same services swaps in the fake:

```csharp
var clock = new FakeTimeProvider();
services.AddSingleton<TimeProvider>(clock);
```

ASP.NET Core went the same way. `ISystemClock`, which authentication and Identity used since 1.0, is
obsolete since ASP.NET Core 8: the options classes now have a `TimeProvider` property, and the old
`SystemClock` truncated to whole seconds while `TimeProvider` does not.

### FakeTimeProvider: a clock that moves when you say so

```xml
<PackageReference Include="MSTest" Version="4.5.1" />
<PackageReference Include="Microsoft.Extensions.TimeProvider.Testing" Version="10.11.0" />
```

These are the members and behaviors this concept relies on, checked with version 10.11.0:

| Member | What it does |
| --- | --- |
| `new FakeTimeProvider()` | starts at 2000-01-01 00:00 UTC, local zone UTC |
| `new FakeTimeProvider(start)` | starts at `start` |
| `Advance(delta)` | moves forward and fires every timer that became due; a negative delta throws |
| `SetUtcNow(value)` | jumps forward and fires due timers; a value in the past throws |
| `AdjustTime(value)` | sets the time, forward or back, without firing timers (like changing a system clock) |
| `AutoAdvanceAmount` | each read of the clock returns the time and then advances it by this amount (default zero) |
| `SetLocalTimeZone(zone)` | the zone used by `GetLocalNow` |

Two details the documentation does not spell out, both observed here. `AutoAdvanceAmount` also advances on
`GetTimestamp`, so with it on, `GetElapsedTime` measures your reads too. And the fake keeps the offset of
the value you give it: `new FakeTimeProvider(new DateTimeOffset(2026, 10, 18, 9, 0, 0,
TimeSpan.FromHours(-3)))` makes `GetUtcNow()` return a value with a `-03:00` offset, so `.DateTime`
reads 09:00 instead of 12:00. Comparisons between `DateTimeOffset` values still work; formatting and
`.DateTime` do not. Hand it UTC values (`ToUniversalTime()`).

Start the fake at a fixed instant, not at `DateTimeOffset.UtcNow`. Expected values become exact, and
code that still reads the real clock somewhere disagrees with the fake at once:

```csharp
// A fixed instant, far from the real "now".
private readonly FakeTimeProvider _clock = new(new DateTimeOffset(2026, 1, 5, 9, 0, 0, TimeSpan.Zero));
```

### Test the limit, not "well past it"

A limit has two sides. Advancing 16 days to check a 14-day trial passes even when the trial lasts 15.
Test one tick before and exactly at the limit, and write the 14 days in the test instead of reusing the
production constant:

```csharp
private static readonly TimeSpan FourteenDays = TimeSpan.FromDays(14);

[TestMethod]
public void ATrialIsStillActiveOneTickBeforeFourteenDays()
{
    var trials = new TrialService(_clock);
    var trial = trials.Start(Customer);

    _clock.Advance(FourteenDays - TimeSpan.FromTicks(1));

    Assert.AreEqual(TrialStatus.Active, trials.StatusOf(trial));
}

[TestMethod]
public void ATrialExpiresExactlyFourteenDaysAfterItStarts()
{
    var trials = new TrialService(_clock);
    var trial = trials.Start(Customer);

    _clock.Advance(FourteenDays);

    Assert.AreEqual(TrialStatus.Expired, trials.StatusOf(trial));
}
```

The pair catches `<` written as `<=` and a trial of the wrong length; either test alone misses one of
them.

### Timers fire inside Advance

`FakeTimeProvider.CreateTimer` returns a timer that fires when the fake clock reaches its due time. In
every run for this concept the callback ran synchronously, on the thread that called `Advance`, so the
next line of the test already sees its effect. A login throttle that resets its counter every minute:

```csharp
_reset = time.CreateTimer(_ => Reset(), state: null, dueTime: window, period: window);
```

```csharp
using var throttle = new LoginThrottle(3, TimeSpan.FromMinutes(1), _clock);
for (var i = 0; i < 3; i++)
{
    throttle.TryAttempt();
}

_clock.Advance(TimeSpan.FromMinutes(1) - TimeSpan.FromTicks(1));
Assert.IsFalse(throttle.TryAttempt());

_clock.Advance(TimeSpan.FromTicks(1)); // the timer callback runs inside Advance
Assert.IsTrue(throttle.TryAttempt());
```

One `Advance` that covers several periods fires the timer once per period: advancing 35 seconds on a
10-second timer that had fired once took the count from 1 to 4. `SetUtcNow` fires due timers too;
`AdjustTime` does not.

### Delays, deadlines and the await-before-advance hang

`Task.Delay(delay, timeProvider)`, `new CancellationTokenSource(timeout, timeProvider)` and
`task.WaitAsync(timeout, timeProvider)` all run on the provider's timers. A retry that waits 1, 2 and 4
seconds and gives up after 10 seconds uses two of them:

```csharp
using var deadline = new CancellationTokenSource(Deadline, time);
using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct, deadline.Token);
// ...
await Task.Delay(wait, time, linked.Token);
```

The test starts the work, moves the clock, and awaits at the end. Awaiting first never returns, because
the only code that could move the clock is the line after the `await`. `[Timeout]` turns that hang into
a failure ("timed out after 2000ms") instead of a run that never ends:

```csharp
[TestMethod]
[Timeout(2000)]
public async Task TheAttemptsFollowTheBackoffOfOneTwoAndFourSeconds()
{
    var attempts = 0;
    var run = new DeliveryRetry(_clock).RunAsync(_ => Task.FromResult(++attempts == 4), testContext.CancellationToken);
    Assert.AreEqual(1, attempts);

    _clock.Advance(TimeSpan.FromSeconds(1) - TimeSpan.FromTicks(1));
    Assert.AreEqual(1, attempts);

    _clock.Advance(TimeSpan.FromTicks(1));
    Assert.AreEqual(2, attempts);

    _clock.Advance(TimeSpan.FromSeconds(2));
    Assert.AreEqual(3, attempts);

    _clock.Advance(TimeSpan.FromSeconds(4));
    Assert.IsTrue(await run);
}
```

The counter checks between the `Advance` calls work because, in these runs, the continuation after the
fake `Task.Delay` also ran inside `Advance`, even with `ConfigureAwait(false)`. MSTest installs no
`SynchronizationContext` for a test, so nothing posted the continuation elsewhere. That is observed
behavior, not a documented promise: when the code under test awaits real I/O between delays, keep the
final `await` and assert after it. `Thread.Sleep` or `Task.Delay` without the provider in the test does
nothing for a fake clock except make the test slower.

The deadline works the same way. An attempt that never answers is abandoned exactly at 10 seconds:

```csharp
var run = new DeliveryRetry(_clock).RunAsync(
    async ct =>
    {
        await Task.Delay(Timeout.InfiniteTimeSpan, ct); // a server that never answers
        return true;
    },
    testContext.CancellationToken);

_clock.Advance(TimeSpan.FromSeconds(10) - TimeSpan.FromTicks(1));
Assert.IsFalse(run.IsCompleted);

_clock.Advance(TimeSpan.FromTicks(1));
Assert.IsFalse(await run);
```

### PeriodicTimer for background loops

`new PeriodicTimer(period, timeProvider)` is the timer for an `async` loop, the shape of most
`BackgroundService` workers:

```csharp
public async Task RunAsync(CancellationToken ct)
{
    using var timer = new PeriodicTimer(TimeSpan.FromHours(1), time);
    while (await timer.WaitForNextTickAsync(ct))
    {
        Sent++;
    }
}
```

With the loop running, `Advance(1 hour)` made `Sent` 1 and a further `Advance(3 hours)` made it 4: the
loop body ran and waited again inside each firing. When nobody is waiting, ticks do not queue up:
advancing three periods before the first `WaitForNextTickAsync` completed that call at once, and the
next one waited for a new period. Only one `WaitForNextTickAsync` may be in flight at a time.

### Local time on any machine

A rule in local time must not depend on the zone of the machine running the tests. A custom zone works
on every operating system:

```csharp
private static readonly TimeZoneInfo UtcMinus3 =
    TimeZoneInfo.CreateCustomTimeZone("Test/UTC-03", TimeSpan.FromHours(-3), "UTC-03", "UTC-03");

[TestMethod]
[DataRow(21, 59, false)]
[DataRow(22, 0, true)]
[DataRow(6, 59, true)]
[DataRow(7, 0, false)]
public void QuietHoursRunFromTenAtNightToSevenInTheMorningLocalTime(int hour, int minute, bool expected)
{
    var clock = new FakeTimeProvider();
    clock.SetLocalTimeZone(UtcMinus3);
    var local = new DateTimeOffset(2026, 1, 5, hour, minute, 0, TimeSpan.FromHours(-3));
    clock.SetUtcNow(local.ToUniversalTime());

    Assert.AreEqual(expected, new QuietHours(clock).IsQuietNow());
}
```

The production side reads `time.GetLocalNow()` and uses `TimeOnly.IsBetween(22:00, 07:00)`, which
handles a range that wraps past midnight.

### Do the tests protect the rules?

These are the results for the lab's solution (16 tests), one change at a time:

| Change to the production code | Tests that fail |
| --- | --- |
| `StatusOf` uses `<=` instead of `<` | the "expires exactly at 14 days" test |
| The trial lasts 15 days | the "exactly at 14 days" and "remaining time" tests |
| A nested type reads `DateTimeOffset.UtcNow` instead of the injected clock | the two "still valid" token tests |
| Token expiry uses `>` instead of `>=` | the "expires exactly at 15 minutes" test |
| The throttle timer fires 1 s late | the boundary reset test |
| The backoff calls `Task.Delay(wait, token)` | the backoff schedule test |
| The deadline is `new CancellationTokenSource(Deadline)` | the hung attempt test |
| `QuietHours` reads `GetUtcNow` | the 21:59 and 06:59 rows |

The weak versions confirm the advice: a throttle test that advances two minutes lets the late timer
through (16 of 16 green), and token tests with the fake started at `DateTimeOffset.UtcNow` catch the
forgotten clock in one test instead of two.

## Trade-offs

- **One more constructor parameter everywhere.** Every class that reads time takes a `TimeProvider`.
  It is honest (the dependency is visible) and cheap with DI, but it spreads. Code that only needs
  "now" once can receive a `DateTimeOffset` argument instead, which needs no fake at all.
  ```csharp
  public bool IsExpiredAt(DateTimeOffset now) => now >= ExpiresAt;
  ```
- **Synchronous firing is observed, not promised.** Assertions between `Advance` calls rely on
  callbacks and continuations running inside `Advance`. Keep a final `await` so the test stays correct
  if that changes or if the code awaits real I/O.
- **Fake time does not cover real concurrency.** Two threads racing on the counter are not exercised
  by a fake clock. Locks still need their own tests or reasoning.
- **`TimeProvider.System` everywhere else.** The fake is for tests. Mixing the fake and the real clock
  in one test (a fake for the service, `TimeProvider.System` or `DateTime.UtcNow` in the test's
  expected values) gives results that depend on when the test runs, which Microsoft's guidance also
  warns against.
- **Libraries that do not take a `TimeProvider` stay real.** A dependency that calls `DateTime.UtcNow`
  internally cannot be controlled. Wrap it behind a port, or test it with real time and generous limits.
- **xUnit and NUnit use the same package.** `FakeTimeProvider` does not depend on a test framework;
  only `[Timeout]` and `TestContext.CancellationToken` in the lab are MSTest-specific.

## Lab

Five account rules that depend on time are already implemented: a 14-day trial, a 15-minute API token,
a login throttle reset by a timer, quiet hours in local time, and a retry with backoff and a deadline.
Your job is to write the MSTest tests with `FakeTimeProvider`, without sleeping, and to test each limit
exactly where it is.

**What you will practice**

- Starting a fake clock at a fixed instant and testing both sides of a limit.
- Driving a timer created by `TimeProvider.CreateTimer` with `Advance`.
- Testing `Task.Delay` and a `CancellationTokenSource` deadline: start, advance, await.
- Testing local-time rules with a custom time zone.

**Prerequisites:** the Test Doubles in .NET concept and lab, `async`/`await` and `CancellationToken`, .NET 10 SDK.

**How it works:** every test method is already declared with a hint and fails with `TODO-NN: write this test` until you write it. The retry tests carry `[Timeout(2000)]`, so awaiting before advancing fails instead of hanging. The optional TODOs ask you to hide a real clock in a nested type and to mutate the limits, and see which tests notice.

## Documentation Links

- [What is the TimeProvider class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/datetime/timeprovider-overview) (doc)
- [Testing with FakeTimeProvider, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/timeprovider-testing) (doc)
- [FakeTimeProvider class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/microsoft.extensions.time.testing.faketimeprovider) (doc)
- [PeriodicTimer constructor, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.threading.periodictimer.-ctor) (doc)
- [Breaking change: ISystemClock is obsolete, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/breaking-changes/8/isystemclock-obsolete) (doc)
- [Test execution and control in MSTest (timeouts), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-writing-tests-controlling-execution) (doc)
