---
version: 1.0
updatedAt: 2026-08-19
---
## Objective

The Foreign Function and Memory API (FFM), in the `java.lang.foreign` package, lets pure Java code call functions in native shared libraries (`.so`, `.dll`, `.dylib`) and read and write memory outside the Java heap — with no C glue code to write and no extra compilation step. Delivered by Project Panama and finalized as a permanent standard feature in JDK 22 (JEP 454), it replaces JNI as the supported way to reach native code: instead of declaring `native` methods and compiling a matching C stub library, you describe the foreign function's signature in Java, obtain a `MethodHandle` to it, and invoke it.

## Use Cases

- Calling an existing C or C++ library (image codecs, cryptography, compression, CUDA/BLAS, SQLite, `libcurl`) directly from Java without writing a JNI wrapper library.
- Reaching an operating-system API — a libc function, a POSIX call, a Win32 entry point — for something the JDK does not expose.
- Working with large off-heap buffers that must outlive a single GC cycle or be shared with native code, as a typed, bounds-checked replacement for `ByteBuffer` and `sun.misc.Unsafe`.
- Passing structured data (C structs, arrays, pointers) across the boundary using explicit memory layouts instead of hand-packed byte arrays.
- Letting native code call *back* into Java (an upcall) — for example, supplying a C comparator function to `qsort`.
- Consuming machine-generated bindings from `jextract`, which reads a C header and emits the FFM boilerplate for a whole library.

## Deep Dive

### A complete downcall: calling C `strlen`

`strlen` lives in the C standard library, which the JVM process already has loaded, so this example needs no custom native library and no build step:

```java
import java.lang.foreign.*;
import java.lang.invoke.MethodHandle;

void main() throws Throwable {
    Linker linker = Linker.nativeLinker();
    SymbolLookup stdlib = linker.defaultLookup();

    MethodHandle strlen = linker.downcallHandle(
        stdlib.findOrThrow("strlen"),
        FunctionDescriptor.of(ValueLayout.JAVA_LONG,   // size_t return
                              ValueLayout.ADDRESS));   // const char* argument

    try (Arena arena = Arena.ofConfined()) {
        MemorySegment cString = arena.allocateFrom("Hello");
        long len = (long) strlen.invokeExact(cString);
        System.out.println(len);   // 5
    }
}
```

Run it with native access enabled:

```
java --enable-native-access=ALL-UNNAMED Strlen.java
```

Five pieces do all the work: `Linker` (the bridge), `SymbolLookup` (find the symbol), `FunctionDescriptor` (describe the signature), `MethodHandle` (the callable), and `Arena` + `MemorySegment` (the off-heap memory holding the C string).

### Linker and SymbolLookup: locating the function

`Linker.nativeLinker()` returns the linker for the platform's ABI. `defaultLookup()` searches the libraries the JVM always has (libc and friends); `SymbolLookup.libraryLookup(...)` loads an arbitrary shared library and ties its lifetime to an arena:

```java
try (Arena arena = Arena.ofConfined()) {
    SymbolLookup myLib =
        SymbolLookup.libraryLookup("/opt/lib/hello.so", arena);   // unloaded when arena closes

    Optional<MemorySegment> maybe = myLib.find("greet");          // Optional form
    MemorySegment addr = myLib.findOrThrow("greet");              // throws NoSuchElementException
}
```

A lookup returns a zero-length `MemorySegment` whose *address* is the function's entry point — a pointer, not something you can read bytes from.

### FunctionDescriptor: the C signature, restated in Java

There is no header parsing at runtime, so you state the signature yourself. `FunctionDescriptor.of(returnLayout, argLayouts...)` describes a function that returns a value; `FunctionDescriptor.ofVoid(argLayouts...)` one that does not:

```java
// size_t strlen(const char *s);
FunctionDescriptor.of(ValueLayout.JAVA_LONG, ValueLayout.ADDRESS);

// int printf(const char *fmt, ...);   -> variadic, see Linker.Option.firstVariadicArg
FunctionDescriptor.of(ValueLayout.JAVA_INT, ValueLayout.ADDRESS);

// void free(void *p);
FunctionDescriptor.ofVoid(ValueLayout.ADDRESS);
```

`ValueLayout` constants map Java carriers onto C types: `JAVA_INT` (32-bit), `JAVA_LONG` (64-bit), `JAVA_DOUBLE`, `JAVA_CHAR`, `ADDRESS` for any pointer. C's own `int` and `long` are *not* fixed-width — `long` is 64-bit on Linux/macOS LP64 but 32-bit on Windows LLP64 — so the layout you choose is a platform decision, not a mechanical translation.

Composite types get a `StructLayout`, and `VarHandle`s derived from it read named fields:

```java
// struct Point { int x; int y; };
StructLayout POINT = MemoryLayout.structLayout(
    ValueLayout.JAVA_INT.withName("x"),
    ValueLayout.JAVA_INT.withName("y"));

VarHandle xHandle = POINT.varHandle(MemoryLayout.PathElement.groupElement("x"));

try (Arena arena = Arena.ofConfined()) {
    MemorySegment p = arena.allocate(POINT);
    xHandle.set(p, 0L, 42);
    System.out.println((int) xHandle.get(p, 0L));   // 42
}
```

