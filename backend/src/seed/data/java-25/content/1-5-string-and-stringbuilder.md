---
version: 1.0
updatedAt: 2026-05-26
---
# String and StringBuilder

---

## String

`String` is an **immutable**, `final` class in `java.lang`. Once created, its character sequence cannot be changed. Every operation that appears to modify a `String` actually returns a new `String` object.

### Creating Strings

```java
String s1 = "Hello";                  // string literal — from the string pool
String s2 = new String("Hello");      // new object — NOT from the pool
String s3 = String.valueOf(42);       // "42"
String s4 = Integer.toString(42);     // "42"
```

> **Exam tip:** String literals with identical content share the same pool object. `new String(...)` always creates a new heap object even if the value is the same.

### String Pool and `==` vs `.equals()`

```java
String a = "hello";
String b = "hello";
String c = new String("hello");

System.out.println(a == b);          // true  (same pool object)
System.out.println(a == c);          // false (c is a new heap object)
System.out.println(a.equals(c));     // true  (same content)

String d = c.intern();               // d points to the pool object
System.out.println(a == d);          // true
```

---

## Common String Methods

### Length and Character Access

```java
String s = "Hello, World!";
s.length();            // 13
s.charAt(0);           // 'H'
s.indexOf('o');        // 4  (first occurrence)
s.indexOf('o', 5);     // 8  (starting from index 5)
s.lastIndexOf('o');    // 8  (last occurrence)
```

### Substrings

```java
String s = "Hello, World!";
s.substring(7);        // "World!" (from index 7 to end)
s.substring(7, 12);    // "World"  (from 7, up to but not including 12)
```

> **Exam tip:** `substring(beginIndex, endIndex)` — `beginIndex` is inclusive, `endIndex` is exclusive. Length of result = `endIndex - beginIndex`.

### Searching and Comparing

```java
String s = "Hello, World!";
s.contains("World");          // true
s.startsWith("Hello");        // true
s.endsWith("!");              // true
s.equals("Hello, World!");    // true  (case-sensitive)
s.equalsIgnoreCase("hello, world!"); // true
s.compareTo("Hello, World!"); // 0 (same content)
s.isEmpty();                  // false
s.isBlank();                  // false (Java 11+)
```

### Transformation

```java
String s = "  Hello, World!  ";
s.toUpperCase();        // "  HELLO, WORLD!  "
s.toLowerCase();        // "  hello, world!  "
s.trim();               // "Hello, World!" (removes leading/trailing whitespace ASCII ≤ 32)
s.strip();              // "Hello, World!" (Unicode-aware, Java 11+)
s.stripLeading();       // "Hello, World!  "
s.stripTrailing();      // "  Hello, World!"
s.replace('l', 'r');    // "  Herro, Worrd!  "
s.replace("World", "Java"); // "  Hello, Java!  "
s.replaceAll("\\s+", "-");  // regex replacement
```

### Splitting and Joining

```java
String csv = "a,b,c,d";
String[] parts = csv.split(",");    // ["a", "b", "c", "d"]
String[] two   = csv.split(",", 2); // ["a", "b,c,d"] (limit 2 tokens)

String joined = String.join("-", "a", "b", "c");     // "a-b-c"
String joined2 = String.join(", ", List.of("x","y")); // "x, y"
```

### Formatting

```java
String msg = String.format("Name: %s, Age: %d", "Alice", 30);
// "Name: Alice, Age: 30"

String msg2 = "Name: %s, Score: %.2f".formatted("Bob", 99.567);
// "Name: Bob, Score: 99.57"
```

### Characters and Code Points

```java
String s = "Hello";
char[] chars = s.toCharArray();
int[] codePoints = s.codePoints().toArray();

String fromChars = new String(chars);
String fromCode  = String.valueOf(chars);
```

---

## String Immutability

Because `String` is immutable, each method returns a **new** object — the original is unchanged:

```java
String s = "hello";
s.toUpperCase();         // returns "HELLO" but s is unchanged
String upper = s.toUpperCase();  // must capture the result
System.out.println(s);   // "hello"
System.out.println(upper); // "HELLO"
```

---

## StringBuilder

`StringBuilder` is a **mutable** sequence of characters. Use it when building strings dynamically — it is much more efficient than concatenating `String` objects in a loop.

`StringBuilder` is **not thread-safe**. Use `StringBuffer` for thread-safe operations (rarely needed on the exam).

### Creating StringBuilder

```java
StringBuilder sb1 = new StringBuilder();          // empty, initial capacity 16
StringBuilder sb2 = new StringBuilder("Hello");   // from String
StringBuilder sb3 = new StringBuilder(100);       // initial capacity 100
```

### Appending and Inserting

```java
StringBuilder sb = new StringBuilder("Hello");
sb.append(", World");     // "Hello, World"
sb.append('!');           // "Hello, World!"
sb.append(42);            // "Hello, World!42" (any type)
sb.insert(5, " there");   // inserts at index 5
```

### Deleting and Replacing

```java
StringBuilder sb = new StringBuilder("Hello, World!");
sb.delete(5, 7);          // removes chars from index 5 to 6: "HelloWorld!"
sb.deleteCharAt(0);       // removes char at index 0: "elloWorld!"
sb.replace(4, 9, "Java"); // replaces chars 4-8: "elloJava!"
```

### Reversing and Other Operations

```java
StringBuilder sb = new StringBuilder("Hello");
sb.reverse();             // "olleH"

sb.charAt(0);             // 'o'
sb.indexOf("ll");         // -1 (after reverse)
sb.length();              // 5
sb.setCharAt(0, 'H');     // "HlleH" — mutates in place

String result = sb.toString();  // convert to immutable String
```

### Chaining

All mutating methods return `this`, so calls can be chained:

```java
String result = new StringBuilder()
    .append("Hello")
    .append(", ")
    .append("World")
    .append('!')
    .toString();
// "Hello, World!"
```

---

## String vs StringBuilder Comparison

| Feature | `String` | `StringBuilder` |
|---------|----------|-----------------|
| Mutability | Immutable | Mutable |
| Thread safety | Thread-safe (immutable) | Not thread-safe |
| Performance in loops | Poor (creates many objects) | Excellent |
| Pool/interning | Yes (string pool) | No |
| Method return | New `String` | `this` (for chaining) |

---

## Key Points for the Exam

- `String` is immutable — every transformation returns a new `String`; the original is unchanged.
- String literals with the same content share a pool object; `==` can return `true` for them.
- Always use `.equals()` to compare `String` content, never `==`.
- `substring(begin, end)` — `begin` inclusive, `end` exclusive.
- `StringBuilder` is mutable, not thread-safe, and faster for building strings in loops.
- `StringBuilder` methods mutate the object and return `this`, enabling chaining.
- `trim()` removes ASCII whitespace only; `strip()` (Java 11+) handles Unicode whitespace.

## References

- [Oracle Docs — String (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/String.html)
- [Oracle Docs — StringBuilder (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/StringBuilder.html)
