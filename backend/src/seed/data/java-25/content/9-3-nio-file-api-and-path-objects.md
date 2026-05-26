# java.nio.file API and Path Objects

---

## Overview

`java.nio.file` (introduced in Java 7) modernises file-system access with the `Path` interface and the `Files` utility class. They replace most uses of `java.io.File` and integrate cleanly with the Stream API.

---

## Path — Representing a File-System Location

`Path` is an **interface** in `java.nio.file`. It represents an abstract, immutable path that may or may not correspond to an existing file.

### Creating a Path

```java
import java.nio.file.Path;
import java.nio.file.Paths;

// Preferred since Java 11
Path p1 = Path.of("/home/user/docs/report.txt");
Path p2 = Path.of("relative/dir", "file.txt");

// Legacy — delegates to Path.of internally
Path p3 = Paths.get("/home/user/docs/report.txt");
```

> **Exam tip:** `Path.of()` and `Paths.get()` are functionally equivalent. Prefer `Path.of()` in modern code.

---

## Absolute vs Relative Paths

| Kind | Description | Example |
|------|-------------|---------|
| Absolute | Starts from the file-system root | `/home/user/file.txt` (Unix), `C:\file.txt` (Windows) |
| Relative | Interpreted relative to the current working directory | `docs/file.txt` |

```java
Path abs = Path.of("/usr/local/bin");
Path rel = Path.of("config/app.properties");

abs.isAbsolute();  // true
rel.isAbsolute();  // false

// Convert relative to absolute
Path absoluteRel = rel.toAbsolutePath();
```

---

## Path Navigation Methods

| Method | Description |
|--------|-------------|
| `getFileName()` | Last element of the path |
| `getParent()` | All elements except the last; `null` if none |
| `getRoot()` | Root component (`/` or drive letter); `null` for relative paths |
| `getNameCount()` | Number of name elements (not counting root) |
| `getName(int)` | Element at the given index (0-based) |
| `subpath(int, int)` | Sub-path between indices (exclusive end) |

```java
Path p = Path.of("/home/user/docs/report.txt");

p.getFileName();       // report.txt
p.getParent();         // /home/user/docs
p.getRoot();           // /
p.getNameCount();      // 4
p.getName(0);          // home
p.subpath(1, 3);       // user/docs
```

---

## resolve(), relativize(), normalize()

### resolve — Appending a Path

```java
Path base = Path.of("/home/user");
Path full = base.resolve("docs/report.txt");
// full → /home/user/docs/report.txt

// If the argument is absolute, it replaces base entirely
Path abs  = base.resolve(Path.of("/etc/hosts"));
// abs → /etc/hosts
```

### relativize — Computing a Relative Path

```java
Path from = Path.of("/home/user");
Path to   = Path.of("/home/user/docs/report.txt");

Path rel  = from.relativize(to);
// rel → docs/report.txt
```

Both paths must be the same kind (both absolute or both relative).

### normalize — Eliminating Redundant Elements

```java
Path p = Path.of("/home/user/../user/./docs");
p.normalize();  // /home/user/docs
```

`normalize()` resolves `.` (current directory) and `..` (parent directory) lexically — it does not access the file system.

> **Exam tip:** `normalize()` is purely lexical. `toRealPath()` resolves symbolic links and requires the path to exist.

---

## Files Utility Class — Checking File Attributes

All `Files` methods accept a `Path` argument.

| Method | Returns | Description |
|--------|---------|-------------|
| `Files.exists(Path)` | `boolean` | `true` if the path exists |
| `Files.notExists(Path)` | `boolean` | `true` if the path provably does not exist |
| `Files.isRegularFile(Path)` | `boolean` | `true` if a regular file (not directory or link) |
| `Files.isDirectory(Path)` | `boolean` | `true` if a directory |
| `Files.isSymbolicLink(Path)` | `boolean` | `true` if a symbolic link |
| `Files.isReadable(Path)` | `boolean` | File exists and is readable |
| `Files.isWritable(Path)` | `boolean` | File exists and is writable |
| `Files.isHidden(Path)` | `boolean` | Platform-specific hidden flag |
| `Files.size(Path)` | `long` | File size in bytes |
| `Files.getLastModifiedTime(Path)` | `FileTime` | Last-modified timestamp |

```java
Path p = Path.of("data.csv");

if (Files.exists(p) && Files.isRegularFile(p)) {
    System.out.println("Size: " + Files.size(p));
}
```

---

## Files Utility Class — Creating and Deleting

| Method | Description |
|--------|-------------|
| `Files.createFile(Path)` | Creates a new empty file; throws if already exists |
| `Files.createDirectory(Path)` | Creates a single directory; throws if parent missing |
| `Files.createDirectories(Path)` | Creates directory and all missing parents |
| `Files.createTempFile(Path, String, String)` | Creates temp file in given directory |
| `Files.delete(Path)` | Deletes file or empty directory; throws if not found |
| `Files.deleteIfExists(Path)` | Deletes if exists; no exception if not found |

