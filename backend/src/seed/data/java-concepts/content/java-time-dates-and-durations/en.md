---
version: 1.0
updatedAt: 2026-08-18
---
## Objective

`java.time` (JSR-310, added in Java 8) exists because the API it replaced was genuinely hard to use correctly. `java.util.Date` is mutable, so any object holding one can be changed behind its owner's back; `SimpleDateFormat` is mutable *and* not thread-safe; `Calendar` mutates itself through an untyped field API (`cal.add(Calendar.MONTH, 1)`); months were 0-indexed, so "March" was `2`; and a single `Date` was made to stand for a date, a time, a timestamp, and — depending on which library you handed it to — a timezone-naive wall-clock reading, all at once.

`java.time` fixes this by splitting those conflated ideas into a family of small, immutable types, each modeling exactly one thing: a date with no time (`LocalDate`), a time with no date (`LocalTime`), a wall-clock date-and-time with no zone (`LocalDateTime`), an exact point on the global timeline (`Instant`), that point rendered in a zone (`ZonedDateTime`), a clock-based amount of time (`Duration`), and a calendar-based amount of time (`Period`). Every "modification" method returns a new instance and leaves the receiver untouched. In other words, `java.time` is a large, real-world worked example of the design described in `immutability-and-defensive-copying` — a field of type `LocalDate` needs no defensive copy in the constructor and none in the accessor, because there is no operation that could mutate what the caller receives. This concept is about the *type choices* that design produced, not about re-arguing immutability itself.

## Use Cases

- A human date with no time-of-day — a birthday, an invoice due date, a public holiday — where "midnight" would be a fiction you'd have to keep ignoring: `LocalDate`.
- A wall-clock date and time deliberately detached from any zone — "the exam starts at 09:00 on the 5th", meaning 09:00 wherever the reader is: `LocalDateTime`.
- An exact, unambiguous moment that happened once globally — a log timestamp, an audit record, a `created_at` — where "which timezone" is a display question, not a storage question: `Instant`.
- A moment anchored to a named zone or a fixed offset, when the zone is part of the meaning — "the conference call is at 15:00 Lisbon time, whatever that is where you are": `ZonedDateTime` (named zone, DST-aware) or `OffsetDateTime` (fixed offset, no DST rules).
- Measuring elapsed time or expressing a timeout — `Duration.between(start, end)`, `Duration.ofMinutes(90)` — versus expressing a calendar span like "three months from signature" — `Period.between(a, b)`, `Period.ofMonths(3)`. Both exist because neither can do the other's job honestly.
- Formatting for display and parsing external input with a `DateTimeFormatter` that can safely be a shared `static final` constant, unlike the `SimpleDateFormat` it replaces.

## Deep Dive

### LocalDate, LocalTime, LocalDateTime — and capturing the return value

The three "local" types are built from static factories, never constructors:

```java
LocalDate date = LocalDate.of(2026, 8, 18);        // 2026-08-18 — months are 1-indexed: 8 is August
LocalTime time = LocalTime.of(14, 30);             // 14:30
LocalDateTime dt = LocalDateTime.of(date, time);   // 2026-08-18T14:30

LocalDate today = LocalDate.now();                 // reads the system clock and default zone
LocalDate month = LocalDate.of(2026, Month.AUGUST, 18);  // or the enum, if a bare int reads badly
```

The 1-indexing is deliberate: `Calendar.JANUARY` was `0`, which meant `new GregorianCalendar(2026, 2, 18)` was March, not February. `LocalDate.of(2026, 2, 18)` is February, and `LocalDate.of(2026, 13, 1)` throws `DateTimeException` rather than silently rolling into next year.

Every mutation-shaped method — `plusDays`, `minusMonths`, `withYear`, `withDayOfMonth` — returns a **new** object. This is the single most common first mistake with the API:

```java
LocalDate due = LocalDate.of(2026, 8, 18);
due.plusDays(5);                     // BROKEN: return value discarded
System.out.println(due);             // 2026-08-18 — unchanged, and no compiler warning
```

The fix is to capture the result (or reassign):

```java
LocalDate due = LocalDate.of(2026, 8, 18);
LocalDate extended = due.plusDays(5);
System.out.println(due);             // 2026-08-18 — the original, still valid
System.out.println(extended);        // 2026-08-23
```

