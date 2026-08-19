---
version: 1.0
updatedAt: 2026-08-19
---
## Objective

`Scanner` turns reading formatted, whitespace-or-pattern-delimited tokens — from `System.in`, a `String`, a `File`, or anything implementing `Readable` — into a small, uniform loop: ask `hasNextX()`, then call `nextX()`. It's the tool reached for constantly in scripts, coding exercises, and CLI tools, and it has exactly one trap that catches nearly everyone who uses it: mixing `nextInt()`/`nextDouble()` with `nextLine()` leaves an unconsumed newline sitting in the buffer, so the very next `nextLine()` reads an empty string instead of what the user actually typed next.

## Use Cases

- Reading interactive console input in a small tool or script, where `Scanner(System.in)` is genuinely the simplest correct option.
- Parsing a whitespace- or delimiter-separated data file or string — a CSV-like format, a log line, a config value — without writing a manual tokenizer.
- Reading mixed-type input (an int, then a double, then a word) in one pass, where each `hasNextX()` check tells you what to read next before you try to read it.
- Prototyping or exercises where reading structured input quickly matters more than the performance or precision a dedicated parser would give.

## Deep Dive

### Construction: one class, many sources

```java
Scanner console = new Scanner(System.in);              // keyboard
Scanner fromString = new Scanner("42 3.14 done");        // a String
Scanner fromFile = new Scanner(Paths.get("data.txt"));   // a file, via Path (JDK 10+)
```

Anything implementing `Readable` or `ReadableByteChannel` can back a `Scanner` — a `FileReader` resolves to the `Scanner(Readable)` constructor the same way `System.in` (an `InputStream`) resolves to `Scanner(InputStream)`.

### The core loop: hasNextX, then nextX

```java
Scanner sc = new Scanner(System.in);
int sum = 0;
while (sc.hasNextInt()) {
    sum += sc.nextInt();
}
```

`hasNextInt()` peeks at whether the *next token* parses as an `int` without consuming it; `nextInt()` consumes and returns it. Calling a `nextX()` without checking the matching `hasNextX()` first throws `InputMismatchException` if the token doesn't match, or `NoSuchElementException` if there's no token left — checking first is what makes the loop terminate cleanly instead of crashing on the first non-matching or missing token.

`nextDouble()` matches anything that can be read as a `double`, including a plain integer like `2` — so mixing types in the same read matters in a specific order: check the more specific type first. Reading a mixed `int`-then-`double` stream by calling `nextDouble()` before `nextInt()` silently reads *both* as doubles, because `nextDouble()`'s pattern matches an integer token too.

### The classic trap: `nextInt()` then `nextLine()`

```java
Scanner sc = new Scanner(System.in);
System.out.print("Age: ");
int age = sc.nextInt();          // consumes "30", leaves the trailing newline in the buffer
System.out.print("Name: ");
String name = sc.nextLine();     // consumes just that leftover newline — reads "" !
```

`nextInt()` (and every other `nextX()` except `nextLine()`) consumes only the token itself, not the newline that follows it. `nextLine()` reads up to and including the next newline — so immediately after a `nextInt()`, the "next line" it finds is the empty remainder of the line the number was on, not the line the user types afterward. The fix is an extra `sc.nextLine()` to explicitly discard that leftover newline before the real `nextLine()` call:

```java
int age = sc.nextInt();
sc.nextLine();                   // consume the leftover newline
String name = sc.nextLine();     // now reads the actual next line
```

This single gotcha accounts for a large share of "my program skips reading the name" bug reports — it isn't a bug in `Scanner`, it's a mismatch between what each method actually consumes.

### Delimiters: whitespace by default, a regex if you need one

```java
Scanner sc = new Scanner("10, 20,   30");
sc.useDelimiter(",\\s*");        // comma, then zero or more spaces
while (sc.hasNextInt()) {
    System.out.println(sc.nextInt());   // 10, 20, 30
}
```

`useDelimiter` takes a regular expression, not a literal character set — so a `Scanner` can tokenize on arbitrary patterns (`","`, `"\\s+"`, a fixed-width record boundary), not just the default whitespace run. `delimiter()` returns the currently active `Pattern`.

### `findInLine` and `findWithinHorizon`: searching without consuming everything up to the match

```java
Scanner sc = new Scanner("Name: Alice, Age: 28");
sc.findInLine("Age:");           // advances past "Age:" if found; returns the matched text or null
int age = sc.nextInt();          // 28
```

`findInLine` searches the next line for a pattern independent of the current delimiter set, consuming only the match itself — useful for pulling one labeled field out of semi-structured text without tokenizing the whole line first. `findWithinHorizon` is the same idea over a bounded (or, with `0`, unbounded) character window instead of one line.

### Closing: `Scanner` implements `AutoCloseable`

```java
try (Scanner sc = new Scanner(Paths.get("data.txt"))) {
    while (sc.hasNextLine()) {
        process(sc.nextLine());
    }
}   // sc.close() called automatically, which also closes the underlying file
```

Closing a `Scanner` closes the `Readable`/stream backing it (if that source implements `Closeable`) — a real reason to prefer try-with-resources here over remembering an explicit `close()` call, exactly the pattern covered in `io-streams-fundamentals`.

## Trade-offs

- **`Scanner(System.in)` should not be closed if you need `System.in` again afterward.** Closing a `Scanner` wrapping `System.in` closes the underlying stream too — a second `new Scanner(System.in)` later in the same program will find it already closed. This is a real reason some code deliberately skips try-with-resources specifically for the `System.in` case.
- **`Scanner` type-checks every token against the requested pattern, which costs real throughput** compared to a hand-written tokenizer or `BufferedReader.readLine()` plus manual `split()`/parsing — fine for interactive input or modest files, a genuine bottleneck on very large inputs read token-by-token in a hot loop.
- **The `nextInt()`-then-`nextLine()` newline trap is not a bug to patch around case by case — it's a consequence of what each method consumes**, and the fix generalizes: any time a non-`nextLine()` call is followed by a `nextLine()` call, assume a leftover newline needs an explicit discard first, rather than debugging it fresh each time it appears.
- **A missing or mismatched token throws, it doesn't return a null/sentinel value** — `NoSuchElementException` for exhausted input, `InputMismatchException` for a type mismatch — which is exactly why the `hasNextX()`-before-`nextX()` discipline matters; skipping it converts a normal "no more input" condition into an exception-driven control flow.

## Documentation Links

- [Scanner — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Scanner.html) — doc
- [Pattern — Java SE 25 API (used by `useDelimiter`)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/regex/Pattern.html) — doc
