# Using Generics

## What Are Generics?

Generics allow you to write classes, interfaces, and methods that work with **type parameters** — placeholders resolved at compile time. They provide type safety without casting and eliminate a whole class of `ClassCastException` errors at runtime.

```java
// Without generics — requires cast, no compile-time safety
List raw = new ArrayList();
raw.add("hello");
String s = (String) raw.get(0); // cast required

// With generics — no cast, compiler enforces the type
List<String> typed = new ArrayList<>();
typed.add("hello");
String s2 = typed.get(0); // no cast needed
```

## Generic Classes

A generic class declares one or more **type parameters** in angle brackets after the class name. By convention, single uppercase letters are used: `T` (type), `E` (element), `K` / `V` (key/value), `N` (number).

```java
public class Box<T> {
    private T value;

    public Box(T value) { this.value = value; }

    public T getValue()          { return value; }
    public void setValue(T value){ this.value = value; }
}

Box<String>  strBox = new Box<>("OCP");
Box<Integer> intBox = new Box<>(21);
System.out.println(strBox.getValue()); // OCP
System.out.println(intBox.getValue()); // 21
```

Multiple type parameters are separated by commas:

```java
public class Pair<K, V> {
    private K key;
    private V value;
    public Pair(K key, V value) { this.key = key; this.value = value; }
    public K getKey()   { return key; }
    public V getValue() { return value; }
}

Pair<String, Integer> p = new Pair<>("age", 30);
```

## Generic Methods

A method can declare its own type parameter independently of the enclosing class. The type parameter list appears **before the return type**.

```java
public class Utils {
    public static <T> T identity(T value) {
        return value;
    }

    public static <T extends Comparable<T>> T max(T a, T b) {
        return a.compareTo(b) >= 0 ? a : b;
    }
}

String s  = Utils.identity("Java");
int    n  = Utils.max(10, 20);       // 20
String hi = Utils.max("Apple", "Banana"); // "Banana"
```

## Generic Interfaces

Interfaces can also be parameterized. An implementing class either provides a concrete type or remains generic.

```java
public interface Container<T> {
    void add(T item);
    T get(int index);
}

// Concrete implementation — provides specific type
public class StringContainer implements Container<String> {
    private List<String> list = new ArrayList<>();
    public void add(String item) { list.add(item); }
    public String get(int index) { return list.get(index); }
}

// Generic implementation — stays parameterized
public class GenericContainer<T> implements Container<T> {
    private List<T> list = new ArrayList<>();
    public void add(T item)      { list.add(item); }
    public T get(int index)      { return list.get(index); }
}
```

## Bounded Wildcards

Wildcards (`?`) represent an **unknown type** and appear only in variable declarations, parameters, and return types — not in class or method type parameter lists.

### Unbounded Wildcard `<?>`

Accepts a collection of **any type**. You can only read elements as `Object`.

```java
public static void printAll(List<?> list) {
    for (Object obj : list) {
        System.out.println(obj);
    }
}

printAll(List.of(1, 2, 3));
printAll(List.of("a", "b"));
```

### Upper-Bounded Wildcard `<? extends T>`

Accepts `T` or any **subtype** of `T`. Useful for reading from a collection. You cannot add elements (except `null`) because the exact subtype is unknown.

```java
public static double sum(List<? extends Number> numbers) {
    double total = 0;
    for (Number n : numbers) {
        total += n.doubleValue();
    }
    return total;
}

sum(List.of(1, 2, 3));         // works — Integer extends Number
sum(List.of(1.5, 2.5, 3.0));  // works — Double extends Number
```

### Lower-Bounded Wildcard `<? super T>`

Accepts `T` or any **supertype** of `T`. Useful for writing into a collection. You can add elements of type `T` safely.

```java
public static void addNumbers(List<? super Integer> list) {
    list.add(1);
    list.add(2);
    list.add(3);
}

List<Number>  nums    = new ArrayList<>();
List<Object>  objects = new ArrayList<>();
addNumbers(nums);    // OK — Number is a supertype of Integer
addNumbers(objects); // OK — Object is a supertype of Integer
```

### Producer Extends, Consumer Super (PECS)

A helpful mnemonic for choosing the right wildcard:

| Role | Wildcard | Example |
|------|----------|---------|
| Reading (producer) | `<? extends T>` | `sum(List<? extends Number>)` |
| Writing (consumer) | `<? super T>` | `addNumbers(List<? super Integer>)` |
| Both read and write | No wildcard — use `<T>` | Generic method with `<T>` |

## Type Erasure

Generic type information exists **only at compile time**. The compiler replaces all type parameters with their bounds (or `Object` if unbounded) and inserts casts as needed. This process is called **type erasure**.

```java
// At compile time
List<String> list = new ArrayList<>();
list.add("hello");
String s = list.get(0);

// After erasure (conceptually what the JVM sees)
List list = new ArrayList();
list.add("hello");
String s = (String) list.get(0);
```

Key consequences of type erasure:

- You cannot use `instanceof` with a parameterized type: `list instanceof List<String>` does not compile.
- You cannot create an array of a parameterized type: `new T[10]` is not allowed.
- Generic type information is not available at runtime via reflection on instances.

## Exam Tips

- A wildcard `?` cannot be used as a type parameter when declaring a generic class or method — it only appears as a **type argument**.
- `List<Integer>` is **not** a subtype of `List<Number>` even though `Integer` extends `Number`. Use `List<? extends Number>` to accept both.
- An unbounded wildcard `<?>` is equivalent to `<? extends Object>`.
- Lower-bounded wildcards (`<? super T>`) allow adding elements of type `T` but reading only gives back `Object`.
- Type parameters are erased at runtime; you cannot call `new T()` directly without a `Class<T>` token.
