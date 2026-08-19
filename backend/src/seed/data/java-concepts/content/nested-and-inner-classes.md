---
version: 1.0
updatedAt: 2026-08-19
---
## Objective

A *nested class* is any class declared inside another class or inside a method. Java has four kinds, and they differ along exactly one axis: **how much of the enclosing context each one captures**. A `static` nested class captures nothing. An inner class (a non-`static` member class) captures the enclosing *instance*. A local class captures the enclosing instance *and* effectively final locals. An anonymous class is a local class with no name, declared and instantiated in one expression. Knowing which flavor you wrote tells you what it can reach, what keeps it alive in memory, and whether a lambda or a `record` would say the same thing with less code.

## Use Cases

- A private data holder or node type used only by one class — a `static` nested `Node`, `Entry`, or `Builder` that has no business referring back to its owner.
- A view or iterator over the enclosing object's state — an inner class, because it genuinely needs the enclosing instance's fields to do its job.
- A helper class needed by exactly one method, where hoisting it to a member would widen its scope for no reason — a local class.
- A one-off implementation that needs its own fields, several methods, or a superclass — an anonymous class, where a lambda cannot reach.
- A one-off implementation of a single-method interface — write a **lambda** instead of an anonymous class; this is the modern default.
- Capturing a full generic type at runtime (a "supertype token") — one of the few remaining places where an anonymous class is required and a lambda cannot substitute.

## Deep Dive

### The four flavors side by side

```java
public class Demo {
    private int count = 7;

    static class Node<T> {                 // 1. static nested: no enclosing instance
        T value;
        Node(T v) { value = v; }
    }

    class Counter {                        // 2. inner: has an enclosing Demo
        int doubled() { return count * 2; }
    }

    void locals() {
        int base = 10;
        class Local {                      // 3. local: captures `base` and the enclosing Demo
            int plus() { return base + count; }
        }
        System.out.println(new Local().plus());   // 17
    }

    Runnable anon() {                      // 4. anonymous: declared and instantiated at once
        return new Runnable() {
            @Override public void run() { System.out.println(count); }
        };
    }
}
```

Each flavor gets its own class file, and the naming scheme tells you which is which:

```
Demo.class            Demo$Node.class       ← static nested / inner: Outer$Name
Demo$Counter.class    Demo$1Local.class     ← local: Outer$<n><Name>
Demo$1.class                                ← anonymous: Outer$<n>, no name at all
```

A lambda produces no class file at all — it is spun up at runtime:

```java
System.out.println(anon().getClass().getName());  // Demo$1
System.out.println(lam().getClass().getName());   // Demo$$Lambda/0x00007fe001042a38
```

### static nested vs inner: the synthetic enclosing reference

The difference is not stylistic. An inner class that uses the enclosing instance gets a synthetic `this$0` field holding it, and its constructor takes the enclosing instance as a hidden first parameter:

```java
class InnerIter implements Iterator<String> {   // inner
    int i = 0;
    public boolean hasNext() { return i < items.size(); }
    public String next() { return items.get(i++); }
}

static class StaticIter implements Iterator<String> {  // static nested
    private final List<String> snapshot;
    int i = 0;
    StaticIter(List<String> snapshot) { this.snapshot = snapshot; }
    public boolean hasNext() { return i < snapshot.size(); }
    public String next() { return snapshot.get(i++); }
}
```

Reflect on both and the hidden plumbing shows up:

```java
InnerIter  ctor: [class Leak]        fields: [int i, final Leak this$0]
StaticIter ctor: [interface List]    fields: [private final List snapshot, int i]
```

A `static` nested class *cannot* hold that reference, so it also cannot read instance state — that's the trade you are making:

```java
public class E2 {
    int field = 1;
    static class Nested {
        int read() { return field; }
    }
}
// error: non-static variable field cannot be referenced from a static context
```

### Instantiating an inner class needs an enclosing instance

Because an inner class has an implicit enclosing instance, `new Inner()` only works where `this` is available. From a static context it fails:

```java
public class E1 {
    class Inner { int x; }
    static void tryIt() {
        Inner i = new Inner();
    }
}
// error: non-static variable this cannot be referenced from a static context
```

