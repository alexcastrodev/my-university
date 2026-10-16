---
version: 1.0
updatedAt: 2026-10-16
---
## Question

# How can you get the bytes of a String?

## Short Answer

There is a method for that: `getBytes()`. But it may not do exactly what you think.

## Less Short Answer

A `String` wraps an array of bytes, in a private field called `value`. It used to be an array of `char`, but since Java 9 (Compact Strings, JEP 254) it is an array of `byte`. The string also has a `coder` field, which takes one of two values: `LATIN1` (one byte per character) or `UTF16` (two bytes per character).

So you might expect `getBytes()` to hand you that internal array. It does not. When you call `getBytes()`, the characters of the string are **encoded** with the default charset, and what you get is a brand new array holding that encoding.

```java
String s = "Olá";

byte[] utf8   = s.getBytes(StandardCharsets.UTF_8);      // [79, 108, -61, -95]: 4 bytes, "á" takes two
byte[] latin1 = s.getBytes(StandardCharsets.ISO_8859_1); // [79, 108, -31]: 3 bytes
byte[] utf16  = s.getBytes(StandardCharsets.UTF_16);     // 8 bytes: a BOM (FE FF) + 2 bytes per char
```

Same string, three different byte arrays. None of them is "the bytes of the string": they are the bytes of the string *in a given encoding*.

## Use an Explicit Charset

The no-argument `getBytes()` uses `Charset.defaultCharset()`. If you want a predictable outcome, pass the charset yourself.

```java
byte[] unpredictable = s.getBytes();                       // depends on the default charset
byte[] predictable   = s.getBytes(StandardCharsets.UTF_8); // always UTF-8
```

The overload that takes a `Charset` is also nicer than the one that takes a charset name: `getBytes("UTF-8")` throws the checked `UnsupportedEncodingException`, the `Charset` version does not.

## CharsetEncoder: When You Need Control

Instead of `getBytes()`, you can also use `charset.newEncoder().encode(...)`. The difference shows up with characters the charset cannot represent: `getBytes()` silently replaces them (with `?` for Latin-1), while a `CharsetEncoder` reports an error by default.

```java
String s = "€uro";

byte[] lossy = s.getBytes(StandardCharsets.ISO_8859_1);
System.out.println(new String(lossy, StandardCharsets.ISO_8859_1)); // ?uro: the € is gone, no error

CharsetEncoder encoder = StandardCharsets.ISO_8859_1.newEncoder();
ByteBuffer buffer = encoder.encode(CharBuffer.wrap(s));
// throws UnmappableCharacterException: you know the data does not fit
```

You can configure that behavior with `onMalformedInput()` and `onUnmappableCharacter()` (`REPORT`, `REPLACE` or `IGNORE`), and the encoder works on buffers, which is handy when you stream large amounts of text.

## Where the Default Charset Comes From

One last word. If you have not set the default charset, it is read from the environment: historically the JVM took it from your operating system (its locale and platform encoding). So you could write and test your application in one country, deploy it in a cloud environment in another country, and get a different charset at runtime than the one you developed with.

Since Java 18 (JEP 400), the default charset is UTF-8 on every platform, which removes most of that surprise. The OS encoding is still there, exposed as the `native.encoding` system property, and you can get the old behavior back with `-Dfile.encoding=COMPAT`.

```java
System.out.println(Charset.defaultCharset());              // UTF-8 on Java 18+
System.out.println(System.getProperty("native.encoding")); // e.g. Cp1252 on a Windows machine
```

So the advice holds on any version: if the bytes matter (files, network, hashing, signatures), always name the charset.

## One Last Word

Something you need to be aware of!

## References

- [Java Coding Tip #404: How Can You Get the Bytes of a String?](https://www.youtube.com/shorts/eHcph5zC-SQ) (video)
- [String.getBytes(Charset) (Java SE 25 API)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/String.html#getBytes(java.nio.charset.Charset)) (doc)
- [CharsetEncoder (Java SE 25 API)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/charset/CharsetEncoder.html) (doc)
- [JEP 254: Compact Strings](https://openjdk.org/jeps/254) (doc)
- [JEP 400: UTF-8 by Default](https://openjdk.org/jeps/400) (doc)
