---
version: 1.0
updatedAt: 2026-08-05
---
## Objective

NIO.2 (`java.nio.file`, added in JDK 7) is the modern replacement for `java.io.File`: it represents a location with the `Path` interface, performs file operations through the static `Files` class, and adds real filesystem features `File` never had — symbolic-link awareness and change notifications through `WatchService`. The core difference isn't cosmetic: `File`'s methods report failure by returning `false` or doing nothing, while `Files` methods throw a specific checked exception that says exactly what went wrong.

## Use Cases

- Deployment scripts that must know *why* a copy or move failed (target exists vs. permission denied vs. source missing) instead of just getting `false` back.
- Build tooling that walks a directory of release artifacts where `current` is a symbolic link to the active version and the code needs to detect and follow (or not follow) that link deliberately.
- One-shot, filtered listing of a directory's immediate entries (by glob or custom predicate) without pulling in a full recursive `Stream<Path>`.
- File-drop or hot-reload pipelines that react to files appearing in a folder instead of polling it on a timer.
- Migrating legacy code built on `java.io.File` incrementally, using `File.toPath()` and `Path.toFile()` as the bridge between the two APIs.

## Deep Dive

### File's silent failures vs. Files' informative exceptions

`java.io.File` reports most failures as a boolean or simply does nothing — it never says *why*:

```java
File target = new File("/no/such/dir/report.txt");
boolean ok = target.createNewFile(); // false — parent doesn't exist, no message at all

File missing = new File("ghost.txt");
boolean deleted = missing.delete();  // false — file never existed, still no message
```

`Files` performs the same operations but throws a specific, informative exception instead:

```java
Path target = Path.of("/no/such/dir/report.txt");
Files.createFile(target);
// throws NoSuchFileException: /no/such/dir/report.txt

Path missing = Path.of("ghost.txt");
Files.delete(missing);
// throws NoSuchFileException: ghost.txt

Path notEmpty = Path.of("some-dir");
Files.delete(notEmpty);
// throws DirectoryNotEmptyException: some-dir (if it contains entries)
```

`deleteIfExists()` is the one method that keeps the "safe, no exception" shape on purpose — it returns `true`/`false` for existence, but still throws if the directory isn't empty or an I/O error occurs, so it isn't a silent-failure method either.

### DirectoryStream: a closeable, filterable, single-use iterator

`Files.list()`/`Files.walk()` (already familiar from the basic NIO topic) return a `Stream<Path>`. `DirectoryStream<Path>`, obtained from `Files.newDirectoryStream()`, is the lower-level NIO.2 primitive they're built on: it implements both `AutoCloseable` and `Iterable<Path>`, so it plugs into try-with-resources and a for-each loop directly:

```java
try (DirectoryStream<Path> stream = Files.newDirectoryStream(Path.of("."))) {
    for (Path entry : stream) {
        System.out.println(entry.getFileName());
    }
}
```

It can filter by glob directly, without a separate `Stream.filter()` step:

```java
try (DirectoryStream<Path> java = Files.newDirectoryStream(dir, "*.java")) {
    for (Path p : java) System.out.println(p);
}
```

Or by a custom `DirectoryStream.Filter<Path>` when the condition isn't name-based:

```java
DirectoryStream.Filter<Path> writable = Files::isWritable;
try (DirectoryStream<Path> stream = Files.newDirectoryStream(dir, writable)) {
    for (Path p : stream) System.out.println(p);
}
```

Its iterator can only be obtained once — calling `iterator()` (or running the for-each) a second time on the same instance throws:

```java
DirectoryStream<Path> stream = Files.newDirectoryStream(dir);
stream.iterator(); // fine
stream.iterator(); // throws IllegalStateException: iterator has already been returned
```

An I/O error mid-iteration (e.g., the directory is removed underneath you) surfaces as `DirectoryIteratorException` wrapping the real `IOException`, thrown from `hasNext()`/`next()` rather than from `newDirectoryStream()` itself.