The qualified form supplies the enclosing instance explicitly:

```java
Demo d = new Demo();
Demo.Counter c = d.new Counter();      // the `outer.new Inner()` syntax
```

### Local classes: capture and the Java 16 relaxation

A local class sees effectively final locals of its method. Reassigning a captured local is a compile error:

```java
void m() {
    int base = 1;
    Supplier<Integer> s = () -> base;
    base = 2;
}
// error: local variables referenced from a lambda expression must be final or effectively final
```

Since JDK 16 (JEP 395), a method body can also declare local `record`, `enum`, and `interface` declarations — all implicitly static, so they capture nothing:

```java
void locals() {
    record Pair(String k, int v) {}          // local record — implicitly static
    class Local { int plus() { return 1; } } // local class — captures
    System.out.println(new Pair("a", 1));    // Pair[k=a, v=1]
}
```

The same JEP dropped the old rule that an inner class could not declare `static` members, so this now compiles:

```java
class Counter {
    static final String KIND = "counter";    // legal since JDK 16; was a compile error before
}
```

Any Java text older than JDK 16 will tell you inner classes cannot have `static` members — that rule is gone.

### Anonymous classes: what the syntax can and cannot express

The `new Type() { ... }` form declares a class that extends or implements `Type` and instantiates it in one go. It has no name, so it can have no constructor:

```java
Comparator<String> c = new Comparator<String>() {
    Comparator(int n) {}
    public int compare(String a, String b) { return 0; }
};
// error: invalid method declaration; return type required
```

Initialization has to go through field initializers or an instance initializer block instead. What an anonymous class *does* have is its own identity: `this` refers to the anonymous instance, and the enclosing instance needs the qualified form.

```java
Runnable r = new Runnable() {
    @Override public void run() {
        System.out.println("anon this = " + this.getClass().getName());
        System.out.println("outer this = " + Demo.this.getClass().getName());
    }
};
// anon this = Demo$1
// outer this = Demo
```

### When a lambda replaces an anonymous class — and when it does not

The classic GUI idiom is an anonymous class implementing a single-method interface:

```java
button.addActionListener(new ActionListener() {
    @Override public void actionPerformed(ActionEvent evt) {
        System.out.println("Thanks for pressing me");
    }
});
```

For any *functional* interface — one abstract method — the lambda is the modern form, and this advice has not changed:

```java
button.addActionListener(evt -> System.out.println("Thanks for pressing me"));
```

A lambda is not a class, though, so four things keep anonymous classes alive.

An abstract *class* target is not a functional interface:

```java
abstract static class Task { abstract void run(); }
Task t = () -> System.out.println("x");
// error: incompatible types: Task is not a functional interface
```

`this` inside a lambda is the *enclosing* instance, not the lambda — so a lambda cannot refer to itself, and recursion fails:

```java
IntUnaryOperator fact = n -> n <= 1 ? 1 : n * fact.applyAsInt(n - 1);
// error: variable fact might not have been initialized
```

An anonymous class has a real `this` and recurses fine:

```java
IntUnaryOperator fact = new IntUnaryOperator() {
    public int applyAsInt(int n) { return n <= 1 ? 1 : n * this.applyAsInt(n - 1); }
};
System.out.println(fact.applyAsInt(5));   // 120
```

And an anonymous *subclass* records its generic supertype in the class file, which is how supertype tokens work — a lambda has no supertype to inspect:

```java
static abstract class TypeRef<T> {
    Type type() {
        return ((ParameterizedType) getClass().getGenericSuperclass()).getActualTypeArguments()[0];
    }
}

var tok = new TypeRef<Map<String, List<Integer>>>() {};
System.out.println(tok.type());
// java.util.Map<java.lang.String, java.util.List<java.lang.Integer>>
```

### When a record replaces a nested data holder

The book-era idiom for a private tuple is a mutable static nested class:

```java
public class AllClasses {
    public class Data {
        int x;
        int y;
    }
}
```

If it is really just a pair of values, a nested `record` is the shorter and safer statement — it is implicitly static, immutable, and brings `equals`/`hashCode`/`toString` with it:

```java
public class AllClasses {
    record Data(int x, int y) {}
}
```

