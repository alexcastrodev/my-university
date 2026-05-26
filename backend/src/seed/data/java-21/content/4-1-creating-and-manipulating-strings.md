# Creating and Manipulating Strings

## String Immutability

In Java, `String` objects are **immutable** — once created, their value cannot be changed. Every method that appears to modify a `String` actually returns a **new** `String` object. The original remains unchanged.

```java
String s = "hello";
s.toUpperCase();        // does nothing useful — return value is discarded
System.out.println(s);  // still prints "hello"

String upper = s.toUpperCase();
System.out.println(upper); // prints "HELLO"
```

## The String Pool

Java maintains a **string pool** (part of the heap) to reuse `String` literals and avoid redundant allocations. When you write a string literal, Java checks the pool first.

```java
String a = "Java";
String b = "Java";
String c = new String("Java");

System.out.println(a == b);      // true  — same pool reference
System.out.println(a == c);      // false — c is a new heap object
System.out.println(a.equals(c)); // true  — same character content
```

Use `intern()` to add a heap string to the pool and get back the pooled reference.

## Creating Strings

```java
String s1 = "literal";                   // pool
String s2 = new String("explicit");      // always new heap object
String s3 = String.valueOf(42);          // "42"
String s4 = String.valueOf(true);        // "true"
```

## Key String Methods

### Length and Character Access

| Method | Description | Example |
|--------|-------------|---------|
| `length()` | Number of characters | `"Java".length()` → `4` |
| `charAt(int index)` | Character at index | `"Java".charAt(1)` → `'a'` |
| `indexOf(String s)` | First occurrence index, or `-1` | `"abcabc".indexOf("b")` → `1` |
| `lastIndexOf(String s)` | Last occurrence index | `"abcabc".lastIndexOf("b")` → `4` |

### Substrings

```java
String s = "Hello World";
s.substring(6);      // "World"   — from index 6 to end
s.substring(0, 5);   // "Hello"   — from 0 (inclusive) to 5 (exclusive)
```

### Case Conversion

```java
"hello".toUpperCase(); // "HELLO"
"HELLO".toLowerCase(); // "hello"
```

### Whitespace Handling

| Method | Removes |
|--------|---------|
| `trim()` | Leading/trailing ASCII whitespace (`\t`, `\n`, space) |
| `strip()` | Leading/trailing Unicode whitespace (preferred in Java 11+) |
| `stripLeading()` | Leading whitespace only |
| `stripTrailing()` | Trailing whitespace only |
| `isBlank()` | Returns `true` if empty or whitespace only |

### Searching and Replacing

```java
String s = "one two one";
s.startsWith("one");         // true
s.endsWith("one");           // true
s.contains("two");           // true
s.replace("one", "three");   // "three two three"
```

`replace` accepts either a `char` or a `CharSequence`. For regex-based replacement use `replaceAll` or `replaceFirst`.

### Formatted Output

```java
// Instance method (Java 15+)
String msg = "Score: %d out of %d".formatted(87, 100);

// Static method (classic)
String msg2 = String.format("Hello, %s!", "Alice");
```

Common format specifiers: `%s` (String), `%d` (int), `%f` (float/double), `%n` (newline), `%.2f` (2 decimal places).

## String Concatenation Rules

The `+` operator concatenates strings. Java applies specific rules:

1. If **both** operands are numeric, `+` performs addition.
2. If **either** operand is a `String`, `+` performs concatenation.
3. Evaluation is **left to right**.

```java
System.out.println(1 + 2 + " hello");   // "3 hello"  (1+2=3 first)
System.out.println("hello " + 1 + 2);   // "hello 12" (left to right, string first)
System.out.println("total: " + (1 + 2)); // "total: 3" (parentheses force addition)
```

Concatenating with `null` produces the string `"null"`:

```java
String x = null;
System.out.println("value: " + x); // "value: null"
```

## Useful Utility Methods

```java
"  spaces  ".strip();          // "spaces"
"abc".repeat(3);               // "abcabcabc"
"a,b,c".split(",");            // String[] {"a", "b", "c"}
String.join("-", "a", "b");    // "a-b"
"hello".equalsIgnoreCase("HELLO"); // true
```

## Exam Tips

- String indices are **zero-based**.
- `substring(beginIndex, endIndex)` — `endIndex` is **exclusive**.
- Methods like `toUpperCase()` return a new `String`; they do not modify the original.
- Comparing strings with `==` checks **reference equality**, not content — always use `equals()` for content comparison.
