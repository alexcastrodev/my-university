---
version: 1.0
updatedAt: 2026-08-19
---
## Objective

A running JVM can answer "what am I running on, and how was I configured?" through three genuinely different channels: **environment variables** (`System.getenv`) — set by the OS shell, inherited by every child process; **system properties** (`System.getProperty`) — JVM-scoped key/value pairs set with `-D`, visible only to this JVM unless explicitly forwarded; and the **`Runtime` class** — live facts about this specific JVM instance (available processors, heap usage, the exact platform version). Confusing these three, or reaching for string-parsing where a structured API already exists, is the recurring mistake this concept exists to head off.

## Use Cases

- Reading twelve-factor-style configuration (`DATABASE_URL`, `PORT`) from the environment in a containerized service, as opposed to a JVM-specific `-D` flag that a container orchestrator would have to know to set.
- Sizing a thread pool or a work-stealing pool to the number of CPUs actually available to the process — which, in a container, is not necessarily the host machine's physical core count.
- Detecting at startup whether an optional dependency or platform feature is present, and failing with a clear message instead of a confusing `NoClassDefFoundError` deep in unrelated code.
- Writing a path or line-ending manipulation that behaves correctly on both Unix and Windows without hardcoding `/` or `\n`.
- Diagnosing a memory problem by reading `Runtime`'s live heap figures, or comparing `Runtime.version()` against a known-bad or known-good JDK build during an incident.

## Deep Dive

### Environment variables vs. system properties: not the same channel

```java
String path = System.getenv("PATH");                 // from the OS environment
Map<String, String> allEnv = System.getenv();         // immutable snapshot, whole environment

String version = System.getProperty("java.version");  // from the JVM's own Properties object
System.getProperties().forEach((k, v) -> System.out.println(k + "=" + v));
```

```
$ java -Dpencil.color="Deep Sea Green" -cp . App
```

The distinction that actually matters: **environment variables are inherited by every child process** the JVM launches (via `ProcessBuilder`, `Runtime.exec`, or a shell script that starts the JVM itself), while **a `-D` system property is visible only inside this one JVM** — it is not automatically forwarded to a subprocess. A configuration value a subprocess needs has to be either an environment variable, or explicitly copied into that subprocess's own environment/arguments via `ProcessBuilder.environment()` or a command-line argument.

`System.getenv()` is case-sensitive on some platforms and case-insensitive on others (Windows) — code that reads a specific variable name should not assume either behavior transfers across platforms. Properties whose names start with `sun.` (`sun.boot.library.path`, `sun.arch.data.model`) are internal, undocumented, and have disappeared or changed across releases without notice — treat them as debugging curiosities, never as something production code depends on.

### Detecting the platform and its features

```java
String spec = System.getProperty("java.specification.version");   // "25"
String os   = System.getProperty("os.name");                       // "Linux", "Mac OS X", "Windows 11"
```

For anything beyond display, `Runtime.version()` (JDK 9+, JEP 223) is the API worth reaching for instead of parsing `java.version`'s string by hand:

```java
Runtime.Version v = Runtime.version();
v.feature();     // 25 — the feature release number (what most people mean by "Java 25")
v.interim();     // 0
v.update();      // 1  (for "25.0.1")

if (Runtime.version().feature() >= 21) {
    // safe to use a feature that requires JDK 21+
}
```

`Runtime.Version` implements `Comparable<Runtime.Version>`, so version comparisons are a method call, not a regex over a string that has changed shape across JDK releases (`"1.8.0_202"` vs. `"17.0.1"` vs. `"25"`).

For "is this optional class/library actually on the classpath," a coarse but effective probe is:

```java
try {
    Class.forName("javax.swing.JButton");
} catch (ClassNotFoundException e) {
    System.err.println("This build needs a JRE with Swing available.");
}
```

This only tells you the class is loadable, not that a specific method or field exists on it — for that finer-grained check, or for a real module-level "is this dependency present" answer instead of an ad hoc probe, see the `classpath-scanning-via-reflection` and `java-platform-module-system` concepts.

