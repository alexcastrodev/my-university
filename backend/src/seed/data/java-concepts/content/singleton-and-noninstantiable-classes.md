---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

A singleton guarantees exactly one instance of a class exists for the lifetime of the JVM — useful for components that are intrinsically unique, like a configuration registry or a connection manager. Java offers three ways to build one: a `public static final` field, a static factory method, and a single-element `enum`. A related but distinct problem is the noninstantiable utility class — a pure grouping of `static` members, like `java.lang.Math`, that should never be instantiated at all. Both problems are solved by controlling constructor access, but only one of the three singleton forms is actually safe against reflection.

## Use Cases

- A single shared resource that must not have competing instances — a thread pool manager, an in-memory cache, an application-wide event bus.
- Modeling a system component that's intrinsically unique, such as a window manager or a hardware interface, where a second instance would be meaningless.
- Grouping stateless helper methods on primitives, arrays, or a related family of objects — `Math`, `Collections`, `Arrays` — where instantiation would be nonsensical.
- Any class built entirely of `static` factory methods for a shared interface, where the class itself is never meant to hold state.

## Deep Dive

### Three ways to write a singleton

The first two approaches both keep the constructor `private` and expose the sole instance through a public static member — a field or a method:

```java
// Singleton with a public final field
public class Elvis {
    public static final Elvis INSTANCE = new Elvis();
    private Elvis() { }

    public void leaveTheBuilding() { }
}

// Singleton with a static factory method
public class Elvis {
    private static final Elvis INSTANCE = new Elvis();
    private Elvis() { }

    public static Elvis getInstance() { return INSTANCE; }

    public void leaveTheBuilding() { }
}
```

Both guarantee exactly one instance under normal use — the private constructor runs exactly once, to initialize the static field. The factory-method form has one practical edge: it can change its mind later (return a per-thread instance, a mock for tests, etc.) without touching the call sites, since callers only ever see `Elvis.getInstance()`.

The third form, available since Java 5, is a single-element `enum`:

```java
public enum Elvis {
    INSTANCE;

    public void leaveTheBuilding() { }
}
```

This is functionally equivalent to the public-field form, but the JVM itself enforces the singleton property instead of relying on constructor discipline — which matters once reflection and serialization enter the picture.

### The reflection attack against a private constructor

`AccessibleObject.setAccessible(true)` lets code bypass Java's normal access checks and call a `private` constructor directly. Against the field- or factory-based `Elvis`, this creates a second instance and breaks the singleton guarantee outright:

```java
Constructor<Elvis> ctor = Elvis.class.getDeclaredConstructor();
ctor.setAccessible(true);           // suppress the access check
Elvis clone = ctor.newInstance();   // succeeds — a second Elvis now exists

System.out.println(Elvis.INSTANCE == clone);   // false
```

Since JDK 9, the module system narrows this attack surface but doesn't close it for typical application code: `setAccessible(true)` throws `InaccessibleObjectException` only when the target class lives in a named module whose package hasn't been `opened` to the caller's module. Code that isn't run with `module-info.java` boundaries in play — the common case for application/business logic living in the unnamed module — gets no such protection, and the attack above still succeeds.

Defending the field/factory forms requires extra code in the constructor itself:

```java
private Elvis() {
    if (INSTANCE != null) {
        throw new IllegalStateException("Already instantiated");
    }
}
```

This closes the gap, but it's discipline the author has to remember to add — it isn't the default.

### Why the enum form doesn't need that defense

Calling `Constructor.newInstance()` on an enum constant's constructor doesn't create a second instance the way it does for `Elvis` — it fails immediately. Per the `Constructor.newInstance` documentation, it throws `IllegalArgumentException` whenever the target "pertains to an enum class," regardless of whether `setAccessible(true)` succeeded first:

```java
public enum ElvisEnum { INSTANCE }

Constructor<?> ctor = ElvisEnum.class.getDeclaredConstructor(String.class, int.class);
ctor.setAccessible(true);
ElvisEnum clone = (ElvisEnum) ctor.newInstance("FAKE", 1);
// IllegalArgumentException: Cannot reflectively create enum objects
```

This check is enforced by the reflection API itself, independent of module boundaries — it applies the same way in a modular or non-modular application. `Enum` also overrides `clone()` to throw `CloneNotSupportedException` unconditionally, closing the other common way to mint a second instance, and its `protected Enum(String, int)` constructor is documented as being for compiler-generated code only, not for programmer use.

