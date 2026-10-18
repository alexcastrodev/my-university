---
version: 1.0
updatedAt: 2026-08-02
---
## Objective

`Pattern` and `Matcher` split regex work into two steps: `Pattern.compile()` turns a regex string into a reusable, pre-parsed pattern once, and `Pattern.matcher(input)` creates a `Matcher` that runs that pattern against a specific piece of text — as many times as needed, against as many inputs as needed, without recompiling the regex each time.

## Use Cases

- Validating that a string has a specific shape (an email-like format, a product code) before accepting it as input.
- Extracting substructure out of a larger string — the domain out of an email address, the year/month/day out of a date-like string — via capturing groups instead of manual index arithmetic.
- Scanning a large block of text for every occurrence of a pattern, one match at a time, with `find()` called repeatedly.
- Replacing every substring that matches a pattern with something else in one call, instead of a manual search-and-splice loop.

## Deep Dive

### Pattern and Matcher: compile once, match many

```java
Pattern pattern = Pattern.compile("Java");
Matcher matcher = pattern.matcher("Java SE");
if (matcher.find()) {
    System.out.println("subsequence found");
}
```

`Pattern` has no public constructor — `compile()` is the only way to get one, and the resulting object is safe to reuse against many different inputs. `Pattern.matcher(CharSequence)` creates a fresh `Matcher` bound to one specific input sequence.

### matches() vs. find() vs. lookingAt()

- `matches()` — the *entire* input sequence must match the pattern, start to end. `"Java".matches` against pattern `"Java"` succeeds; against `"Java SE"` it fails, even though `"Java"` appears at the start.
- `find()` — succeeds if *any* subsequence matches, anywhere in the input. Repeated calls continue searching from where the previous match ended, which is how you scan for every occurrence:
  ```java
  Matcher m = Pattern.compile("test").matcher("This is a test. Another test follows.");
  while (m.find()) {
      System.out.println("test found at index " + m.start());
  }
  ```
- `lookingAt()` — like `matches()`, but only requires the match to start at the beginning of the input; it doesn't have to consume the whole string.

### Capturing groups — numbered and named

Parentheses in a pattern create a capturing group; `group(n)` retrieves what group `n` matched (`group(0)`, or plain `group()`, is the whole match):

```java
Matcher m = Pattern.compile("(\\d{4})-(\\d{2})-(\\d{2})").matcher("Date: 2026-08-02");
if (m.find()) {
    String year = m.group(1);    // "2026"
    String month = m.group(2);   // "08"
}
```

Named groups (`(?<name>...)`) let you retrieve a captured value by name instead of by position — much more readable once a pattern has more than two or three groups:

```java
Matcher m = Pattern.compile("(?<year>\\d{4})-(?<month>\\d{2})-(?<day>\\d{2})").matcher("2026-08-02");
if (m.matches()) {
    System.out.println(m.group("year"));   // "2026"
}
```

### Greedy, reluctant, and possessive quantifiers

```java
Pattern.compile("e.+d").matcher("extend cup end").find();    // greedy: matches "extend cup end"
Pattern.compile("e.+?d").matcher("extend cup end");           // reluctant: matches "extend", then "end"
```

A plain quantifier (`+`, `*`, `{n,m}`) is *greedy* by default — it matches the longest possible sequence. Appending `?` makes it *reluctant* (shortest possible match); appending `+` makes it *possessive* (matches greedily and never backtracks, even if that means the overall match fails where a greedy quantifier would have succeeded). The distinction matters most whenever a wildcard (`.`) is followed by another quantified construct in the same pattern.

### Replacing and splitting

```java
"Jon Jonathan Frank".replaceAll("Jon.*? ", "Eric ");   // "Eric Eric Frank"

Pattern.compile("[ ,.!]+").split("one two, alpha9.12!done");
// ["one", "two", "alpha9", "12", "done"]
```

`Matcher.replaceAll()`/`String.replaceAll()` substitute every match; `Pattern.split()`/`String.split()` treat every match of the pattern as a delimiter and return the tokens between them, dropping the delimiters themselves.

### One-shot matching without a Pattern object