### Symbolic links: a filesystem feature File can't see

`java.io.File` has no concept of a symbolic link at all — it follows one transparently and exposes no method to detect it existed. NIO.2 makes links a first-class, inspectable thing:

```java
Path link = Path.of("current");
Files.createSymbolicLink(link, Path.of("release-2.3.0"));

Files.isSymbolicLink(link);      // true
Files.readSymbolicLink(link);    // release-2.3.0 (the link's target, not resolved)
Files.isDirectory(link);         // follows the link by default → true, if target is a dir
Files.isDirectory(link, LinkOption.NOFOLLOW_LINKS); // false — link itself isn't a directory
```

`readSymbolicLink()` throws `NotLinkException` if the path isn't actually a symbolic link — another example of a specific, named failure instead of a boolean. `isSymbolicLink()` itself doesn't follow that same "throw on trouble" pattern: it quietly returns `false` both when the path isn't a link *and* when the path doesn't exist at all, so a `false` result alone doesn't tell you which case you're in.

Most `Files` methods that touch link targets (`copy`, `isDirectory`, `readAttributes`, ...) accept `LinkOption.NOFOLLOW_LINKS` to operate on the link itself instead of transparently following it — there is no equivalent switch anywhere in `File`.

### WatchService: reacting to filesystem changes instead of polling

`Path` implements `Watchable`, so any path can register with a `WatchService` for specific kinds of events instead of a program re-scanning a directory on a timer:

```java
try (WatchService watcher = FileSystems.getDefault().newWatchService()) {
    Path dir = Path.of("incoming");
    dir.register(watcher,
        StandardWatchEventKinds.ENTRY_CREATE,
        StandardWatchEventKinds.ENTRY_DELETE,
        StandardWatchEventKinds.ENTRY_MODIFY);

    while (true) {
        WatchKey key = watcher.take(); // blocks until an event is queued
        for (WatchEvent<?> event : key.pollEvents()) {
            if (event.kind() == StandardWatchEventKinds.OVERFLOW) {
                continue; // events may have been lost — consider re-scanning the directory
            }
            Path changed = (Path) event.context(); // name relative to the registered dir
            System.out.println(event.kind() + ": " + changed);
        }
        if (!key.reset()) break; // the watched directory became inaccessible
    }
}
```

`take()` blocks until a `WatchKey` has events; `poll()`/`poll(timeout, unit)` give a non-blocking or timed alternative. `key.reset()` must be called after processing to put the key back in the ready state — forgetting it means the key never fires again even though events keep occurring. `File` has no equivalent: detecting changes with it means writing your own polling loop that compares timestamps or directory listings.

## Trade-offs

- **Exceptions demand handling, not just an `if`** — `Files` methods force a `try`/`catch` (or a `throws` declaration) for each specific failure mode instead of a single boolean check, which is more verbose but removes the "it returned false, now guess why" debugging step.
- **`DirectoryStream`'s iterator is single-use** — reusing an instance across two loops is a bug, not a style choice:

```java
DirectoryStream<Path> ds = Files.newDirectoryStream(dir);
for (Path p : ds) { /* ok */ }
for (Path p : ds) { /* IllegalStateException at iterator() */ }
```

- **Symbolic link support is filesystem- and OS-dependent** — `Files.createSymbolicLink()` throws `UnsupportedOperationException` on filesystems without link support, and on Windows it typically requires elevated privileges or Developer Mode; code that creates links needs a fallback path or a documented requirement.
- **`WatchService` is best-effort, not a real-time guarantee** — events can coalesce, arrive with platform-dependent latency, and overflow into a single `OVERFLOW` event if too many queue up before you drain them; it's unreliable over network filesystems and isn't a substitute for verifying state with `Files` after an event fires.

## Documentation Links

- [Files — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/file/Files.html) — doc
- [Path — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/file/Path.html) — doc
- [DirectoryStream — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/file/DirectoryStream.html) — doc
- [WatchService — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/file/WatchService.html) — doc
