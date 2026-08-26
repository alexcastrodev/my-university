---
version: 1.0
updatedAt: 2026-08-14
---
## Question

# What is the canonical constructor?

## Short Answer

A constructor — but the term only really means something in the context of records.

## What It Is

When you declare a record, you don't write its constructor. You just declare the record's components, and the compiler generates a constructor that takes exactly those components for you. That generated constructor — the one that takes all the components, in order — is what's called the **canonical constructor**.

## The Guarantee

Records are designed so that you cannot create a record instance without going through the canonical constructor. Even if you add other constructors to your record, each of them has to eventually delegate to the canonical constructor. Deserialization follows the same rule: it doesn't bypass it either.

That means if you put validation logic in the canonical constructor, you have a guarantee that this validation runs for **every** instance of the record — no exceptions, no back doors.

## Practical Example

```java
record Range(int min, int max) {

    // compact canonical constructor: validates before the fields are assigned
    Range {
        if (min > max) {
            throw new IllegalArgumentException("min must be <= max");
        }
    }

    // a secondary constructor still has to reach the canonical one
    Range(int max) {
        this(0, max); // delegates to Range(int, int)
    }
}

new Range(1, 5);   // fine
new Range(5, 1);   // throws IllegalArgumentException — validation always runs
new Range(10);     // delegates to the canonical constructor too
```

## Why Regular Classes Can't Do This

Think about it: a record is the only kind of class that offers this guarantee. For a regular class, deserialization does not call any constructor at all — the object is reconstructed directly from the stream. So there's no single chokepoint where you could put validation logic and be sure it always runs, the way there is with a record's canonical constructor.

## Solution and Conclusion

The canonical constructor is simply the constructor the compiler generates from a record's components. Because every way of creating a record instance — extra constructors, deserialization, all of it — is forced through it, it's the one guaranteed place to put invariant checks for that record.

## References

- [Java Coding Tip #386: What Is the Canonical Constructor?](https://youtube.com/shorts/V_dVhb8QZuA?is=TA5Nv32YeS1Ap6J0) — video
- [Java SE Language Documentation — Record Classes](https://docs.oracle.com/en/java/javase/25/language/records.html) — doc
- [Record — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Record.html) — doc
- [ObjectInputStream — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/io/ObjectInputStream.html) — doc
