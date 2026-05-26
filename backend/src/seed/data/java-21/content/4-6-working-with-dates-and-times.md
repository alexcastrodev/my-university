# Working with Dates and Times

## Overview

Java's modern date/time API lives in `java.time` (introduced in Java 8). All core types are **immutable** — operations return new objects rather than modifying existing ones. This mirrors `String` immutability.

Key types to know for the OCP exam:

| Class | Stores |
|-------|--------|
| `LocalDate` | Date only (year, month, day) — no time, no timezone |
| `LocalTime` | Time only (hour, minute, second, nanosecond) — no date |
| `LocalDateTime` | Date and time — no timezone |
| `ZonedDateTime` | Date, time, and timezone offset |
| `Instant` | A point on the UTC timeline (machine timestamp) |
| `Period` | A date-based amount (years, months, days) |
| `Duration` | A time-based amount (hours, minutes, seconds, nanos) |

## Creating Instances

### Factory Methods — now() and of()

```java
LocalDate today = LocalDate.now();
LocalDate birthdate = LocalDate.of(1990, Month.JUNE, 15);
LocalDate also = LocalDate.of(1990, 6, 15); // int month also accepted

LocalTime now = LocalTime.now();
LocalTime meeting = LocalTime.of(14, 30);        // 14:30
LocalTime precise = LocalTime.of(9, 0, 30, 500); // 09:00:30.000000500

LocalDateTime dt = LocalDateTime.of(2024, 3, 10, 8, 0);
LocalDateTime dt2 = LocalDateTime.of(birthdate, meeting);

ZonedDateTime zdt = ZonedDateTime.of(dt, ZoneId.of("America/New_York"));
ZonedDateTime zdtNow = ZonedDateTime.now(ZoneId.of("Europe/London"));
```

There are no public constructors — always use the static factory methods.

## Immutability in Action

```java
LocalDate date = LocalDate.of(2024, 1, 1);
date.plusDays(10);         // return value discarded — date unchanged!
System.out.println(date);  // 2024-01-01

LocalDate later = date.plusDays(10);
System.out.println(later); // 2024-01-11
```

Always assign the result of a manipulation back to a variable (or chain it).

## Manipulating Dates and Times

### plus and minus Methods

```java
LocalDate d = LocalDate.of(2024, 6, 15);
d.plusDays(5);       // 2024-06-20
d.plusMonths(2);     // 2024-08-15
d.plusYears(1);      // 2025-06-15
d.minusWeeks(1);     // 2024-06-08

LocalTime t = LocalTime.of(10, 30);
t.plusHours(3);      // 13:30
t.minusMinutes(15);  // 10:15
```

### with Methods (Adjust a Field)

```java
LocalDate d = LocalDate.of(2024, 6, 15);
d.withYear(2025);       // 2025-06-15
d.withMonth(12);        // 2024-12-15
d.withDayOfMonth(1);    // 2024-06-01
```

## Period — Date-Based Amounts

`Period` represents a quantity in **years, months, and days**. Use with `LocalDate`.

```java
Period oneYear = Period.ofYears(1);
Period sixMonths = Period.ofMonths(6);
Period tenDays = Period.ofDays(10);
Period complex = Period.of(1, 2, 3); // 1 year, 2 months, 3 days

LocalDate start = LocalDate.of(2024, 1, 1);
LocalDate end = start.plus(complex);  // 2025-03-04

// Calculate period between two dates
Period between = Period.between(start, end);
System.out.println(between); // P1Y2M3D
```

`Period` does **not** work with `LocalTime` or `Duration` — it is purely date-based.

## Duration — Time-Based Amounts

`Duration` represents a quantity in **hours, minutes, seconds, and nanoseconds**. Use with `LocalTime`, `LocalDateTime`, and `Instant`.

```java
Duration twoHours = Duration.ofHours(2);
Duration thirtyMin = Duration.ofMinutes(30);
Duration ninetySeconds = Duration.ofSeconds(90);

LocalTime start = LocalTime.of(8, 0);
LocalTime end = start.plus(twoHours); // 10:00

Duration between = Duration.between(start, end);
System.out.println(between.toHours());   // 2
System.out.println(between.toMinutes()); // 120
```

## Instant — Machine Timestamp

`Instant` represents a point on the UTC timeline, useful for timestamping events.

```java
Instant now = Instant.now();
Instant epoch = Instant.EPOCH;   // 1970-01-01T00:00:00Z
Instant later = now.plusSeconds(3600);

Duration gap = Duration.between(epoch, now);
System.out.println(gap.toDays()); // days since Unix epoch
```

## DateTimeFormatter

Format and parse date/time objects using `DateTimeFormatter`.

```java
import java.time.format.DateTimeFormatter;

LocalDate date = LocalDate.of(2024, 6, 15);

// Predefined formatters
DateTimeFormatter iso = DateTimeFormatter.ISO_LOCAL_DATE;
System.out.println(date.format(iso)); // 2024-06-15

// Custom pattern
DateTimeFormatter custom = DateTimeFormatter.ofPattern("dd/MM/yyyy");
System.out.println(date.format(custom));                  // 15/06/2024
LocalDate parsed = LocalDate.parse("15/06/2024", custom); // parse back

DateTimeFormatter dtf = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");
LocalDateTime ldt = LocalDateTime.of(2024, 6, 15, 14, 30);
System.out.println(ldt.format(dtf)); // 2024-06-15 14:30
```

Common pattern letters: `y` year, `M` month, `d` day, `H` hour (0-23), `h` hour (1-12), `m` minute, `s` second, `a` AM/PM.

## Period vs Duration

| Feature | Period | Duration |
|---------|--------|----------|
| Unit | Years, months, days | Hours, minutes, seconds, nanos |
| Works with | `LocalDate` | `LocalTime`, `LocalDateTime`, `Instant` |
| Created via | `Period.of(y, m, d)` | `Duration.ofHours(n)` etc. |
| Between two dates | `Period.between(d1, d2)` | `Duration.between(t1, t2)` |

## ZonedDateTime and Daylight Saving

`ZonedDateTime` accounts for timezone rules including Daylight Saving Time (DST) transitions.

```java
ZoneId nyZone = ZoneId.of("America/New_York");
ZonedDateTime springForward = ZonedDateTime.of(
    LocalDateTime.of(2024, 3, 10, 2, 30), nyZone);
// Clocks spring forward — 2:30 AM doesn't exist; Java adjusts automatically

// Adding hours across a DST boundary may shift the offset
ZonedDateTime before = ZonedDateTime.of(2024, 11, 3, 0, 0, 0, 0, nyZone);
ZonedDateTime after = before.plusHours(2);
// Wall clock may show a different offset (-04:00 vs -05:00)
```

## Exam Tips

- All `java.time` objects are **immutable** — always capture the return value.
- `LocalDate`, `LocalTime`, `LocalDateTime` have **no** timezone info.
- Use `Period` for date arithmetic; use `Duration` for time arithmetic.
- `of()` methods are strict — passing `LocalDate.of(2024, 2, 30)` throws `DateTimeException`.
- `DateTimeFormatter.ofPattern` is case-sensitive: uppercase `M` = month, lowercase `m` = minute.
- `Instant` cannot be formatted with a pattern directly — convert to `ZonedDateTime` first.
