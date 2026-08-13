---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

A static factory method is just a `static` method on a class that returns an instance of that class — an alternative (or supplement) to a public constructor. Because it's a named method rather than `new ClassName(...)`, it can communicate what the returned object *is*, decide whether to build a new object at all, and hand back any subtype of its declared return type. The Builder pattern solves a different but related problem: constructing an immutable object that has several optional fields, without resorting to a wall of overloaded constructors or a mutable multi-step setter dance. Both are ways of controlling object construction more deliberately than a plain public constructor allows.

## Use Cases

- Giving a constructor-like operation a name that documents intent — `BigInteger.probablePrime(bitLength, random)` says far more at the call site than a constructor taking the same two arguments ever could.
- Avoiding redundant allocation for values that are cheap to reuse — returning a cached, shared instance instead of a fresh object on every call.
- Exposing an API purely through an interface or abstract type while keeping every concrete implementation class non-public, so callers can never depend on (or need to know) which class they actually hold.
- Building an immutable object that has a handful of required fields and many optional ones — a configuration object, a request payload, a domain event — without a telescoping pile of constructor overloads.
- Constructing several closely related objects from one reusable, tweakable builder instead of repeating the same long argument list for each one.

## Deep Dive

### Static factories vs. constructors: named, sometimes cached, free to return a subtype

```java
Boolean b1 = Boolean.valueOf(true);   // static factory
Boolean b2 = new Boolean(true);       // constructor — deprecated since Java 9

b1 == Boolean.TRUE;   // true — valueOf(true) never allocates, it hands back the cached constant
```

`Boolean(boolean)` is deprecated precisely because `valueOf(boolean)` does the same job with better space and time performance: it returns one of two preallocated constants (`Boolean.TRUE` / `Boolean.FALSE`) instead of creating a new object every call. A constructor can never do this — `new` always produces a new instance.

The same freedom lets a static factory return a type its own class doesn't reveal:

```java
List<String> names = List.of("Ana", "Bo", "Cy");
```

`List.of(...)` doesn't return an `ArrayList` — it returns one of several package-private classes internally, chosen based on how many elements were passed. Callers only ever see `List`, so the JDK is free to change which concrete class backs a call to `List.of(...)` between releases without breaking anyone; nobody could have coded against a class they were never given. `EnumSet` pushes the same idea further: it has no public constructor at all (every instance comes from `noneOf`, `allOf`, `of`, `range`, or `copyOf`), and its declared type is `public abstract sealed class EnumSet<E>` — the two implementations behind it are permitted, non-public subclasses, not something a caller can new up or extend.

### Naming conventions

Static factories don't have parameter-driven overload resolution to lean on the way constructors of the same class do, so a handful of naming conventions carry the meaning a constructor's implicit "this creates a `Foo`" would otherwise provide:

```java
Optional<String> opt = Optional.of("value");           // of — wraps a value as-is
Integer n = Integer.valueOf("42");                       // valueOf — converts from another representation
BufferedReader r = Files.newBufferedReader(path);        // newType — a new instance, factory lives in a different class
var dbf = DocumentBuilderFactory.newInstance();           // newInstance — each call is a distinct object
```

- **`valueOf`** — returns an instance with (loosely) the same value as its argument; effectively a type conversion.
- **`of`** — a terser `valueOf`, the convention used throughout `java.util` (`List.of`, `Set.of`, `Map.of`) and `java.time`.
- **`getInstance` / `newInstance`** — `getInstance` may return the same instance across calls (as a no-arg call often does for a singleton-like object); `newInstance` promises each returned instance is distinct from every other.
- **`getType` / `newType`** — like the two above, used when the factory method lives in a different class than the type it returns, so plain `getInstance` would be ambiguous about what comes back.

None of these are compiler-enforced — they're a readability convention, and the only thing that actually marks a method as a static factory is `static` plus a return type matching (or related to) its declaring class.

### The Builder pattern: taming many optional parameters

A class with a few required fields and many optional ones is awkward to construct either way: a constructor overload per combination of optional parameters ("telescoping constructors") is unreadable at the call site, and a no-arg constructor plus setters allows the object to exist half-configured and rules out immutability.

