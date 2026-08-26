---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

Extending a concrete class you don't control is fragile: the subclass silently depends on the superclass's undocumented "self-use" — which of its own methods call which others internally — and that detail can change release to release, breaking the subclass without either class's code being touched. Composition plus forwarding (a wrapper/decorator that implements the same interface and holds an instance of the wrapped type, delegating to it) sidesteps this entirely. The same single-inheritance limitation that makes subclassing risky also shapes a separate decision: when a public API defines a *type* meant to have multiple implementations, an interface is almost always the better choice than an abstract class, because a class can implement any number of interfaces but extend only one class — a gap that `default` methods (Java 8+) narrow but don't close.

## Use Cases

- Adding instrumentation, logging, or validation to a `Set`, `List`, or `Map` without subclassing `HashSet`/`ArrayList` directly and inheriting their internal call patterns.
- Wrapping a class from a library you don't control to add behavior, without depending on implementation details that aren't part of its contract.
- Designing a public API type that many unrelated classes will need to implement — reach for an interface, not an abstract base class, so implementers aren't forced to give up their one shot at `extends`.
- Retrofitting an existing class with a new capability (the way `Comparable` gets added to classes after the fact) — only possible with an interface, since you can't insert a new abstract superclass into an already-published hierarchy.
- Giving implementers of a non-trivial interface a head start with a skeletal abstract implementation (`AbstractSet`, `AbstractList`, `AbstractMap`), while still leaving them free to implement the interface directly if they can't extend it.

## Deep Dive

### The fragile base class: subclassing HashSet

Suppose you want a `Set` that tracks how many elements have ever been inserted. The obvious move — extend `HashSet` and override the two methods capable of adding — looks reasonable:

```java
public class InstrumentedHashSet<E> extends HashSet<E> {
    private int addCount = 0;

    @Override
    public boolean add(E e) {
        addCount++;
        return super.add(e);
    }

    @Override
    public boolean addAll(Collection<? extends E> c) {
        addCount += c.size();
        return super.addAll(c);
    }

    public int getAddCount() {
        return addCount;
    }
}
```

```java
InstrumentedHashSet<String> s = new InstrumentedHashSet<>();
s.addAll(List.of("Snap", "Crackle", "Pop"));
System.out.println(s.getAddCount()); // 6 — not 3
```

