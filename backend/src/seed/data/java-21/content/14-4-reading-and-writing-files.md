# Reading and Writing Files

> Building on the stream foundations, this lesson covers the practical patterns you will use most often: reading lines with `BufferedReader`, writing with `PrintWriter`, using `Scanner` for text parsing, and leveraging the NIO.2 convenience methods `Files.newBufferedReader`, `Files.newBufferedWriter`, and `Files.lines()`.

---

## Reading Lines with `BufferedReader`

`BufferedReader.readLine()` is the classic way to read a text file line by line. It strips the line terminator and returns `null` at end of stream.

```java
try (BufferedReader br = new BufferedReader(new FileReader("/tmp/log.txt"))) {
    String line;
    while ((line = br.readLine()) != null) {
        System.out.println(line);
    }
}
```

The assignment inside the `while` condition is idiomatic Java — notice it reads the next line **and** checks for `null` in one expression.

---

## Writing with `BufferedWriter`

`BufferedWriter` wraps `FileWriter` and adds a `newLine()` method that writes the platform-correct line separator (`\r\n` on Windows, `\n` on Unix).

```java
try (BufferedWriter bw = new BufferedWriter(new FileWriter("/tmp/output.txt"))) {
    bw.write("First line");
    bw.newLine();
    bw.write("Second line");
    bw.newLine();
}
// File is flushed and closed automatically
```

Always prefer `newLine()` over hard-coding `"\n"` to keep files portable.

---

## try-with-resources for Streams

Any class that implements `AutoCloseable` (which `Closeable` extends) can be used in a try-with-resources statement. Multiple resources are closed in **reverse declaration order**.

```java
try (BufferedReader br   = new BufferedReader(new FileReader("/tmp/in.txt"));
     BufferedWriter bw   = new BufferedWriter(new FileWriter("/tmp/out.txt"))) {

    String line;
    while ((line = br.readLine()) != null) {
        bw.write(line.toUpperCase());
        bw.newLine();
    }
}
// bw closed first, then br
```

If an exception occurs during `close()`, it is suppressed (available via `getSuppressed()`) so it does not mask the original exception.

---

## `PrintWriter`

`PrintWriter` is a character-stream writer that adds `print`, `println`, and `printf` convenience methods. It never throws `IOException` — errors are tracked with `checkError()`.

```java
// Wrapping a file path directly (Java will create the file)
try (PrintWriter pw = new PrintWriter("/tmp/report.txt")) {
    pw.println("Header");
    pw.printf("Value: %d%n", 42);
    pw.print("No newline here");
}

// Wrapping a BufferedWriter for performance
try (PrintWriter pw = new PrintWriter(
        new BufferedWriter(new FileWriter("/tmp/big.txt")))) {
    for (int i = 0; i < 100_000; i++) {
        pw.println("Line " + i);
    }
}
```

> `println` appends `\n` on Unix and `\r\n` on Windows. Use `printf` with `%n` for a portable newline in format strings.

---

## `Scanner` for Parsing Text

`Scanner` tokenises its input (by default on whitespace) and provides typed methods for reading individual tokens.

```java
try (Scanner sc = new Scanner(Path.of("/tmp/data.txt"))) {
    while (sc.hasNextLine()) {
        String line = sc.nextLine();
        System.out.println(line);
    }
}

// Reading typed tokens from a file of numbers
try (Scanner sc = new Scanner(Path.of("/tmp/numbers.txt"))) {
    while (sc.hasNextInt()) {
        int n = sc.nextInt();
        System.out.println(n * 2);
    }
}
```

Use `hasNextLine()` with `nextLine()` for line-by-line reading, or `hasNextInt()` / `nextInt()` etc. for structured data. Mixing both on the same `Scanner` can cause issues because `nextInt()` does not consume the line terminator.

---

## NIO.2 Convenience Methods

### `Files.newBufferedReader` and `Files.newBufferedWriter`

These factory methods return properly-encoded `BufferedReader` / `BufferedWriter` instances backed by the NIO.2 infrastructure. They default to UTF-8.

```java
Path src  = Path.of("/tmp/input.txt");
Path dest = Path.of("/tmp/output.txt");

try (BufferedReader br = Files.newBufferedReader(src);
     BufferedWriter bw = Files.newBufferedWriter(dest)) {

    String line;
    while ((line = br.readLine()) != null) {
        bw.write(line);
        bw.newLine();
    }
}

// Explicit charset
try (BufferedReader br = Files.newBufferedReader(src, StandardCharsets.ISO_8859_1)) {
    System.out.println(br.readLine());
}
```

### `Files.lines()`

Returns a lazy `Stream<String>` of lines. No line terminators are included. The stream must be closed.

```java
try (Stream<String> lines = Files.lines(Path.of("/tmp/data.csv"))) {
    lines.filter(l -> !l.startsWith("#"))   // skip comment lines
         .map(String::toUpperCase)
         .forEach(System.out::println);
}

// Count non-blank lines
long count;
try (Stream<String> lines = Files.lines(Path.of("/tmp/data.csv"))) {
    count = lines.filter(l -> !l.isBlank()).count();
}
```

`Files.lines()` is ideal for large files because it reads on demand rather than loading everything into a `List` upfront (unlike `Files.readAllLines()`).

---

## Comparison: Reading Approaches

| Approach | Returns | Lazy? | Best for |
|---|---|---|---|
| `Files.readAllLines()` | `List<String>` | No | Small files, random access |
| `Files.lines()` | `Stream<String>` | Yes | Large files, pipeline processing |
| `BufferedReader.readLine()` | `String` (one line) | Yes | Procedural line-by-line logic |
| `Scanner.nextLine()` | `String` (one line) | Yes | Tokenised / mixed-type input |

---

## Key Rules Summary

- `readLine()` returns `null` at end of stream — never compare against `""`.
- Always use try-with-resources; multiple resources are closed in reverse order.
- `PrintWriter` suppresses `IOException`; check errors with `checkError()` if needed.
- `Files.newBufferedReader/Writer` default to UTF-8 — prefer them over `new FileReader/Writer`.
- `Files.lines()` is lazy; `Files.readAllLines()` loads everything into memory.
- Close `Files.lines()` streams with try-with-resources to release the underlying file handle.

---

## References

- [Oracle Docs — BufferedReader](https://docs.oracle.com/en/java/docs/api/java.base/java/io/BufferedReader.html)
- [Oracle Docs — Files.lines](https://docs.oracle.com/en/java/docs/api/java.base/java/nio/file/Files.html#lines(java.nio.file.Path))
- OCP Study Guide, Chapter 14 — I/O
