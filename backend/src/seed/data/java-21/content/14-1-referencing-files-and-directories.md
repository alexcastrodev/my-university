# Referencing Files and Directories

> Before reading or writing any data, you must be able to refer to a file or directory on the filesystem. Java provides two main APIs: the legacy `File` class and the modern NIO.2 `Path` interface introduced in Java 7. The OCP exam expects you to know both.

---

## The Legacy `File` Class

`java.io.File` was the original way to represent a path. It still appears in older APIs and some exam questions.

```java
File f1 = new File("/home/user/data.txt");         // absolute
File f2 = new File("config/settings.properties"); // relative to working directory
File dir = new File("/home/user");
File child = new File(dir, "data.txt");            // parent + child constructor
```

Key methods on `File`:

| Method | Description |
|---|---|
| `exists()` | Returns `true` if the path exists on disk |
| `isFile()` | `true` if it exists and is a regular file |
| `isDirectory()` | `true` if it exists and is a directory |
| `getName()` | Last element of the path |
| `getParent()` | Parent path as a `String` |
| `getAbsolutePath()` | Full path as a `String` |
| `toPath()` | Converts to a NIO.2 `Path` |

`File` has significant limitations: methods return `boolean` rather than throwing exceptions on failure, and it has poor support for symbolic links and file attributes.

---

## The NIO.2 `Path` Interface

`java.nio.file.Path` is the modern replacement. A `Path` is an immutable object representing a path in the filesystem. It does **not** require the file to exist.

### Creating a Path

```java
// Path.of() — preferred since Java 11
Path p1 = Path.of("/home/user/data.txt");
Path p2 = Path.of("/home", "user", "data.txt");   // variadic form
Path p3 = Path.of("config", "settings.properties");

// Paths.get() — older form, still valid on the exam
Path p4 = Paths.get("/home/user/data.txt");
Path p5 = Paths.get("/home", "user", "data.txt");
```

`Path.of()` and `Paths.get()` are functionally equivalent. Prefer `Path.of()` in new code.

---

## Absolute vs. Relative Paths

| Type | Description | Example (Unix) | Example (Windows) |
|---|---|---|---|
| Absolute | Starts from filesystem root | `/home/user/file.txt` | `C:\Users\user\file.txt` |
| Relative | Resolved against the current working directory | `docs/readme.txt` | `docs\readme.txt` |

```java
Path abs = Path.of("/tmp/logs/app.log");   // absolute — starts with /
Path rel = Path.of("logs/app.log");        // relative — no leading /

System.out.println(abs.isAbsolute()); // true
System.out.println(rel.isAbsolute()); // false
```

### Path Resolution

`resolve()` appends one path to another. If the argument is absolute, it replaces the base entirely.

```java
Path base = Path.of("/home/user");
Path resolved = base.resolve("documents/notes.txt");
// → /home/user/documents/notes.txt

Path absolute = base.resolve(Path.of("/etc/passwd"));
// → /etc/passwd  (absolute argument replaces base)
```

---

## Navigating Path Components

`Path` exposes individual components of the path string.

```java
Path p = Path.of("/home/user/projects/demo/Main.java");

p.getFileName();       // Main.java
p.getParent();         // /home/user/projects/demo
p.getRoot();           // /  (null for relative paths)
p.getNameCount();      // 5  (home, user, projects, demo, Main.java)
p.getName(0);          // home
p.getName(4);          // Main.java
p.subpath(1, 3);       // user/projects  (start inclusive, end exclusive)
```

> `getNameCount()` does **not** count the root (`/`). Index 0 is the element immediately after the root.

---

## Normalizing and Resolving Symbols

Paths can contain redundant elements like `.` (current directory) and `..` (parent directory). `normalize()` collapses them.

```java
Path messy = Path.of("/home/user/../user/./projects");
Path clean = messy.normalize();
// → /home/user/projects
```

`toAbsolutePath()` prepends the current working directory to a relative path without checking the filesystem.

```java
Path rel = Path.of("data/file.txt");
Path abs = rel.toAbsolutePath();
// → /current/working/dir/data/file.txt  (depends on JVM working dir)
```

`toRealPath()` combines `toAbsolutePath()` + `normalize()` **and** follows symbolic links — but it requires the file to actually exist and may throw `IOException`.

---

## Converting Between `File` and `Path`

```java
// File → Path
File file = new File("/tmp/data.txt");
Path path = file.toPath();

// Path → File
Path p = Path.of("/tmp/data.txt");
File f = p.toFile();
```

---

## Key Rules Summary

- `File` is legacy; prefer `Path` / NIO.2 for new code.
- Use `Path.of()` or `Paths.get()` to create `Path` objects — no `new` keyword.
- `Path` is immutable; all transformation methods return new instances.
- `getNameCount()` counts elements after the root; index is 0-based.
- `subpath(start, end)` is start-inclusive, end-exclusive.
- `normalize()` removes `.` and `..`; `toRealPath()` also resolves symlinks and requires the file to exist.

---

## References

- [Oracle Docs — Path (java.nio.file)](https://docs.oracle.com/en/java/docs/api/java.base/java/nio/file/Path.html)
- OCP Study Guide, Chapter 14 — I/O
