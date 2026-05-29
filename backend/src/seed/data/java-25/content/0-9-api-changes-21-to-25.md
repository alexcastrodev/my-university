---
version: 1.0
updatedAt: 2026-05-28
---
# API Changes between Java 21 and Java 25

> Reference catalogue of the standard-library deltas between Java 21 and Java 25. Grouped by package. For every entry: one-line description, Javadoc link, and a code example for the high-impact ones. Cross-linked to the dedicated bridge lessons where deeper coverage exists.

---

## How to Read This Lesson

The OCP 1Z0-831 exam treats API knowledge in two tiers:

| Tier | What you must do | Items |
|------|------------------|-------|
| **Code** | Read and write code against the API | `IO`, `Gatherers`, `ScopedValue`, module imports |
| **Recognise** | Spot the class name and know which package it lives in | `HexFormat`, sequenced collections, FFM API, `Unsafe` deprecations |

Skip the "Recognise" rows if you are short on time and come back to them last.

---

## java.lang

### New `IO` class (JEP 512)

A tiny convenience API for compact source files. Three static methods sitting on `java.lang.IO`, importable without any qualifier in compact sources.

| Method | Signature | Purpose |
|--------|-----------|---------|
| `println` | `static void println(Object)` | Print and newline to stdout |
| `print` | `static void print(Object)` | Print without newline |
| `readln` | `static String readln(String prompt)` | Read a line from stdin with optional prompt |

- Javadoc: <https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/IO.html>

```java
// Compact source file (no class declaration needed)
void main() {
    var name = IO.readln("Name? ");
    IO.println("Hello, " + name);
}
```

Deeper treatment: [[0-5-compact-source-files-instance-main-changes]], [[7-5-compact-source-files-and-multi-file-programs]], [[7-6-instance-main-methods]].

### `Character` emoji predicates

Added in Java 21 and refreshed in 25 to track the latest Unicode emoji database.

| Method | What it tests |
|--------|---------------|
| `isEmoji(int)` | Code point has the Emoji property |
| `isEmojiPresentation(int)` | Defaults to emoji presentation |
| `isEmojiModifier(int)` | Skin-tone or other modifier |
| `isEmojiModifierBase(int)` | Can carry a modifier |
| `isEmojiComponent(int)` | ZWJ, keycap, regional indicator |
| `isExtendedPictographic(int)` | Pictographic per UTS #51 |

- Javadoc: <https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Character.html>

```java
"Hello 👋"
    .codePoints()
    .filter(Character::isEmoji)
    .forEach(cp -> System.out.println(Integer.toHexString(cp)));
```

### `StringTemplate` removed

A common 21-era exam trap. `StringTemplate` and the `STR."..."` template processor were a **preview in Java 21 and 22**. JEP 459 (the preview) was **withdrawn** in Java 23 and the API was removed. Java 25 has **no** `StringTemplate` class.

If a question shows `STR."Hello \{name}"`, the correct answer is "this does not compile in Java 25". Do not confuse it with text blocks (`"""..."""`), which are unchanged and fully supported.

### `ScopedValue` (JEP 506 final)

Promoted from preview to final in Java 25. Immutable, dynamic-scope alternative to `ThreadLocal`. Friendlier to virtual threads.

- Javadoc: <https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ScopedValue.html>

```java
static final ScopedValue<String> USER = ScopedValue.newInstance();

ScopedValue.where(USER, "alice")
           .run(() -> System.out.println(USER.get()));
```

Deeper treatment: [[0-3-scoped-values-changes]], [[8-4-scoped-values]].

### `Runtime.Version` and other unchanged classes

`Runtime`, `Thread`, `String`, `StringBuilder`, `Math`, `Number`, `Boolean` — no behaviourally breaking changes 21 to 25. Virtual threads remain final since 21.

---

## java.util

No removals. A handful of additions and one important reminder.

### Sequenced collections — already in 21 but on the exam

| Interface | Added | Where |
|-----------|-------|-------|
| `SequencedCollection<E>` | 21 | `java.util` |
| `SequencedSet<E>` | 21 | `java.util` |
| `SequencedMap<K,V>` | 21 | `java.util` |

Methods you should recognise: `addFirst`, `addLast`, `getFirst`, `getLast`, `removeFirst`, `removeLast`, `reversed()`. For maps: `firstEntry`, `lastEntry`, `pollFirstEntry`, `pollLastEntry`, `sequencedKeySet()`, `sequencedValues()`, `sequencedEntrySet()`.

- Javadoc: <https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/SequencedCollection.html>

```java
SequencedSet<String> s = new LinkedHashSet<>(List.of("a", "b", "c"));
s.addFirst("z");
System.out.println(s.reversed()); // [c, b, a, z]
```

### `HashMap`, `Arrays`, `List`, `Set`

