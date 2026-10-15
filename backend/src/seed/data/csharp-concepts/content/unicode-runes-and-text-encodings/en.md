---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

A .NET `string` is a sequence of UTF-16 code units, files and networks speak
bytes, and what a person calls "one character" can be several code points. Most
text bugs live in the gaps between those three levels: a `Length` that does not
match what is on screen, an emoji split in half, a file that shows `Ã©` instead of
`é`, a token that breaks inside a URL. This concept names the levels (`char`,
`Rune`, grapheme cluster), shows how encodings turn text into bytes and what
happens to invalid data, covers the BOM, and ends with the binary-to-text
encodings you meet every day: Base64, Base64Url and hex.

## Use Cases

- Truncating, padding or splitting user text without cutting an emoji or an
  accented letter in half.
- Reading and writing files and HTTP bodies with the right encoding, and knowing
  when a BOM is added.
- Validating untrusted bytes as UTF-8 before treating them as text.
- Putting binary data (a token, a hash, an id) into a URL, a header or a log.

## Deep Dive

### Three levels: char, Rune, grapheme

`string.Length` counts UTF-16 code units. Code points above `U+FFFF` need two of
them, a surrogate pair. A `Rune` is one Unicode scalar value (any code point that
is not a surrogate), and it is what you want when you iterate "characters" in the
code-point sense:

```csharp
string s = "a\u00E9\U0001F600";   // a, e-acute, grinning face
Console.WriteLine($"Length={s.Length} UTF8={Encoding.UTF8.GetByteCount(s)} UTF16={Encoding.Unicode.GetByteCount(s)} UTF32={Encoding.UTF32.GetByteCount(s)}");
// Length=4 UTF8=7 UTF16=8 UTF32=12
Console.WriteLine(char.IsHighSurrogate(s[2]) + " " + char.IsLowSurrogate(s[3]));   // True True
foreach (var r in s.EnumerateRunes())
    Console.WriteLine($"U+{r.Value:X4} utf8={r.Utf8SequenceLength} utf16={r.Utf16SequenceLength}");
// U+0061 utf8=1 utf16=1
// U+00E9 utf8=2 utf16=1
// U+1F600 utf8=4 utf16=2
new Rune(0xD800);   // ArgumentOutOfRangeException: a lone surrogate is not a scalar value
```

The same three characters take 7 bytes in UTF-8, 8 in UTF-16 and 12 in UTF-32.
The `Rune` constructors validate their input, so a `Rune` is always a well-formed
scalar and is safe to pass to APIs such as `Rune.IsLetter` or
`Rune.ToUpperInvariant`. Calling `char.ToUpperInvariant` on each half of a
surrogate pair separately cannot work, because each half alone carries no letter
information.

A `string` is usually well-formed UTF-16, but it is not guaranteed: `"x\uD83Dy"`
(a lone high surrogate) or a `Substring` that cuts a pair in two compiles and runs
fine. Encoding it shows what the runtime does with it, and the next section
returns to that.

Runes still are not what a reader sees as one symbol. That is a grapheme
cluster, which .NET calls a text element, and `StringInfo` enumerates them:

```csharp
string accent = "e\u0301";                                // e + combining acute
string flag = "\U0001F1F5\U0001F1F9";                      // two regional indicators
string family = "\U0001F468\u200D\U0001F469\u200D\U0001F467"; // ZWJ family emoji
foreach (var t in new[] { accent, flag, family })
    Console.WriteLine($"Length={t.Length} runes={t.EnumerateRunes().Count()} graphemes={new StringInfo(t).LengthInTextElements}");
// Length=2 runes=2 graphemes=1
// Length=4 runes=2 graphemes=1
// Length=8 runes=5 graphemes=1
Console.WriteLine(accent == "\u00E9");               // False: two code points versus one
Console.WriteLine(accent.Normalize() == "\u00E9");   // True: composed to FormC
```

Use `StringInfo` when the unit that matters is "what the user sees": cursor
movement, a "first 10 characters" preview, a visible length limit. The Microsoft
docs note that `StringInfo` had a bug before .NET 5, which is one reason to avoid
hand-rolled grapheme logic. For comparing text that looks the same, normalize
first (`Normalize`, `NormalizationForm`); the earlier strings concept covers when
a culture-aware comparison does this for you.

### Encodings, invalid bytes and the BOM

`Encoding.UTF8` is the right default for files, HTTP and APIs, and it is what
.NET uses for most text I/O. Decoding with the wrong encoding does not throw, it
produces garbage, and encoding unrepresentable text substitutes silently:

```csharp
byte[] u8 = Encoding.UTF8.GetBytes("caf\u00E9");
Console.WriteLine(Encoding.Latin1.GetString(u8));      // cafÃ©    (the classic mojibake)
Console.WriteLine(Encoding.ASCII.GetString(u8));       // caf??
Console.WriteLine(Encoding.ASCII.GetBytes("caf\u00E9")[3]);   // 63, the '?' substitute

string broken = "x\uD83Dy";
Console.WriteLine(Convert.ToHexString(Encoding.UTF8.GetBytes(broken)));   // 78EFBFBD79
new UTF8Encoding(false, throwOnInvalidBytes: true).GetBytes(broken);       // EncoderFallbackException
```

