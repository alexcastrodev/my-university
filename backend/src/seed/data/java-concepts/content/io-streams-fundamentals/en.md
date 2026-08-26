---
version: 1.0
updatedAt: 2026-08-05
---
## Objective

`java.io` is Java's original I/O system: every source or destination of data — a file, the console, a network socket, an in-memory buffer — is accessed through the same abstraction, a **stream**. A stream either produces (`InputStream`/`Reader`) or consumes (`OutputStream`/`Writer`) a sequence of data, one item at a time, and the same read/write-oriented API works no matter what's on the other end. Because a stream almost always wraps an external resource, closing it correctly matters as much as reading or writing it, which is why `Closeable`/`AutoCloseable`/`Flushable` and the try-with-resources statement are as central to this concept as the streams themselves. Serialization — turning a whole object graph into bytes and back — is `java.io`'s other major feature, built on the same stream classes but carrying its own, more serious set of risks.

## Use Cases

- Reading or writing a file's raw bytes (images, binary formats) with `FileInputStream`/`FileOutputStream`, or its text with `FileReader`/`FileWriter`.
- Wrapping a raw stream in a buffered one (`BufferedInputStream`, `BufferedReader`) to avoid a system call per byte or per character.
- Producing formatted console or file output with `PrintWriter`/`PrintStream`, including `printf`-style formatting.
- Persisting an in-memory object graph to disk or shipping it across a network boundary via `ObjectOutputStream`/`ObjectInputStream`.
- Guaranteeing a file, socket, or other resource is released even when the code using it throws, via try-with-resources instead of a manual `finally` block.

## Deep Dive

### Two hierarchies: bytes vs. characters

`java.io` splits cleanly into two parallel class hierarchies. `InputStream`/`OutputStream` move raw bytes — the right choice for binary data or when no text encoding is involved. `Reader`/`Writer` move Unicode characters — the right choice for text, because they handle the byte-to-character mapping (the charset) for you.

```java
// Byte stream: for binary data
try (InputStream in = new FileInputStream("photo.jpg");
     OutputStream out = new FileOutputStream("copy.jpg")) {
    in.transferTo(out);
}

// Character stream: for text
try (Reader r = new FileReader("notes.txt");
     Writer w = new FileWriter("notes-copy.txt")) {
    r.transferTo(w);
}
```

At the lowest level all I/O is still bytes — `InputStreamReader` and `OutputStreamWriter` are the bridge classes that decode/encode between the two hierarchies, given an explicit `Charset`:

```java
Reader consoleReader = new InputStreamReader(System.in, StandardCharsets.UTF_8);
```

`System.in`/`System.out`/`System.err` are themselves byte streams (`InputStream`, and `PrintStream` for the latter two) even though they're commonly used to read and write text — wrapping them in a character stream is what makes console I/O encoding-correct.

### Closeable, AutoCloseable, Flushable, and why try-with-resources exists

Every stream class that holds an external resource implements `java.lang.AutoCloseable` (a single `close()` method, declared to throw `Exception`), and `java.io.Closeable` narrows that contract to `close()` throwing only `IOException` — and, unlike `AutoCloseable`, requires `close()` to be **idempotent**: calling it a second time must be a no-op, not an error. `AutoCloseable` only encourages that behavior; it doesn't require it. Any class writing to a stream also typically implements `Flushable`, whose `flush()` pushes buffered data out to the underlying device on demand rather than waiting for the buffer to fill or the stream to close.

Before JDK 7, releasing a resource correctly meant a `finally` block, checking for `null` in case the constructor itself had failed:

```java
FileInputStream fin = null;
try {
    fin = new FileInputStream("data.txt");
    // use fin
} finally {
    if (fin != null) fin.close();
}
```

Try-with-resources replaces that boilerplate: any resource declared in the `try(...)` clause must implement `AutoCloseable`, and it is closed automatically when the block exits, in reverse declaration order, whether the block completes normally or throws.

```java
try (FileInputStream fin = new FileInputStream("in.txt");
     FileOutputStream fout = new FileOutputStream("out.txt")) {
    fin.transferTo(fout);
}   // both fin and fout are closed here, even if transferTo throws
```

A resource declared in the `try` is implicitly `final`, and its scope is limited to the statement. If closing a resource throws while the `try` body is already unwinding from another exception, the close exception isn't lost — it's attached to the original as a *suppressed* exception, retrievable via `Throwable.getSuppressed()`, instead of silently replacing it the way a `finally`-block exception would.

### Buffering and PrintWriter

Wrapping a stream is how `java.io` adds behavior without changing its type: a `BufferedInputStream`/`BufferedReader` around any `InputStream`/`Reader` batches physical reads into memory-sized chunks instead of one system call per byte or character.

```java
try (BufferedReader br = new BufferedReader(new FileReader("log.txt"))) {
    String line;
    while ((line = br.readLine()) != null) {
        process(line);
    }
}
```

For output, `PrintWriter` is the character-based counterpart to the byte-based `PrintStream` (which is what `System.out` actually is) — same `print`/`println`/`printf` API, but wrapping a `Writer` so it composes cleanly with other character streams:

```java
try (PrintWriter pw = new PrintWriter(new FileWriter("report.txt"))) {
    pw.printf("Total: %,d%n", total);
}
```

### Serialization: turning an object graph into bytes

`ObjectOutputStream`/`ObjectInputStream` write and read whole objects — including everything they transitively reference — rather than individual bytes or characters. Only a class that implements the empty marker interface `Serializable` (or the more manual `Externalizable`) is eligible; every field is saved except `static` fields and fields marked `transient`.

