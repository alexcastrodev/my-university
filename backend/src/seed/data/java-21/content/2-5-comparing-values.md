# Comparing Values

> **Comparison operators** evaluate a relationship between two operands and return a `boolean` result (`true` or `false`). Java provides equality, relational, and type-check operators.

---

## Equality and Inequality: `==` and `!=`

| Operator | Meaning |
|---|---|
| `==` | Equal to |
| `!=` | Not equal to |

```java
int a = 5, b = 5, c = 6;
System.out.println(a == b);  // true
System.out.println(a == c);  // false
System.out.println(a != c);  // true
```

---

## Relational Operators

| Operator | Meaning |
|---|---|
| `<` | Less than |
| `>` | Greater than |
| `<=` | Less than or equal to |
| `>=` | Greater than or equal to |

These work only on numeric types (`byte`, `short`, `int`, `long`, `float`, `double`, `char`).

```java
System.out.println(3 < 5);    // true
System.out.println(5 <= 5);   // true
System.out.println(5 > 5);    // false
System.out.println('A' < 'B'); // true — char comparison uses Unicode values
```

---

## Comparing Primitives

Primitive comparison is straightforward — values are compared directly:

```java
int x = 10;
int y = 10;
System.out.println(x == y);  // true

double d1 = 0.1 + 0.2;
double d2 = 0.3;
System.out.println(d1 == d2);  // false — floating-point precision issue
```

> Avoid `==` with `double` or `float` values that result from calculations. Use an epsilon comparison instead: `Math.abs(d1 - d2) < 1e-9`.

---

## Comparing Objects with `==`

For **object references**, `==` checks whether both variables point to the **same object in memory** — not whether the objects have equal content.

```java
String s1 = new String("hello");
String s2 = new String("hello");
System.out.println(s1 == s2);       // false — different objects
System.out.println(s1.equals(s2));  // true  — same content
```

String literals from the **string pool** are often the same object:

```java
String a = "hello";
String b = "hello";
System.out.println(a == b);       // true  — both reference the same pool entry
System.out.println(a.equals(b)); // true
```

> On the OCP exam, watch for `==` vs. `.equals()` questions involving `String`, `Integer`, and other wrapper types.

---

## Integer Cache and Autoboxing

Java caches `Integer` objects in the range **-128 to 127**. `==` on cached values returns `true`; outside that range it returns `false`.

```java
Integer i1 = 127;
Integer i2 = 127;
System.out.println(i1 == i2);   // true  — cached

Integer i3 = 128;
Integer i4 = 128;
System.out.println(i3 == i4);   // false — not cached, different objects
System.out.println(i3.equals(i4)); // true
```

---

## The `instanceof` Operator

`instanceof` tests whether an object is an instance of a given type. It returns `false` (not an exception) when the reference is `null`.

```java
Object obj = "Hello";
System.out.println(obj instanceof String);   // true
System.out.println(obj instanceof Integer);  // false

Object nullRef = null;
System.out.println(nullRef instanceof String);  // false  (no NullPointerException)
```

### Pattern Matching instanceof (Java 16+, finalized in Java 21)

Combines the type test with a binding in a single expression:

```java
Object obj = "OCP";
if (obj instanceof String s) {
    System.out.println(s.length());  // s is already a String — no cast needed
}
```

### instanceof with Reference Types

`instanceof` only applies to reference types — not primitives:

```java
int x = 5;
// System.out.println(x instanceof Integer);  // compile error
```

---

## Comparing null

```java
String s = null;
System.out.println(s == null);    // true
System.out.println(null == null); // true
// s.equals("test");              // throws NullPointerException
```

A safe pattern is to call `equals` on the known non-null value:

```java
"expected".equals(s);  // false — no NPE even when s is null
```

---

## Common Exam Scenarios

```java
// Scenario 1: comparing boolean expressions
boolean b1 = true, b2 = false;
System.out.println(b1 == !b2);  // true == true → true

// Scenario 2: char vs int
char c = 'A';      // Unicode 65
System.out.println(c == 65);    // true

// Scenario 3: promotion in comparison
int  i = 1000000;
long l = 1000000L;
System.out.println(i == l);     // true — i promoted to long

// Scenario 4: wrapper vs primitive
Integer w = 5;
int    p = 5;
System.out.println(w == p);     // true — w unboxed to int before comparison
```

---

## Key Rules to Remember

- `==` on objects tests **reference identity**, not content equality — use `.equals()` for content.
- `null instanceof AnyType` always returns `false` — never throws.
- Integer autoboxing cache covers -128 to 127; `==` on `Integer` objects outside that range returns `false`.
- When comparing a wrapper type to a primitive with `==`, the wrapper is unboxed first.
- Floating-point `==` comparisons are unreliable due to precision; prefer an epsilon check.

---

## References

- [Oracle Docs — Equality, Relational, and Conditional Operators](https://docs.oracle.com/javase/tutorial/java/nutsandbolts/op2.html)
- *OCP Oracle Certified Professional Java SE 21 Study Guide* — Chapter 2