Reach for a `static` nested class instead when the holder is genuinely mutable, needs to extend something, or needs to hide some of its state.

### Package-private top-level class vs nested class

A class that is not `public` can also just live beside the main class in the same file. It is not nested, so it has no enclosing instance and no `$` in its name — and it is a first-class member of its package, usable by simple name anywhere in that package:

```java
public class AllClasses {
    record Data(int x, int y) {}
}

/** Same file as AllClasses, but a separate top-level class. */
class AnotherClass {
    AnotherClass() {
        Data d = new Data(1, 2);
    }
}
// error: cannot find symbol — symbol: class Data, location: class AnotherClass
```

The nested `Data` is package-private, so it is *reachable*, but only through its enclosing class — its simple name is scoped to `AllClasses`:

```java
class AnotherClass {
    AnotherClass() {
        AllClasses.Data d = new AllClasses.Data(1, 2);   // compiles: Data[x=1, y=2]
    }
}
```

That extra qualification is the whole point: nesting says "this belongs to `AllClasses`". Use a separate top-level class when the helper is package-level infrastructure that other classes legitimately name directly.

## Trade-offs

- **An inner class keeps the enclosing object alive** — the synthetic `this$0` reference means a long-lived inner instance (a cached iterator, a registered listener) pins the whole enclosing object in memory. Making the class `static` is the enforceable fix, because then the language forbids the reference:

```java
class InnerIter implements Iterator<String> { /* uses items */ }
// fields: [int i, final Leak this$0]   ← holds the enclosing Leak

static class StaticIter implements Iterator<String> { /* takes a snapshot */ }
// fields: [private final List snapshot, int i]   ← no this$0 possible
```

- **`static` costs you access, not just retention** — the same removal of `this$0` is why a `static` nested class cannot read the enclosing instance's fields, so the choice is retention versus reach, not "static is always better".

- **Anonymous classes cannot be constructed, reused, or named** — no constructor is allowed, the type has no name you can declare a variable of, and referring to `OtherClass$1` from elsewhere is caught at compile time. If you need any of that, it should have been a named class:

```java
Comparator<String> c = new Comparator<String>() {
    Comparator(int n) {}          // error: invalid method declaration; return type required
    public int compare(String a, String b) { return 0; }
};
```

- **Lambdas are terser but strictly less capable** — they only target functional interfaces, and their `this` is the enclosing instance, so no self-reference and no supertype token:

```java
IntUnaryOperator fact = n -> n <= 1 ? 1 : n * fact.applyAsInt(n - 1);
// error: variable fact might not have been initialized
```

- **`javac` may elide an unused enclosing reference, but do not design around it** — an inner class that never touches the enclosing instance currently gets no `this$0` field, yet its constructor still demands one, and adding a single reference to an outer field silently reinstates the field. Treat `static` as the guarantee and the elision as an optimization detail.

```java
class NeverUsesOuter { int n = 1; }
// ctor: [class T2]   fields: [int n]   ← param kept, field elided
```

- **Deeply nested declarations hurt readability** — an anonymous class inside a local class inside an inner class is legal and unreadable. The point of nesting is to signal "this exists only for its owner"; past one level of nesting, that signal is lost and a named top-level or package-private class communicates better.

## Documentation Links

- [Inner Classes and Enclosing Instances — JLS 8.1.3 (Java SE 25)](https://docs.oracle.com/javase/specs/jls/se25/html/jls-8.html#jls-8.1.3) — doc
- [Local Class and Interface Declarations — JLS 14.3 (Java SE 25)](https://docs.oracle.com/javase/specs/jls/se25/html/jls-14.html#jls-14.3) — doc
- [Anonymous Class Declarations — JLS 15.9.5 (Java SE 25)](https://docs.oracle.com/javase/specs/jls/se25/html/jls-15.html#jls-15.9.5) — doc
- [Nested Classes — The Java Tutorials](https://docs.oracle.com/javase/tutorial/java/javaOO/nested.html) — doc
- [Lambda Expressions — The Java Tutorials](https://docs.oracle.com/javase/tutorial/java/javaOO/lambdaexpressions.html) — doc
- [JEP 395: Records — relaxed static members in inner classes, local records](https://openjdk.org/jeps/395) — doc
