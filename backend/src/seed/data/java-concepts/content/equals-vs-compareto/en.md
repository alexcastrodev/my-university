---
version: 1.0
updatedAt: 2026-10-09
---
## Objective

`equals()` and `compareTo()` both answer "are these two objects the same?", but they come from different places and say different things. `equals(Object)` is declared on `Object`, so every Java object has it, and it returns a `boolean`: equal or not. `compareTo(T)` is declared on the `Comparable<T>` interface, so only types that opt in have it, and it returns an `int`: negative if `this` is less than the other, zero if they are equal, positive if `this` is greater. The short answer is "one returns a boolean, the other an int". The longer answer is that the two are expected to agree on what "equal" means, and when they don't (as with `BigDecimal`), collections built on one of them behave differently from collections built on the other.

## Use Cases

- Answering the interview question "what is the difference between `equals()` and `compareTo()`?" with more than the return types.
- Deciding whether a class needs only `equals()`/`hashCode()` (it goes in a `HashSet` or is a `HashMap` key) or also a natural ordering via `Comparable` (it gets sorted, or goes in a `TreeSet`/`TreeMap`).
- Comparing money amounts held in `BigDecimal`, where `new BigDecimal("1.0").equals(new BigDecimal("1.00"))` is `false`.
- Explaining why the same values produce a set of size 2 in a `HashSet` and size 1 in a `TreeSet`.

## Deep Dive

### Where each method comes from

`equals()` is inherited by every class from `java.lang.Object`. The default implementation is identity (`this == obj`); classes that represent values override it.

`compareTo()` only exists if the class implements `java.lang.Comparable<T>`. Many JDK types do: `String`, every primitive wrapper (`Integer`, `Long`, `Double`, `Character`, ...), `BigDecimal`, `BigInteger`, `LocalDate`, enums, and so on. Your own classes can implement it too.

```java
public record Version(int major, int minor) implements Comparable<Version> {
    @Override
    public int compareTo(Version other) {
        int byMajor = Integer.compare(major, other.major);
        return byMajor != 0 ? byMajor : Integer.compare(minor, other.minor);
    }
}
```

The record gets `equals()` for free from its components; the ordering is something it had to declare explicitly.

### What each one returns

`equals()` gives a yes/no answer. `compareTo()` gives a direction, which is exactly what sorting algorithms need:

```java
"apple".equals("banana");          // false

"apple".compareTo("banana");       // -1  (negative: "apple" comes first)
"b".compareTo("a");                // 1   (positive: "b" comes after)
"a".compareTo("a");                // 0   (equal)

Integer.valueOf(5).compareTo(7);   // -1
```

Only the sign is part of the contract. `String.compareTo()` can return `-1`, `-17` or `-3000`; callers must test `< 0`, `== 0`, `> 0`, never `== -1`.

### They also differ on null

`equals(null)` is required to return `false`. `compareTo(null)` is required to throw, because there is no meaningful "direction" to null:

```java
"a".equals(null);      // false
"a".compareTo(null);   // NullPointerException
```

### Consistent with equals

The `Comparable` documentation asks for this rule: `x.compareTo(y) == 0` should have the same truth value as `x.equals(y)`. Two objects that are equal should compare as zero, and two objects that compare as zero should be equal. The JDK calls an ordering that satisfies this *consistent with equals*. It is strongly recommended, not enforced, and that gap is where the bugs come from.

The reason it matters is that the JDK's collections pick one of the two methods and ignore the other:

- `HashSet`, `HashMap`, `List.contains()`, `List.indexOf()` use `equals()` (and `hashCode()`).
- `TreeSet`, `TreeMap`, `Collections.binarySearch()` use `compareTo()` (or a `Comparator`) and never call `equals()`.

If the two methods disagree, the same data behaves differently depending on which collection holds it.

### BigDecimal: the famous inconsistency

A `BigDecimal` is an unscaled integer plus a scale. `1.0` is `10 × 10^-1` and `1.00` is `100 × 10^-2`. `equals()` compares value **and** scale; `compareTo()` compares only the numeric value:

```java
BigDecimal a = new BigDecimal("1.0");
BigDecimal b = new BigDecimal("1.00");

a.equals(b);     // false  (different scale)
a.compareTo(b);  // 0      (same numeric value)
```

Put the same two objects into a hash-based and a tree-based collection and you get two different answers:

```java
new HashSet<>(List.of(a, b)).size();   // 2  (uses equals)
new TreeSet<>(List.of(a, b)).size();   // 1  (uses compareTo)

Map<BigDecimal, String> hash = new HashMap<>();
hash.put(a, "x");
hash.get(b);                           // null

Map<BigDecimal, String> tree = new TreeMap<>();
tree.put(a, "x");
tree.get(b);                           // "x"
```

For numeric comparison of `BigDecimal`, use `compareTo() == 0`. If you need values like `1.0` and `1.00` to be interchangeable as hash keys, normalize them first:

```java
a.stripTrailingZeros().equals(b.stripTrailingZeros());   // true
```

### Double: consistent, but not with ==

`Double.equals()` and `Double.compareTo()` agree with each other, but both disagree with the primitive `==` operator on two edge cases:

```java
Double.valueOf(0.0).equals(-0.0);          // false
Double.valueOf(0.0).compareTo(-0.0);       // 1
0.0 == -0.0;                               // true

Double.valueOf(Double.NaN).equals(Double.NaN);     // true
Double.valueOf(Double.NaN).compareTo(Double.NaN);  // 0
Double.NaN == Double.NaN;                          // false
```

The wrapper methods deliberately define a total order (needed for sorting and for `NaN` keys to be findable), while `==` follows IEEE 754.

## Trade-offs

- **An ordering inconsistent with equals is legal and compiles silently, but sorted collections then break the `Set`/`Map` contract.** `Set` is specified in terms of `equals()`, yet a `TreeSet` decides membership with `compareTo()`, so it can reject an element that `equals()` says is new.
  ```java
  Set<String> names = new TreeSet<>(String.CASE_INSENSITIVE_ORDER);
  names.add("Java");
  names.add("JAVA");   // returns false: "JAVA".equals("Java") is false,
  names.size();        // 1             but the comparator says 0
  ```
- **Implementing `Comparable` commits a type to one natural ordering.** Any other ordering has to live in a `Comparator`; trying to fit two orderings into one `compareTo()` fights the contract. This is a design decision rather than something to demonstrate in code.
- **`compareTo()` written as subtraction is shorter but overflows.** `a - b` only has the right sign when the difference fits in an `int`; `Integer.compare()` is always correct.
  ```java
  int a = Integer.MIN_VALUE, b = 1;
  a - b;                    // 2147483647  (positive: wrong)
  Integer.compare(a, b);    // -1          (negative: right)
  ```
- **For `BigDecimal`, choosing `equals()` or `compareTo()` is choosing whether scale matters.** Scale is real information (`10.00` says "to the cent", `10` does not), so `equals()` is not wrong, just stricter than most business code expects.
  ```java
  new BigDecimal("10").equals(new BigDecimal("10.00"));        // false
  new BigDecimal("10").compareTo(new BigDecimal("10.00")) == 0; // true
  ```

## Documentation Links

- [Comparable (Java SE 25 API)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Comparable.html) (doc)
- [Object.equals (Java SE 25 API)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Object.html#equals(java.lang.Object)) (doc)
- [BigDecimal (Java SE 25 API)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/math/BigDecimal.html) (doc)
- [Question 402: equals vs compareTo (YouTube Short)](https://youtube.com/shorts/bsB3rAGONI8) (video)
