---
version: 1.0
updatedAt: 2026-05-26
---
# Text Blocks

> **JEP 378** — finalized in Java 15. A text block is a multi-line string literal that avoids the need for most escape sequences and gives the string a predictable format.

---

## Basic Syntax

A text block begins with `"""` followed by a line terminator, then the content, then a closing `"""`. It can be used anywhere a regular string literal can.

```java
// Regular string literal
String name = "Pat Q. Smith";

// Text block — equivalent
String name = """
              Pat Q. Smith""";

name.equals("Pat Q. Smith") // true
```

Multi-line content:

```java
String message = """
    'The time has come,' the Walrus said,
    'To talk of many things:
    Of shoes -- and ships -- and sealing-wax --
    Of cabbages -- and kings --
    And why the sea is boiling hot --
    And whether pigs have wings.'
    """;
```

Equivalent without text blocks:

```java
String message = "'The time has come,' the Walrus said,\n" +
                 "'To talk of many things:\n" +
                 "Of shoes -- and ships -- and sealing-wax --\n" +
                 "Of cabbages -- and kings --\n" +
                 "And why the sea is boiling hot --\n" +
                 "And whether pigs have wings.'\n";
```

---

## Syntax Rules

- Must begin with `"""` followed immediately by a line terminator — content cannot start on the same line as the opening `"""`
- Cannot be written on a single line

```java
// INVALID
String s = """red""";
String s = """red
           green""";

// VALID
String s = """
    red
    green
    blue
    """;
```

Embedded double quotes do not need escaping:

```java
String source = """
    String msg = "Hello, World!";
    System.out.println(msg);
    """;
```

---

## Final Newline

By default the text block includes a trailing newline (the line before the closing `"""`):

```java
String s = """
    red
    green
    blue
    """;
// Equivalent to: "red\ngreen\nblue\n"
```

To exclude the final newline, place the closing `"""` on the last content line:

```java
String s = """
    red
    green
    blue""";
// Equivalent to: "red\ngreen\nblue"
```

Or use the `\` line continuation escape:

```java
String s = """
    red
    green
    blue\
    """;
// Equivalent to: "red\ngreen\nblue"
```

---

## Incidental Whitespace

The compiler strips **incidental** whitespace — the leftmost non-whitespace character determines the left margin. Relative indentation is preserved.

```java
void writeHTML() {
    String html = """
                  <html>
                      <body>
                          <p>Hello World.</p>
                      </body>
                  </html>
                  """;
}
// Result: "<html>\n    <body>\n        <p>Hello World.</p>\n    </body>\n</html>\n"
```

To preserve all leading whitespace, position the closing `"""` at column 0:

```java
String html = """
              <html>
              </html>
""";
// Indentation is preserved as-is
```

---

## Trailing Whitespace

Trailing whitespace on each line is stripped automatically. To preserve it:

```java
// Using \s as a fence (translates to a space)
String colors = """
    red  \s
    green\s
    blue \s
    """;
// Each line is exactly 6 characters

// Using character substitution
String r = """
    trailing$$$
    white space
    """.replace('$', ' ');
```

---

## Line Terminator Normalization

All line terminators (`\n`, `\r`, `\r\n`) are normalized to `\n` by the compiler.

To get platform-specific line endings:

```java
String s = textBlock.replaceAll("\n", System.lineSeparator());
```

---

## Escape Sequences

Text blocks support the same escapes as string literals, plus two new ones:

| Escape | Meaning |
|--------|---------|
| `\<line-terminator>` | Suppress newline (line continuation) |
| `\s` | Space character (ASCII 32) |

Escaping runs of three or more quotes:

```java
String code = """
    String source = \"""
        String message = "Hello!";
        \""";
    """;
```

---

## Related String Methods

| Method | Description |
|--------|-------------|
| `formatted(Object... args)` | Equivalent to `String.format(this, args)` — can chain off a text block |
| `stripIndent()` | Removes incidental whitespace using the same algorithm as the compiler |
| `translateEscapes()` | Translates escape sequences (`\n`, `\t`, `\s`, etc.) |

```java
String output = """
    Name: %s
    Phone: %s
    """.formatted(name, phone);
```

---

## Style Guidelines

- Use text blocks for multi-line strings; use regular literals for single-line strings
- Indent content relative to the closing `"""`, not to the opening
- Use only spaces **or** only tabs — never mix (mixing causes inconsistent indentation)
- Use `\` to suppress the final newline when needed
- Use `\s` to preserve trailing spaces

---

## References

- [Oracle Docs — Text Blocks (Java 25)](https://docs.oracle.com/en/java/javase/25/language/text-blocks.html)
- [JEP 378: Text Blocks](https://openjdk.org/jeps/378)
