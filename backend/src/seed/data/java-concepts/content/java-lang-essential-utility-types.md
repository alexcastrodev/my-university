---
version: 1.0
updatedAt: 2026-08-05
---
## Objective

`java.lang` bundles a handful of small, single-purpose contracts that don't
belong to collections, strings, or numbers, but that quietly underlie
everyday code: `Comparable` gives a type its one natural ordering,
`AutoCloseable` is the contract that makes try-with-resources possible,
`StackWalker` is the modern, stream-based way to inspect the current call
stack, and `ProcessBuilder` is how a Java program launches and controls
another operating-system process. They don't share an inheritance
relationship — each is covered here because it's a small tool that shows up
constantly, not because they form one API.

## Use Cases

- Giving a class one default sort order that `Collections.sort()`,
  `TreeSet`, and `TreeMap` use automatically when no comparator is supplied.
- Writing a custom resource wrapper (a native handle, a pooled connection)
  that needs to plug into try-with-resources instead of a manual
  `finally { close(); }`.
- Building a logging, debugging, or framework utility that needs to know
  which class called a method, without paying for a full stack trace up
  front.
- Launching an external tool (a compiler, a shell script, another JVM) from
  inside a Java program, feeding it input, capturing its output, and
  reacting once it exits.

## Deep Dive

### Comparable and the compareTo contract

`Comparable<T>` declares exactly one method:

```java
public interface Comparable<T> {
    int compareTo(T other);
}
```

`compareTo()` returns a negative number if the invoking object is "less
than" `other`, zero if they're equal, and a positive number if it's
"greater than" — the exact magnitude doesn't matter, only the sign. This
is the type's *natural ordering*: `Byte`, `Character`, `Double`, `Integer`,
`Long`, `String`, and `Enum` all implement it, and it's what `TreeSet`,
`TreeMap`, and `Collections.sort()` fall back to when no `Comparator` is
given.

```java
class Version implements Comparable<Version> {
    final int major;
    Version(int major) { this.major = major; }

    @Override
    public int compareTo(Version other) {
        return Integer.compare(this.major, other.major);
    }
}
```

`Comparable` is baked into the type — a class gets exactly one ordering
this way. `Comparator<T>` lives outside the type and can define any number
of orderings for the same class without touching it; see
[Comparators and Collection Algorithms](/java-concepts/comparators-and-collection-algorithms)
for `Comparator.comparing()`, `thenComparing()`, and the `Collections`
algorithms built on top of both.

### AutoCloseable vs. Closeable

`AutoCloseable` is what makes try-with-resources work. It declares one
method:

```java
public interface AutoCloseable {
    void close() throws Exception;
}
```

Any object whose class implements `AutoCloseable` can appear in a
try-with-resources statement; `close()` is called automatically when the
block exits, success or failure:

```java
try (var resource = acquireResource()) {
    resource.use();
} // close() called here, no matter how the block exits
```

`java.io.Closeable` extends `AutoCloseable` and narrows it in two ways:
its `close()` declares only `throws IOException` instead of the broad
`Exception`, and it's documented to be *idempotent* — calling it more than
once must have no further effect. `AutoCloseable.close()` carries no such
guarantee; the Javadoc explicitly says repeated calls "may have some
visible side effect," while still encouraging implementers to make it
idempotent anyway.

### StackWalker: inspecting the call stack

Added in Java 9, `StackWalker` replaced the older pattern of calling
`Thread.currentThread().getStackTrace()` (or `new Throwable().getStackTrace()`)
to inspect the call stack, and the `SecurityManager`-based caller-sensitive
checks that used to guard that kind of introspection. Instead of eagerly
materializing an array of every frame, `StackWalker` streams frames
lazily, letting a caller stop early without paying for the rest of the
stack:

```java
StackWalker walker = StackWalker.getInstance();

List<StackWalker.StackFrame> topThree =
    walker.walk(frames -> frames.limit(3).toList());
```

`walk()` takes a `Function<Stream<StackFrame>, T>` — the stream is only
valid for the duration of that call and closes when `walk()` returns.
Each `StackFrame` exposes `getClassName()` and `getMethodName()` by
default; reflection and VM-internal frames are hidden unless
`Option.SHOW_REFLECT_FRAMES` or `Option.SHOW_HIDDEN_FRAMES` is requested
at construction time:

