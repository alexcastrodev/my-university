---
version: 1.0
updatedAt: 2026-07-21
---
## Question

# How can you get the number of characters in a String?

## Short Answer

It's harder than it looks. The answer depends on what you call a "character" — the `length()` method returns the number of **Unicode code units**, which isn't always the same as the number of characters you actually see on screen.

## What It Is

The `length()` method on `String` returns the number of Unicode code units in the string. A code unit is a 16-bit value — the type used internally to store `char` values in Java.

For most everyday text, one code unit maps to exactly one visible character, so `length()` behaves the way you'd expect.

## The Surrogate Pair Problem

Some Unicode characters — like many emoji and characters from certain historical or symbolic scripts — don't fit in a single 16-bit code unit. They need **two or more code units** to be represented, a pair known as a **surrogate pair**.

When that happens, `length()` no longer matches the number of characters visually displayed on the screen: it counts code units, not "characters" in the everyday sense.

## Code Unit vs Code Point

Two concepts are essential here:

- **Code unit**: corresponds to the `char` type in Java. It's a 16-bit piece of a character's encoding, and it's what `length()` actually counts.
- **Code point**: corresponds to the `int` type in Java. It represents the real, complete character — though not every `int` value is a valid code point.

A code point may be made up of one or two code units, depending on the character.

## Practical Example

```java
String text = "a😀b"; // "a" + 😀 (grinning face emoji) + "b"

System.out.println(text.length());        // 4 — counts code units
System.out.println(text.codePointCount(0, text.length())); // 3 — counts code points
```

The emoji 😀 is encoded as a surrogate pair, so it consumes two code units — but it's still just one visible character.

## Solution and Conclusion

If you need the true number of characters as perceived by a user, don't rely on `length()` alone. Use `codePointCount()` to count Unicode code points instead, and prefer code-point-aware iteration (such as `codePoints()`) when processing strings that may contain characters outside the basic 16-bit range.

## References

- [Java Coding Tip #378: String Length](https://www.youtube.com/shorts/7al_ZQn99CY) — video
- [String.length() — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/String.html#length()) — doc
- [Character — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Character.html) — doc
