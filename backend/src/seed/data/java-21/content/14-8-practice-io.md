# Practice: I/O

> Five exercises covering what the slides in this module introduced —
> `Path` component navigation and `resolve()`, byte-stream vs.
> character-stream wrapping compatibility, buffered-vs-unbuffered
> flush/close behavior, `Serializable` rules when a superclass isn't
> serializable, and try-with-resources closing order across chained
> wrapped streams. Try to answer before opening each explanation.

---

## Exercise 1 — `Path` component navigation and `resolve()`

```java
Path p = Path.of("/home/user/projects/demo/Main.java");

System.out.println(p.getNameCount());
System.out.println(p.subpath(1, 3));

Path base = Path.of("/home/user");
Path result = base.resolve(Path.of("/etc/passwd"));
System.out.println(result);
```

What's printed by each of the three `println` calls?

<details>
<summary>Answer</summary>

```
5
user/projects
/etc/passwd
```

`getNameCount()` counts the elements **after** the root — it never
counts `/` itself. For `/home/user/projects/demo/Main.java` those
elements are `home`, `user`, `projects`, `demo`, `Main.java`, so the
count is `5`.

`subpath(1, 3)` is start-inclusive, end-exclusive over those same
zero-indexed elements: index `1` is `user`, index `2` is `projects`,
index `3` (`demo`) is excluded — so the result is `user/projects`.

`resolve()` normally appends its argument onto the base path. But when
the argument passed to `resolve()` is itself **absolute**, it entirely
replaces the base rather than being appended to it — `base` is
discarded and the result is simply `/etc/passwd`. This is a deliberate
part of `resolve()`'s contract, not a bug: it lets the same method be
used for both "append a relative fragment" and "override with an
absolute path" use cases.

</details>

---

## Exercise 2 — Which wrapper accepts which stream type?

```java
InputStream in1 = new BufferedInputStream(new FileInputStream("data.bin"));

Reader r = new BufferedReader(new InputStreamReader(new FileInputStream("data.bin")));

Writer w = new BufferedWriter(new FileWriter("out.txt"));

InputStream in2 = new BufferedInputStream(new FileReader("data.txt"));
```

One of these four declarations fails to compile. Which one, and why?

<details>
<summary>Answer</summary>

The last one, `in2`, **fails to compile** — everything else is fine.

- `in1`: `FileInputStream` IS-A `InputStream`, and `BufferedInputStream`'s
  constructor is declared to accept an `InputStream`. Byte stream
  wrapping byte stream — compiles.
- `r`: `InputStreamReader` is the bridge class that converts a **byte**
  stream into a **character** stream (decoding bytes into `char`s using
  a charset). It takes an `InputStream` — `FileInputStream` qualifies —
  and produces a `Reader`, which is exactly what `BufferedReader`'s
  constructor requires. Compiles.
- `w`: `FileWriter` extends `OutputStreamWriter` which extends `Writer`,
  so it IS-A `Writer`, which is what `BufferedWriter`'s constructor
  requires. Compiles.
- `in2`: `FileReader` is a **character** stream — it IS-A `Reader`, not
  an `InputStream`, despite the superficially similar name to
  `FileInputStream`. `BufferedInputStream`'s constructor only accepts an
  `InputStream`, so passing a `Reader`-typed reference is a type
  mismatch: "incompatible types: FileReader cannot be converted to
  InputStream." There is no automatic bridge from a character stream
  back down to a byte stream — `InputStreamReader` only goes one
  direction (bytes → chars).

</details>

---

## Exercise 3 — Does the write actually happen without `flush()`/`close()`?

```java
public void writeConfig(Path target, String content) throws IOException {
    Writer w = new BufferedWriter(new FileWriter(target.toFile()));
    w.write(content);
}
```

This method compiles and runs without throwing. Right after it
returns, is `content` guaranteed to have reached the underlying file?
What's actually wrong here, and how would you fix it?

<details>
<summary>Answer</summary>

**No, it is not guaranteed** — and in practice, for a short `content`
string, it almost certainly has *not* reached the file yet.

`BufferedWriter` exists specifically to avoid making a system call for
every `write()`. It holds written data in an in-memory buffer (8 KB by
default) and only pushes that buffer down to the wrapped `FileWriter`
when the buffer fills up, when `flush()` is called explicitly, or when
`close()` is called (which flushes before closing). This method's body
does none of those things — it writes into the buffer and returns,
leaving the data sitting in memory. On top of the data never reaching
the file, the underlying `FileWriter`'s file handle is also never
released, which leaks a file descriptor for the life of the JVM.

An unbuffered `FileWriter` used alone wouldn't have this *particular*
problem to the same degree, because each `write()` call is forwarded
immediately to the underlying stream instead of also being held in a
separate, unflushed Java-level buffer — though the file handle would
still leak if never closed.

The fix is to close the writer, and the idiomatic way to guarantee that
happens (even if an exception is thrown mid-write) is try-with-resources:

```java
public void writeConfig(Path target, String content) throws IOException {
    try (Writer w = new BufferedWriter(new FileWriter(target.toFile()))) {
        w.write(content);
    }
    // buffer flushed and file handle closed automatically here
}
```

</details>

---

## Exercise 4 — Serialization with a non-`Serializable` superclass

```java
class Vehicle {
    protected String make;
    Vehicle() {
        this.make = "Unknown";
    }
}

class Car extends Vehicle implements Serializable {
    private static final long serialVersionUID = 1L;
    private String model;
    private transient int mileage;

    Car(String make, String model, int mileage) {
        this.make = make;
        this.model = model;
        this.mileage = mileage;
    }

    @Override
    public String toString() {
        return make + " " + model + " " + mileage;
    }
}
```

```java
Car original = new Car("Toyota", "Corolla", 42000);

ByteArrayOutputStream baos = new ByteArrayOutputStream();
try (ObjectOutputStream oos = new ObjectOutputStream(baos)) {
    oos.writeObject(original);
}

Car restored;
try (ObjectInputStream ois =
        new ObjectInputStream(new ByteArrayInputStream(baos.toByteArray()))) {
    restored = (Car) ois.readObject();
}

System.out.println(restored);
```

Note that `Vehicle` does **not** implement `Serializable`. Does this
compile and run without throwing, and if so, what's printed?

<details>
<summary>Answer</summary>

It compiles and runs without throwing, and prints:

```
Unknown Corolla 0
```

`Vehicle` itself is not required to implement `Serializable` — only
`Car`, the class actually being serialized, needs to. But because
`Vehicle` isn't `Serializable`, the JVM has no way to capture or
restore *its* portion of the object's state through the byte stream:
the `make` field, declared in `Vehicle`, is simply not written out
during serialization at all.

When `Car` is deserialized, `ObjectInputStream` reconstructs the
`Car`-declared fields (`model`, and non-transient state) directly from
the byte stream without invoking any of `Car`'s constructors. But for
the non-serializable superclass portion, there's no saved state to
restore from — so the JVM instead calls `Vehicle`'s **no-arg
constructor** to initialize that part of the object, exactly as if a
brand-new `Vehicle` were being constructed. That constructor sets
`make = "Unknown"`, overwriting whatever value ("Toyota") the field
held at serialization time. (If `Vehicle` had no accessible no-arg
constructor, deserialization would fail at runtime with
`InvalidClassException`.)

`model` is declared directly in `Car`, which is `Serializable`, and
`String` is itself serializable, so it round-trips normally →
`"Corolla"`.

`mileage` is `transient`, so it is deliberately excluded from the
byte stream regardless of which class declares it; on deserialization
it is reset to its type's default value, `0` for `int` — not the
`42000` it held before serialization.

</details>

---

## Exercise 5 — try-with-resources closing order through chained wrappers

```java
class LoggingOutputStream extends FilterOutputStream {
    private final String tag;
    LoggingOutputStream(OutputStream out, String tag) {
        super(out);
        this.tag = tag;
    }
    @Override
    public void close() throws IOException {
        System.out.println("closing " + tag);
        super.close(); // delegates to the wrapped stream's close()
    }
}
```

```java
try (OutputStream first = new LoggingOutputStream(
             new LoggingOutputStream(new ByteArrayOutputStream(), "inner"), "outer");
     OutputStream second = new LoggingOutputStream(new ByteArrayOutputStream(), "second")) {

    first.write(1);
    second.write(2);
}
```

`first` is a two-layer chain (`outer` wraps `inner`); `second` is a
single layer. What's printed, and in what order, when the `try` block
exits normally?

<details>
<summary>Answer</summary>

```
closing second
closing outer
closing inner
```

Two separate rules combine here, both straight from the module:

1. **try-with-resources closes the resources it directly declares, in
   reverse declaration order.** The header declares `first` then
   `second`, so on exit the JVM calls `second.close()` first, then
   `first.close()` — it does not know or care that `first` is itself a
   chain of wrapped streams; it only ever calls `close()` on the two
   variables named in the `try(...)` clause.

2. **Closing an outer wrapper cascades down through the chain it
   wraps**, because each decorator's `close()` calls `super.close()`,
   which delegates to the stream it wraps. `second.close()` runs first
   and only touches its own single layer, printing `closing second`.
   Then `first.close()` runs: it's the `"outer"` `LoggingOutputStream`,
   so it prints `closing outer` and then calls `super.close()`, which
   is `FilterOutputStream.close()` — this closes the wrapped stream,
   the `"inner"` `LoggingOutputStream`, triggering *its* override and
   printing `closing inner`.

So a two-layer chain produces two "closing" messages from a single
`close()` call on the outermost reference, while `second` — never
nested inside anything — produces exactly one. This is exactly why the
module's rule is "close only the outermost wrapper, the inner streams
are closed transitively": you never call `close()` on `inner` or
`second`'s wrapped `ByteArrayOutputStream` directly, and you don't need
to.

</details>