Unchanged between 21 and 25 in any exam-relevant way. `putIfAbsent`, `getOrDefault`, `computeIfAbsent`, `merge`, factory methods (`List.of`, `Map.of`, `Map.ofEntries`) all behave identically.

### `HexFormat` — recap

Already shipped in Java 17. Not new, but reappears in some 21-to-25 study guides because OCP 21 candidates may not have used it heavily.

- Javadoc: <https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/HexFormat.html>

```java
HexFormat hex = HexFormat.of().withPrefix("0x").withDelimiter(", ");
System.out.println(hex.formatHex(new byte[]{1, 15, (byte)255}));
// 0x01, 0x0f, 0xff
```

### `Random`, `RandomGenerator`

The pluggable PRNG family (`RandomGeneratorFactory`, `SplittableGenerator`, `JumpableGenerator`, `LeapableGenerator`) is unchanged since 17. Exam tip: `Random` still exists and still implements `RandomGenerator`; the modern way to obtain one is `RandomGenerator.getDefault()` or `RandomGeneratorFactory.of("L64X128MixRandom").create()`.

- Javadoc: <https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/random/RandomGenerator.html>

---

## java.util.stream

### `Stream.gather(Gatherer)` and `Gatherers` (JEP 485 final)

The headline stream change between 21 and 25. Adds a general-purpose **intermediate** operation for stateful many-to-many transformations.

- Javadoc (`Gatherer`): <https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Gatherer.html>
- Javadoc (`Gatherers`): <https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Gatherers.html>

```java
Stream.of(1, 2, 3, 4, 5, 6, 7)
      .gather(Gatherers.windowFixed(3))
      .forEach(System.out::println);
// [1, 2, 3]
// [4, 5, 6]
// [7]
```

Deeper treatment: [[0-2-stream-gatherers-changes]], [[6-5-stream-gatherers]].

### Everything else in `java.util.stream`

`Stream`, `IntStream`, `LongStream`, `DoubleStream`, `Collectors` — no breaking changes 21 to 25. `Stream.toList()` (added in 16) is still the idiomatic terminal collector.

---

## java.util.concurrent

### Virtual threads — recap

Final since Java 21. `Thread.ofVirtual()` builder, `Executors.newVirtualThreadPerTaskExecutor()` factory, `Thread.startVirtualThread(Runnable)` shortcut. Unchanged API surface.

### `Thread.ofVirtual()` builder

```java
Thread t = Thread.ofVirtual()
                 .name("worker-", 0)
                 .start(() -> System.out.println("hi"));
t.join();
```

### Virtual threads no longer pin on `synchronized` (JEP 491, Java 24)

A pure runtime fix — **no API change** — but exam-relevant context. In Java 21, entering a `synchronized` block on a virtual thread pinned it to its carrier (no other VT could run on that platform thread). From Java 24 onward, `synchronized` participates in the same yield-and-remount machinery as `ReentrantLock`. Pinning is now rare and limited to JNI critical regions.

- JEP: <https://openjdk.org/jeps/491>

This means: code that previously needed to be rewritten from `synchronized` to `ReentrantLock` to scale with virtual threads no longer needs to be.

### `StructuredTaskScope` — still preview as of 25

Sits in `java.util.concurrent`. Still a preview feature (JEP 505 in Java 25). You must enable `--enable-preview` to use it.

- Javadoc (preview): <https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/StructuredTaskScope.html>

Deeper treatment: [[0-8-preview-incubator-features]].

---

## java.lang (module system)

### Module Import Declarations (JEP 511)

A new import form at the top of a compilation unit.

```java
import module java.base;          // brings in every public type from java.base
import module java.sql;

void main() {
    var list = new ArrayList<String>();   // java.util.ArrayList
    var conn = DriverManager.getConnection("jdbc:h2:mem:");
}
```

- JEP: <https://openjdk.org/jeps/511>

Deeper treatment: [[0-4-module-import-declarations-changes]], [[7-3-module-import-declarations]].

---

## Deprecations and Removals (21 to 25)

### `sun.misc.Unsafe` memory-access methods deprecated for removal (JEP 471)

Java 23 deprecated for removal the memory-access methods (`allocateMemory`, `freeMemory`, `getInt`, `putInt`, etc.) on `sun.misc.Unsafe`. The replacement is the Foreign Function and Memory API in `java.lang.foreign` (final since Java 22, JEP 454).

| Old | New |
|-----|-----|
| `Unsafe.allocateMemory(n)` | `Arena.ofConfined().allocate(n)` |
| `Unsafe.getInt(addr)` | `MemorySegment.get(ValueLayout.JAVA_INT, offset)` |
| `Unsafe.putInt(addr, v)` | `MemorySegment.set(ValueLayout.JAVA_INT, offset, v)` |
| `Unsafe.freeMemory(addr)` | `arena.close()` |

- JEP: <https://openjdk.org/jeps/471>
- FFM API Javadoc: <https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/foreign/package-summary.html>

