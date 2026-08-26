---
version: 1.0
updatedAt: 2026-08-21
---
## Question

# How can you format a string of characters?

## Short Answer

There is a method for that.

## Less Short Answer

There are actually several solutions given to you by the JDK, but the simplest one is probably the `format` factory method of the `String` class. It takes a format as its first argument, followed by the objects you want to pass to that format so they get rendered into the final string.

```java
String message = String.format("%s scored %d points", "Ana", 92);
// message = "Ana scored 92 points"
```

## Inspired by C's `printf`

This format syntax is inspired by the (in)famous format used by C's `printf` function — the one everybody knows, or has at least run into. It is fully described in the Javadoc of the `Formatter` class, which is the engine behind `String.format`, `PrintStream.printf`, and `PrintWriter.printf`.

There are, however, differences between C's `printf` and Java's `Formatter`:

- **Errors are not handled the same way.** C's `printf` trusts the format string and reads memory according to it, regardless of what was actually passed — a mismatch can silently corrupt output or crash. Java's `Formatter` type-checks each argument against its specifier and throws `IllegalFormatConversionException` on a mismatch instead.
- **Some customization has been made** on top of the original C syntax — for instance the `n$` argument index and the `%n` platform-independent line separator have no equivalent in C's `printf`.

## Practical Example

```java
System.out.printf("%-10s | %5.2f%n", "Total", 42.5);   // writes straight to System.out
String s = String.format("%-10s | %5.2f", "Total", 42.5); // same rendering, returned as a String
```

## One Last Word: Thread Safety

Formatting strings might tempt you to share a `Formatter` instance to save some resources — but be careful: a `Formatter` carries mutable internal state (its output buffer), so sharing one across threads is not safe. `String.format` and `printf` never run into this because each call creates its own private `Formatter` internally.

## References

- [Java Coding Tip #388: How Can You Format a String of Characters?](https://youtube.com/shorts/DUX5bEvepbo?is=vDI15IXtwHnAcxGv) — video
- [String.format — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/String.html#format(java.lang.String,java.lang.Object...)) — doc
- [Formatter — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Formatter.html) — doc