`EF BF BD` is `U+FFFD`, the replacement character. Per the docs, the built-in
encodings replace ill-formed input by default and can be configured to throw
instead, which is the setting for security-sensitive code where silently
changing data is not acceptable. The same docs warn that bytes from the wire may
be ill-formed UTF-8 on purpose, so validate them (decode with a throwing
encoding, or call `System.Text.Unicode.Utf8.IsValid` on a span) before trusting
them.

A BOM (byte order mark, `EF BB BF` in UTF-8) is a few bytes at the start of a
file that announce its encoding. It signals byte order for UTF-16 and is optional, often
unwanted, for UTF-8. In .NET the `Encoding.UTF8` singleton has a 3-byte preamble
that file APIs write, while `new UTF8Encoding(false)` has none:

```csharp
Console.WriteLine(Convert.ToHexString(new UTF8Encoding(true).GetPreamble()));   // EFBBBF
File.WriteAllText(path, "hi");                          // 2 bytes
File.WriteAllText(path, "hi", Encoding.UTF8);           // 5 bytes: BOM added
File.WriteAllText(path, "hi", Encoding.Unicode);        // FFFE68006900: UTF-16 LE with BOM
File.ReadAllText(path);                                 // "hi": the reader detects the BOM
```

Readers such as `File.ReadAllText` and `StreamReader` detect a BOM and switch
encoding, which is why a UTF-16 file reads back correctly without you saying so.
To write UTF-8 explicitly without a BOM, use `new UTF8Encoding(false)`, whose
`GetPreamble()` is empty (we checked its length: 0).

Legacy code pages such as Windows-1252 are not available by default on modern
.NET. `Encoding.GetEncoding(1252)` throws `NotSupportedException` until you call
`Encoding.RegisterProvider(CodePagesEncodingProvider.Instance)`, after which it
works. `Encoding.Latin1` (ISO-8859-1) is built in, and maps `€` to `?` because that
symbol is not in Latin-1, where Windows-1252 maps it to `0x80`. Treat code pages
as a compatibility tool for old files and partners, not as a choice for new data.

### Base64, Base64Url and hex

Binary data in text form uses three encodings. Standard Base64 uses `+`, `/` and
`=` padding, which are awkward in URLs. `Base64Url` (new in .NET 9, in
`System.Buffers.Text`) uses `-` and `_` and omits padding by default:

```csharp
byte[] data = [0xFB, 0xFF, 0xFE, 0x3E, 0x3F];
Console.WriteLine(Convert.ToBase64String(data));    // +//+Pj8=
Console.WriteLine(Base64Url.EncodeToString(data));  // -__-Pj8
Console.WriteLine(Convert.ToHexString(Base64Url.DecodeFromChars("-__-Pj8")));  // FBFFFE3E3F
Console.WriteLine(Convert.ToBase64String([1]) + " " + Base64Url.EncodeToString([1]));  // AQ== AQ
Console.WriteLine(Convert.ToHexString(data) + " " + Convert.ToHexStringLower(data));   // FBFFFE3E3F fbfffe3e3f
```

The docs state the Base64Url alphabet differs from Base64 only in replacing `+`
and `/` with `-` and `_`. `Convert.ToHexString` writes uppercase and
`Convert.ToHexStringLower` (.NET 9) writes lowercase, which saves a `ToLower`
call and its allocation when a protocol, such as many hash representations,
expects lowercase. Base64 and hex are encodings, not encryption: anyone can
reverse them.

## Trade-offs

- **`char` indexing is fast and wrong for some text.** `s[i]` and `Length` are
  cheap and correct for ASCII and most BMP text, and silently wrong for emoji and
  combining marks. Use `Rune` or `StringInfo` where users can type anything, and
  accept the cost.
- **Enumerating runes is not enumerating graphemes.** `EnumerateRunes` fixes
  surrogate pairs only; `"e\u0301"` is still two runes. For "visible character"
  semantics you need `StringInfo`, which allocates and is slower.
- **Replacement versus throwing.** Silent `U+FFFD` keeps a pipeline running and
  hides corruption. A throwing `UTF8Encoding` surfaces bad input at the price of
  having to handle the exception. Pick per boundary: lenient for display, strict
  for identifiers, signatures and anything compared byte by byte.
- **A BOM helps tools and hurts others.** It makes UTF-8 detection reliable in
  some editors and spreadsheets, and can trip consumers that do not expect it, such
  as shebang lines. Default to no BOM unless a consumer requires one.
- **`Base64Url` starts at .NET 9.** The API docs also list a
  `Microsoft.Bcl.Memory` package for older targets. Hand-rolling the `+` and `/`
  replacement plus padding is easy to get subtly wrong.

## Documentation Links

- [Introduction to character encoding in .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/base-types/character-encoding-introduction) (doc)
- [Rune struct, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.text.rune) (doc)
- [StringInfo class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.globalization.stringinfo) (doc)
- [Base64Url class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.buffers.text.base64url) (doc)
- [Convert.ToHexStringLower method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.convert.tohexstringlower) (doc)
- [How to use character encoding classes in .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/base-types/character-encoding) (doc)
