# Introducing I/O Streams

> Java I/O is built around **streams** — sequences of data flowing between a source and a destination. Understanding the two fundamental categories (byte streams vs. character streams) and how to wrap them with buffered decorators is the foundation of all file I/O on the OCP exam.

---

## Two Categories of Streams

| Category | Base classes | Unit of transfer | Use for |
|---|---|---|---|
| Byte streams | `InputStream` / `OutputStream` | Single byte (0–255) | Binary data: images, audio, serialized objects |
| Character streams | `Reader` / `Writer` | Single `char` (UTF-16) | Text data: .txt, .csv, .json, .xml |

Character streams handle character encoding transparently. Always use them when working with text — they eliminate encoding bugs that arise from treating bytes as characters.

---

## The Stream Class Hierarchy

```
java.io.InputStream (abstract)
├── FileInputStream
├── ByteArrayInputStream
├── FilterInputStream
│   └── BufferedInputStream
└── ObjectInputStream

java.io.OutputStream (abstract)
├── FileOutputStream
├── ByteArrayOutputStream
├── FilterOutputStream
│   ├── BufferedOutputStream
│   └── PrintStream
└── ObjectOutputStream

java.io.Reader (abstract)
├── InputStreamReader
│   └── FileReader
├── StringReader
└── BufferedReader

java.io.Writer (abstract)
├── OutputStreamWriter
│   └── FileWriter
├── StringWriter
├── BufferedWriter
└── PrintWriter
```

---

## Byte Streams: FileInputStream and FileOutputStream

Use these for raw binary data.

```java
// Reading bytes one at a time — read() returns -1 at end of stream
try (InputStream in = new FileInputStream("/tmp/image.png")) {
    int b;
    while ((b = in.read()) != -1) {
        // b is a single byte value 0–255
        process(b);
    }
}

// Writing bytes
try (OutputStream out = new FileOutputStream("/tmp/copy.png")) {
    out.write(72);   // writes byte value 72
    out.write(new byte[]{65, 66, 67}); // writes "ABC"
}
```

Reading and writing one byte at a time is extremely slow. In practice, use a buffer or the bulk `read(byte[])` form.

---

## Character Streams: FileReader and FileWriter

```java
// Reading chars one at a time — read() returns -1 at end of stream
try (Reader reader = new FileReader("/tmp/notes.txt")) {
    int ch;
    while ((ch = reader.read()) != -1) {
        System.out.print((char) ch);
    }
}

// Writing characters
try (Writer writer = new FileWriter("/tmp/output.txt")) {
    writer.write("Hello");
    writer.write('\n');
}

// Appending to an existing file
try (Writer writer = new FileWriter("/tmp/output.txt", true)) {
    writer.write("Appended line\n");
}
```

`FileReader` and `FileWriter` use the platform's default charset. For explicit encoding, wrap an `InputStreamReader` / `OutputStreamWriter` with a `Charset` argument.

```java
Reader utf8 = new InputStreamReader(
    new FileInputStream("/tmp/data.txt"), StandardCharsets.UTF_8);
```

---

## Buffered Wrappers

Unbuffered streams make a system call for every byte or character. **Buffered wrappers** reduce this overhead by maintaining an in-memory buffer (8 KB by default).

```java
// Buffered byte stream
try (BufferedInputStream in = new BufferedInputStream(
        new FileInputStream("/tmp/large.dat"))) {
    // reads a full buffer at a time internally
    int b;
    while ((b = in.read()) != -1) {
        process(b);
    }
}

// Buffered character stream
try (BufferedReader reader = new BufferedReader(
        new FileReader("/tmp/text.txt"))) {
    String line;
    while ((line = reader.readLine()) != null) {
        System.out.println(line);
    }
}

try (BufferedWriter writer = new BufferedWriter(
        new FileWriter("/tmp/out.txt"))) {
    writer.write("Line one");
    writer.newLine();   // platform-appropriate line separator
    writer.write("Line two");
}
```

`BufferedReader.readLine()` returns `null` at end of stream, not an empty string — do not compare against `""`.

---

## The Decorator Pattern

Java I/O uses the **decorator pattern**: you wrap a base stream with one or more decorators that add behavior. Each layer delegates to the one below.

```java
// Three layers: File → Byte Buffer → Object stream
ObjectInputStream ois = new ObjectInputStream(
    new BufferedInputStream(
        new FileInputStream("/tmp/data.ser")));
```

You can keep stacking decorators. The common combinations to know for the exam:

| Combination | Purpose |
|---|---|
| `BufferedReader(FileReader)` | Buffered text reading with `readLine()` |
| `BufferedWriter(FileWriter)` | Buffered text writing with `newLine()` |
| `BufferedInputStream(FileInputStream)` | Buffered binary reading |
| `BufferedOutputStream(FileOutputStream)` | Buffered binary writing |
| `ObjectInputStream(BufferedInputStream(FileInputStream))` | Deserialization |
| `ObjectOutputStream(BufferedOutputStream(FileOutputStream))` | Serialization |

---

## Closing Streams

Always close streams in a `finally` block or, preferably, with **try-with-resources**. Closing an outer wrapper automatically closes the inner stream — you only need to close the outermost wrapper.

```java
// Correct — only close the outermost stream
try (BufferedReader br = new BufferedReader(new FileReader("/tmp/file.txt"))) {
    System.out.println(br.readLine());
}
// FileReader is closed when BufferedReader.close() is called
```

---

## Key Rules Summary

- Byte streams (`InputStream`/`OutputStream`) transfer bytes; character streams (`Reader`/`Writer`) transfer `char` values.
- Use character streams for text, byte streams for binary data.
- Buffered wrappers dramatically improve performance by reducing system calls.
- `readLine()` returns `null` at end of stream.
- Java I/O is built on the decorator pattern — wrap streams to add behavior.
- Close only the outermost wrapper; the inner streams are closed transitively.

---

## References

- [Oracle Docs — I/O Streams (Java Tutorial)](https://docs.oracle.com/javase/tutorial/essential/io/streams.html)
- OCP Study Guide, Chapter 14 — I/O
