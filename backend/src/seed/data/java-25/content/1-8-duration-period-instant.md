# Duration, Period, and Instant

---

## Overview

The `java.time` package provides three classes to represent amounts of time or a specific point in time:

| Class | Represents | Use with |
|-------|-----------|----------|
| `Duration` | Amount of time in seconds and nanoseconds | `LocalTime`, `LocalDateTime`, `Instant` |
| `Period` | Amount of time in years, months, and days | `LocalDate`, `LocalDateTime` |
| `Instant` | A specific moment on the UTC timeline | Machine time, timestamps |

All three are **immutable** and **value-based**.

---

## Instant

`Instant` represents a single point on the UTC timeline — like a timestamp measured from the **epoch** (1970-01-01T00:00:00Z).

### Creating an Instant

```java
Instant now  = Instant.now();                  // current UTC moment
Instant epoch = Instant.EPOCH;                 // 1970-01-01T00:00:00Z
Instant ts   = Instant.ofEpochSecond(1_000_000); // seconds since epoch
Instant ts2  = Instant.ofEpochMilli(1_700_000_000_000L); // millis since epoch
Instant parsed = Instant.parse("2025-06-15T10:30:00Z");
```

### Reading an Instant

```java
Instant now = Instant.now();
now.getEpochSecond();   // seconds since 1970-01-01T00:00:00Z
now.getNano();          // nanosecond adjustment within current second
now.toEpochMilli();     // milliseconds since epoch
```

### Arithmetic with Instant

```java
Instant start = Instant.now();
Instant later = start.plusSeconds(3600);     // 1 hour later
Instant before = start.minusMillis(500);

start.isBefore(later);    // true
start.isAfter(later);     // false
Duration between = Duration.between(start, later);  // PT1H
```

> **Exam tip:** `Instant` represents machine time and has no concept of date fields like year or month. To get human-readable date/time, convert to `ZonedDateTime` using a `ZoneId`.

---

## Duration

`Duration` represents an amount of time measured in seconds and nanoseconds. It is ideal for time-of-day differences (hours, minutes, seconds).

### Creating a Duration

```java
Duration d1 = Duration.ofHours(2);
Duration d2 = Duration.ofMinutes(90);
Duration d3 = Duration.ofSeconds(3600);
Duration d4 = Duration.ofMillis(500);
Duration d5 = Duration.ofNanos(1_000_000);
Duration d6 = Duration.of(2, ChronoUnit.HOURS);  // using ChronoUnit

// Between two time-based instances
LocalTime start = LocalTime.of(9, 0);
LocalTime end   = LocalTime.of(17, 30);
Duration workDay = Duration.between(start, end);   // PT8H30M

LocalDateTime ldt1 = LocalDateTime.of(2025, 1, 1, 0, 0);
LocalDateTime ldt2 = LocalDateTime.of(2025, 1, 2, 0, 0);
Duration oneDay = Duration.between(ldt1, ldt2);    // PT24H
```

### Reading a Duration

```java
Duration d = Duration.ofHours(2).plusMinutes(30).plusSeconds(15);
d.toHours();        // 2   (total hours, truncated)
d.toMinutes();      // 150 (total minutes)
d.toSeconds();      // 9015 (total seconds)
d.toMillis();       // 9015000
d.toDaysPart();     // 0   (day component only — Java 9+)
d.toHoursPart();    // 2   (hour component only — Java 9+)
d.toMinutesPart();  // 30  (minute component only — Java 9+)
d.toSecondsPart();  // 15  (second component only — Java 9+)
```

### Arithmetic with Duration

```java
Duration d1 = Duration.ofHours(2);
Duration d2 = Duration.ofMinutes(30);
Duration sum  = d1.plus(d2);       // PT2H30M
Duration diff = d1.minus(d2);      // PT1H30M
Duration neg  = d1.negated();      // PT-2H
Duration abs  = neg.abs();         // PT2H
Duration mult = d1.multipliedBy(3); // PT6H
```