### Platform-dependent constants, made platform-independent

```java
File.separator;         // "/" on Unix/macOS, "\" on Windows
File.separatorChar;
File.pathSeparator;     // ":" on Unix/macOS, ";" on Windows — the PATH-list delimiter
System.lineSeparator();  // "\n", "\r\n", ...
```

Java's own file-handling code accepts both `/` and `\` on Windows, so hardcoded forward slashes usually work by accident — but code that *constructs* a path for display, or writes it into a file another program will parse strictly, should use these constants (or better, `java.nio.file.Path`, which never needs a separator character spelled out at all) rather than assume the accident holds everywhere.

### `Runtime`: live facts about this JVM

```java
Runtime rt = Runtime.getRuntime();

rt.availableProcessors();   // CPUs visible to this process — container-aware since JDK 10
rt.totalMemory();           // bytes currently allocated to the JVM's heap
rt.freeMemory();            // bytes free within that allocated heap
rt.maxMemory();              // bytes the heap is allowed to grow to (-Xmx)
```

`availableProcessors()` is the number to size a thread pool against, not the host machine's physical core count — since JDK 10 (JDK-8146115), the JVM reads the container's cgroup CPU quota when running under Docker/Kubernetes with a CPU limit set, so a pod capped at 2 CPUs reports `2` here even on a 64-core host node. Sizing `ForkJoinPool`/`ExecutorService` off this number, rather than a hardcoded constant, is what makes the same container image size itself correctly regardless of where it's scheduled.

`rt.exec(...)` and `Runtime.addShutdownHook(...)` exist here too, but `ProcessBuilder` is the modern, more controllable way to launch a process (covered in `java-lang-essential-utility-types`), and shutdown-hook mechanics and ordering are covered in depth in `executor-shutdown-and-jvm-exit` — both are cross-referenced rather than re-explained here.

## Trade-offs

- **`sun.*` properties are an implementation detail, not an API** — they've appeared, changed shape, and vanished across releases without a deprecation cycle, because they were never a supported contract in the first place. Reading `os.name`/`java.specification.version`/`file.separator` is safe; reading anything under `sun.` in production code is a latent portability bug.
- **Environment variables and system properties solve different propagation problems.** Reaching for a `-D` flag when the real need is "this subprocess must see this value too" produces code that works from the command line and silently breaks the moment that logic runs inside a subprocess `ProcessBuilder` launches — check which of the two a value actually needs to reach before picking one.
- **`availableProcessors()`'s container-awareness is a JVM-version-dependent behavior, not something the number itself declares.** Code sizing a pool off this value on an old JDK (pre-10) or without cgroup limits set at all gets the host's raw CPU count instead — the number is only as meaningful as the platform reporting it.
- **`Class.forName` probing tells you a class loaded, nothing more.** A class that loads but is missing a method your code calls next still fails, just later and with a less obvious `NoSuchMethodError` — it's a coarse presence check, not a real capability check, and a real module boundary (`requires`/`uses`/`provides`, see `java-platform-module-system`) is the more precise tool when you control the dependency's packaging.
- **`totalMemory()`/`freeMemory()` describe the heap's currently allocated region, not the JVM's actual memory ceiling** — `totalMemory()` can be well below `maxMemory()` if the heap hasn't grown yet, so a naive `freeMemory()/maxMemory()` ratio can read as "nearly full" immediately after startup even though the heap has plenty of room left to grow into.

## Documentation Links

- [System — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/System.html) — doc
- [Runtime — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Runtime.html) — doc
- [Runtime.Version — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Runtime.Version.html) — doc
- [JEP 223: New Version-String Scheme](https://openjdk.org/jeps/223) — doc
- [File — Java SE 25 API (separator, pathSeparator fields)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/io/File.html) — doc
- [JDK-8146115: Docker container CPU/memory awareness](https://bugs.openjdk.org/browse/JDK-8146115) — doc