For a pattern used only once, `Pattern.matches(String, CharSequence)` and `String.matches(String)` skip the explicit `compile()`/`matcher()` steps:

```java
boolean ok = "2026-08-02".matches("\\d{4}-\\d{2}-\\d{2}");
```

Both recompile the regex internally on every call — fine for a one-off check, wasteful if the same pattern runs against many inputs in a loop.

## Trade-offs

- **Compiling the same pattern repeatedly (via `String.matches()` in a loop, say) throws away the one real performance advantage `Pattern`/`Matcher` offers** — compile once outside the loop, reuse the `Pattern` for every input.
  ```java
  Pattern p = Pattern.compile("\\d+");           // compiled once
  for (String s : inputs) if (p.matcher(s).matches()) { /* ... */ }
  ```
- **`matches()` requires the whole input to match; `find()` only requires a subsequence to.** Using `matches()` when you meant `find()` (or vice versa) is a common source of "why doesn't this match" bugs — always check which one the intent actually calls for.
- **Greedy quantifiers can silently grab more than intended when a wildcard spans across characters you didn't expect to be included** — `"e.+d"` matching all the way from the first `e` to the *last* `d` in the string is correct-by-specification, not a bug, but it surprises people expecting the shortest match.
- **`group(n)` and `start()`/`end()` throw `IllegalStateException` if called before a successful match** — always check the boolean return of `matches()`/`find()`/`lookingAt()` before calling any method that reads the match result.

## Lab

In this lab you get `LogLineParser` with the `Pattern` constants already declared and the methods left empty. Your job is to use them. The core idea is to feel the difference between `matches()` (the whole input must fit) and `find()` (looks for a subsequence and can be called in a loop to find every occurrence), to see named groups making extraction readable and to understand why a reluctant quantifier (`.*?`) makes the pattern stop at the first delimiter.

**The scenario**

Log lines in the format `yyyy-MM-dd LEVEL message`.

- `LOG_LINE`: a pattern with the named groups `date`, `level` and `message`.
- `QUOTED`: the pattern `"(.*?)"`, already reluctant, for quoted text.
- `LogEntry(date, level, message)`: a record representing a parsed line.
- `parse(line)`: reads one line and returns an `Optional<LogEntry>`.
- `findAllErrorMessages(log)`: scans a multi-line log and returns the messages at `ERROR` level.
- `extractFirstQuoted(text)`: returns the first quoted substring.

You do not need to write any regex: the focus is how to use `Matcher` with the ready-made patterns.

**What you will do, step by step**

1. **Parse one line (TODO-00).** Use `LOG_LINE.matcher(line)` and `matches()`. If it matches, build a `LogEntry` from `group("date")`, `group("level")` and `group("message")`. If not, return `Optional.empty()`. The tests include a line with no level and one with text before the date, which `matches()` must reject.
2. **Find every ERROR (TODO-01).** Use `LOG_LINE.matcher(log)` and `find()` in a loop, collecting the message of the occurrences whose level is `ERROR`.
3. **Extract the first quoted substring (TODO-02).** Use `QUOTED` with `find()` and return `group(1)`, or `""` if there are no quotes. With several quoted parts in the text, only the first one must come back.

**How you know you are done**

`mvn test` is all green. You should be able to explain what `extractFirstQuoted` would return if `QUOTED` were `"(.*)"` (greedy) and why `matches()` rejects a line that `find()` would accept.

**Optional challenges**

- **TODO-03:** implement `maskDigits()`, replacing every digit in the text with `#` using `String.replaceAll()`.

**Prerequisites:** basic Java syntax and basic regex syntax (character classes and quantifiers). The project uses Java 21 and Maven.

**How to run it:** clone the repository, go into `java-concepts/regular-expressions` and run `mvn test` (from the root: `mvn -pl java-concepts/regular-expressions test`). The methods start out throwing `UnsupportedOperationException("Not implemented yet.")` and the `TODO-NN` comments explain each step, so the red tests are your checklist.

## Documentation Links

- [Pattern — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/regex/Pattern.html) — doc
- [Matcher — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/regex/Matcher.html) — doc
