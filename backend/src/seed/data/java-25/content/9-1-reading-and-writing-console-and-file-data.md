# Reading and Writing Console and File Data

---

## Overview

Java I/O is built around **streams** — ordered sequences of bytes or characters. The `java.io` package provides the classic stream hierarchy; the `java.nio.file` package adds modern convenience methods. All resources that implement `AutoCloseable` should be opened in a **try-with-resources** block.

---

## Console I/O

### Standard Streams

| Stream | Type | Purpose |
|--------|------|---------|
| `System.out` | `PrintStream` | Standard output |
| `System.err` | `PrintStream` | Standard error |
| `System.in` | `InputStream` | Standard input |

```java
System.out.println("Hello, World!");
System.err.println("Something went wrong");
```

> **Exam tip:** `System.err` writes to the error stream; output ordering relative to `System.out` is not guaranteed.

---

### Scanner — Reading from Console

`Scanner` wraps any `InputStream` (or `Readable`) and parses tokens from it.

```java
import java.util.Scanner;

Scanner sc = new Scanner(System.in);
String line  = sc.nextLine();
int    value = sc.nextInt();
double d     = sc.nextDouble();
sc.close();
```

Common `Scanner` methods:

| Method | Returns | Description |
|--------|---------|-------------|
| `nextLine()` | `String` | Reads entire line including whitespace |
| `next()` | `String` | Reads next whitespace-delimited token |
| `nextInt()` | `int` | Parses next token as `int` |
| `nextLong()` | `long` | Parses next token as `long` |
| `nextDouble()` | `double` | Parses next token as `double` |
| `hasNext()` | `boolean` | Returns `true` if another token exists |
| `hasNextLine()` | `boolean` | Returns `true` if another line exists |

> **Exam tip:** `nextInt()` does not consume the trailing newline. Calling `nextLine()` immediately after reads an empty string. Insert an extra `sc.nextLine()` to discard it.

---

### Console — Secure Password Input

`System.console()` returns a `Console` object, or `null` if no console is attached (e.g., inside an IDE).

```java
Console console = System.console();
if (console != null) {
    String user = console.readLine("Username: ");
    char[] pwd  = console.readPassword("Password: ");  // does not echo input
    console.printf("Welcome, %s%n", user);
}
```

`readPassword()` returns `char[]` — not `String` — so the password can be zeroed from memory after use.

---

## Character File I/O — Reader / Writer

### FileReader and FileWriter

```java
try (FileWriter fw = new FileWriter("output.txt", StandardCharsets.UTF_8)) {
    fw.write("Hello\n");
}

try (FileReader fr = new FileReader("output.txt", StandardCharsets.UTF_8)) {
    int ch;
    while ((ch = fr.read()) != -1) {
        System.out.print((char) ch);
    }
}
```

`FileWriter(String, boolean append)` — second `boolean` controls append mode.

---

### BufferedReader and BufferedWriter

Wrapping with a `Buffered*` class reduces system calls and enables `readLine()`:

```java
try (BufferedWriter bw = new BufferedWriter(
        new FileWriter("notes.txt", StandardCharsets.UTF_8))) {
    bw.write("First line");
    bw.newLine();
    bw.write("Second line");
}

try (BufferedReader br = new BufferedReader(
        new FileReader("notes.txt", StandardCharsets.UTF_8))) {
    String line;
    while ((line = br.readLine()) != null) {
        System.out.println(line);
    }
}
```

`readLine()` returns `null` at end-of-file, not an empty string.

---

## Byte File I/O — InputStream / OutputStream

Use byte streams for binary data (images, audio, serialized objects).

```java
try (FileOutputStream fos = new FileOutputStream("data.bin");
     BufferedOutputStream bos = new BufferedOutputStream(fos)) {
    bos.write(new byte[]{1, 2, 3, 4});
}

try (FileInputStream fis = new FileInputStream("data.bin");
     BufferedInputStream bis = new BufferedInputStream(fis)) {
    int b;
    while ((b = bis.read()) != -1) {
        System.out.println(b);
    }
}
```

---

## PrintWriter — Formatted Text Output to Files

`PrintWriter` supports `printf`/`format` and never throws checked exceptions (errors are silently swallowed unless `checkError()` is called).

```java
try (PrintWriter pw = new PrintWriter(
        new BufferedWriter(new FileWriter("report.txt")))) {
    pw.printf("%-10s %5d%n", "Alice", 42);
    pw.println("Done");
}
```

---

## Modern Convenience — java.nio.file.Files

For small-to-medium text files, `Files` methods are simpler than the classic stream API.

| Method | Description |
|--------|-------------|
| `Files.readString(Path)` | Reads entire file as `String` (UTF-8 by default) |
| `Files.readString(Path, Charset)` | Reads with explicit charset |
| `Files.writeString(Path, CharSequence)` | Writes `String` to file (creates or truncates) |
| `Files.writeString(Path, CharSequence, OpenOption...)` | With open options, e.g. `APPEND` |
| `Files.lines(Path)` | Returns a lazy `Stream<String>` of lines |
| `Files.readAllLines(Path)` | Returns `List<String>` of all lines |
| `Files.write(Path, Iterable<? extends CharSequence>)` | Writes lines to file |

```java
Path p = Path.of("hello.txt");

Files.writeString(p, "Hello, NIO!");

String content = Files.readString(p);
System.out.println(content);  // Hello, NIO!

// Lazy stream — must be closed
try (Stream<String> lines = Files.lines(p)) {
    lines.forEach(System.out::println);
}
```

> **Exam tip:** `Files.lines()` returns a `Stream` that holds an open file handle. Always close it with try-with-resources.

---

## Encoding and Charset

Always specify a `Charset` when crossing process or system boundaries to avoid platform-dependent defaults.

```java
import java.nio.charset.StandardCharsets;

Files.writeString(Path.of("utf8.txt"), "café", StandardCharsets.UTF_8);
String s = Files.readString(Path.of("utf8.txt"), StandardCharsets.UTF_8);
```

Common constants in `StandardCharsets`:

| Constant | Encoding |
|----------|----------|
| `UTF_8` | Unicode — recommended default |
| `US_ASCII` | 7-bit ASCII |
| `ISO_8859_1` | Latin-1 |
| `UTF_16` | 16-bit Unicode |

---

## Key Points for the Exam

- Wrap `FileReader`/`FileWriter` with `BufferedReader`/`BufferedWriter` to enable `readLine()` and reduce I/O calls.
- Always use try-with-resources — resources are closed in reverse declaration order.
- `BufferedReader.readLine()` returns `null` at EOF, not an empty string.
- `Scanner.nextInt()` leaves the newline in the buffer; a subsequent `nextLine()` returns `""`.
- `System.console()` returns `null` when no console is attached; guard before calling its methods.
- `Files.readString()` / `Files.writeString()` are the modern alternatives for small text files.
- `Files.lines()` is lazy and must be closed.

## References

- [Oracle Docs — java.io (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/io/package-summary.html)
- [Oracle Docs — Files (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/file/Files.html)
