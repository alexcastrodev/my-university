# Working with Advanced APIs

> Java NIO.2 goes beyond basic file operations. This lesson covers `DirectoryStream` for memory-efficient directory traversal, `WatchService` for filesystem event monitoring, `BasicFileAttributes` for rich metadata access, and how to read and set file attributes and permissions — all topics that appear in OCP exam scenarios.

---

## `Files.walk` vs `Files.find` — Revisited

Both return a lazy `Stream<Path>`, but they differ in how filtering works:

```java
// walk + filter (filtering happens after path emission)
try (Stream<Path> s = Files.walk(Path.of("/app/logs"), 3)) {
    s.filter(p -> p.toString().endsWith(".log"))
     .forEach(System.out::println);
}

// find — filtering happens during traversal via BiPredicate<Path, BasicFileAttributes>
try (Stream<Path> s = Files.find(
        Path.of("/app/logs"),
        3,
        (path, attrs) -> attrs.isRegularFile()
                      && attrs.size() > 1024
                      && path.toString().endsWith(".log"))) {
    s.forEach(System.out::println);
}
```

`Files.find` is more efficient when you need to filter on file attributes (size, last-modified, type) because the attributes are fetched once per entry rather than requiring a separate `Files.readAttributes()` call.

---

## `DirectoryStream`

`Files.newDirectoryStream()` returns a `DirectoryStream<Path>` that streams the direct children of a directory. It uses less memory than collecting all entries into a list and supports glob-pattern filtering.

```java
// Iterate direct children
try (DirectoryStream<Path> ds = Files.newDirectoryStream(Path.of("/tmp"))) {
    for (Path entry : ds) {
        System.out.println(entry.getFileName());
    }
}

// With glob filter — only .java files
try (DirectoryStream<Path> ds =
        Files.newDirectoryStream(Path.of("/src"), "*.java")) {
    for (Path entry : ds) {
        System.out.println(entry);
    }
}

// With a custom filter (DirectoryStream.Filter functional interface)
try (DirectoryStream<Path> ds = Files.newDirectoryStream(
        Path.of("/tmp"),
        path -> Files.isRegularFile(path) && Files.size(path) > 0)) {
    for (Path entry : ds) {
        System.out.println(entry);
    }
}
```

`DirectoryStream` does **not** recurse into subdirectories. Use `Files.walk` for recursive traversal.

---

## `BasicFileAttributes`

`BasicFileAttributes` provides a snapshot of a file's metadata. Reading all attributes at once is more efficient than calling individual `Files.isDirectory()`, `Files.size()`, etc. methods separately.

```java
Path p = Path.of("/tmp/report.pdf");
BasicFileAttributes attrs = Files.readAttributes(p, BasicFileAttributes.class);

System.out.println("Regular file : " + attrs.isRegularFile());
System.out.println("Directory    : " + attrs.isDirectory());
System.out.println("Symbolic link: " + attrs.isSymbolicLink());
System.out.println("Size (bytes) : " + attrs.size());
System.out.println("Created      : " + attrs.creationTime());
System.out.println("Last modified: " + attrs.lastModifiedTime());
System.out.println("Last accessed: " + attrs.lastAccessTime());
```

`FileTime` objects returned by the time methods implement `Comparable` and have a `toInstant()` method for integration with `java.time`.

```java
Instant modified = attrs.lastModifiedTime().toInstant();
boolean isRecent = modified.isAfter(Instant.now().minus(Duration.ofDays(7)));
```

---

## Platform-Specific Attributes

`PosixFileAttributes` (Unix/macOS) and `DosFileAttributes` (Windows) extend `BasicFileAttributes` with platform-specific metadata.

```java
// POSIX attributes — owner, group, permissions
PosixFileAttributes posix = Files.readAttributes(p, PosixFileAttributes.class);
System.out.println("Owner      : " + posix.owner().getName());
System.out.println("Group      : " + posix.group().getName());
System.out.println("Permissions: " + PosixFilePermissions.toString(posix.permissions()));
// e.g., "rwxr-xr--"
```

---

## Setting File Permissions

```java
// Set permissions using a PosixFilePermission set
Set<PosixFilePermission> perms = PosixFilePermissions.fromString("rwxr-x---");
Files.setPosixFilePermissions(p, perms);

// Create a file with specific permissions from the start
FileAttribute<Set<PosixFilePermission>> attr =
    PosixFilePermissions.asFileAttribute(perms);
Files.createFile(Path.of("/tmp/secure.txt"), attr);
```

`PosixFilePermissions.fromString()` interprets a 9-character string in `rwxrwxrwx` format (owner/group/others).

---

## `WatchService`

`WatchService` monitors a directory for filesystem events without polling. It is backed by native OS mechanisms (inotify on Linux, FSEvents on macOS, ReadDirectoryChangesW on Windows).

```java
Path dir = Path.of("/tmp/watched");
WatchService watcher = FileSystems.getDefault().newWatchService();

// Register events to watch
dir.register(watcher,
    StandardWatchEventKinds.ENTRY_CREATE,
    StandardWatchEventKinds.ENTRY_DELETE,
    StandardWatchEventKinds.ENTRY_MODIFY);

// Event loop — typically runs on a background thread
while (true) {
    WatchKey key = watcher.take();   // blocks until an event occurs
    for (WatchEvent<?> event : key.pollEvents()) {
        WatchEvent.Kind<?> kind = event.kind();
        Path filename = (Path) event.context();

        if (kind == StandardWatchEventKinds.ENTRY_CREATE) {
            System.out.println("Created: " + dir.resolve(filename));
        } else if (kind == StandardWatchEventKinds.ENTRY_MODIFY) {
            System.out.println("Modified: " + dir.resolve(filename));
        } else if (kind == StandardWatchEventKinds.ENTRY_DELETE) {
            System.out.println("Deleted: " + dir.resolve(filename));
        }
    }
    boolean valid = key.reset();   // re-register the key for future events
    if (!valid) break;             // directory no longer accessible
}
```

Key points:
- `take()` blocks; `poll()` returns immediately (`null` if no event).
- Always call `key.reset()` after processing; if it returns `false`, the key is no longer valid.
- `WatchService` watches only one directory level — not subdirectories.

---

## `FileAttribute` Summary

| Attribute type | Platform | Access via |
|---|---|---|
| `BasicFileAttributes` | All | `Files.readAttributes(p, BasicFileAttributes.class)` |
| `PosixFileAttributes` | Unix/macOS | `Files.readAttributes(p, PosixFileAttributes.class)` |
| `DosFileAttributes` | Windows | `Files.readAttributes(p, DosFileAttributes.class)` |

---

## Key Rules Summary

- `Files.find` is more efficient than `Files.walk` when filtering on file attributes.
- `DirectoryStream` covers only direct children; close it with try-with-resources.
- `BasicFileAttributes` provides a single-call metadata snapshot — prefer it over multiple `Files.*` calls.
- `WatchService` uses native OS events; `take()` blocks until an event arrives.
- After processing `WatchKey` events, call `reset()` — a `false` return means the directory is gone.
- `PosixFilePermissions.fromString("rwxr-x---")` converts a permission string to a `Set<PosixFilePermission>`.

---

## References

- [Oracle Docs — WatchService](https://docs.oracle.com/en/java/docs/api/java.base/java/nio/file/WatchService.html)
- [Oracle Docs — BasicFileAttributes](https://docs.oracle.com/en/java/docs/api/java.base/java/nio/file/attribute/BasicFileAttributes.html)
- OCP Study Guide, Chapter 14 — I/O
