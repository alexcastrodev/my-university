---
version: 1.0
updatedAt: 2026-08-02
---
## Objective

A generic class, interface, or method takes the type it operates on as a parameter — written in angle brackets, like `Gen<T>` — instead of hard-coding a specific type or falling back to `Object` and casting. The compiler substitutes the real type at every use site and checks it, so a whole category of `ClassCastException`s at runtime becomes a compile error instead.

## Use Cases

- Writing one container/algorithm (a stack, a pair, a cache) that works identically for `String`, `Integer`, or any other reference type, without duplicating the class per type.
- Restricting a type parameter to "anything with a `doubleValue()`" (`<T extends Number>`) so a method can call numeric methods on it without an unsafe cast.
- Writing a method that accepts "a `List` of anything" (`List<?>`) when the method only reads from the list and doesn't care what's inside.
- Writing a method that accepts "a destination that can hold this type or a supertype of it" (`? super T`) when the method only writes into the collection.

## Deep Dive

### Type parameters and type arguments

```java
class Gen<T> {
    private T ob;
    Gen(T o) { ob = o; }
    T getOb() { return ob; }
}

Gen<Integer> iOb = new Gen<Integer>(88);   // Integer is the type argument for T
int v = iOb.getOb();                        // no cast needed — return type is already Integer
```

`T` is a placeholder filled in with the type argument (`Integer` here) at every point it's used inside `Gen` — the field, the constructor parameter, and `getOb()`'s return type all become `Integer` for this instance. A second instance, `Gen<String>`, gets its own fully-`String` view of the same class — but `iOb = strOb;` between a `Gen<Integer>` and a `Gen<String>` reference doesn't compile, even though both are "a `Gen`": different type arguments make them incompatible types.

Generics only accept reference types as arguments — `Gen<int>` doesn't compile — but autoboxing makes the wrapper classes (`Integer`, `Double`, ...) transparent enough that this is rarely a real restriction.

### Bounded types

An unbounded `<T>` can be any reference type, which blocks calling anything more specific than `Object`'s methods on it. `extends` narrows the type parameter to a class/interface and its subtypes:

```java
class Stats<T extends Number> {
    T[] nums;
    Stats(T[] o) { nums = o; }
    double average() {
        double sum = 0.0;
        for (T num : nums) sum += num.doubleValue();   // legal: T is-a Number
        return sum / nums.length;
    }
}
```

Because `T` is bounded by `Number`, the compiler knows every `T` has `doubleValue()` — and, as a side effect, `Stats<String>` no longer compiles at all, since `String` isn't a `Number`. A bound can combine a class and interfaces with `&` (`<T extends MyClass & Comparable<T>>`), but the class — if any — must come first.

### Wildcard arguments: `?`, `? extends`, `? super`

A method parameter typed `Stats<T>` only accepts `Stats` objects whose type argument is exactly that same `T`. To accept *any* `Stats`, use a wildcard:

```java
boolean isSameAvg(Stats<?> ob) {
    return average() == ob.average();
}
```

`Stats<?>` matches `Stats<Integer>`, `Stats<Double>`, anything — the wildcard doesn't loosen what `Stats` objects can be *created* with (that's still governed by `Stats`'s own `extends Number` bound), it just lets a method accept the whole family.

Wildcards can themselves be bounded, which matters once a generic type sits in a class hierarchy:

```java
class Coords<T extends TwoD> { T[] coords; /* ... */ }

// accepts Coords<ThreeD> and Coords<FourD>, rejects Coords<TwoD>
void showXYZ(Coords<? extends ThreeD> c) { /* ... */ }
```