Because each call returns a new value, the calls chain, and the chain reads as one expression:

```java
LocalDate endOfNextQuarter = LocalDate.of(2026, 8, 18)
        .plusMonths(3)
        .withDayOfMonth(1)
        .minusDays(1);               // 2026-10-31
```

One detail worth knowing early: month arithmetic clamps rather than overflowing, because there is no 31st of February.

```java
LocalDate.of(2026, 1, 31).plusMonths(1);   // 2026-02-28, not 2026-03-03
```

Also note that `now()` reaches out to the system clock, which makes it awkward to test. Every `now()` has an overload taking a `Clock`, and `Clock.fixed(...)` is the standard way to make date logic deterministic:

```java
Clock frozen = Clock.fixed(Instant.parse("2026-08-18T00:00:00Z"), ZoneOffset.UTC);
LocalDate.now(frozen);               // always 2026-08-18
```

### Instant: a point on the timeline, not a calendar date

An `Instant` is a count of seconds and nanoseconds from the 1970-01-01T00:00:00Z epoch. It has no year, no month, no day-of-week — not because the API forgot them, but because those fields do not exist until you say *where on Earth* you are asking from. The same instant is "18 August, late evening" in Lisbon and "19 August, morning" in Tokyo.

```java
Instant now = Instant.now();
now.getEpochSecond();       // e.g. 1787000000
now.getNano();              // nanosecond-of-second

now.getYear();              // does not compile — Instant has no such method
now.get(ChronoField.YEAR);  // compiles, but throws UnsupportedTemporalTypeException at runtime
```

To get calendar fields you have to name a zone, which turns the instant into a `ZonedDateTime` — a *rendering* of that instant for a particular place:

```java
ZoneId lisbon = ZoneId.of("Europe/Lisbon");
ZonedDateTime here = now.atZone(lisbon);
here.getYear();             // now this is a meaningful question
here.getDayOfWeek();
here.toLocalDate();         // drop back down to just the date, if that's all you needed
```

The conversion runs the other way too, and it is lossless in one direction only:

```java
Instant backAgain = here.toInstant();     // ZonedDateTime -> Instant: always well-defined

LocalDateTime wall = LocalDateTime.of(2026, 8, 18, 15, 0);
Instant guess = wall.toInstant(ZoneOffset.UTC);   // needs an offset supplied — it has none of its own
Instant real  = wall.atZone(lisbon).toInstant();  // or resolve it through a zone's rules
```

That asymmetry is the conceptual core of the whole API. A `ZonedDateTime` knows enough to name an instant. A `LocalDateTime` does not — it is a reading on a wall clock, and turning it into an instant requires information from outside it.

### Duration vs Period: why one type can't do both

`Duration` is time-based: it holds seconds and nanos, and one of its "days" is exactly 86 400 seconds, always.

```java
Duration timeout = Duration.ofMinutes(90);
timeout.toSeconds();                        // 5400
timeout.plusMinutes(30).toHours();          // 2

Instant start = Instant.now();
Instant end = start.plusSeconds(3725);
Duration elapsed = Duration.between(start, end);
elapsed.toMinutes();                        // 62
elapsed.toString();                         // PT1H2M5S
```

`Period` is date-based: years, months, and days as *calendar* quantities, resolved against a real date only when applied.

```java
Period p = Period.between(LocalDate.of(2026, 1, 15), LocalDate.of(2026, 8, 18));
p.getYears();   // 0
p.getMonths();  // 7
p.getDays();    // 3
p.toString();   // P7M3D

LocalDate.of(2026, 1, 31).plus(Period.ofMonths(3));   // 2026-04-30
```

The split exists because "one month" is not a fixed number of seconds. Ask what a month costs and the honest answer depends on which month:

```java
LocalDate a = LocalDate.of(2026, 2, 1);
ChronoUnit.DAYS.between(a, a.plusMonths(1));   // 28
LocalDate b = LocalDate.of(2026, 3, 1);
ChronoUnit.DAYS.between(b, b.plusMonths(1));   // 31
```

A single type covering both would have to pick a lie: either "a month is 30 days" (wrong for every actual month) or "a duration has months" (meaningless without a start date). So the types stay separate, and each rejects the other's territory outright:

```java
Duration.between(LocalDate.of(2026, 1, 1), LocalDate.of(2026, 3, 1));
// UnsupportedTemporalTypeException: Unsupported unit: Seconds — a LocalDate has no time fields

Instant.now().plus(Period.ofMonths(1));
// UnsupportedTemporalTypeException: Unsupported unit: Months — an Instant has no calendar

Period.between(LocalDate.of(2026, 1, 1), LocalDate.of(2026, 3, 1)).getDays();  // 0, not 59
```

That last line is the one that catches people: `P2M` has *zero* days, because the two months absorbed the whole span. For a plain count of days, ask `ChronoUnit.DAYS.between(...)` instead — `Period` decomposes a span into y/m/d, it does not total it.

### ZoneId vs ZoneOffset, and what "plus one day" means across DST

A `ZoneOffset` is just a fixed displacement from UTC — `+01:00` — with no rules attached. A `ZoneId` is a named region whose *rules* (including its DST transitions, and how those rules changed over history) come from the IANA time-zone database shipped with the JDK.

```java
ZoneOffset fixed = ZoneOffset.ofHours(1);          // always +01:00, forever
ZoneId lisbon = ZoneId.of("Europe/Lisbon");        // +00:00 in winter, +01:00 in summer
lisbon.getRules().getOffset(Instant.now());        // asks the rules for *this* instant
```

Use `ZoneOffset`/`OffsetDateTime` when you have a timestamp that already carries an offset (a wire format, an HTTP header). Use `ZoneId`/`ZonedDateTime` when you mean a place, because only a place knows when the clocks move.

Now the transition itself. Portugal springs forward on the last Sunday of March — in 2026, at 01:00 UTC on the 29th, when Lisbon clocks jump from 01:00 to 02:00. A `ZonedDateTime` that crosses that boundary via `plusDays` keeps the **wall-clock time**, not the elapsed duration:

```java
ZoneId lisbon = ZoneId.of("Europe/Lisbon");
ZonedDateTime before = ZonedDateTime.of(2026, 3, 28, 12, 0, 0, 0, lisbon);
// 2026-03-28T12:00Z[Europe/Lisbon]

ZonedDateTime after = before.plusDays(1);
// 2026-03-29T12:00+01:00[Europe/Lisbon] — still "noon", as intended

Duration.between(before, after).toHours();   // 23 — noon to noon was 23 real hours
```

That is correct, not a bug: "same time tomorrow" is a calendar statement, and on that particular day the calendar day was 23 hours long. If you wanted exactly 24 hours of elapsed time, ask for elapsed time, and the wall clock moves instead:

```java
before.plusHours(24);
// 2026-03-29T13:00+01:00[Europe/Lisbon] — 24 real hours, but now it's 13:00
```

The rule behind both lines: on `ZonedDateTime`, the date-based methods (`plusDays`, `plusWeeks`, `plusMonths`, `plusYears`) add to the local date-time and then re-resolve against the zone rules, while the time-based ones (`plusHours`, `plusMinutes`, `plusSeconds`) add to the underlying instant.

The same transition makes some local times not exist at all, and others exist twice. `java.time` resolves both without throwing:

```java
// 01:30 on 2026-03-29 never happens in Lisbon — the gap pushes it forward by the gap length
ZonedDateTime.of(2026, 3, 29, 1, 30, 0, 0, lisbon);
// 2026-03-29T02:30+01:00[Europe/Lisbon]

// on the autumn fall-back (2026-10-25) 01:30 happens twice; the earlier offset wins by default
ZonedDateTime overlap = ZonedDateTime.of(2026, 10, 25, 1, 30, 0, 0, lisbon);
overlap.withLaterOffsetAtOverlap();   // opt into the second occurrence explicitly
```

### Parsing and formatting with DateTimeFormatter

Every type parses and prints its ISO-8601 form with no formatter at all:

```java
LocalDate.parse("2026-08-18");                 // ISO_LOCAL_DATE by default
Instant.parse("2026-08-18T14:30:00Z");         // ISO_INSTANT
LocalDate.of(2026, 8, 18).toString();          // "2026-08-18"
```

For anything else, name a formatter. The built-in constants cover the standard wire formats, and `ofPattern` covers the rest:

```java
DateTimeFormatter.ISO_LOCAL_DATE.format(LocalDate.of(2026, 8, 18));   // 2026-08-18
DateTimeFormatter.ISO_OFFSET_DATE_TIME.format(OffsetDateTime.now());  // 2026-08-18T14:30:00+01:00

private static final DateTimeFormatter UI = DateTimeFormatter.ofPattern("dd/MM/yyyy");

UI.format(LocalDate.of(2026, 8, 18));          // 18/08/2026
LocalDate.parse("18/08/2026", UI);             // 2026-08-18
LocalDate.parse("18-08-2026", UI);             // DateTimeParseException — strict, by design
```

`DateTimeFormatter` is **immutable and thread-safe**, which is why that `static final` field above is not just acceptable but idiomatic. Its predecessor was not:

```java
// legacy — a shared SimpleDateFormat is a real production bug, not a theoretical one
private static final SimpleDateFormat OLD = new SimpleDateFormat("dd/MM/yyyy");
// two threads calling OLD.parse(...) concurrently corrupt its internal Calendar:
// wrong dates, or NumberFormatException from deep inside the parser
```

`SimpleDateFormat` keeps mutable parsing state in a field, so concurrent calls interleave and produce garbage — sometimes an exception, sometimes a plausible-looking wrong date, which is worse. The usual workarounds (a new instance per call, a `ThreadLocal`) exist only because the type is broken; `DateTimeFormatter` needs neither.

Two formatter details that catch people: a formatter's "modifier" methods are immutable too (`withLocale`, `withZone` return a *new* formatter, same rule as everything else in `java.time`), and formatting an `Instant` with a date-based formatter fails unless you attach a zone, because — as above — an `Instant` has no calendar fields:

```java
DateTimeFormatter.ISO_LOCAL_DATE.format(Instant.now());
// UnsupportedTemporalTypeException: Unsupported field: DayOfMonth

DateTimeFormatter.ISO_LOCAL_DATE.withZone(ZoneId.of("Europe/Lisbon")).format(Instant.now());
// 2026-08-18
```

### Bridging to the legacy API

Code that still has to talk to `java.util.Date`-based libraries converts through `Instant`, in both directions:

```java
Date legacy = Date.from(Instant.now());        // java.time -> java.util
Instant modern = legacy.toInstant();           // java.util -> java.time

Calendar cal = Calendar.getInstance();
ZonedDateTime zdt = cal.toInstant().atZone(cal.getTimeZone().toZoneId());
```

The JDBC types have their own bridges, and one of them is a trap:

```java
java.sql.Timestamp ts = java.sql.Timestamp.valueOf(LocalDateTime.of(2026, 8, 18, 14, 30));
LocalDateTime back = ts.toLocalDateTime();

java.sql.Date sqlDate = java.sql.Date.valueOf(LocalDate.of(2026, 8, 18));
LocalDate backDate = sqlDate.toLocalDate();

sqlDate.toInstant();   // UnsupportedOperationException — java.sql.Date has no time-of-day,
                       // even though it extends java.util.Date, which does
```

A modern JDBC driver will hand you `java.time` types directly — `rs.getObject("created_at", OffsetDateTime.class)` — which skips the whole bridge. Prefer that where the driver supports it.

## Trade-offs

- **Immutability means the return value is the result — discarding it is a silent no-op.** Nothing in the compiler flags a `plusDays` whose result is thrown away, and the code looks like it worked. This is the most common java.time bug by a wide margin, and it is the direct cost of the design that makes these types safe to share:
  ```java
  date.plusDays(5);                  // BROKEN — date is unchanged
  LocalDate later = date.plusDays(5); // fixed — the new value is the point
  ```
