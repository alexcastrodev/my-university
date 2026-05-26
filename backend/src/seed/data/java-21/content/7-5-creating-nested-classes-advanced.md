# Creating Nested Classes (Advanced)

> Java supports four kinds of nested types, each with different scoping and access rules. The OCP exam tests the distinctions carefully — knowing when each kind is appropriate and what members each can access is essential.

---

## Overview of Nested Types

| Kind | Declared where | `static`? | Accesses outer instance? | Name |
|---|---|---|---|---|
| Inner class | Inside a class body | No | Yes | Has a name |
| Static nested class | Inside a class body | Yes | No | Has a name |
| Local class | Inside a method | No | Yes (if `final`/effectively final) | Has a name |
| Anonymous class | Inside an expression | No | Yes (if `final`/effectively final) | No name |

---

## Inner Classes: Accessing Outer Members

An inner class holds an implicit reference to the enclosing instance. It can access all members of the outer class — including `private` ones:

```java
public class Outer {
    private int value = 10;

    class Inner {
        private int value = 20;

        void display() {
            int value = 30;
            System.out.println(value);        // 30 — local variable
            System.out.println(this.value);   // 20 — Inner field
            System.out.println(Outer.this.value); // 10 — Outer field
        }
    }
}

// Instantiation requires an outer instance:
Outer outer = new Outer();
Outer.Inner inner = outer.new Inner();
inner.display();
```

**Memory consideration:** every `Inner` instance holds a reference to its `Outer` instance, which can prevent garbage collection. Prefer static nested classes when the inner class does not need the outer instance.

---

## Static Nested Classes: Usage Patterns

A static nested class is associated with the **enclosing type**, not any instance. It cannot access instance members of the outer class directly:

```java
public class LinkedList<T> {
    private Node<T> head;

    // Static nested class — no access to LinkedList instance fields
    static class Node<T> {
        T data;
        Node<T> next;

        Node(T data) { this.data = data; }
    }
}

// Instantiated without an outer instance:
LinkedList.Node<String> node = new LinkedList.Node<>("hello");
```

**Common usage patterns for static nested classes:**

- **Builder pattern** — the `Builder` class lives inside the class it builds
- **Value holder** — `Map.Entry<K,V>` is a static nested interface inside `Map`
- **Implementation details** — data structure nodes (like `Node` above)

```java
public class HttpRequest {
    private final String url;
    private final String method;

    private HttpRequest(Builder b) {
        this.url    = b.url;
        this.method = b.method;
    }

    public static class Builder {
        private String url;
        private String method = "GET";

        public Builder url(String url)       { this.url = url; return this; }
        public Builder method(String method) { this.method = method; return this; }
        public HttpRequest build()           { return new HttpRequest(this); }
    }
}

HttpRequest req = new HttpRequest.Builder()
        .url("https://example.com")
        .method("POST")
        .build();
```

---

## Local Classes in Methods

A local class is declared inside a method body. It can access local variables from the enclosing method, but only if they are `final` or **effectively final** (not reassigned after initialisation):

```java
public static void process(List<String> items) {
    final String prefix = "item-";   // effectively final

    class Formatter {
        String format(String s) {
            return prefix + s.toUpperCase(); // captured from enclosing scope
        }
    }

    Formatter fmt = new Formatter();
    items.forEach(i -> System.out.println(fmt.format(i)));
}
```

Local classes can implement interfaces and extend classes. They are useful when a helper type is needed only inside a single method and a lambda is insufficient (e.g., when you need multiple methods or internal state).

---

## Anonymous Classes

An anonymous class is a local class without a name — it is declared and instantiated in a single expression. It is common for one-off implementations of interfaces or abstract classes:

### As Runnable

```java
Thread t = new Thread(new Runnable() {
    @Override
    public void run() {
        System.out.println("Running in thread: " + Thread.currentThread().getName());
    }
});
t.start();
// Modern equivalent: new Thread(() -> System.out.println("..."))
```

### As Comparator

```java
List<String> words = new ArrayList<>(List.of("banana", "apple", "cherry"));

words.sort(new Comparator<String>() {
    @Override
    public int compare(String a, String b) {
        return Integer.compare(a.length(), b.length());
    }
});
// Modern equivalent: words.sort(Comparator.comparingInt(String::length));
```

### As a functional interface with state

When the implementation needs more logic than a single lambda expression cleanly handles:

```java
interface Validator<T> {
    boolean isValid(T value);
    default Validator<T> and(Validator<T> other) {
        return value -> this.isValid(value) && other.isValid(value);
    }
}

Validator<String> notEmpty = new Validator<>() {
    private int checks = 0;
    @Override
    public boolean isValid(String s) {
        checks++;
        return s != null && !s.isBlank();
    }
};
```

---

## Capture Rules Summary

| Variable type | Accessible in inner / local / anonymous class? |
|---|---|
| Instance field of enclosing class | Yes (inner class only — requires outer reference) |
| Static field of enclosing class | Yes (all nested kinds) |
| Local variable of enclosing method | Only if `final` or effectively final |
| Method parameter of enclosing method | Only if `final` or effectively final |

---

## Key Rules to Remember

- Inner classes require an enclosing instance; use `Outer.this.field` to disambiguate shadowed names
- Static nested classes have no link to an enclosing instance; they are preferred when the outer reference is not needed
- Local and anonymous classes capture effectively final local variables — reassignment after declaration breaks the rule
- Anonymous classes can extend a class **or** implement an interface — never both in the same expression
- Anonymous classes cannot have explicit constructors; use instance initializers `{}` for setup
- Modern Java often replaces anonymous classes with lambdas or method references, but anonymous classes remain necessary when you need internal state or multiple methods

---

## References

- [Oracle Docs — Nested Classes (Java 21)](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/reflect/package-summary.html)
- [Oracle Tutorial — Nested Classes](https://docs.oracle.com/javase/tutorial/java/javaOO/nested.html)