The mnemonic (PECS — *Producer Extends, Consumer Super*) is about which direction data flows: `? extends T` when the parameter only *produces* values you read (you can't safely add to it — the compiler doesn't know if it's really a `List<ThreeD>` or `List<FourD>`); `? super T` when the parameter only *consumes* values you write (any supertype of `T` can legally hold a `T`).

### Generic methods and constructors

A method can declare its own type parameters even inside a non-generic class — the parameter list goes before the return type:

```java
static <T extends Comparable<T>, V extends T> boolean isIn(T x, V[] y) {
    for (V v : y) if (v.compareTo(x) == 0) return true;
    return false;
}

isIn(2, nums);                    // T and V both inferred as Integer, no explicit type args needed
GenMethDemo.<Integer, Integer>isIn(2, nums);   // same call, type arguments spelled out (rarely needed)
```

`V extends T` here means "`V` must be `T`, or a subtype of it" — mixing an `Integer` and a `String` array in the same call is a compile error, not a runtime surprise. Constructors can be generic the same way, even when their enclosing class isn't.

### Generic interfaces and hierarchies

```java
interface MinMax<T extends Comparable<T>> {
    T min();
    T max();
}

class MyClass<T extends Comparable<T>> implements MinMax<T> { /* ... */ }
```

A class implementing a generic interface must itself be generic (or bind the interface to one concrete type, e.g. `implements MinMax<Integer>`) — there's no way to "forget" the type parameter partway through a hierarchy. The same passing-through rule applies to a generic superclass: `class Gen2<T> extends Gen<T>` must carry `T` even if `Gen2` never uses it directly, purely to satisfy `Gen`.

### Erasure

At compile time, all generic type information is *erased*: every type parameter is replaced by its bound (`Object` if unbounded), and the compiler inserts the casts needed to make the code behave as if a type-specific version existed. At runtime there is exactly one class file for `Gen`, not one per type argument — `Gen<Integer>` and `Gen<String>` are the same `.class`.

```java
class Gen2 extends Gen<String> {
    @Override
    String getOb() { return super.getOb(); }   // erasure expects Object getOb()
}
```

The compiler resolves the mismatch by generating a synthetic *bridge method* (`Object getOb()` that calls the `String` one) — invisible in source, visible only in `javap` output.

Erasure is also why two overloads that only differ by two different type parameters can be ambiguous (both erase to `Object`), why you can't `new T[10]` (the compiler doesn't know what array type to allocate), and why a generic class can't extend `Throwable` (there's no such thing as a type-specific exception class at the bytecode level).

## Trade-offs

- **Bounded types trade flexibility for compiler guarantees.** `Stats<T extends Number>` can no longer be instantiated with a non-numeric type — that's the point, not a limitation.
  ```java
  class Stats<T extends Number> { /* ... */ }
  // Stats<String> s;  // compile error: String is not a Number
  ```
- **Raw types (a generic class used with no type argument at all) exist only for legacy interop and silently drop type safety** — the compiler still emits *unchecked* warnings, but a bad assignment now fails at runtime instead of compile time.
  ```java
  Gen raw = new Gen(Double.valueOf(98.6));
  int i = (Integer) raw.getOb();   // compiles, throws ClassCastException at runtime
  ```
- **A generic array of a specific type argument can't be created** — only a wildcarded one — because the JVM needs a concrete component type for `new`, and erasure has already thrown that information away by the time the array would be allocated.
  ```java
  // Gen<Integer>[] gens = new Gen<Integer>[10];   // won't compile
  Gen<?>[] gens = new Gen<?>[10];                   // OK
  ```
- **The diamond operator (`<>`) and `var` reduce verbosity but only work where the compiler can infer the type argument from context** — an assignment or constructor call, not a bare field declaration. Readability is otherwise unaffected: the erased runtime behavior is identical either way.

## Documentation Links

- [Generics (The Java Tutorials) — Oracle](https://docs.oracle.com/javase/tutorial/java/generics/index.html) — doc
- [Java Language Specification — Chapter 4.5, Parameterized Types](https://docs.oracle.com/javase/specs/jls/se25/html/jls-4.html#jls-4.5) — doc
- [Comparable — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Comparable.html) — doc
