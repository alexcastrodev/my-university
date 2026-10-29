---
version: 1.0
updatedAt: 2026-10-28
---
## Objective

Most date bugs come from a value that does not say what it means: is
`2026-07-01 12:00` an instant, a wall-clock reading in some city, or a date
with a meaningless time? .NET gives each meaning a type: `DateTime` with its
`Kind`, `DateTimeOffset` for instants, `TimeZoneInfo` for a zone's rules,
`DateOnly`/`TimeOnly` for calendar values and `TimeProvider` for the clock.
This concept runs each one on .NET 10 / C# 14 on a Mac in `Europe/Lisbon`
(UTC+1 in July, UTC+0 since 25 October 2026), with invariant-culture output,
including New York's 2026 daylight saving transitions.

## Use Cases

- Storing when an order or login happened so any server reads the same instant.
- Scheduling at a local time in a named zone: "Mondays 09:00 in New York".
- Modeling values that are not instants: a birthday, a holiday, opening hours.
- Testing expiry, retries and timeouts without sleeping, via `TimeProvider`.

## Deep Dive

### `DateTime` and its `Kind`

A `DateTime` is ticks plus a `Kind`: `Utc`, `Local` (the machine's zone) or
`Unspecified` (the constructor's default). `Kind` is ignored by equality,
comparison and arithmetic, and the conversions guess for `Unspecified`, in
opposite directions:

```csharp
var u = new DateTime(2026, 7, 1, 12, 0, 0, DateTimeKind.Utc);
var l = new DateTime(2026, 7, 1, 12, 0, 0, DateTimeKind.Local);  // 11:00 UTC
var x = new DateTime(2026, 7, 1, 12, 0, 0);                        // Unspecified
u == l                       // True  (an hour apart in reality); l - u is 00:00:00
x.ToUniversalTime()          // 2026-07-01T11:00:00.0000000Z       (assumed Local)
x.ToLocalTime()              // 2026-07-01T13:00:00.0000000+01:00  (assumed Utc)
```

Only `"O"` round-trips: parsed back with `DateTimeStyles.RoundtripKind`,
`2026-07-01T12:00:00.1234567Z` is identical, `"s"` (`2026-07-01T12:00:00`)
loses the fraction and the kind, `"u"` (`2026-07-01 12:00:00Z`) the fraction.
`"u"` and `"R"` convert nothing: `l` (11:00 UTC) prints as
`2026-07-01 12:00:00Z` and `Wed, 01 Jul 2026 12:00:00 GMT`, both wrong.

### `DateTimeOffset`: an instant with an offset

```csharp
var a = new DateTimeOffset(2026, 7, 1, 12, 0, 0, TimeSpan.Zero);
var b = new DateTimeOffset(2026, 7, 1, 9, 0, 0, TimeSpan.FromHours(-3));
$"{a == b} {a.EqualsExact(b)}"     // True False (same instant, different offset)
b.UtcDateTime                      // 2026-07-01T12:00:00.0000000Z (Kind=Utc)
new DateTimeOffset(u, TimeSpan.FromHours(1));
// ArgumentException: The UTC Offset for Utc DateTime instances must be 0. (Parameter 'offset')
```

An offset is not a time zone: `-03:00` says nothing about next month. The docs
recommend `DateTimeOffset` "as the default date and time type for application
development"; store a zone id beside it when you need the zone's rules.

### `TimeZoneInfo`: IANA and Windows ids

On this Mac (with ICU) `FindSystemTimeZoneById` resolves both id families,
and `HasIanaId` says which kind you hold:

```csharp
var sp = TimeZoneInfo.FindSystemTimeZoneById("America/Sao_Paulo");
var win = TimeZoneInfo.FindSystemTimeZoneById("E. South America Standard Time");
$"{sp.HasIanaId} {win.HasIanaId} {sp.BaseUtcOffset}"   // True False -03:00:00
TimeZoneInfo.TryConvertIanaIdToWindowsId("Europe/Lisbon", out var w);      // GMT Standard Time
TimeZoneInfo.TryConvertWindowsIdToIanaId("GMT Standard Time", out var i);  // Europe/London
TimeZoneInfo.TryConvertWindowsIdToIanaId("GMT Standard Time", "PT", out i); // Europe/Lisbon
TimeZoneInfo.FindSystemTimeZoneById("BRT");
// TimeZoneNotFoundException: The time zone ID 'BRT' was not found on the local computer.
var noon = DateTimeOffset.Parse("2026-07-01T12:00Z");
TimeZoneInfo.ConvertTime(noon, sp)                       // 2026-07-01T09:00:00-03:00
TimeZoneInfo.ConvertTimeFromUtc(noon.UtcDateTime, sp)    // 2026-07-01T09:00:00 (Unspecified)
```

Windows to IANA is many to one, `BRT` is not an id, and
`TryFindSystemTimeZoneById` avoids the exception. `ConvertTimeToUtc` with a
`Local` value and another zone throws `ArgumentException` ("...did not have
the Kind property set correctly"). `TimeZoneInfo.Local.Id` here is `Portugal`,
an old alias with a zoneinfo file byte-identical to Lisbon's; with
`TZ=Brazil/East` it is `Brazil/East`. Never branch on `Local.Id`.

With `DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1` the rules stayed the same (the
transitions below printed identically), but New York's `DisplayName` became
`(UTC-05:00) America/New_York`, `StandardName` became `EST`, and Windows ids
stopped resolving (`TimeZoneNotFoundException`), so store IANA ids.

### Daylight saving: the gap and the repeated hour

Scanning New York's `GetUtcOffset` every 30 minutes of 2026 finds two
changes: 2026-03-08 at 07:00Z (-05:00 to -04:00, 02:00 jumps to 03:00) and
2026-11-01 at 06:00Z (back to -05:00, 01:00 to 01:59 happens twice).

```csharp
var ny = TimeZoneInfo.FindSystemTimeZoneById("America/New_York");
var gap = new DateTime(2026, 3, 8, 2, 30, 0);   // never shown on a New York clock
var rep = new DateTime(2026, 11, 1, 1, 30, 0);  // shown twice
ny.IsInvalidTime(gap)               // True
ny.GetUtcOffset(gap)                // -05:00:00 (no error)
TimeZoneInfo.ConvertTimeToUtc(gap, ny);
// ArgumentException: The supplied DateTime represents an invalid time.  For example,
// when the clock is adjusted forward, any time in the period that is skipped is invalid.
ny.IsAmbiguousTime(rep)             // True
ny.GetAmbiguousTimeOffsets(rep)     // [-05:00:00, -04:00:00]
TimeZoneInfo.ConvertTimeToUtc(rep, ny)   // 2026-11-01T06:30:00Z (silently standard time)
```

Which 01:30 is meant is a business decision: ask, or build both with
`new DateTimeOffset(rep, offset)`. A `DateTimeOffset` is never ambiguous:
05:30Z and 06:30Z convert to `01:30-04:00` and `01:30-05:00`. Measured in UTC,
2026-03-08 lasts 23 h and 2026-11-01 lasts 25 h, so "one day later" has two
meanings:

```csharp
var sat9 = new DateTime(2026, 3, 7, 9, 0, 0);                  // Saturday 09:00 New York
TimeZoneInfo.ConvertTimeToUtc(sat9.AddDays(1), ny)             // 2026-03-08T13:00:00Z (09:00 local)
var dto = new DateTimeOffset(sat9, ny.GetUtcOffset(sat9));     // 09:00-05:00
TimeZoneInfo.ConvertTime(dto.AddDays(1), ny)                   // 2026-03-08T10:00:00-04:00
```

`DateTimeOffset.AddDays(1)`, like adding `TimeSpan.FromHours(24)`, keeps the
old offset: right for "24 h after this instant", wrong for "same time
tomorrow". The classic bug is a weekly Monday 09:00 meeting stored as its
first instant in UTC and repeated with `AddDays(7)`:

```text
stored UTC + 7d        shown in New York      wall clock + 7d, then converted
2026-03-02 14:00Z  ->  Mon 09:00              Mon 2026-03-02 09:00 -> 14:00Z
2026-03-09 14:00Z  ->  Mon 10:00 (wrong)      Mon 2026-03-09 09:00 -> 13:00Z
```

Store the rule as local time plus IANA id and compute each instant when
needed. Seen from Lisbon it is 13:00 on 16 March and 14:00 on 6 April.

### `DateOnly` and `TimeOnly`

A birthday stored as UTC midnight 1990-03-04 becomes `1990-03-03 21:00` in
São Paulo. `DateOnly` and `TimeOnly` (.NET 6) carry no fake time:

```csharp
var d = new DateOnly(2026, 1, 31);
d.DayOfWeek                        // Saturday
d.AddMonths(1)                     // 02/28/2026 (clamped)
d.AddMonths(1).AddMonths(1)        // 03/28/2026 (compute from the start date instead)
d.AddMonths(2)                     // 03/31/2026
new TimeOnly(23, 30).AddHours(2, out int wrapped)       // 01:30, wrapped = 1
new TimeOnly(23, 30).IsBetween(new(22, 0), new(2, 0))   // True (crosses midnight)
JsonSerializer.Serialize(new Person("Ana", new DateOnly(1990, 3, 4), new TimeOnly(9, 30)));
// {"Name":"Ana","Birthday":"1990-03-04","Start":"09:30:00"}
// reading "04/03/1990" -> JsonException: The JSON value could not be converted to Person. Path: $.Birthday ...
```

### Parsing with `DateTimeStyles`

```text
input                      None          AssumeUniversal  AdjustToUniversal  Assume|Adjust  RoundtripKind
2026-07-01 12:00           12:00 Unspec  13:00 Local      12:00 Unspec       12:00 Utc      12:00 Unspec
2026-07-01T12:00:00Z       13:00 Local   13:00 Local      12:00 Utc          12:00 Utc      12:00 Utc
2026-07-01T12:00:00-03:00  16:00 Local   16:00 Local      15:00 Utc          15:00 Utc      16:00 Local
```

The style decides the `Kind` and whether the value moves. `AssumeUniversal`
alone converts to local; add `AdjustToUniversal` for UTC.
`AssumeLocal | AssumeUniversal` throws `ArgumentException`, and `ParseExact`
with `"yyyy-MM-dd'T'HH:mm:ssK"` plus `RoundtripKind` reads `...Z` as `Utc`.
`"03/04/2026"` is 3 April in `pt-BR` and 4 March in `en-US`, and
`DateTimeOffset.Parse("2026-07-01 12:00")` silently takes the local `+01:00`.

### `TimeProvider`, `FakeTimeProvider` and `Stopwatch`

`TimeProvider` (.NET 8+) abstracts clock, timestamps, timers and local zone;
per the docs, `TimeProvider.System` uses `UtcNow`, `Local` and `Stopwatch`:

```csharp
TimeProvider tp = TimeProvider.System;
tp.GetLocalNow().Offset    // 00:00:00          tp.LocalTimeZone.Id  // Portugal
long t0 = tp.GetTimestamp(); Thread.Sleep(100); tp.GetElapsedTime(t0);  // about 103 ms
using var timer = tp.CreateTimer(_ => n++, null, TimeSpan.Zero, TimeSpan.FromMilliseconds(50));
// 6 callbacks in about 275 ms (due at 0, 50, ... 250)
```

`FakeTimeProvider` (`Microsoft.Extensions.TimeProvider.Testing` 10.11.0) starts
at `2000-01-01T00:00:00+00:00` in zone `UTC` and moves only on `Advance`, which
also fires timers and cancels `new CancellationTokenSource(span, provider)`:

```csharp
[Fact]
public async Task Delay_and_local_time_follow_the_fake_clock()
{
    var fake = new FakeTimeProvider(new DateTimeOffset(2026, 3, 8, 6, 30, 0, TimeSpan.Zero));
    var delay = Task.Delay(TimeSpan.FromHours(1), fake);
    Assert.False(delay.IsCompleted);
    fake.Advance(TimeSpan.FromHours(1));
    await delay;                     // completes at once, no real hour waited
    fake.SetLocalTimeZone(TimeZoneInfo.FindSystemTimeZoneById("America/New_York"));
    Assert.Equal("2026-03-08T03:30:00.0000000-04:00", fake.GetLocalNow().ToString("O"));
}
```

`DateTime.UtcNow - start` reads the wall clock, which the OS may correct
mid-measurement; `Stopwatch` and `GetTimestamp` read the high-resolution
counter (`Frequency` 1,000,000,000 here; 100 ms of sleep measured 102 ms).

**Book vs today.** Scattered `DateTime.Now`/`UtcNow` calls give way to an
injected `TimeProvider`. The old `System.TimeZone` class gives `warning CS0618:
'TimeZone' is obsolete: 'System.TimeZone has been deprecated. Investigate the
use of System.TimeZoneInfo instead.'`

## Trade-offs

- **`DateTimeOffset` for instants.** It has no zone rules, and some providers
  want `DateTime` with `Kind=Utc` (Npgsql rejects `Local`, see the EF Core lesson).
- **UTC for past events, local time plus zone for future appointments.** A
  future meeting stored as a UTC instant drifts when DST or the law changes.
- **IANA ids over Windows ids**, because they survive invariant mode.
- **`TimeProvider` over `DateTime.Now`.** One constructor parameter buys tests.

| What you store          | Type                                                    |
|-------------------------|---------------------------------------------------------|
| An instant (event, log) | `DateTimeOffset`, or `DateTime` with `Kind=Utc`         |
| A local appointment     | `DateOnly` + `TimeOnly` (or local `DateTime`) + IANA id |
| A birthday or holiday   | `DateOnly`                                              |
| A duration              | `TimeSpan`, measured with `Stopwatch` or `GetTimestamp` |
| A timestamp column      | UTC instant (`timestamptz`, `datetimeoffset`)           |

## Documentation Links

- [Choose between DateTime, DateOnly, DateTimeOffset, TimeSpan, TimeOnly, and TimeZoneInfo, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/datetime/choosing-between-datetime) (doc)
- [Converting times between time zones, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/datetime/converting-between-time-zones) (doc)
- [How to resolve ambiguous times, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/datetime/resolve-ambiguous-times) (doc)
- [What is TimeProvider?, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/datetime/timeprovider-overview) (doc)
- [TimeZoneInfo class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.timezoneinfo) (doc)
- [TimeProvider class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.timeprovider) (doc)