- **Picking the wrong type is the mistake that actually costs money, and it is a modeling decision, not an API preference.** Storing something that is genuinely a global instant as a `LocalDateTime` throws the zone away silently, so "15:00" means a different real moment to every service that later reads it. Storing a genuinely zone-free wall-clock concept as an `Instant` or `ZonedDateTime` invents a conversion nobody asked for — an alarm set for 07:00 should stay 07:00 after the user flies somewhere, and a `ZonedDateTime` will helpfully "correct" it. Ask what the value *is* before asking which class to use: a moment (`Instant`), a moment in a place (`ZonedDateTime`), or a reading on a wall clock (`LocalDateTime`).
- **`Period` and `Duration` cannot substitute for one another, so any calculation mixing calendar spans with elapsed time needs an explicit decision about which type owns which step.** A `Duration` cannot answer "how many months" in a calendar-meaningful way, and a `Period` cannot produce an exact second count without being resolved against a specific start date:
  ```java
  Period.ofMonths(1).get(ChronoUnit.SECONDS);        // UnsupportedTemporalTypeException
  Duration.between(LocalDate.of(2026, 1, 1), LocalDate.of(2026, 3, 1));  // also throws
  // resolve the calendar part first, then measure:
  LocalDate from = LocalDate.of(2026, 1, 1);
  Duration.between(from.atStartOfDay(), from.plusMonths(1).atStartOfDay()).toDays();  // 31
  ```
- **Zone-aware arithmetic is correct but not intuitive, and "a day" stops being 24 hours.** `plusDays` on a `ZonedDateTime` preserves wall-clock time across a DST transition, so a "daily" job scheduled that way runs 23 or 25 hours after the previous run twice a year. That is usually what a human means by "daily", but it is not what a fixed-rate timer means, and code that assumes the two agree drifts:
  ```java
  Duration.between(before, before.plusDays(1)).toHours();   // 23 across spring-forward
  ```
- **Pattern letters are case-sensitive in ways that produce plausible wrong output.** `yyyy` is the calendar year; `YYYY` is the *week-based* year, which differs from the calendar year for a few days around New Year — so a report labelled with `YYYY` prints the wrong year on 31 December and nobody notices until January. Likewise `mm` is minutes and `MM` is months, and `DD` is day-of-year, not day-of-month.
  ```java
  LocalDate d = LocalDate.of(2026, 12, 31);
  d.format(DateTimeFormatter.ofPattern("dd/MM/yyyy"));   // 31/12/2026
  d.format(DateTimeFormatter.ofPattern("dd/MM/YYYY"));   // 31/12/2027 — week-based year
  ```
- **Equality on zoned types compares the representation, not the moment.** Two `ZonedDateTime` values naming the same instant in different zones are not `equals`, which is correct for a type whose zone is part of its identity but surprises anyone using them as `Map` keys or in `assertEquals`. Compare instants when you mean instants — see `equals-hashcode-and-tostring-contracts` for why a type gets to define equality this way.
  ```java
  ZonedDateTime a = Instant.parse("2026-08-18T12:00:00Z").atZone(ZoneId.of("Europe/Lisbon"));
  ZonedDateTime b = Instant.parse("2026-08-18T12:00:00Z").atZone(ZoneId.of("UTC"));
  a.equals(b);    // false — different zone, different object
  a.isEqual(b);   // true  — same point on the timeline
  ```
- **Legacy interop is an ongoing cost, and every boundary crossing is a place a bug can hide.** Old `Date`/`Calendar` APIs and older JDBC drivers still surface `java.util.Date`, `java.sql.Date`, and `Timestamp`; the bridge methods exist, but each crossing can drop precision (`java.util.Date` holds milliseconds, `Instant` holds nanoseconds, so a round trip through `Date` truncates), or silently apply a legacy library's default-timezone assumption that the explicit `java.time` model would have forced someone to name. Push the conversions to the edges of the system and keep `java.time` types everywhere inside it.
  ```java
  Instant precise = Instant.parse("2026-08-18T14:30:00.123456789Z");
  Date.from(precise).toInstant();   // 2026-08-18T14:30:00.123Z — nanos gone
  ```
- **These types are `Serializable`, but not in the naive way.** Every `java.time` type writes itself through a package-private serialization proxy rather than exposing its fields as permanent API, which is exactly the containment technique described in `serialization-risks-and-safer-alternatives` — worth knowing if you serialize them, and worth copying if you write value types of your own.

## Documentation Links

- [java.time — Java SE 25 API docs](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/time/package-summary.html) — doc
- [Date Time — Java SE developer guide](https://docs.oracle.com/en/java/javase/25/core/date-time-classes.html) — doc
- [DateTimeFormatter — Java SE 25 API docs](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/time/format/DateTimeFormatter.html) — doc