### `SecurityManager` — terminally deprecated

Deprecated for removal since Java 17. In Java 24 (JEP 486), `System.setSecurityManager` throws `UnsupportedOperationException` **by default**. To restore the old "throw `SecurityException` for disallowed actions" semantics you must launch with `-Djava.security.manager=allow`. No replacement is being shipped.

- JEP: <https://openjdk.org/jeps/486>

### `Thread.stop()`, `suspend()`, `resume()`

| Method | Status in 25 |
|--------|--------------|
| `Thread.stop()` | Removed (was terminally deprecated; final removal in Java 23) |
| `Thread.suspend()` | Removed |
| `Thread.resume()` | Removed |
| `Thread.stop(Throwable)` | Removed |
| `Thread.destroy()` | Removed |
| `Thread.countStackFrames()` | Removed |

If exam code calls any of them, the answer is **does not compile**.

### Finalization

`Object.finalize()`, `Reference.enqueue` semantics, `Runtime.runFinalizersOnExit` — `finalize()` is deprecated for removal. Use `Cleaner` or try-with-resources.

### Legacy locale data updates

CLDR data is refreshed each release. No API change, but some `Locale.getDisplayName(...)` and number-format outputs differ across versions. The exam will not test localised strings letter-for-letter.

---

## java.time

No major API additions between 21 and 25. The classes you already know — `LocalDate`, `LocalTime`, `LocalDateTime`, `ZonedDateTime`, `OffsetDateTime`, `Instant`, `Duration`, `Period`, `DateTimeFormatter` — are unchanged in shape.

`ZoneId` zone-database updates ship with each release (TZDB rolls forward). No code change required.

`DateTimeFormatter` patterns are unchanged. `ofPattern`, `ISO_LOCAL_DATE`, `ISO_INSTANT` and the rest behave identically.

- Package Javadoc: <https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/time/package-summary.html>

---

## java.lang.foreign — FFM API final

Final since Java 22 (JEP 454). The replacement for `sun.misc.Unsafe` and the JNI bypass for native interop.

Key types: `Arena`, `MemorySegment`, `MemoryLayout`, `ValueLayout`, `Linker`, `SymbolLookup`, `FunctionDescriptor`.

```java
try (Arena arena = Arena.ofConfined()) {
    MemorySegment seg = arena.allocate(ValueLayout.JAVA_INT, 1);
    seg.set(ValueLayout.JAVA_INT, 0, 42);
    System.out.println(seg.get(ValueLayout.JAVA_INT, 0)); // 42
}
```

- Package Javadoc: <https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/foreign/package-summary.html>

Exam relevance: recognise the package name, know it replaces `Unsafe`, do not memorise signatures.

---

## java.lang.classfile — Class-File API (preview)

Still preview in 25 (JEP 466). A first-party API for reading and writing class files, replacing third-party libraries like ASM for many use-cases.

```java
// Requires --enable-preview
ClassFile.of().parse(Path.of("Foo.class"))
              .methods()
              .forEach(m -> System.out.println(m.methodName()));
```

Deeper treatment: [[0-8-preview-incubator-features]].

---

## Quick Lookup Table — what changed, since when, where

| Item | Package | Since | Link |
|------|---------|-------|------|
| `IO.println` / `print` / `readln` | `java.lang` | 25 | <https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/IO.html> |
| `Character.isEmoji` family | `java.lang` | 21 | <https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Character.html> |
| `ScopedValue` final | `java.lang` | 25 | <https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ScopedValue.html> |
| `Stream.gather` / `Gatherers` | `java.util.stream` | 25 | <https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Gatherers.html> |
| Sequenced collections | `java.util` | 21 | <https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/SequencedCollection.html> |
| FFM API | `java.lang.foreign` | 22 | <https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/foreign/package-summary.html> |
| Module import declaration | language feature | 25 | <https://openjdk.org/jeps/511> |
| `Unsafe` memory-access deprecation | `sun.misc` | 23 | <https://openjdk.org/jeps/471> |
| `SecurityManager` disabled by default | `java.lang` | 24 | <https://openjdk.org/jeps/486> |
| `Thread.stop/suspend/resume` removed | `java.lang` | 23 | n/a |
| `StringTemplate` withdrawn | n/a | gone in 23 | <https://openjdk.org/jeps/459> |
| `StructuredTaskScope` (preview) | `java.util.concurrent` | preview in 25 | <https://openjdk.org/jeps/505> |

---

## Key Takeaway

The standard library between 21 and 25 grew in two small, focused places (`IO`, `Gatherers`, `ScopedValue` final) and shrank in one (`Unsafe` memory access, `SecurityManager`, `Thread.stop` family). The biggest trap is **`StringTemplate`** — if a question shows `STR."..."`, the right answer is **does not compile in Java 25**.

See also [[0-11-cheat-sheet-21-to-25]] for the one-page reference.