### The downcall MethodHandle is exactly typed

`Linker.downcallHandle` returns a `MethodHandle` whose type is derived from the descriptor. `invokeExact` means exact: the static types of the arguments and the cast on the result must match, or you get a `WrongMethodTypeException` rather than a silent conversion.

```java
long ok  = (long) strlen.invokeExact(cString);   // matches JAVA_LONG return
int  bad = (int)  strlen.invokeExact(cString);   // WrongMethodTypeException
```

`invokeExact` is declared `throws Throwable`, which is why the enclosing method above declares it too. Use `invoke` instead of `invokeExact` when you want the handle to apply the usual argument conversions.

### Arena and MemorySegment: off-heap memory with a lifetime

`MemorySegment` is a contiguous, bounds-checked region of memory. An `Arena` allocates segments and owns their lifetime: closing the arena frees everything it allocated at once, so there is no per-segment `free()` to forget.

```java
try (Arena arena = Arena.ofConfined()) {
    MemorySegment cString = arena.allocateFrom("Killer Bunny");   // NUL-terminated UTF-8
    MemorySegment ints    = arena.allocate(ValueLayout.JAVA_INT, 4);

    ints.setAtIndex(ValueLayout.JAVA_INT, 0, 7);
    System.out.println(ints.getAtIndex(ValueLayout.JAVA_INT, 0));  // 7
    System.out.println(ints.byteSize());                           // 16
    System.out.println(cString.getString(0));                      // Killer Bunny
}   // all of it deallocated here
```

Bounds are enforced, so a stray index is an exception, not memory corruption:

```java
ints.getAtIndex(ValueLayout.JAVA_INT, 99);   // IndexOutOfBoundsException
```

Note the names: the JDK 21 preview spelled these `allocateUtf8String` and `getUtf8String`; the finalized API renamed them to `allocateFrom` and `getString`, so older FFM examples do not compile on JDK 22+.

### Choosing an arena

| Factory | Closeable | Threads | Freed when |
| --- | --- | --- | --- |
| `Arena.ofConfined()` | yes | owner thread only | `close()` |
| `Arena.ofShared()` | yes | any thread | `close()`, by any thread |
| `Arena.ofAuto()` | no | any thread | GC decides |
| `Arena.global()` | no | any thread | never |

`ofConfined` in a try-with-resources is the default choice: cheapest access checks, deterministic release. `ofAuto` when a segment's lifetime is genuinely hard to bound; `global()` for a one-time allocation that lives as long as the JVM.

A confined arena is bound to its creating thread — another thread touching it fails fast:

```java
Arena arena = Arena.ofConfined();
MemorySegment seg = arena.allocate(8);
Thread.ofPlatform().start(() -> seg.get(ValueLayout.JAVA_BYTE, 0)).join();
// WrongThreadException
```

### Use-after-close is an exception, not a crash

This is the safety guarantee that JNI and `Unsafe` never gave you. A segment carries its arena's scope, and every access re-validates it:

```java
MemorySegment leaked;
try (Arena arena = Arena.ofConfined()) {
    leaked = arena.allocateFrom("Hello");
}   // memory freed here

leaked.getString(0);   // IllegalStateException: Already closed
```

The dangling pointer is still caught deterministically, on the accessing thread, with a stack trace — where the C equivalent would be undefined behaviour.

### Pointers returned from C: reinterpret

When a C function returns `char*`, the FFM API hands back a zero-length segment: it knows the address but not the size, so reading from it fails. `reinterpret` attaches a size (and optionally an arena and a cleanup action) so the bytes become accessible:

```java
MethodHandle getenv = linker.downcallHandle(
    linker.defaultLookup().findOrThrow("getenv"),
    FunctionDescriptor.of(ValueLayout.ADDRESS, ValueLayout.ADDRESS));

try (Arena arena = Arena.ofConfined()) {
    MemorySegment name = arena.allocateFrom("HOME");
    MemorySegment result = (MemorySegment) getenv.invokeExact(name);

    result.getString(0);                                    // IndexOutOfBoundsException: size 0
    System.out.println(result.reinterpret(Long.MAX_VALUE).getString(0));  // /home/you
}
```

`reinterpret` is where you take responsibility back from the runtime: you are asserting a size the JVM cannot verify. A three-argument form also registers a cleanup action, which is how you hook a native `free()` to the arena's close:

```java
MemorySegment owned = result.reinterpret(1024, arena, seg -> freeHandle.invokeExact(seg));
```

### Upcalls: letting C call Java

`Linker.upcallStub` turns a Java `MethodHandle` into a native function pointer that C can invoke, valid for as long as the arena passed to it:

```java
static int compare(MemorySegment a, MemorySegment b) {
    return Integer.compare(a.get(ValueLayout.JAVA_INT, 0),
                           b.get(ValueLayout.JAVA_INT, 0));
}

MethodHandle target = MethodHandles.lookup().findStatic(
    Sorter.class, "compare",
    MethodType.methodType(int.class, MemorySegment.class, MemorySegment.class));

try (Arena arena = Arena.ofConfined()) {
    MemorySegment comparator = linker.upcallStub(
        target,
        FunctionDescriptor.of(ValueLayout.JAVA_INT, ValueLayout.ADDRESS, ValueLayout.ADDRESS),
        arena);
    // comparator is now a C function pointer, passable to qsort
}
```

### Native access is a restricted operation

`Linker.downcallHandle`, `Linker.upcallStub`, `SymbolLookup.libraryLookup`, and `MemorySegment.reinterpret` are *restricted methods*: misused, they can crash the JVM or corrupt memory, so the platform wants the risk declared explicitly.

```
java --enable-native-access=ALL-UNNAMED App.java        # code on the classpath
java --enable-native-access=my.module -m my.module/App  # a named module
```

An executable JAR can carry the declaration instead, as an `Enable-Native-Access: ALL-UNNAMED` attribute in its manifest.

Without it, `--illegal-native-access` decides what happens. As of JDK 26 the default is still `warn` — the call proceeds and the module gets one warning:

```
WARNING: A restricted method in java.lang.foreign.Linker has been called
WARNING: java.lang.foreign.Linker::downcallHandle has been called by the unnamed module
WARNING: Use --enable-native-access=ALL-UNNAMED to avoid a warning for callers in this module
```

`--illegal-native-access=deny` throws `IllegalCallerException` instead, and is slated to become the default in a future release — so treat today's warning as tomorrow's failure and pass the flag now.

### What this replaces: JNI in one paragraph

JNI required a Java `native` method declaration, a C function whose name encoded the class and method (`Java_pkg_Cls_method`), a header generated from the class file, a C compiler run per target platform, and a shared library shipped alongside the JAR. Every mistake in that chain — a mismatched signature, a missed `ReleaseStringUTFChars`, a stale local reference — was undiagnosable from Java and typically ended in a JVM crash. FFM keeps the same reach but moves the whole binding into Java source: no C to write, no per-platform build, bounds and lifetime checks on every access, and failures surface as ordinary Java exceptions. JNI still works and is not deprecated, but it is no longer the recommended path, and it too now warns unless native access is enabled.

## Trade-offs

- **Memory-safe by default, but not memory-safe absolutely** — arena scoping turns use-after-free into a deterministic exception, yet `reinterpret` deliberately hands the guarantee back:

```java
seg.reinterpret(Long.MAX_VALUE).get(ValueLayout.JAVA_BYTE, 0);  // no bounds check left to fail
```

- **No glue code, but the signature is unverified** — nothing checks your `FunctionDescriptor` against the real C function. Get the layout wrong and you may get a wrong answer or a crash, with no compiler to catch it:

```java
// size_t strlen(const char*) described as returning int on an LP64 platform
FunctionDescriptor.of(ValueLayout.JAVA_INT, ValueLayout.ADDRESS);  // reads half the return value
```

- **`invokeExact` is unforgiving** — the payoff is that the JIT can inline the call to near-native speed; the cost is that every argument and the result cast must match the handle's type exactly:

```java
strlen.invokeExact(cString);      // WrongMethodTypeException: expected (MemorySegment)long
```

- **Restricted by design** — every deployment needs `--enable-native-access` (or a manifest attribute) or it will start failing when `deny` becomes the default. That is one more launch-time concern for libraries that would rather be a drop-in dependency:

```
java --illegal-native-access=deny App.java   # IllegalCallerException today, default later
```

- **Platform assumptions leak into Java source** — C's `int`, `long`, `size_t`, struct padding, and endianness differ across ABIs, so descriptors and layouts written against one platform are not automatically portable, even though the Java code compiles everywhere.
- **Verbose for anything non-trivial** — a real library means dozens of descriptors, struct layouts, and var handles. `jextract` generates them from headers, but it is a separate tool shipped outside the JDK, so adopting FFM at scale usually means adopting a code generator too.
- **Still a boundary** — FFM makes the call cheap and safe, not free. Data crossing the boundary must be copied to or laid out in off-heap memory, and native code remains outside the JVM's control: it can still block a carrier thread, ignore interrupts, and abort the process.

## Documentation Links

- [java.lang.foreign — Java SE 26 API Specification](https://docs.oracle.com/en/java/javase/26/docs/api/java.base/java/lang/foreign/package-summary.html) — doc
- [Arena — Java SE 26 API Specification](https://docs.oracle.com/en/java/javase/26/docs/api/java.base/java/lang/foreign/Arena.html) — doc
- [Linker — Java SE 26 API Specification](https://docs.oracle.com/en/java/javase/26/docs/api/java.base/java/lang/foreign/Linker.html) — doc
- [Foreign Function and Memory API — Java SE 26 Core Libraries Guide](https://docs.oracle.com/en/java/javase/26/core/foreign-function-and-memory-api.html) — doc
- [Restricted Methods — Java SE 26 Core Libraries Guide](https://docs.oracle.com/en/java/javase/26/core/restricted-methods.html) — doc
- [JEP 454: Foreign Function and Memory API](https://openjdk.org/jeps/454) — doc
