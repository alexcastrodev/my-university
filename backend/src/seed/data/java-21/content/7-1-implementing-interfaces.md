# Implementing Interfaces

> Interfaces define a **contract** — what an object can do — without dictating how it is done. Mastering interface rules is essential for the OCP exam and for writing flexible, maintainable code.

---

## Interface vs Abstract Class

Both can be extended/implemented, but they serve different design goals.

| Feature | Interface | Abstract Class |
|---|---|---|
| State (instance fields) | No (only `static final`) | Yes |
| Constructors | No | Yes |
| Multiple inheritance | Yes — a class can implement many | No — `extends` is single only |
| Default access for members | `public` (implicitly) | Depends on declared modifier |
| `default` methods | Yes | Not applicable |
| `static` methods | Yes (not inherited) | Yes (inherited) |
| `private` methods (Java 9+) | Yes | Yes |
| Design intent | "Can do" relationship | "Is a" relationship with shared code |

**Rule of thumb:** prefer interfaces for type definitions. Use an abstract class when you need to share concrete state or constructors.

---

## Default Method Conflict Resolution

When a class inherits the same default method from multiple interfaces, Java applies two rules.

### Rule 1 — Classes win over interfaces

A method defined in a class always takes priority over a default method from an interface:

```java
interface Greeter {
    default String greet() { return "Hello from interface"; }
}

class Base {
    public String greet() { return "Hello from class"; }
}

class MyClass extends Base implements Greeter {
    // Base.greet() wins — no ambiguity
}

new MyClass().greet(); // "Hello from class"
```

### Rule 2 — More specific interface wins

If two interfaces share a default method and one interface extends the other, the more specific (child) interface wins:

```java
interface A {
    default String name() { return "A"; }
}

interface B extends A {
    default String name() { return "B"; }
}

class C implements A, B {
    // B is more specific — B.name() is chosen automatically
}

new C().name(); // "B"
```

### No winner? You must override

If neither rule resolves the conflict, the compiler forces you to override:

```java
interface Left  { default String value() { return "left"; } }
interface Right { default String value() { return "right"; } }

class Both implements Left, Right {
    @Override
    public String value() {
        return Left.super.value(); // explicit delegation is allowed
    }
}
```

---

## Interface Static Methods Are Not Inherited

Static methods on an interface must be called via the interface name — they are **not** available through implementing classes or subinterfaces:

```java
interface MathUtil {
    static int square(int n) { return n * n; }
}

MathUtil.square(5);       // OK — 25
// SomeImpl.square(5);   // Compile error — not inherited
```

---

## Comparable and Comparator

These two interfaces appear together on the exam.

### Comparable — natural ordering

```java
public class Student implements Comparable<Student> {
    private final String name;
    private final double gpa;

    public Student(String name, double gpa) {
        this.name = name;
        this.gpa = gpa;
    }

    @Override
    public int compareTo(Student other) {
        // negative = this is less, 0 = equal, positive = this is greater
        return Double.compare(this.gpa, other.gpa);
    }
}

List<Student> list = new ArrayList<>(List.of(
    new Student("Alice", 3.8),
    new Student("Bob",   3.5)
));
Collections.sort(list); // uses compareTo
```

### Comparator — external, flexible ordering

```java
Comparator<Student> byName = Comparator.comparing(s -> s.name);
Comparator<Student> byGpaDesc = Comparator.comparingDouble(
        (Student s) -> s.gpa).reversed();

list.sort(byName.thenComparing(byGpaDesc));
```

| | `Comparable` | `Comparator` |
|---|---|---|
| Location | Inside the class | Outside (lambda / separate class) |
| Method | `compareTo(T o)` | `compare(T o1, T o2)` |
| Use | Natural order | Custom / multiple orderings |
| `Collections.sort` | Works directly | Pass as second argument |

---

## Functional Interfaces and Default Methods

Interfaces with exactly one abstract method are **functional interfaces** and can be used as lambda targets. Default and static methods do not count toward the abstract-method limit:

```java
@FunctionalInterface
interface Transformer<T> {
    T transform(T input);                          // the one abstract method

    default Transformer<T> andThen(Transformer<T> after) {
        return input -> after.transform(this.transform(input));
    }
}

Transformer<String> upper = String::toUpperCase;
Transformer<String> trim  = String::trim;
Transformer<String> both  = trim.andThen(upper);

both.transform("  hello  "); // "HELLO"
```

---

## Key Rules to Remember

- A class can implement multiple interfaces but extend only one class
- `default` methods provide implementations; a class override beats them
- More-specific interface wins in diamond conflicts; equal specificity requires manual override
- Interface `static` methods are called on the interface type — never inherited
- `Comparable.compareTo` returns negative/zero/positive; `Comparator.compare` does the same but from outside
- `@FunctionalInterface` is optional but communicates intent and triggers a compile error if violated

---

## References

- [Oracle Docs — Interfaces (Java 21)](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/reflect/package-summary.html)
- [JEP 345 — Interface Default Methods (historical)](https://openjdk.org/jeps/345)
- [Comparable (Java 21)](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/Comparable.html)
- [Comparator (Java 21)](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/Comparator.html)
