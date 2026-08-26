---
version: 1.0
updatedAt: 2026-08-18
---
## Objective

Understand the text block (`"""`, JEP 378, finalized in Java 15): a multi-line string literal that removes the `\n`-at-every-line-break, `+`-at-every-line-end, escape-every-quote noise of building multi-line text with ordinary `"..."` literals. A text block is *source syntax only* — the compiler produces exactly a `String`, with the same type, the same methods, and the same interning as an equivalent regular literal.

## Use Cases

- Embedding a multi-line SQL query, JSON payload, or HTML/XML fragment directly in Java source, without a wall of concatenation and escapes.
- Writing a test's expected multi-line output (snapshot-style assertions) in a form that visually matches the thing it represents.
- Any literal that previously needed a `String.join("\n", ...)` call, a `StringBuilder`, or a helper method just to stay readable.

## Deep Dive

### The opening delimiter must end its line

A text block starts with three double quotes followed by *nothing but* optional trailing spaces and a line terminator. Content begins on the next line:

```java
String bad = """Hello, world""";   // error: illegal text block open delimiter sequence,
                                   //        missing line terminator
```

```java
String good = """
        Hello, world
        """;
```

The closing delimiter may sit on its own line, or at the end of the last content line. That choice decides whether the value ends with a newline:

```java
String withNewline = """
        one
        two
        """;        // "one\ntwo\n"

String noNewline = """
        one
        two""";     // "one\ntwo"  — no trailing \n
```

### Incidental whitespace: the closing delimiter is part of the input

This is the mechanic that surprises everyone. The compiler looks at every **non-blank content line** *and* **the line containing the closing delimiter**, takes the minimum leading-whitespace count across them, and strips exactly that many leading white space characters from every line.

```java
class Report {
    static String sql() {
        return """
                SELECT id, name
                  FROM users
                 WHERE active = true
                """;
    }
}
```

Content lines are indented 16, 18, and 17 columns; the closing `"""` sits at column 16. The minimum is 16, so 16 columns come off every line:

```text
SELECT id, name
  FROM users
 WHERE active = true
```

Now move only the closing delimiter four columns left — the content is untouched:

```java
        return """
                SELECT id, name
                  FROM users
                 WHERE active = true
            """;
```

The minimum is now 12, so only 12 columns are stripped and every line keeps four leading spaces:

```text
    SELECT id, name
      FROM users
     WHERE active = true
```

The delimiter's column is genuinely an *input* to the algorithm, not just a terminator. Note the asymmetry: pushing the closing `"""` further **right** than the least-indented content line changes nothing (the content minimum still wins), while pushing it **left** adds indentation to the value. Blank lines do not participate in the minimum — they are simply normalized to empty lines.

### Trailing whitespace is always stripped

Independent of the indentation algorithm, trailing white space is removed from the end of every line:

```java
String s = """
        alpha   
        beta
        """;      // "alpha\nbeta\n" — the three spaces after "alpha" are gone
```

This is deliberate (it makes invisible trailing spaces impossible to introduce by accident in a diff), but it does mean a text block is *not* a byte-for-byte copy of what you typed. To keep a trailing space, you need `\s` (below).

### Line terminators are normalized to `\n`

Whatever the source file uses — LF, CRLF, or CR — every line terminator inside a text block becomes a single `\n` in the resulting `String`. A file authored on Windows and one authored on Linux compile to the identical value:

```java
String twoLines = """
        first
        second
        """;
// twoLines.equals("first\nsecond\n") is true on every platform
assert !twoLines.contains("\r");
```

If you genuinely need CRLF in the value, write it explicitly with `\r\n` escapes.

### Quotes and escapes inside a text block

All the familiar escapes still work (`\n`, `\t`, `\\`, `\"`, unicode escapes). The difference is that a lone `"` needs no escaping at all, because only a run of three quotes is ambiguous:

```java
String quoted = """
        She said "yes" — a single quote pair needs no escape.
        Two in a row are fine as well: ""
        Three would close the block, so escape one of them: \"""
        """;
```

Any of `\"""`, `"\""`, or `""\"` works; only three-or-more consecutive quotes require an escape.

Escape processing happens **after** incidental whitespace stripping, which is why a `\n` written inside a text block never confuses the indentation algorithm — at stripping time it is still two characters, not a line break.

### The two escapes unique to text blocks: `\s` and line continuation

`\s` translates to a single space (U+0020). Because it is translated *after* trailing-whitespace stripping, it acts as a fence that protects everything to its left:

```java
String padded = """
        red  \s
        green\s
        blue
        """;
// "red   \ngreen \nblue\n"
//     ^^^ two typed spaces + the \s space survive
```

A backslash at the very end of a line suppresses that line's terminator, letting one logical line be wrapped across several physical source lines:

```java
String oneLine = """
        The quick brown fox \
        jumps over \
        the lazy dog.
        """;
// "The quick brown fox jumps over the lazy dog.\n"
```

The space before each `\` is preserved: the line no longer *ends* in whitespace, so there is nothing for the trailing-whitespace pass to strip. This line-continuation escape is not valid in an ordinary `"..."` literal — it exists only for text blocks.

### Still exactly a String

A text block is a string literal, so it is a compile-time constant expression whenever its content is fully known at compile time — usable as a `static final` constant, an annotation value, or a `switch` case label, and interned like any other literal:

```java
static final String GREETING = """
        hello""";

GREETING == "hello";   // true — constant expression, same interned instance
```

There is no interpolation, so variables go in through the normal `String` API:

```java
String body = """
        {"user": "%s", "id": %d}
        """.formatted(name, id);
```

Java 15 also exposed the algorithm at runtime: `String.stripIndent()` applies the same incidental-whitespace rules to an ordinary string, and `String.translateEscapes()` performs escape translation — handy when the text arrives from a file rather than from source.

## Trade-offs

- **The closing delimiter's column silently changes the value.** An auto-formatter, or a careless re-indent during review, can shift the closing `"""` and change the runtime string with no compiler warning — both versions are perfectly valid syntax. Golden-file tests and `assertEquals` on multi-line output are where this bites:

```java
String a = """
        x
        """;      // "x\n"
String b = """
        x
    """;          // "    x\n"  — same content, delimiter 4 columns left
```

- **No interpolation.** Unlike template literals in other languages, `${...}` and friends do not exist here; injecting a value still means `formatted()`, `String.format()`, or concatenation — and for SQL specifically, that means a text block does nothing to help you avoid injection, so parameter placeholders remain mandatory:

```java
String sql = """
        SELECT * FROM users WHERE id = ?
        """;   // still a PreparedStatement parameter, not string-built
```

- **Trailing whitespace cannot be typed, only escaped.** Any content whose meaning depends on trailing spaces (fixed-width record formats, some Markdown line breaks) needs an explicit `\s` on every affected line, which is easy to forget and invisible in the value until a test fails.

- **Zero runtime distinction.** A `String` carries no marker of having come from a text block, so nothing can detect "was this literal a text block" reflectively or at runtime — it is purely a source-ergonomics feature, and an API must never be designed around telling the two apart:

```java
"a\nb\n".equals("""
        a
        b
        """);   // true — indistinguishable
```

## Documentation Links

- [JEP 378: Text Blocks](https://openjdk.org/jeps/378) — doc
- [Text Blocks — Java SE developer guide](https://docs.oracle.com/en/java/javase/25/text-blocks/index.html) — doc