### Applying Duration to Date-Time

```java
LocalDateTime dt = LocalDateTime.of(2025, 6, 15, 10, 0);
Duration twoHours = Duration.ofHours(2);
LocalDateTime later = dt.plus(twoHours);  // 2025-06-15T12:00

Instant now   = Instant.now();
Instant after = now.plus(Duration.ofMinutes(5));
```

---

## Period

`Period` represents an amount of time in years, months, and days. It is calendar-based and ideal for date differences.

### Creating a Period

```java
Period p1 = Period.ofYears(1);
Period p2 = Period.ofMonths(6);
Period p3 = Period.ofDays(10);
Period p4 = Period.of(1, 6, 10);  // 1 year, 6 months, 10 days

// Between two dates
LocalDate start = LocalDate.of(2024, 1, 1);
LocalDate end   = LocalDate.of(2025, 6, 15);
Period between  = Period.between(start, end);  // P1Y5M14D
```

### Reading a Period

```java
Period p = Period.of(1, 5, 14);
p.getYears();    // 1
p.getMonths();   // 5
p.getDays();     // 14
p.isNegative();  // false
p.isZero();      // false
```

> **Exam tip:** `Period.between()` returns the **components** separately — there is no `toTotalDays()` method on `Period`. For total days, use `ChronoUnit.DAYS.between(start, end)`.

### Applying Period to a Date

```java
LocalDate date  = LocalDate.of(2025, 1, 1);
Period period   = Period.of(1, 2, 3);  // 1 year, 2 months, 3 days
LocalDate later = date.plus(period);   // 2026-03-04
```

---

## Duration vs Period — Key Differences

| Feature | `Duration` | `Period` |
|---------|-----------|---------|
| Components | Seconds + nanoseconds | Years + months + days |
| Best for | Time-of-day, machine time | Calendar dates |
| Works with | `LocalTime`, `LocalDateTime`, `Instant` | `LocalDate`, `LocalDateTime` |
| Normalization | Automatically normalized to seconds | Components stored separately |
| `between()` | `Duration.between(temporal1, temporal2)` | `Period.between(date1, date2)` |

```java
// Duration — cannot apply to LocalDate:
LocalDate d = LocalDate.of(2025, 1, 1);
d.plus(Duration.ofDays(1));  // UnsupportedTemporalTypeException

// Period — cannot apply to LocalTime:
LocalTime t = LocalTime.of(10, 0);
t.plus(Period.ofDays(1));    // UnsupportedTemporalTypeException
```

---

## ChronoUnit for Total Differences

`ChronoUnit` is useful for computing the total number of a specific unit between two temporals:

```java
LocalDate start = LocalDate.of(2025, 1, 1);
LocalDate end   = LocalDate.of(2025, 6, 15);

ChronoUnit.DAYS.between(start, end);    // 165
ChronoUnit.MONTHS.between(start, end);  // 5
ChronoUnit.YEARS.between(start, end);   // 0

LocalTime t1 = LocalTime.of(9, 0);
LocalTime t2 = LocalTime.of(17, 30);
ChronoUnit.HOURS.between(t1, t2);       // 8
ChronoUnit.MINUTES.between(t1, t2);     // 510
```

---

## Key Points for the Exam

- `Instant` is a point in time on the UTC timeline; it has no date/time fields.
- `Duration` measures seconds and nanos — apply it to time-based types.
- `Period` measures years, months, and days — apply it to date-based types.
- Applying `Duration` to `LocalDate` or `Period` to `LocalTime` throws `UnsupportedTemporalTypeException`.
- `Period.between()` stores year/month/day components separately; there is no `toTotalDays()`.
- Use `ChronoUnit.DAYS.between()` for total-day counts.
- All these classes are immutable — arithmetic operations return new instances.

## References

- [Oracle Docs — Duration (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/time/Duration.html)
- [Oracle Docs — Period (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/time/Period.html)
- [Oracle Docs — Instant (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/time/Instant.html)