```java
// Telescoping constructors — every new optional field means another overload,
// and a call site like this is unreadable without checking the signature:
new EmailMessage("team@example.com", "Deploy done", "", List.of(), List.of(), "ops@example.com", true);
// which of those two booleans-shaped trailing args means what?
```

A builder replaces both: the client passes required fields up front, chains setter-like methods for whichever optional fields it cares about, and finishes with a `build()` call that produces an immutable result.

```java
public record EmailMessage(
        String to, String subject, String body,
        List<String> cc, List<String> bcc, String replyTo, boolean highPriority) {

    public static final class Builder {
        private final String to;
        private final String subject;
        private String body = "";
        private List<String> cc = List.of();
        private List<String> bcc = List.of();
        private String replyTo;
        private boolean highPriority;

        public Builder(String to, String subject) {
            this.to = to;
            this.subject = subject;
        }

        public Builder body(String body)          { this.body = body; return this; }
        public Builder cc(List<String> cc)        { this.cc = cc; return this; }
        public Builder bcc(List<String> bcc)      { this.bcc = bcc; return this; }
        public Builder replyTo(String replyTo)    { this.replyTo = replyTo; return this; }
        public Builder highPriority()             { this.highPriority = true; return this; }

        public EmailMessage build() {
            if (to == null || to.isBlank()) {
                throw new IllegalStateException("recipient is required");
            }
            return new EmailMessage(to, subject, body, cc, bcc, replyTo, highPriority);
        }
    }
}
```

```java
var message = new EmailMessage.Builder("team@example.com", "Deploy done")
        .body("Release 4.2 is live.")
        .cc(List.of("alerts@example.com"))
        .highPriority()
        .build();
```

Each setter-like method returns `this`, which is what makes the calls chainable — this is sometimes called a fluent API. The builder itself is mutable while it's being configured, but `build()` is the single point where the fields are copied into the immutable `EmailMessage`, and it's the natural place to enforce invariants that span multiple fields, since by then every optional value the caller wanted to set has already been supplied.

## Trade-offs

- **A static factory doesn't stand out in generated API docs the way a constructor does.** Javadoc lists constructors in their own section; a static factory is just another method, so a class that offers only static factories (no public constructor) can be harder to figure out how to instantiate without reading the class-level documentation or knowing the naming conventions above.
- **A class exposing only static factories (no public or protected constructor) can't be subclassed from outside its own package.** This is often intentional — it forces composition instead of inheritance — but it's an easy thing to trip over.
  ```java
  // EnumSet has no public constructor and is itself sealed —
  // this does not compile no matter what package it's written in:
  // class MyEnumSet<E extends Enum<E>> extends EnumSet<E> { }
  ```
- **The Builder pattern costs an extra object and more code than a constructor call.** For a class with only one or two fields, a plain constructor (or a compact record) is simpler and cheaper — reach for a builder once optional fields start piling up (a rough rule of thumb: four or more, especially if most calls only set a few of them).
- **Builder invariants are only checked once, in `build()`, not as each field is set.** A field can sit in an invalid intermediate state while the builder is still being configured; only the final object is guaranteed consistent.
  ```java
  new EmailMessage.Builder("", "Deploy done").build();
  // throws IllegalStateException: recipient is required — but only here, at build()
  ```
- **A record's compact constructor (see `records-and-sealed-types`) is the leaner alternative when there are only a few, mostly-required fields** — it validates in one place without the ceremony of a separate builder class. It doesn't help once several fields are genuinely optional, though: a record's canonical constructor still takes every component positionally, so a record alone doesn't solve the telescoping problem a builder does.

## Documentation Links

- [Boolean — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Boolean.html) — doc
- [List — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/List.html) — doc
- [EnumSet — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/EnumSet.html) — doc
- [BigInteger — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/math/BigInteger.html) — doc
- [Nested Classes — The Java Tutorials](https://docs.oracle.com/javase/tutorial/java/javaOO/nested.html) — doc
