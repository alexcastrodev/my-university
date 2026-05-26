---
version: 1.0
updatedAt: 2026-05-26
---
# LocalDate, LocalTime, LocalDateTime

---

## Overview

The `java.time` package (introduced in Java 8) provides immutable, thread-safe date and time classes. The three core types that represent date and/or time **without a time zone** are:

| Class | Stores | Example |
|-------|--------|---------|
| `LocalDate` | Date only | `2025-06-15` |
| `LocalTime` | Time only | `10:30:45.123` |
| `LocalDateTime` | Date and time | `2025-06-15T10:30:45.123` |

None of these classes store timezone or offset information. Use `ZonedDateTime` or `OffsetDateTime` when timezone is needed.

---

## LocalDate

Represents a date: year, month, and day-of-month.

### Creating a LocalDate

```java
LocalDate today    = LocalDate.now();              // current date from system clock
LocalDate birthday = LocalDate.of(1990, 3, 15);   // March 15, 1990
LocalDate holiday  = LocalDate.of(2025, Month.DECEMBER, 25);  // using Month enum
LocalDate parsed   = LocalDate.parse("2025-06-15"); // ISO format: yyyy-MM-dd
```

### Reading Fields

```java
LocalDate d = LocalDate.of(2025, 6, 15);
d.getYear();         // 2025
d.getMonthValue();   // 6
d.getMonth();        // Month.JUNE
d.getDayOfMonth();   // 15
d.getDayOfWeek();    // DayOfWeek.SUNDAY
d.getDayOfYear();    // 166
d.isLeapYear();      // false
d.lengthOfMonth();   // 30
```

### Manipulating Dates (Immutable — always returns new object)

```java
LocalDate d = LocalDate.of(2025, 6, 15);
d.plusDays(10);         // 2025-06-25
d.plusWeeks(1);         // 2025-06-22
d.plusMonths(2);        // 2025-08-15
d.plusYears(1);         // 2026-06-15
d.minusDays(5);         // 2025-06-10
d.withDayOfMonth(1);    // 2025-06-01
d.withMonth(1);         // 2025-01-15
```

> **Exam tip:** Date-time classes are **immutable**. Calling `d.plusDays(10)` does not modify `d` — it returns a new `LocalDate`. You must assign the result.

### Comparing Dates

```java
LocalDate d1 = LocalDate.of(2025, 1, 1);
LocalDate d2 = LocalDate.of(2025, 6, 15);

d1.isBefore(d2);        // true
d1.isAfter(d2);         // false
d1.isEqual(d2);         // false
d1.compareTo(d2);       // negative (d1 is earlier)
```

---

## LocalTime

Represents a time-of-day: hours, minutes, seconds, and nanoseconds.

### Creating a LocalTime

```java
LocalTime now     = LocalTime.now();
LocalTime morning = LocalTime.of(9, 30);           // 09:30:00
LocalTime precise = LocalTime.of(10, 15, 30, 500); // 10:15:30.000000500
LocalTime parsed  = LocalTime.parse("14:30:00");   // ISO format: HH:mm:ss
```

Constants:

```java
LocalTime.MIN;       // 00:00:00
LocalTime.MAX;       // 23:59:59.999999999
LocalTime.MIDNIGHT;  // 00:00:00
LocalTime.NOON;      // 12:00:00
```

### Reading Fields

```java
LocalTime t = LocalTime.of(14, 30, 45, 100_000_000);
t.getHour();         // 14
t.getMinute();       // 30
t.getSecond();       // 45
t.getNano();         // 100000000
```

### Manipulating Time

```java
LocalTime t = LocalTime.of(10, 0);
t.plusHours(3);       // 13:00
t.plusMinutes(90);    // 11:30
t.minusSeconds(30);   // 09:59:30
t.withHour(8);        // 08:00
```

Times wrap around at midnight:

```java
LocalTime.of(23, 0).plusHours(2);  // 01:00 (next day — no date stored)
```

---

## LocalDateTime

Combines a `LocalDate` and a `LocalTime` into a single object, still without timezone.

### Creating a LocalDateTime

```java
LocalDateTime now  = LocalDateTime.now();
LocalDateTime dt   = LocalDateTime.of(2025, 6, 15, 10, 30);      // date + time
LocalDateTime dt2  = LocalDateTime.of(2025, Month.JUNE, 15, 10, 30, 0);
LocalDateTime dt3  = LocalDateTime.parse("2025-06-15T10:30:00"); // ISO 8601

// From existing LocalDate and LocalTime
LocalDate     date = LocalDate.of(2025, 6, 15);
LocalTime     time = LocalTime.of(10, 30);
LocalDateTime dt4  = LocalDateTime.of(date, time);
LocalDateTime dt5  = date.atTime(time);
LocalDateTime dt6  = date.atTime(10, 30);
LocalDateTime dt7  = time.atDate(date);
```

### Extracting Parts

```java
LocalDateTime dt = LocalDateTime.of(2025, 6, 15, 10, 30, 45);
dt.toLocalDate();    // LocalDate: 2025-06-15
dt.toLocalTime();    // LocalTime: 10:30:45
dt.getYear();        // 2025
dt.getHour();        // 10
```

### Manipulating LocalDateTime

All manipulation methods work the same as `LocalDate` and `LocalTime`:

```java
LocalDateTime dt = LocalDateTime.of(2025, 6, 15, 10, 30);
dt.plusDays(1);       // 2025-06-16T10:30
dt.plusHours(5);      // 2025-06-15T15:30
dt.minusWeeks(1);     // 2025-06-08T10:30
dt.withMonth(12);     // 2025-12-15T10:30
```

---

## The Month and DayOfWeek Enums

```java
// Month enum
Month.JANUARY.getValue();     // 1
Month.DECEMBER.getValue();    // 12
Month.JUNE.maxLength();       // 30
Month.FEBRUARY.maxLength();   // 29 (uses leap year for max)

// DayOfWeek enum
DayOfWeek.MONDAY.getValue();  // 1
DayOfWeek.SUNDAY.getValue();  // 7
```

---

## Formatting and Parsing

```java
import java.time.format.DateTimeFormatter;

DateTimeFormatter fmt = DateTimeFormatter.ofPattern("dd/MM/yyyy");
String formatted = LocalDate.of(2025, 6, 15).format(fmt);  // "15/06/2025"

LocalDate parsed = LocalDate.parse("15/06/2025", fmt);     // 2025-06-15

// Predefined formatters
LocalDate.now().format(DateTimeFormatter.ISO_LOCAL_DATE);   // "2025-06-15"
```

---

## Key Points for the Exam

- `LocalDate`, `LocalTime`, and `LocalDateTime` are **immutable** — mutations return new instances.
- Month values in `LocalDate.of()` are **1-based** (1 = January, 12 = December).
- The `Month` enum values are `JANUARY` through `DECEMBER`; `getMonthValue()` returns 1–12.
- `LocalTime` wraps around midnight — it has no concept of date overflow.
- `parse()` defaults to ISO 8601 format; use a `DateTimeFormatter` for other formats.
- Use `.atTime()` and `.atDate()` to combine `LocalDate` and `LocalTime` into `LocalDateTime`.

## References

- [Oracle Docs — LocalDate (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/time/LocalDate.html)
- [Oracle Docs — LocalTime (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/time/LocalTime.html)
- [Oracle Docs — LocalDateTime (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/time/LocalDateTime.html)
