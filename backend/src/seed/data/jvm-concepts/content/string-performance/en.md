---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

Understand three JVM-level `String` optimizations that matter at scale: compact strings (how much heap a string actually costs), string deduplication (removing redundant copies after the fact), and how the compiler turns `+` concatenation into something faster than it looks.

## Use Cases

- Explaining a real drop in GC pauses after a JDK upgrade without any code change (compact strings).
- Deciding whether `-XX:+UseStringDeduplication` is worth testing on a service that holds a lot of near-duplicate strings in long-lived caches.
- Knowing that a `+`-concatenated string in a hot loop isn't automatically a performance problem — but a naive hand-rolled `StringBuilder` chain can be *slower* than just writing `+`.

## Deep Dive

### Compact strings: most Java strings don't need 16 bits per character

Every `String` used to be stored as a `char[]` — 16 bits per character, even for plain ASCII text that only needs 8. Since Java 9, strings are stored as a `byte[]` with a coding flag, using 8 bits per character unless the content actually requires 16-bit characters (`Latin-1` vs `UTF-16` internally) — this is what "compact strings" means. Since `String` objects routinely account for something like half of a typical Java heap, this roughly halves the memory cost of an average string, which in turn means less garbage collection work for the same live data. It's controlled by `-XX:+CompactStrings`, on by default — there's essentially never a reason to turn it off unless literally every string in the application requires 16-bit encoding.

### String deduplication: letting G1 merge identical copies after the fact

Compact strings shrink each string; deduplication instead removes *redundant* strings — many long-lived objects end up holding separate `String` instances with identical content (`"Name"` appearing 300,000 times across parsed records, say). With `-XX:+UseStringDeduplication` (off by default, and originally G1-only), a background thread finds strings with equal content during GC and repoints their internal byte array at one shared copy, freeing the rest:

```
[gc,stringdedup]  Inspected: 62420  Hashed: 62420 (100.0%)  New: 62420 (100.0%)
[gc,stringdedup]  Deduplicated: 15604 (25.0%)   731.4K (22.2%)
```

It's opt-in rather than default because it costs something to get that benefit: extra work during GC phases, an extra background thread competing for CPU, and — if an application doesn't actually have many duplicate strings — the bookkeeping itself can make memory usage *worse*, not better. Test it before flipping it on in production; expected gains are commonly cited around 10%, not a guaranteed win.

### Concatenation: the compiler already optimizes `+`

```java
String answer = integerPart + "." + mantissa;
```

This never actually runs one wasteful intermediate string per `+`. `javac` rewrites simple concatenation into something efficient automatically — the exact strategy has changed between JDK releases (see Trade-offs), but the point that matters day to day is the same across all of them: **hand-rolling your own `StringBuilder` chain to "help" doesn't help**. In the book's own benchmark, `prefix + strings[0]` consistently beat a manually written `new StringBuilder().append(prefix).append(strings[0]).toString()` — the compiler's own optimization already accounts for the common cases better than typing it out by hand does.

## Trade-offs

- **String deduplication is a real trade-off, not a free win** — extra GC-phase work, an extra background thread, and possibly *more* memory overhead if there simply aren't many duplicates to remove; this is a "measure it on your actual workload" flag, not a default-on one.
- **Compact strings have one narrow downside** — operations on strings that genuinely require 16-bit encoding throughout can be marginally slower under compact strings than they were before, since there's a coding check involved; irrelevant for the vast majority of programs, whose strings are overwhelmingly Latin-1-compatible.
- **Book vs today**: the book contrasts Java 8's `char[]`-only strings against Java 11's compact strings and separately contrasts Java 8 vs. Java 11 string-concatenation bytecode strategies (`StringBuilder`-based in 8, an `invokedynamic` call to `StringConcatFactory` since Java 9 via [JEP 280](https://openjdk.org/jeps/280)) as a recent, evolving change. On current JDKs, both are long-settled: compact strings and `invokedynamic`-based concatenation have been the stable default mechanism since Java 9, not something still shifting release to release — the "book vs today" nuance here is mostly that what the book frames as a JDK 8→11 transition in progress is now simply how every supported JDK has always worked for anyone starting fresh today.

## Documentation Links

- Scott Oaks, *Java Performance: The Definitive Guide*, 2nd Edition (O'Reilly, 2020) — Chapter 12 "Java SE API Tips", "Strings", pp. 363-374 — book
- [JEP 254: Compact Strings](https://openjdk.org/jeps/254) — doc
- [JEP 280: Indify String Concatenation](https://openjdk.org/jeps/280) — doc