### Why the enum form is also serialization-safe for free

Making the field- or factory-based `Elvis` implement `Serializable` isn't enough on its own to preserve the singleton guarantee: deserializing a stream produces a brand-new instance built from the stream data, bypassing the constructor entirely. The documented fix is a `readResolve` method that swaps in the canonical instance:

```java
private Object readResolve() {
    return INSTANCE;   // let the deserialized impersonator be garbage-collected
}
```

Every field also has to be marked `transient`, or a leaked reference to the impersonator can still surface before `readResolve` runs. `Serializable` documents this as one of several special serialization hook methods (alongside `writeReplace`) a class can opt into.

For enum types, none of this is necessary. The `Serializable` documentation states that enum types "receive treatment defined by the Java Object Serialization Specification during serialization and deserialization," and that "any declarations of the special handling methods discussed above are ignored for enum types" — a `readResolve` written on an enum simply has no effect, because the JVM already serializes an enum constant by writing only its name and reconstructing it via `Enum.valueOf` on read, never re-running a constructor. There's no impersonator to resolve away.

### Enforcing noninstantiability for a utility class

A class like `Math` or `Collections` is a pure grouping of `static` members and was never meant to be instantiated. Leaving it with no explicit constructor doesn't achieve that — the compiler silently supplies a public, no-arg default constructor, so `new Math()`-style code compiles even though it's nonsensical:

```java
public class UtilityClass {
    // no constructor declared — compiler generates a public no-arg one
}

new UtilityClass();   // compiles, produces a pointless instance
```

Making the class `abstract` doesn't fix it either — it can still be subclassed, and the subclass instantiated, which also misleads readers into thinking the class was designed for extension. The working idiom is a `private` constructor that throws if it's ever invoked, including from within the class itself:

```java
public class UtilityClass {
    // Suppress the default constructor; this class is not instantiable.
    private UtilityClass() {
        throw new AssertionError();
    }

    public static int square(int n) {
        return n * n;
    }
}

new UtilityClass();   // compile error: UtilityClass() has private access
```

Because the only constructor is `private`, no subclass has an accessible superclass constructor to call, so this also blocks subclassing as a side effect. The `AssertionError` isn't load-bearing for outside callers — they're already blocked at compile time — but it protects against an accidental internal call (e.g. from another constructor via `this()`) and documents the intent for anyone reading the source.

## Trade-offs

- **The enum singleton is the only form immune to both attacks without extra code** — the field and factory forms need a manual guard against reflective construction and a `readResolve` plus `transient` fields to survive serialization safely; the enum form gets both for free from the language and the serialization spec.
- **Enum syntax reads unusually for something that isn't conceptually a set of constants** — `public enum Elvis { INSTANCE; ... }` is a single-element enum standing in for a class, which can look surprising the first time, even though it compiles to the same kind of type as any other enum.
- **The factory-method form is the only one that can change its return strategy without an API change** — callers only ever see `Elvis.getInstance()`, so the implementation could later hand back a per-thread instance or a test double; a `public static final` field commits callers to the exact same reference forever.
- **A private, throwing constructor also blocks subclassing, not just instantiation** — this is usually the point for a utility class, but it means the pattern is unsuitable for any class where extension is intended later.
  ```java
  public class SubUtility extends UtilityClass { }
  // compile error: implicit super() call has no accessible UtilityClass() to invoke
  ```
- **`setAccessible`'s module-system restriction is not a general fix** — `InaccessibleObjectException` only protects classes inside a named module whose package is not opened to the caller; code in the unnamed module (the common case for application code without `module-info.java`) gets no protection from this at all, so it's not a substitute for choosing the enum form or adding an explicit guard.

## Documentation Links

- [Enum — Java SE API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Enum.html) — doc
- [Constructor.newInstance() — Java SE API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/reflect/Constructor.html#newInstance(java.lang.Object...)) — doc
- [AccessibleObject.setAccessible() — Java SE API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/reflect/AccessibleObject.html#setAccessible(boolean)) — doc
- [InaccessibleObjectException — Java SE API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/reflect/InaccessibleObjectException.html) — doc
- [Serializable — Java SE API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/io/Serializable.html) — doc
- [Java Object Serialization Specification](https://docs.oracle.com/en/java/javase/25/docs/specs/serialization/index.html) — doc
