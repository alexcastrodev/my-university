---
version: 1.0
updatedAt: 2026-08-21
---
## Objective

A `String` is internally a sequence of `char`, and each `char` is a 16-bit **UTF-16 code unit** — not a "character" in the everyday sense. Most characters people type every day (Latin letters, digits, most punctuation, most CJK ideographs) live in the **Basic Multilingual Plane (BMP)**, the first 65,536 Unicode code points, and each of those fits in exactly one `char`. But Unicode has far more than 65,536 assigned code points — most modern emoji, some CJK Extension B+ ideographs, and various mathematical/musical symbols live in the **supplementary planes**, above `U+FFFF`. A `char` can't hold one of those on its own, so Java represents it as a **surrogate pair**: two consecutive `char`s — a *high surrogate* in `U+D800`–`U+DBFF` followed by a *low surrogate* in `U+DC00`–`U+DFFF` — that together encode a single Unicode **code point**. Every API on `String` that operates "by index" (`length()`, `charAt()`, `substring()`) is counting and slicing code *units*, not code *points*, and that mismatch is the source of a whole category of bugs once supplementary characters enter the picture.

## Use Cases

- Counting how many "characters" a user actually typed (e.g. a bio field with a length limit) when the input may contain emoji — counting `char`s overcounts every supplementary character as 2.
- Truncating a string to a fixed length for display or storage without ever cutting a surrogate pair in half, which would leave a lone, unpaired surrogate at the boundary.
- Writing correct grapheme-aware string processing (search, reverse, capitalize-first-letter) that must not treat one half of a surrogate pair as if it were a standalone character.
- Debugging why a string that "looks like 3 characters" reports `length() == 5`, or why re-rendering a string char-by-char corrupts emoji into replacement-character glyphs (`�`).
- Building or parsing text formats where a `char[]` is serialized — an unpaired surrogate at a truncation boundary is invalid UTF-16 and can break downstream decoders.

## Deep Dive

### Code units vs. code points: one `char` is usually enough, but not always

```java
String bmp = "A";                       // U+0041 — fits in one char, one code unit
System.out.println(bmp.length());       // 1
System.out.println(bmp.codePointAt(0)); // 65 (0x41)

String emoji = "😀";                    // U+1F600 GRINNING FACE — outside the BMP
System.out.println(emoji.length());        // 2 — two chars (a surrogate pair)
System.out.println(emoji.codePointAt(0));   // 128512 (0x1F600) — one code point
System.out.println(emoji.codePointCount(0, emoji.length())); // 1 — one visible character
```

`"😀"` is stored as exactly two `char`s in the underlying array, but it is one Unicode code point and one visible glyph. `length()` reports the number of `char`s (2), while `codePointCount()` reports the number of actual Unicode code points (1) — these two numbers only agree as long as every character in the string is in the BMP.

### `length()` counts code units, not what you see on screen

```java
String s = "Hi😀!";
System.out.println(s.length());              // 5 — 'H','i', high-surrogate, low-surrogate, '!'
System.out.println(s.codePointCount(0, s.length())); // 4 — H, i, 😀, !
```

Any code that treats `String.length()` as "number of characters" silently overcounts by one for every supplementary character present. That is usually invisible in testing (most test strings are ASCII) and shows up only once real emoji or extended CJK input reaches the code — a classic case of code that "works" until it meets non-BMP data.

### `charAt(int)` can hand back half of a character

```java
String s = "Hi😀!";
char c2 = s.charAt(2);   // the high surrogate of 😀 — not a printable character on its own
char c3 = s.charAt(3);   // the low surrogate of 😀

System.out.println(Character.isHighSurrogate(c2)); // true
System.out.println(Character.isLowSurrogate(c3));   // true
System.out.println(c2);                              // prints a lone surrogate — garbled/invalid on its own
```

`charAt(2)` is a perfectly legal call — it returns *a* `char` — but that `char` is not a self-contained character. Any indexing scheme built on `charAt`/`substring` that isn't surrogate-aware can land exactly between the two halves of a pair, producing a fragment that is meaningless (and, if written out as UTF-16, invalid) on its own.