```java
Files.createDirectories(Path.of("output/reports/2025"));

Path tmp = Files.createTempFile(Path.of("/tmp"), "log-", ".txt");

Files.delete(Path.of("old.txt"));           // NoSuchFileException if missing
Files.deleteIfExists(Path.of("maybe.txt")); // safe — no exception if absent
```

---

## Files Utility Class — Copying and Moving

```java
import java.nio.file.StandardCopyOption;

Path src  = Path.of("source.txt");
Path dest = Path.of("backup/source.txt");

Files.copy(src, dest);
Files.copy(src, dest, StandardCopyOption.REPLACE_EXISTING);
Files.copy(src, dest, StandardCopyOption.REPLACE_EXISTING,
                      StandardCopyOption.COPY_ATTRIBUTES);

Files.move(src, dest, StandardCopyOption.REPLACE_EXISTING);
```

`StandardCopyOption` values:

| Option | Effect |
|--------|--------|
| `REPLACE_EXISTING` | Overwrites target if it already exists |
| `COPY_ATTRIBUTES` | Copies file attributes (timestamps, permissions) |
| `ATOMIC_MOVE` | Move is performed as a single atomic operation (move only) |

> **Exam tip:** Without `REPLACE_EXISTING`, both `copy` and `move` throw `FileAlreadyExistsException` if the target exists.

---

## Listing and Walking Directories

### Files.list() — Shallow Listing

Returns a lazy `Stream<Path>` of the immediate contents of a directory (not recursive).

```java
try (Stream<Path> entries = Files.list(Path.of("/home/user/docs"))) {
    entries.filter(Files::isRegularFile)
           .forEach(System.out::println);
}
```

### Files.walk() — Recursive Tree Walk

Returns a lazy `Stream<Path>` starting at the given root, depth-first.

```java
try (Stream<Path> tree = Files.walk(Path.of("/home/user"))) {
    tree.filter(p -> p.toString().endsWith(".java"))
        .forEach(System.out::println);
}

// Limit depth
try (Stream<Path> shallow = Files.walk(Path.of("/home/user"), 2)) {
    shallow.forEach(System.out::println);
}
```

### Files.find() — Walk with a BiPredicate

Combines walking with a filter that has access to `BasicFileAttributes`:

```java
try (Stream<Path> found = Files.find(
        Path.of("/home/user"),
        Integer.MAX_VALUE,
        (path, attrs) -> attrs.isRegularFile() && attrs.size() > 1024)) {
    found.forEach(System.out::println);
}
```

> **Exam tip:** `Files.list()`, `Files.walk()`, and `Files.find()` all return a `Stream` that holds an open directory handle. Always close them with try-with-resources.

---

## Reading and Writing Text with Files

| Method | Description |
|--------|-------------|
| `Files.readString(Path)` | Reads entire file as `String` (UTF-8) |
| `Files.readAllLines(Path)` | Returns `List<String>` of all lines |
| `Files.lines(Path)` | Returns lazy `Stream<String>` of lines |
| `Files.writeString(Path, CharSequence, OpenOption...)` | Writes text to file |
| `Files.write(Path, Iterable<?>)` | Writes lines to file |

```java
Path p = Path.of("notes.txt");

Files.writeString(p, "Line 1\nLine 2\n");

String all = Files.readString(p);

List<String> lines = Files.readAllLines(p);

try (Stream<String> stream = Files.lines(p)) {
    stream.map(String::toUpperCase).forEach(System.out::println);
}
```

---

## Obtaining a Buffered Reader / Writer

For large files, use `Files.newBufferedReader()` and `Files.newBufferedWriter()` which default to UTF-8:

```java
try (BufferedReader br = Files.newBufferedReader(Path.of("big.csv"))) {
    String line;
    while ((line = br.readLine()) != null) {
        process(line);
    }
}

try (BufferedWriter bw = Files.newBufferedWriter(Path.of("out.txt"),
        StandardOpenOption.CREATE, StandardOpenOption.APPEND)) {
    bw.write("appended line");
    bw.newLine();
}
```

---

## Key Points for the Exam

- `Path` is an interface; create instances with `Path.of()` or `Paths.get()`.
- `Path` objects are immutable — methods return new `Path` instances.
- `normalize()` is lexical (no I/O); `toRealPath()` resolves links and requires the path to exist.
- `resolve()` with an absolute argument replaces the base path entirely.
- `Files.createDirectory()` requires the parent to exist; `Files.createDirectories()` creates all missing parents.
- `Files.delete()` throws `NoSuchFileException` if the path does not exist; `Files.deleteIfExists()` does not.
- `REPLACE_EXISTING` is required to overwrite an existing target in `copy()` or `move()`.
- `Files.list()`, `Files.walk()`, and `Files.find()` return lazy streams that must be closed.

## References

- [Oracle Docs — Path (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/file/Path.html)
- [Oracle Docs — Files (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/file/Files.html)