```java
StackWalker deepWalker = StackWalker.getInstance(
    Set.of(StackWalker.Option.RETAIN_CLASS_REFERENCE));

Class<?> caller = deepWalker.getCallerClass();
```

`getCallerClass()` is a convenience for the common "who called me"
question, but it needs `Option.RETAIN_CLASS_REFERENCE` supplied up front —
requesting it from a plain `getInstance()` walker throws
`UnsupportedOperationException` rather than retrofitting the option.

### ProcessBuilder: launching and controlling external processes

`ProcessBuilder` configures and starts another OS process:

```java
ProcessBuilder pb = new ProcessBuilder("grep", "-r", "TODO", ".");
pb.directory(new File("/projects/app"));
pb.redirectErrorStream(true);              // merge stderr into stdout
pb.redirectOutput(ProcessBuilder.Redirect.appendTo(new File("grep.log")));

Process process = pb.start();
```

`command()` and `directory()` read/change the program and arguments and
the working directory before `start()`; `environment()` returns a mutable
`Map<String, String>` seeded from the current process's environment that
only affects the child being started. `redirectInput()`/`redirectOutput()`/
`redirectError()` (plus the `inheritIO()` shortcut, which wires all three
to the parent's own console) replace the old pattern of manually draining
`Process.getInputStream()`/`getErrorStream()` on separate threads.

Once started, the returned `Process` exposes `pid()` for the native
process id and `onExit()` for a `CompletableFuture<Process>` that
completes when the child terminates — letting a program react without
blocking on `waitFor()`:

```java
process.onExit()
       .thenApply(p -> p.exitValue() == 0)
       .thenAccept(success -> System.out.println("Clean exit: " + success));
```

`isAlive()`, `destroy()` (requests graceful termination — implementation-dependent
*whether* it succeeds, not how forcibly), and `destroyForcibly()` (forceful
termination) round out lifecycle control; since
Java 9, `toHandle()` converts a `Process` into a `ProcessHandle` for
information (like `Info.totalCpuDuration()`) beyond what `Process` itself
exposes.

## Trade-offs

- **A type gets exactly one natural ordering** — a second, situational
  ordering needs a `Comparator`, not a flag stuffed into `compareTo()`
  (see the Comparators concept for chaining and building comparators
  without touching the class).
- **`return a - b` inside `compareTo()` is a bug waiting to happen, not a
  shortcut** — subtraction can silently overflow and flip the sign for
  extreme values.
  ```java
  public int compareTo(Bucket other) {
      return this.hash - other.hash;      // wraps for extreme int values
  }
  // fix: return Integer.compare(this.hash, other.hash);
  ```
- **`AutoCloseable.close()` throws the broad `Exception`; `Closeable.close()`
  only `IOException`** — code written generically against `AutoCloseable`
  has to catch or declare `Exception`, losing the narrower type that
  I/O-specific callers get from `Closeable`.
- **`AutoCloseable.close()` isn't required to be idempotent, unlike
  `Closeable.close()`** — calling it a second time can still have a
  visible side effect unless the implementer specifically guards against
  it; try-with-resources only ever calls it once per resource, but manual
  cleanup code that calls `close()` from more than one place can't assume
  the second call is a no-op.
- **`getCallerClass()` needs `Option.RETAIN_CLASS_REFERENCE` supplied at
  `getInstance()` time** — it can't be requested after the fact.
  ```java
  StackWalker w = StackWalker.getInstance();
  w.getCallerClass();   // UnsupportedOperationException
  ```
- **`ProcessBuilder.environment()` only edits the child's environment**,
  not the current JVM's — mutating the returned map has no effect on
  `System.getenv()` in the running program, only on processes started
  from that `ProcessBuilder` afterward.
- **An unread subprocess can deadlock its parent** — if the child writes
  enough output to fill the OS pipe buffer and nothing drains
  `getInputStream()`/`getErrorStream()`, the child blocks on write and the
  parent blocks on `waitFor()`, with neither side making progress;
  `redirectErrorStream(true)`, `inheritIO()`, or consuming the streams on
  a separate thread avoids it.

## Documentation Links

- [Comparable — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Comparable.html) — doc
- [AutoCloseable — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/AutoCloseable.html) — doc
- [Closeable — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/io/Closeable.html) — doc
- [StackWalker — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/StackWalker.html) — doc
- [ProcessBuilder — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ProcessBuilder.html) — doc
- [Process — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Process.html) — doc
