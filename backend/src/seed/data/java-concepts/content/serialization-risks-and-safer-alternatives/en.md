---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

`implements Serializable` looks like a one-line decision, but it is a permanent one: the default serialized form exposes a class's private field layout as part of its API forever, and — the sharper problem — deserialization manufactures objects directly from a byte stream without ever running the class's constructor. Any invariant the constructor was supposed to enforce has to be re-enforced by hand, against input that is fully attacker-controlled. This is not a historical footnote; insecure deserialization of untrusted data remains a live vulnerability class today (it's still in OWASP's risk categories), and the JDK ships a dedicated filtering mechanism, `ObjectInputFilter`, specifically to contain it.

## Use Cases

- Deciding whether a new class should implement `Serializable` at all — value classes and simple data carriers are reasonable candidates; classes representing active resources (thread pools, connections) rarely should.
- Hardening any class that already implements `Serializable` and has invariants (a non-null field, a range check, an ordering constraint) that a hand-crafted byte stream could otherwise violate.
- Choosing between hand-written defensive `readObject` logic and the serialization proxy pattern when a class must remain both serializable and safe against malicious input.
- Configuring `ObjectInputFilter` on any `ObjectInputStream` that will ever deserialize data from outside the current process — network input, uploaded files, another service's payloads.

## Deep Dive

### Why `Serializable` is a bigger commitment than it looks

Two costs compound. First, the default serialized form mirrors a class's private fields, so those fields become part of its exported API — changing the internal representation later can silently break compatibility with previously serialized instances. Second, and more dangerous: `ObjectInputStream.readObject()` builds an object straight from bytes and never calls the class's constructor. Any validation the constructor performs is simply skipped.

```java
public final class Range implements Serializable {
    private final int value;

    public Range(int value) {
        if (value <= 0) {
            throw new IllegalArgumentException("value must be positive");
        }
        this.value = value;
    }

    public int value() { return value; }
}
```

`new Range(-5)` cannot exist — the constructor forbids it. But a byte stream never goes through `new Range(...)`. If you serialize one valid `Range` and then patch the four bytes holding its `int` field before deserializing, `ObjectInputStream` hands back a `Range` with a negative `value`, no exception thrown:

```java
byte[] bytes = serialize(new Range(1));      // a normal, valid instance
bytes[bytes.length - 1] = (byte) -5;         // hand-edit the trailing int byte

Range corrupted = (Range) new ObjectInputStream(
        new ByteArrayInputStream(bytes)).readObject();

System.out.println(corrupted.value());       // -5 — the constructor's check never ran
```

This mirrors the documented `Period` attack (Effective Java, Item 76): a class with a real invariant (`start` before `end`) becomes constructible in an invalid state purely by editing its serialized bytes, because `readObject` — not the constructor — is what actually produces the instance.

### Defensive `readObject`

`readObject` is effectively another public constructor, so it needs the same discipline: validate invariants, and defensively copy any field that holds a reference to a mutable object the caller must not be able to reach.

```java
public final class Period implements Serializable {
    private Date start;
    private Date end;

    public Period(Date start, Date end) {
        this.start = new Date(start.getTime());
        this.end = new Date(end.getTime());
        if (this.start.compareTo(this.end) > 0) {
            throw new IllegalArgumentException(start + " after " + end);
        }
    }

    private void readObject(ObjectInputStream s)
            throws IOException, ClassNotFoundException {
        s.defaultReadObject();

        // defensively copy — otherwise a crafted stream can hand the caller
        // a live reference to these Date fields and mutate Period after the fact
        start = new Date(start.getTime());
        end = new Date(end.getTime());

        // re-check the invariant the constructor enforces
        if (start.compareTo(end) > 0) {
            throw new InvalidObjectException(start + " after " + end);
        }
    }
}
```

Both steps matter and in that order: copy first, then validate the copies — validating before copying leaves a window where a second, still-mutable reference to the original fields can be extracted from the stream before the check runs. Without the copy, an attacker who can append extra references into the stream can obtain the live `Date` objects backing `start`/`end` and mutate a `Period` after construction, even though its fields look immutable from the public API.

### The serialization proxy pattern

Defensive `readObject` still has to be gotten right for every invariant, and final fields can't be reassigned inside it — the `Period` example above had to give up `final` to make the copy possible. The serialization proxy pattern sidesteps this: a private static nested class captures the enclosing class's logical state, and the enclosing class delegates all actual construction back through its normal, invariant-enforcing constructor.

