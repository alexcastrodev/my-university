# Operating on File and Path

> The `Files` utility class (java.nio.file.Files) provides static methods for almost every filesystem operation you need: querying metadata, creating, deleting, copying, moving, and traversing directories. The OCP exam tests both individual method signatures and how these operations interact with the filesystem.

---

## Checking File Metadata

These methods accept a `Path` and return information about the underlying filesystem entry.

```java
Path p = Path.of("/tmp/report.txt");

boolean exists      = Files.exists(p);
boolean isDir       = Files.isDirectory(p);
boolean isFile      = Files.isRegularFile(p);
boolean isReadable  = Files.isReadable(p);
boolean isWritable  = Files.isWritable(p);
boolean isHidden    = Files.isHidden(p);  // throws IOException
long size           = Files.size(p);      // throws IOException
```

`Files.exists()` follows symbolic links by default. Pass `LinkOption.NOFOLLOW_LINKS` to check the link itself rather than its target.

---

## Creating Files and Directories

| Method | Creates | Notes |
|---|---|---|
| `Files.createFile(path)` | A single new empty file | Throws if file already exists |
| `Files.createDirectory(path)` | A single directory | Throws if parent doesn't exist |
| `Files.createDirectories(path)` | Full directory tree | No-op if already exists |
| `Files.createTempFile(dir, prefix, suffix)` | A temp file | Returns the `Path` |

```java
Files.createFile(Path.of("/tmp/new.txt"));

Files.createDirectory(Path.of("/tmp/mydir"));

// Creates /tmp/a/b/c even if /tmp/a and /tmp/a/b don't exist
Files.createDirectories(Path.of("/tmp/a/b/c"));
```

> The exam often tests the difference between `createDirectory` (single level, throws on missing parent) and `createDirectories` (full tree, tolerant of existing directories).

---

## Deleting Files and Directories

```java
Files.delete(Path.of("/tmp/old.txt"));         // throws NoSuchFileException if missing
Files.deleteIfExists(Path.of("/tmp/old.txt"));  // returns false if not found
```

You cannot delete a non-empty directory with either method — you must delete its contents first or use a walk-based approach.

---

## Copying and Moving

```java
Path src  = Path.of("/tmp/original.txt");
Path dest = Path.of("/tmp/copy.txt");

// Copy — throws if dest exists (unless REPLACE_EXISTING is specified)
Files.copy(src, dest);
Files.copy(src, dest, StandardCopyOption.REPLACE_EXISTING);

// Move (rename)
Files.move(src, dest, StandardCopyOption.REPLACE_EXISTING);
```

`Files.copy()` can also copy an `InputStream` to a `Path` and vice-versa, making it useful for reading from network connections or other streams directly to disk.

Copying a directory copies **only the directory itself**, not its contents. Recursive copy requires walking the tree manually.

---

## Reading File Contents

NIO.2 provides convenience methods for reading entire files into memory:

```java
// Read all bytes
byte[] bytes = Files.readAllBytes(Path.of("/tmp/image.png"));

// Read all lines into a List<String>
List<String> lines = Files.readAllLines(Path.of("/tmp/data.csv"));

// Read entire file as a String (Java 11+)
String content = Files.readString(Path.of("/tmp/readme.txt"));
```

These methods are convenient for small files. For large files, prefer streaming approaches (see Lesson 14-4).

---

## Writing File Contents

```java
// Write a String (creates or overwrites)
Files.writeString(Path.of("/tmp/out.txt"), "Hello, World!");

// Append instead of overwrite
Files.writeString(Path.of("/tmp/out.txt"), "More data\n", StandardOpenOption.APPEND);

// Write bytes
byte[] data = new byte[]{65, 66, 67};
Files.write(Path.of("/tmp/bytes.bin"), data);

// Write lines
List<String> lines = List.of("line 1", "line 2", "line 3");
Files.write(Path.of("/tmp/lines.txt"), lines);
```

---

## Traversing Directory Trees

### `Files.list()`

Returns a lazy `Stream<Path>` of the **direct** children of a directory (one level only).

```java
try (Stream<Path> entries = Files.list(Path.of("/tmp"))) {
    entries.filter(Files::isRegularFile)
           .forEach(System.out::println);
}
```

The stream must be closed — use try-with-resources.

### `Files.walk()`

Walks the entire subtree recursively. The root itself is the first element.

```java
try (Stream<Path> tree = Files.walk(Path.of("/home/user/projects"))) {
    tree.filter(p -> p.toString().endsWith(".java"))
        .forEach(System.out::println);
}

// Limit depth — walk only 2 levels deep
try (Stream<Path> tree = Files.walk(Path.of("/home/user"), 2)) {
    tree.forEach(System.out::println);
}
```

### `Files.find()`

Like `walk()` but accepts a `BiPredicate<Path, BasicFileAttributes>` for more expressive filtering.

```java
try (Stream<Path> results = Files.find(
        Path.of("/home/user"),
        Integer.MAX_VALUE,
        (path, attrs) -> attrs.isRegularFile() && attrs.size() > 1_000_000)) {
    results.forEach(System.out::println);
}
```

---

## Comparison: list vs. walk vs. find

| Method | Depth | Filter | Returns |
|---|---|---|---|
| `Files.list(path)` | 1 level | Post-stream | `Stream<Path>` |
| `Files.walk(path)` | Recursive (or bounded) | Post-stream | `Stream<Path>` |
| `Files.find(path, depth, predicate)` | Recursive (or bounded) | Inline with attributes | `Stream<Path>` |

---

## Key Rules Summary

- `Files` is a utility class; all methods are static.
- `createDirectory` requires the parent to exist; `createDirectories` creates the full tree.
- `delete` throws on missing file; `deleteIfExists` returns `false` instead.
- `copy` and `move` require `REPLACE_EXISTING` to overwrite an existing destination.
- `list`, `walk`, and `find` all return lazy streams — always close them with try-with-resources.
- Copying a directory is shallow; recursive copy requires a walk.

---

## References

- [Oracle Docs — Files (java.nio.file)](https://docs.oracle.com/en/java/docs/api/java.base/java/nio/file/Files.html)
- OCP Study Guide, Chapter 14 — I/O