### Iterating correctly: `codePointAt`, `codePointCount`, `codePoints()`

```java
String s = "a😀b";

// WRONG: char-by-char iteration splits the emoji into two meaningless halves
for (int i = 0; i < s.length(); i++) {
    System.out.print(s.charAt(i) + "|");
}
// prints: a|?|?|b|  (the two surrogate halves, not a single 😀)

// CORRECT: advance by code point, using Character.charCount to know how many
// chars this code point occupied (1 for BMP, 2 for supplementary)
for (int i = 0; i < s.length(); ) {
    int cp = s.codePointAt(i);
    System.out.print(new String(Character.toChars(cp)) + "|");
    i += Character.charCount(cp);
}
// prints: a|😀|b|

// CORRECT (Java 8+): codePoints() stream does the same advancing internally
s.codePoints().forEach(cp -> System.out.print(new String(Character.toChars(cp)) + "|"));
// prints: a|😀|b|
```

`codePointAt(int index)` returns the full code point starting at `index` (transparently combining a surrogate pair when present), and `Character.charCount(int codePoint)` tells you whether to advance the index by 1 or by 2. The `codePoints()` stream (added in Java 8) does exactly this internally and returns an `IntStream` of code points — it is the simplest correct way to process a string one *character* at a time when supplementary characters are possible.

### Building a supplementary character manually: `Character.toChars`

```java
int codePoint = 0x1F600; // 😀, verified: U+1F600 GRINNING FACE
char[] chars = Character.toChars(codePoint);

System.out.println(chars.length);                 // 2
System.out.println(Character.isHighSurrogate(chars[0])); // true
System.out.println(Character.isLowSurrogate(chars[1]));  // true
System.out.println(new String(chars));             // 😀

// The reverse: recombining a known surrogate pair back into a code point
int recombined = Character.toCodePoint(chars[0], chars[1]);
System.out.println(recombined == codePoint); // true
```

`Character.toChars(int codePoint)` is the low-level tool for constructing the `char[]` for a single code point, producing one `char` for a BMP code point or two (a correctly-formed surrogate pair) for a supplementary one — the same conversion `codePoints()` and string literals do implicitly. `Character.toCodePoint(char high, char low)` is the inverse, combining a known-good surrogate pair back into its code point.

## Trade-offs

- **`length()`/`charAt()`/`substring()` are O(1) or near it and are correct for pure-BMP text**, which covers the large majority of everyday strings — but they are silently wrong the moment a string can contain emoji or other supplementary characters, and nothing in the type system flags the mismatch.
- **Code-point-aware processing (`codePoints()`, `codePointAt` + `charCount`) is correct in general, but it's O(n) to scan and slightly more code at every call site** — it's worth reaching for specifically when the string's origin is untrusted/international user input (bios, chat messages, free-text fields), not as a blanket replacement for every `String` operation in the codebase.
- **A naive `substring(0, n)` truncation can split a surrogate pair**, leaving a lone unpaired surrogate at the boundary — valid to hold in a Java `String` (which doesn't validate UTF-16 well-formedness), but invalid UTF-16 once serialized, and likely to render as `�` downstream.
  ```java
  String s = "😀".substring(0, 1); // legal in Java, but s is now one unpaired high surrogate
  ```
- **`Character.isHighSurrogate`/`isLowSurrogate` must be checked explicitly** — the compiler and the `char` type give no indication that a given `char` value is only half of something; it's on the code to detect and handle this itself when working at the `char` level at all.
- **This is orthogonal to string pooling/interning** (see the related concept on `String`'s pool) — code-unit vs. code-point representation is about how *content* is laid out in memory, while interning is about whether *equal-content instances* share an object. A supplementary-character string pools and interns exactly like any other `String`.

## Documentation Links

- [Character — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Character.html) — doc
- [String — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/String.html) — doc
