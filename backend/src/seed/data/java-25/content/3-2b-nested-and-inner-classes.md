---
version: 1.0
updatedAt: 2026-08-19
---
# Nested and Inner Classes

---

## The Four Kinds

A **nested class** is any class declared inside another class. Java has four kinds, and the exam
tests the differences between them precisely:

| Kind | Declared | `static`? | Needs an outer instance? |
|------|----------|-----------|---------------------------|
| Static nested | Inside a class, at member level | Yes | No |
| Inner (non-static) | Inside a class, at member level | No | Yes |
| Local | Inside a method/block | No | Yes (if the method is an instance method) |
| Anonymous | Inline, at the point of use | No | Yes (if the method is an instance method) |

---

## Static Nested Classes

Behaves like any other top-level class, just namespaced inside the enclosing class. Cannot access
the enclosing instance's fields or methods, because there **is** no enclosing instance implied.

```java
public class Outer {
    private static int counter = 0;

    static class Node {
        int value;
        Node(int value) { this.value = value; }
    }
}

Outer.Node n = new Outer.Node(5);   // no Outer instance needed
```

A static nested class can access the enclosing class's `static` members directly, but not its
instance members.

---

## Inner (Non-static) Classes

Every instance of an inner class is implicitly tied to one instance of the enclosing class, and
can freely read and write that outer instance's fields — including `private` ones.

```java
public class Outer {
    private int id = 42;

    class Inner {
        void show() {
            System.out.println("Outer id = " + id);   // reads Outer's private field
        }
    }
}
```

### Instantiating an Inner Class from Outside

This is the syntax the exam tests most:

```java
Outer outer = new Outer();
Outer.Inner inner = outer.new Inner();   // note: outer.new, not new Outer.Inner()
inner.show();
```

An inner class **cannot** declare `static` members (except `static final` constants), because it
has no meaning independent of an enclosing instance — there is nothing for a `static` member of
`Inner` to belong to without one.

### Referring to the Enclosing Instance Explicitly

`Outer.this` disambiguates when the inner class shadows a name from the outer class:

```java
public class Outer {
    int id = 1;
    class Inner {
        int id = 2;
        void show() {
            System.out.println(id);          // 2 — Inner's own field
            System.out.println(this.id);     // 2 — same, explicit
            System.out.println(Outer.this.id); // 1 — the enclosing Outer's field
        }
    }
}
```

---

## Local Classes

Declared inside a method body. Visible only within that method (or block), and can capture
**effectively final** local variables from the enclosing scope — a local variable that is never
reassigned after initialization, so the compiler doesn't need to make it `final` explicitly.

```java
public class Outer {
    void process(int limit) {
        class Filter {                       // local class
            boolean accepts(int x) { return x < limit; }  // captures limit
        }
        Filter f = new Filter();
        System.out.println(f.accepts(3));
    }
}
```

```java
void broken(int limit) {
    class Filter {
        boolean accepts(int x) { return x < limit; }
    }
    limit = 10;   // compile error: limit is no longer effectively final —
                   // Filter.accepts() captures it, so it can't be reassigned
}
```

If declared inside a `static` method, a local class behaves like a static nested class — no
enclosing instance is available to capture.

---

## Anonymous Classes

A class with no name, declared and instantiated in a single expression — usually to supply a
one-off implementation of an interface or to extend a class on the spot.

```java
Runnable r = new Runnable() {
    @Override
    public void run() {
        System.out.println("running");
    }
};
```

An anonymous class:

- Can implement **one** interface, or extend **one** class — never both, and never more than one
  interface.
- Captures effectively final local variables the same way a local class does.
- Cannot declare a named constructor (it has no name), but can use an **instance initializer
  block** to run setup logic:

```java
Comparator<String> byLength = new Comparator<String>() {
    { System.out.println("comparator created"); }   // instance initializer, runs once
    @Override
    public int compare(String a, String b) { return a.length() - b.length(); }
};
```

A lambda expression is often the terser replacement when the target is a functional interface
(exactly one abstract method) — but a lambda cannot extend a class, and cannot introduce its own
fields the way an anonymous class's body can.

---

## What Each Kind Captures

This is the axis that actually distinguishes the four kinds, and the exam's usual angle on the
topic:

| Kind | Captures enclosing instance's fields? | Captures local variables? |
|------|----------------------------------------|-----------------------------|
| Static nested | No | No |
| Inner | Yes, always | No (has no enclosing method scope) |
| Local | Yes (if declared in an instance method) | Yes, if effectively final |
| Anonymous | Yes (if declared in an instance method) | Yes, if effectively final |

---

## Key Rules

| Rule | Detail |
|------|--------|
| Instantiating a static nested class | `new Outer.Nested()` |
| Instantiating an inner class from outside `Outer` | `outer.new Inner()` |
| Inner class `static` members | Not allowed, except `static final` constants |
| Captured local variables | Must be effectively final — reassigning after capture is a compile error |
| Anonymous class supertype | Exactly one interface OR one class — never both, never more than one |
| Local class in a `static` method | Behaves like a static nested class — no enclosing instance available |