```java
public final class Period implements Serializable {
    private final Date start;
    private final Date end;

    public Period(Date start, Date end) {
        this.start = new Date(start.getTime());
        this.end = new Date(end.getTime());
        if (this.start.compareTo(this.end) > 0) {
            throw new IllegalArgumentException(start + " after " + end);
        }
    }

    // serialize the proxy instead of this instance
    private Object writeReplace() {
        return new SerializationProxy(this);
    }

    // block a forged stream from producing a Period directly
    private void readObject(ObjectInputStream stream) throws InvalidObjectException {
        throw new InvalidObjectException("Proxy required");
    }

    private static class SerializationProxy implements Serializable {
        private final Date start;
        private final Date end;

        SerializationProxy(Period p) {
            this.start = p.start;
            this.end = p.end;
        }

        // rebuild through the real constructor — invariants enforced normally
        private Object readResolve() {
            return new Period(start, end);
        }

        private static final long serialVersionUID = 234098243823485285L;
    }
}
```

Because the proxy's `readResolve` calls `new Period(start, end)`, deserialization goes through exactly the same validation the constructor already performs — there's no separate invariant-checking logic to keep in sync, and `start`/`end` can stay `final`. The pattern doesn't apply to classes clients can extend, and it can't be used if reconstructing the object from within `readResolve` requires calling a method on an object that isn't fully built yet — but for a final, self-contained class with real invariants, it removes the entire category of forged-stream and field-theft attacks described above without hand-written defensive checks.

### The current, JDK-native mitigation: `ObjectInputFilter`

The attacks above assume the attacker can only corrupt data belonging to a class you already expect. A worse variant — deserialization-based remote code execution via "gadget chains" — chains together `readObject` methods from classes already on the classpath to execute arbitrary code, and no amount of defensive coding inside your own classes stops it, because the malicious behavior lives in someone else's class. This is why Oracle's current secure-coding guidance treats deserializing untrusted data as inherently dangerous regardless of how carefully any single class is written.

The JDK's answer is `ObjectInputFilter`, added in JDK 9 by JEP 290 ("Filter Incoming Serialization Data"). It lets an `ObjectInputStream` reject classes, array sizes, graph depth, or stream length before an object is instantiated:

```java
ObjectInputFilter filter =
        ObjectInputFilter.Config.createFilter("com.example.*;java.base/*;!*");

ObjectInputStream ois = new ObjectInputStream(inputStream);
ois.setObjectInputFilter(filter);   // reject anything not explicitly allowed
```

The pattern `com.example.*;java.base/*;!*` allows classes in `com.example` and in the `java.base` module, and rejects (`!*`) everything else — an allowlist rather than a blocklist, which is the safer default for untrusted input.

JDK 17 extended this with JEP 415 ("Context-Specific Deserialization Filters"), which added a process-wide, configurable filter *factory* — a `BinaryOperator<ObjectInputFilter>` invoked whenever any `ObjectInputStream` is created, so an application can install one global policy (or vary it per context) instead of remembering to call `setObjectInputFilter` on every stream individually:

```java
ObjectInputFilter.Config.setSerialFilterFactory(
        (current, next) -> next != null ? next : globalDefaultFilter);
```

A static, process-wide filter can also be set without touching any code, via `-Djdk.serialFilter=...` on the command line or the `jdk.serialFilter` system property — useful for locking down deserialization in code you don't control the source of.

## Trade-offs

- **Accepting the default serialized form locks in your internal field layout as public API.** Renaming or restructuring a field later can break deserialization of instances written by an older version of the class.
- **Defensive `readObject` requires giving up `final` on any field you need to reassign after copying** — `Period`'s `start`/`end` had to become non-final in the Effective Java example specifically so `readObject` could rebind them to fresh `Date` copies.
- **The serialization proxy pattern doesn't work for extendable classes or self-referential object graphs** — it needs the enclosing class to be effectively final, and `readResolve` can't safely call back into a not-yet-reconstructed object.
- **`ObjectInputFilter` allowlists must be maintained as the class graph changes** — a filter pattern like `com.example.*;java.base/*;!*` needs updating whenever a legitimately deserialized class is added, or deserialization starts failing for valid data too.
- **A single-element enum remains the preferred way to keep a serializable singleton safe against forged streams** — writing a manual `readResolve` on a non-enum singleton is fragile (Effective Java's `ElvisStealer` attack shows a crafted stream stealing a reference to the "impersonator" instance before `readResolve` runs); see the enum-singleton coverage in `singleton-and-noninstantiable-classes` rather than reintroducing that mechanism here.

## Documentation Links

- [Serializable — Java SE API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/io/Serializable.html) — doc
- [ObjectInputStream — Java SE API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/io/ObjectInputStream.html) — doc
- [ObjectInputFilter — Java SE API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/io/ObjectInputFilter.html) — doc
- [JEP 290: Filter Incoming Serialization Data](https://openjdk.org/jeps/290) — doc
- [JEP 415: Context-Specific Deserialization Filters](https://openjdk.org/jeps/415) — doc
- [Java Object Serialization Specification](https://docs.oracle.com/en/java/javase/25/docs/specs/serialization/index.html) — doc
- [Secure Coding Guidelines for Java SE — Serialization](https://docs.oracle.com/pls/topic/lookup?ctx=javase25&id=secure_coding_guidelines_javase) — doc
