---
version: 1.0
updatedAt: 2026-10-15
---
## Question

# What is Duration?

## Short Answer

A class.

## Less Short Answer

`Duration` is a class from the Date and Time API, `java.time`. It models a given amount of time, not a point on the timeline: "90 minutes", "1.5 seconds", "a 30 second timeout".

```java
Duration timeout = Duration.ofSeconds(30);
Duration meeting = Duration.ofMinutes(90);

System.out.println(meeting);                  // PT1H30M
System.out.println(meeting.toMinutes());      // 90
System.out.println(meeting.toHoursPart());    // 1
System.out.println(meeting.toMinutesPart());  // 30
```

## Seconds and Nanoseconds

Internally, this amount of time is modeled with two fields only: a number of seconds (a `long`) and a number of nanoseconds within that second (an `int`, from 0 to 999,999,999). Every factory method, `ofMillis()`, `ofMinutes()`, `ofHours()`, `ofDays()`, ends up converted to these two numbers.

```java
Duration d = Duration.ofMillis(1500);

System.out.println(d);              // PT1.5S
System.out.println(d.getSeconds()); // 1
System.out.println(d.getNano());    // 500000000
```

The nanosecond part is always positive, even for a negative duration: minus 0.75 seconds is stored as minus 1 second plus 250 million nanoseconds.

```java
Duration negative = Duration.ofSeconds(-1, 250_000_000);

System.out.println(negative);              // PT-0.75S
System.out.println(negative.getSeconds()); // -1
System.out.println(negative.getNano());    // 250000000
```

## Seconds Are Not Calendar Days

And this is really important. You need to be careful, because specifying an amount of time in seconds is not the same as specifying it between two dates, because of the daylight saving effect.

The Javadoc tells you that when you express a `Duration` in days, these days are exactly 24 hours. That is not always the case on a real calendar: the day the clocks move forward lasts 23 hours, and the day they move back lasts 25 hours. In Paris, the clocks moved forward on March 29, 2026.

```java
ZoneId paris = ZoneId.of("Europe/Paris");
ZonedDateTime saturdayNoon = ZonedDateTime.of(2026, 3, 28, 12, 0, 0, 0, paris);

System.out.println(Duration.ofDays(1).toHours()); // 24

// Duration: add exactly 24 hours of elapsed time
System.out.println(saturdayNoon.plus(Duration.ofDays(1)));
// 2026-03-29T13:00+02:00[Europe/Paris]

// Period: add one calendar day, keep the wall clock time
System.out.println(saturdayNoon.plus(Period.ofDays(1)));
// 2026-03-29T12:00+02:00[Europe/Paris]

// and that calendar day was only 23 hours long
System.out.println(Duration.between(saturdayNoon, saturdayNoon.plus(Period.ofDays(1))));
// PT23H
```

So if you mean "the same time tomorrow", use `Period`. If you mean "24 hours of elapsed time", use `Duration`. Leap seconds are another reason why a real UTC day may not be exactly 86,400 seconds. The Java time-scale smooths them away, so for `Duration` a day is always 24 hours, and it is up to you to decide whether that is what you want.

## Duration and Valhalla

One last word: the `Duration` class, like many other classes from the JDK, is documented as a value-based class. It will become a value class when Valhalla is there. Until then, do not rely on its identity: compare durations with `equals()` or `compareTo()`, never with `==`, and never synchronize on them.

```java
Duration a = Duration.ofSeconds(60);
Duration b = Duration.ofMinutes(1);

System.out.println(a == b);        // false today, do not rely on it
System.out.println(a.equals(b));   // true
System.out.println(a.compareTo(b)); // 0
```

## One Last Word

Valhalla, when? Well, sooner than you expect!

## References

- [Java Coding Tip #403: What Is Duration?](https://youtube.com/shorts/piTR9wKwDnQ) (video)
- [Duration (Java SE 25 API)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/time/Duration.html) (doc)
- [Period (Java SE 25 API)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/time/Period.html) (doc)
- [Value-based Classes (Java SE 25 API)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/doc-files/ValueBased.html) (doc)
- [JEP 401: Value Classes and Objects](https://openjdk.org/jeps/401) (doc)
