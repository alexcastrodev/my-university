---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

C# has four ways to write the same string: a regular literal with escape
sequences, a verbatim literal (`@"..."`), a raw string literal (`"""..."""`,
C# 11) and a UTF-8 literal (`"..."u8`). Each one answers a different pain:
escaping backslashes, embedding quotes, writing multi-line JSON or SQL without
noise, and producing bytes without an encoding call. Interpolation (`$`) can be
combined with the first three. This concept explains the rules of each form as
the compiler enforces them: how raw literals remove indentation, how `$$` counts
braces, what a `u8` literal really is, and where interpolation is allowed in
constants.

## Use Cases

- Embedding a JSON, SQL or HTML snippet in code or in a test without escaping
  every quote.
- Writing Windows paths and regular expressions without doubled backslashes.
- Producing a JSON template that contains literal braces and a few placeholders.
- Passing a constant byte sequence to an API that wants `ReadOnlySpan<byte>`
  (a protocol header, a magic number) without allocating.

## Deep Dive

### Regular literals and escape sequences

A regular literal uses a backslash to start an escape sequence. The usual ones
are `\n`, `\t`, `\"`, `\\` and `\0`, plus the Unicode forms `\uXXXX`,
`\UXXXXXXXX` (needed for characters outside the BMP such as an emoji) and the
variable-length `\x`. C# 13 added `\e` for the ESC character (U+001B), useful for
ANSI terminal colors.

```csharp
Console.WriteLine("tab[\t] quote[\"] backslash[\\] unicode[\u00e9 \U0001F600]");
// tab[	] quote["] backslash[\] unicode[é 😀]
Console.WriteLine((int)'\e');   // 27 (C# 13 or later)
```

On a project whose default language is C# 12 (a `net8.0` target), `\e` fails
with `CS9202: Feature 'string escape character' is not available in C# 12.0`.
Avoid `\x` followed by hex digits in strings: it takes up to four hex digits,
so `"\x41BC"` is a single character, not `A` followed by `BC`. Prefer `\u` with
exactly four digits.

### Verbatim literals

Prefix with `@` and the compiler stops processing escapes: a backslash is a
backslash, and the string can span lines. The only special sequence left is a
doubled quote `""` for a literal quote.

```csharp
string path = @"C:\temp\new";             // C:\temp\new
string q = @"He said ""hi""";             // He said "hi"
string multi = @"line1
  line2";                                 // the line break and the 2 spaces are kept
```

Whitespace is part of the value, so verbatim multi-line strings force you to
break your code's indentation. With interpolation, both `$@"..."` and `@$"..."`
are accepted, and in an interpolated verbatim string `{{` and `}}` are the
escapes for literal braces.

### Raw string literals (C# 11)

A raw literal starts and ends with at least three double quotes. Nothing inside
is an escape sequence, `\n` stays as the two characters, and quotes need no
escaping. Four rules are worth knowing, and each one is a real compiler error:

1. A multi-line raw literal must have the opening quotes followed by a newline
   and the closing quotes alone on their own line (`CS9000` otherwise).
2. The whitespace before the closing quotes is removed from every content line.
   A content line that does not start with that same whitespace is an error
   (`CS8999`), and mixing tabs and spaces between the closing line and a content
   line is also an error (`CS9003`).
3. The first newline after the opening quotes and the last newline before the
   closing quotes are not part of the value.
4. If the content contains a run of quotes, open and close with a longer run.

```csharp
string json = """
    {
      "name": "Ana",
      "quote": "say "hi" now"
    }
    """;
// the 4 spaces before the closing """ are removed:
// {
//   "name": "Ana",
//   "quote": "say "hi" now"
// }

string hasTriple = """"
    contains """ three quotes
    """";                       // contains """ three quotes

string deeper = """
        keep 4 extra
    base
    """;                        // "....keep.4.extra" then "base" (dots are spaces)
```

The closing line sets the baseline: a content line indented deeper than the
closing `"""` keeps the extra spaces in the value, which is how you keep a
deliberate indent. A single-line
raw literal such as `"""a "quoted" word"""` needs no newline rules. Backslashes
are not special: `"""C:\temp"""` is exactly `C:\temp`.

### Interpolated raw literals and the dollar count

In `$"""..."""` a single brace pair is a hole, as in a normal interpolated
string, so literal braces are the problem for JSON. The fix is to add more `$`
signs: with `$$`, a hole is written `{{expr}}` and a single `{` is plain text; with
`$$$` the hole is `{{{expr}}}`, and so on. A run of braces longer than the hole
delimiter is an error (`CS9006`, "does not start with enough '$' characters").

```csharp
string name = "Ana"; int id = 7;
string b = $$"""
    { "name": "{{name}}", "id": {{id}}, "tpl": "{x}" }
    """;
// { "name": "Ana", "id": 7, "tpl": "{x}" }
```

Choose the dollar count so the braces of your content are shorter than the hole
delimiter.

### UTF-8 literals (C# 11)

A `"..."u8` literal is not a `string`. It is a `ReadOnlySpan<byte>` over bytes
stored in the assembly's data section, already UTF-8 encoded, so there is no
encoding call and no allocation.

```csharp
ReadOnlySpan<byte> bytes = "héllo"u8;
Console.WriteLine(bytes.Length);                 // 6 (the é takes 2 bytes)
Console.WriteLine(Convert.ToHexString(bytes));   // 68C3A96C6C6F
byte[] arr = "abc"u8.ToArray();                  // 3, allocates only here
var x = "abc"u8;                                 // x is ReadOnlySpan<byte>
```

Because it is a span, the usual span limits apply: `class C { ReadOnlySpan<byte> F = "a"u8; }`
fails with `CS8345` (a span cannot be a field of a normal class). Use a
`static ReadOnlySpan<byte> Header => "a"u8;` property instead, which is also
how libraries expose constant byte tables without allocating. The suffix works on
regular, verbatim and raw literals, but not on interpolated ones.

### Line breaks in holes, constants, and line endings

Since C# 11 a hole may contain line breaks, so a long expression can be
formatted over several lines. This is only syntax: the result is the same as
writing it on one line.

```csharp
Console.WriteLine($"sum = {
    a +
    b
}");                       // sum = 7
```

Since C# 10 an interpolated string can be a `const` when every hole is itself a
constant string: `const string Full = $"{Name}-v1";` compiles, while a hole with a
`const int` does not (`CS0133`). Finally, line breaks inside verbatim and raw
literals are taken from the source file. In an experiment with the same code,
a file with LF endings gave strings without `\r`, and after converting the file
to CRLF both the verbatim and the raw literal contained `\r`. If the exact bytes
matter (hashes, snapshots), normalize with `.ReplaceLineEndings()`.

## Trade-offs

- **Verbatim literals break your indentation.** Every space on a continuation
  line becomes part of the string, so multi-line verbatim text is usually
  left-aligned in the source. A raw literal fixes that, at the cost of requiring
  C# 11.
- **Raw literals hide the baseline in one line.** The meaning of every content
  line depends on the closing `"""`. A copy and paste that changes the closing
  line's whitespace either fails to compile or silently shifts the indent.
  ```csharp
  string s = """
      a
    b      // CS8999: line does not start with the closing line's whitespace
      """;
  ```
- **`$$` shifts the problem instead of removing it.** A template with a mix of
  `{` content and holes needs the right dollar count, and a later edit that adds
  a `{{` run to the content can break compilation (`CS9006`). Keep templates
  small or move them to a file.
- **`u8` is fast but restricted.** The span cannot be stored in a field, captured
  by a lambda or used across `await`. Use a `static ReadOnlySpan<byte>` property,
  or call `.ToArray()` once into a `static readonly byte[]` when you need to
  keep it.
- **Escapes are the most portable form.** A regular literal with `\n` works in
  every language version, while `\e`, raw literals and `u8` need C# 13, 11 and
  11. In a library that multi-targets old compilers, check the language
  version first.

## Documentation Links

- [Strings, C# programming guide, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/strings/) (doc)
- [Built-in reference types: string literals, raw string literals and UTF-8 literals, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/reference-types) (doc)
- [Raw string literals, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/tokens/raw-string) (doc)
- [String interpolation using $, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/tokens/interpolated) (doc)
- [What's new in C# 11, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-11) (doc)
- [What's new in C# 13, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-13) (doc)
