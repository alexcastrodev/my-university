# Understanding Equality

## Primitives: == Is Always Value Comparison

For primitive types (`int`, `double`, `boolean`, `char`, etc.), `==` compares the **actual values**. There are no objects involved.

```java
int a = 5;
int b = 5;
System.out.println(a == b); // true

double x = 3.14;
double y = 3.14;
System.out.println(x == y); // true
```

## Objects: == Compares References

For object types, `==` checks whether two variables point to the **same object in memory** (same reference), not whether their contents are equal.

```java
StringBuilder sb1 = new StringBuilder("hello");
StringBuilder sb2 = new StringBuilder("hello");

System.out.println(sb1 == sb2);       // false — different objects
System.out.println(sb1.equals(sb2));  // false — StringBuilder doesn't override equals!
```

```java
StringBuilder sb3 = sb1;
System.out.println(sb1 == sb3); // true — same reference
```

## String Pool and ==

String literals are stored in the **string pool**, so two literals with the same content share the same reference.

```java
String s1 = "hello";
String s2 = "hello";
String s3 = new String("hello");

System.out.println(s1 == s2);      // true  — both from pool
System.out.println(s1 == s3);      // false — s3 is a new heap object
System.out.println(s1.equals(s3)); // true  — same content
```

`new String(...)` always creates a fresh object on the heap, bypassing the pool. You can call `intern()` to place it in the pool and return the pooled reference.

```java
String s4 = new String("hello").intern();
System.out.println(s1 == s4); // true — intern() returns the pooled reference
```

## The equals() Method

`Object.equals()` defaults to reference comparison (`==`). Classes that care about **content equality** override it. The standard Java types you should know:

| Class | equals() behavior |
|-------|-------------------|
| `String` | Compares character content |
| `Integer`, `Long`, etc. | Compares numeric value |
| `LocalDate`, `LocalTime` | Compares field values |
| `StringBuilder` | Does **not** override — uses reference |
| Custom classes | Depends on whether you override |

```java
String a = new String("Java");
String b = new String("Java");
System.out.println(a.equals(b)); // true

Integer x = new Integer(42);   // deprecated but valid
Integer y = new Integer(42);
System.out.println(x.equals(y)); // true
```

## The equals() Contract

A correct `equals()` implementation must satisfy:

| Property | Meaning |
|----------|---------|
| **Reflexive** | `x.equals(x)` is always `true` |
| **Symmetric** | `x.equals(y)` implies `y.equals(x)` |
| **Transitive** | `x.equals(y)` and `y.equals(z)` implies `x.equals(z)` |
| **Consistent** | Same result on repeated calls with unchanged objects |
| **Null-safe** | `x.equals(null)` is always `false` |

Calling `equals()` on `null` causes a `NullPointerException`:

```java
String s = null;
s.equals("hello"); // NullPointerException!
"hello".equals(s); // safe — returns false
```

## Objects.equals() — Null-Safe Comparison

`java.util.Objects.equals(a, b)` handles `null` safely without throwing:

```java
import java.util.Objects;

String a = null;
String b = "hello";

System.out.println(Objects.equals(a, b));    // false
System.out.println(Objects.equals(null, null)); // true
System.out.println(Objects.equals("hi", "hi")); // true
```

The implementation is: `(a == b) || (a != null && a.equals(b))`. Prefer `Objects.equals()` when either argument might be `null`.

## Integer Caching and ==

Java caches `Integer` objects for values from **-128 to 127**. This creates a subtle trap:

```java
Integer a = 100;
Integer b = 100;
System.out.println(a == b); // true  — cached

Integer c = 200;
Integer d = 200;
System.out.println(c == d); // false — outside cache range
```

This behavior applies to autoboxed `Integer`, `Long`, `Short`, `Byte`, `Character` (0–127), and `Boolean`. Always use `equals()` when comparing wrapper objects.

## Summary Table

| Scenario | Use `==` | Use `equals()` |
|----------|----------|----------------|
| Primitive values | Yes | N/A |
| Same object reference? | Yes | — |
| String content | No (pool exception aside) | Yes |
| Wrapper content (`Integer`, etc.) | No | Yes |
| Null-safe content check | — | `Objects.equals()` |

## Exam Tips

- `==` on objects is a **reference** check, not a content check.
- String literals with the same text share a pool reference and will satisfy `==`.
- `StringBuilder` does **not** override `equals()` — two `StringBuilder` instances with equal content return `false` with `equals()`.
- Always use `equals()` (or `Objects.equals()`) for content comparison of objects.
- Put the known non-null value on the **left** of `equals()` to avoid `NullPointerException`: `"expected".equals(variable)`.