```java
class Session implements Serializable {
    private static final long serialVersionUID = 1L;
    String user;
    transient String cachedToken;   // recomputed, not persisted
    int loginCount;
}

try (ObjectOutputStream oos = new ObjectOutputStream(new FileOutputStream("session.bin"))) {
    oos.writeObject(new Session());
}

try (ObjectInputStream ois = new ObjectInputStream(new FileInputStream("session.bin"))) {
    Session restored = (Session) ois.readObject();
}
```

Declaring `serialVersionUID` explicitly matters: without it, the JVM computes one from the class's structure, so an *unrelated* code change (adding a method, reordering members in some cases) can silently produce a different computed UID and make old serialized data unreadable — `InvalidClassException` at deserialization time. Omitting `Serializable` entirely on `Session` fails the same way, with `NotSerializableException`.

### Deserialization risk and ObjectInputFilter

`readObject()` doesn't just populate fields — deserialization constructs objects of whatever class the byte stream claims to be, running that class's own deserialization logic along the way. If the byte stream comes from an untrusted source, that is an invitation to run attacker-chosen code: a crafted stream can instantiate classes never intended to be deserialized (gadget chains) purely by naming them, without calling any application method first. This is a long-standing, high-severity class of Java vulnerability, and the only fully safe answer is not deserializing untrusted data at all.

When deserializing external input can't be avoided, the modern mitigation is `ObjectInputFilter` (`java.io`, since JDK 9): a filter inspects each class, array length, and graph metric (depth, reference count, stream size) *before* it's materialized, and can reject it outright.

```java
ObjectInputFilter filter =
    ObjectInputFilter.Config.createFilter("com.example.Session;!*");

try (ObjectInputStream ois = new ObjectInputStream(new FileInputStream("session.bin"))) {
    ois.setObjectInputFilter(filter);
    Session restored = (Session) ois.readObject();   // anything but Session is rejected
}
```

The pattern is an allow/deny list separated by semicolons: `com.example.Session` allows exactly that class, `!*` denies everything else, and limit patterns like `maxdepth=5;maxrefs=1000;maxbytes=8192;maxarray=10000` cap resource usage (`maxarray` bounds the largest array the stream may allocate). A filter can be set per-stream with `setObjectInputFilter()`, or JVM-wide with `ObjectInputFilter.Config.setSerialFilter()` (or the `jdk.serialFilter` system property) so every `ObjectInputStream` that doesn't set its own filter is covered by default.

> Since JDK 17 (JEP 415), a single global filter isn't the only JVM-wide option: `ObjectInputFilter.Config.setSerialFilterFactory()` (or the `jdk.serialFilterFactory` system property) registers a **filter factory** instead — a function invoked for every `ObjectInputStream` as it's created (and again whenever that stream's filter is set), so different parts of an application can be given different, context-specific filters rather than sharing one filter for the whole JVM. This is the recommended mechanism today for applications that deserialize more than one kind of trusted payload.

## Trade-offs

- **Byte streams vs. character streams is a correctness choice, not just a convenience one.** Reading text through a byte stream without specifying a charset ties the result to the JVM's default charset, which varies by platform; a character stream (or an explicit `Charset` argument) makes the encoding part of the code instead of the environment.
- **try-with-resources removes an entire category of resource-leak bugs, at the cost of the resource's scope being locked to the `try` block.** A resource declared in the `try` is implicitly `final`, so it can't be reassigned or reused outside it — the traditional `finally`-based approach is still occasionally needed, e.g. when a resource must outlive the block that creates it.
- **Serialization is convenient but fragile across class evolution.** Adding, removing, or reordering fields on a `Serializable` class can invalidate a computed `serialVersionUID` and break deserialization of already-persisted data; declaring `serialVersionUID` explicitly turns that into a deliberate versioning decision instead of an accident.
  ```java
  class V1 implements Serializable { int a; }          // no explicit serialVersionUID
  class V2 implements Serializable { int a; int b; }    // different computed UID
  // deserializing V1 data as V2: InvalidClassException
  ```
- **Deserializing untrusted data is a security risk, not just a data-integrity one.** `readObject()` on attacker-controlled bytes can instantiate arbitrary classes on the classpath before any application code runs; `ObjectInputFilter` mitigates this with an allow-list, but the safest option is avoiding deserialization of untrusted input entirely — parsing into a plain data format (JSON, a DTO) instead.
- **Plain `java.io` still earns its place next to NIO.2's `Path`/`Files`.** The stream abstraction (`InputStream`/`Reader` and friends) is what most APIs — HTTP clients, compression libraries, serialization — actually consume, so `java.io` remains the interop layer even in code that otherwise does file-system navigation and bulk file operations through `Path`/`Files` (see the NIO.2 concept for that API in depth).

## Documentation Links

- [InputStream — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/io/InputStream.html) — doc
- [OutputStream — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/io/OutputStream.html) — doc
- [Reader — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/io/Reader.html) — doc
- [Writer — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/io/Writer.html) — doc
- [AutoCloseable — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/AutoCloseable.html) — doc
- [Serializable — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/io/Serializable.html) — doc
- [ObjectInputStream — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/io/ObjectInputStream.html) — doc
- [ObjectInputFilter — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/io/ObjectInputFilter.html) — doc
- [JEP 290: Filter Incoming Serialization Data](https://openjdk.org/jeps/290) — doc
- [JEP 415: Context-Specific Deserialization Filters](https://openjdk.org/jeps/415) — doc