`HashSet` doesn't declare its own `addAll`; it inherits it from `AbstractCollection`, whose implementation is a loop that calls `add(e)` once per element. That call is virtual, so it resolves to `InstrumentedHashSet.add()` — the very method already incrementing `addCount`. The override in `addAll` adds 3 for the batch, then `super.addAll(c)` triggers three more calls to the overridden `add`, adding 3 more: every batched element gets counted twice. Nothing about this is documented as a guarantee — it's simply how `AbstractCollection.addAll` happens to be written today, which is exactly why depending on it is fragile. (If a class *is* designed to be safely extended, it says so explicitly — see `AbstractCollection.remove`'s Javadoc, which spells out "This implementation iterates over the collection..." in prose. `HashSet` makes no such promise about `add`/`addAll`, and a class not documented for inheritance should generally be either left alone or declared `final`.)

### The fix: composition and forwarding

Instead of extending `HashSet`, give the new class a private reference to a `Set` and implement `Set` by delegating every call to it. The wrapper's own methods never depend on how the wrapped object implements itself internally:

```java
public class ForwardingSet<E> implements Set<E> {
    private final Set<E> s;
    public ForwardingSet(Set<E> s) { this.s = s; }

    public int size()                                { return s.size(); }
    public boolean isEmpty()                          { return s.isEmpty(); }
    public boolean contains(Object o)                 { return s.contains(o); }
    public Iterator<E> iterator()                     { return s.iterator(); }
    public Object[] toArray()                         { return s.toArray(); }
    public <T> T[] toArray(T[] a)                     { return s.toArray(a); }
    public boolean add(E e)                           { return s.add(e); }
    public boolean remove(Object o)                   { return s.remove(o); }
    public boolean containsAll(Collection<?> c)       { return s.containsAll(c); }
    public boolean addAll(Collection<? extends E> c)  { return s.addAll(c); }
    public boolean retainAll(Collection<?> c)         { return s.retainAll(c); }
    public boolean removeAll(Collection<?> c)         { return s.removeAll(c); }
    public void clear()                               { s.clear(); }
    @Override public boolean equals(Object o)         { return s.equals(o); }
    @Override public int hashCode()                   { return s.hashCode(); }
    // removeIf, stream, parallelStream, forEach, spliterator: not forwarded —
    // they're default methods on Collection, built on top of iterator()/size()
    // above, so they work correctly without being written here at all.
}

public class InstrumentedSet<E> extends ForwardingSet<E> {
    private int addCount = 0;

    public InstrumentedSet(Set<E> s) { super(s); }

    @Override public boolean add(E e) {
        addCount++;
        return super.add(e);
    }

    @Override public boolean addAll(Collection<? extends E> c) {
        addCount += c.size();
        return super.addAll(c);
    }

    public int getAddCount() { return addCount; }
}
```

```java
Set<String> s = new InstrumentedSet<>(new HashSet<>());
s.addAll(List.of("Snap", "Crackle", "Pop"));
System.out.println(((InstrumentedSet<String>) s).getAddCount()); // 3, correctly
```

`InstrumentedSet.addAll` adds 3, then calls `super.addAll(c)`, which is `ForwardingSet.addAll` — it forwards straight to the *wrapped* set's own `addAll`. Whatever that wrapped instance does internally (loop and call its own `add`, or something else entirely) happens on the wrapped object's own vtable, never on `InstrumentedSet`'s, so it can't loop back through the override that already counted the batch. This is also called the Decorator pattern: `InstrumentedSet` "decorates" any `Set` it's given — a `TreeSet`, a `HashSet`, even one that's already in use (`new InstrumentedSet<>(existingSet)` mid-method) — with no separate constructor needed per wrapped implementation, unlike the inheritance version.

### Interfaces vs. abstract classes, today

Both interfaces and abstract classes let you define a type with multiple implementations, but only one of them costs the implementer their single shot at `extends`:

```java
public interface Greeter {
    String name();

    default String greet() {                 // behavior, not just a signature
        return "Hello, " + name() + "!";
    }
}

public class Robot implements Greeter, AutoCloseable {
    private final String name;
    public Robot(String name) { this.name = name; }

    @Override public String name() { return name; }
    @Override public void close() { /* release resources */ }
}
```

`Robot` implements two unrelated interfaces and gets `greet()`'s body for free. Had `Greeter` been an abstract class instead, `Robot` couldn't also extend anything else — Java permits only single inheritance of implementation, so committing a public type to an abstract base is a far more restrictive choice than committing it to an interface. That asymmetry is also why interfaces work as mixins (`Comparable`, `AutoCloseable`, `Greeter` above — "optional" capabilities layered onto a class's primary type) and why an existing class can be retrofitted to implement a brand-new interface (add the methods, add the `implements` clause) but essentially never retrofitted onto a new abstract superclass without disrupting the whole hierarchy above it.

`default` methods (Java 8+) close much of the historical gap: an interface can now ship real behavior, and — critically — the JDK used exactly this to widen `Collection` itself. `stream()`, `forEach()`, and `removeIf()` were all added to `Collection` as default methods so that every pre-existing implementation, including ones written years earlier by third parties, kept compiling instead of breaking. `private` interface methods (Java 9+) go further, letting default methods share helper logic without exposing it as public API. What default methods still can't do is give an interface instance state: a default method's logic has to be phrased entirely in terms of the interface's own abstract methods, because interfaces cannot declare instance fields.

```java
interface Counter {
    int get();
    default String describe() { return "count=" + get(); } // fine — reads via get()
    // default int next() { return count++; }               // won't compile — no `count` field to hold
}
```

Where implementation reuse across many implementers really matters, the JDK's own pattern is a skeletal abstract implementation alongside the interface — `AbstractSet`, `AbstractList`, `AbstractMap` next to `Set`, `List`, `Map`. The interface still defines the type; the `AbstractXxx` class is an optional shortcut for implementers who don't need to extend something else. `ForwardingSet` above is the same idea from a different angle: it implements `Set` fully, so anyone who *can't* extend a skeletal class (because they're already extending something else, or wrapping an existing instance) still gets a working implementation to delegate to.

## Trade-offs

- **Forwarding costs an extra virtual call per delegated method.** Every `ForwardingSet` method is one more hop before reaching the real implementation. In practice this overhead is negligible next to what the collection itself does, but it isn't literally free the way inheritance's direct dispatch is.
- **Wrapper classes are invisible to callback-style APIs (the "SELF problem").** The wrapped object has no idea it's been wrapped, so if it ever hands `this` to another object for a later callback, that callback bypasses the wrapper's added behavior entirely:

  ```java
  class Publisher {
      void subscribe(Consumer<Publisher> onEvent) { onEvent.accept(this); } // passes the raw Publisher
  }
  class LoggingPublisher extends ForwardingPublisher {
      LoggingPublisher(Publisher p) { super(p); }
      // any callback registered through subscribe() gets the unwrapped Publisher —
      // LoggingPublisher's logging never runs for it
  }
  ```
- **Choosing an abstract class as your public type is a one-way, high-cost decision.** Once implementers start extending it, they've permanently spent their one `extends` — Java has no multiple inheritance of state to fall back on:

  ```java
  class A {}
  class B {}
  class C extends A, B {}   // does not compile — a class extends at most one class
  ```
- **Widening a released interface without a default breaks every existing implementer, immediately.** This was the whole reason interfaces were considered harder to evolve than abstract classes before Java 8 — and it's still true for any new abstract method added without one:

  ```java
  interface Foo { void a(); }
  // adding `void b();` here with no default body means every
  // pre-existing `implements Foo` class stops compiling until it adds b()
  ```
- **Default methods add behavior, not state, so they can't replace fields.** A default method can only compute from what the interface's abstract methods expose — it has nowhere private to keep per-instance data, unlike a field in an abstract class. See the `Counter` example in Deep Dive: `describe()` compiles because it only reads through `get()`; a stateful `next()` has no field to increment.

## Documentation Links

- [Set — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Set.html) — doc
- [AbstractCollection — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/AbstractCollection.html) — doc
- [Default Methods — The Java Tutorials](https://docs.oracle.com/javase/tutorial/java/IandI/defaultmethods.html) — doc
- [Java Language Specification — Chapter 9.4, Interface Method Declarations](https://docs.oracle.com/javase/specs/jls/se25/html/jls-9.html#jls-9.4) — doc
