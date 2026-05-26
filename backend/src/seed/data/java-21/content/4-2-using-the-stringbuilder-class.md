# Using the StringBuilder Class

## Why StringBuilder?

`String` is immutable, so every concatenation creates a new object. In a loop, this produces many short-lived strings and puts pressure on the garbage collector.

```java
// Inefficient — creates a new String on every iteration
String result = "";
for (int i = 0; i < 1000; i++) {
    result += i;  // equivalent to result = new String(result + i)
}
```

`StringBuilder` solves this by maintaining a **mutable** character buffer that grows as needed. All modifications happen **in place**.

```java
StringBuilder sb = new StringBuilder();
for (int i = 0; i < 1000; i++) {
    sb.append(i);  // no new object created
}
String result = sb.toString();
```

## Creating a StringBuilder

```java
StringBuilder sb1 = new StringBuilder();          // empty, default capacity 16
StringBuilder sb2 = new StringBuilder("Hello");   // initial content
StringBuilder sb3 = new StringBuilder(64);        // empty, initial capacity 64
```

## Key Methods

### append

Adds content to the **end** of the buffer. Accepts nearly any type.

```java
StringBuilder sb = new StringBuilder("Hello");
sb.append(", ");
sb.append("World");
sb.append('!');
sb.append(42);
System.out.println(sb); // "Hello, World!42"
```

### insert

Inserts content at the specified index, shifting existing characters right.

```java
StringBuilder sb = new StringBuilder("Hello World");
sb.insert(5, ",");
System.out.println(sb); // "Hello, World"
```

### delete and deleteCharAt

```java
StringBuilder sb = new StringBuilder("abcdef");
sb.delete(2, 4);       // removes index 2 (inclusive) to 4 (exclusive) → "abef"
sb.deleteCharAt(0);    // removes character at index 0 → "bef"
```

### replace

Replaces characters between `start` (inclusive) and `end` (exclusive) with a new string.

```java
StringBuilder sb = new StringBuilder("Hello World");
sb.replace(6, 11, "Java");
System.out.println(sb); // "Hello Java"
```

### reverse

Reverses the entire character sequence.

```java
StringBuilder sb = new StringBuilder("abcde");
sb.reverse();
System.out.println(sb); // "edcba"
```

### Other Useful Methods

| Method | Description |
|--------|-------------|
| `length()` | Current number of characters |
| `charAt(int index)` | Character at index |
| `indexOf(String s)` | First occurrence, or `-1` |
| `substring(int start)` | Returns a `String` from index to end |
| `substring(int start, int end)` | Returns a `String` slice |
| `toString()` | Converts buffer to a `String` |

## Method Chaining

All mutating methods return `this`, so calls can be chained fluently.

```java
String result = new StringBuilder()
    .append("Java")
    .append(" ")
    .append(21)
    .insert(0, "OCP ")
    .reverse()
    .toString();
// "12 avaJ PCO"
```

On the exam, trace chained calls **step by step** from left to right — the buffer state changes after each method.

## StringBuilder vs StringBuffer

| Feature | StringBuilder | StringBuffer |
|---------|---------------|--------------|
| Thread-safe | No | Yes (synchronized) |
| Performance | Faster | Slower |
| Since | Java 5 | Java 1.0 |
| Preferred when | Single-threaded | Multi-threaded |

The OCP exam focuses on `StringBuilder`. `StringBuffer` is rarely tested but you should know it is the thread-safe alternative.

## StringBuilder vs String

| Aspect | String | StringBuilder |
|--------|--------|---------------|
| Mutability | Immutable | Mutable |
| `==` comparison | May share pool | References specific instance |
| `equals()` | Compares content | Compares **reference** (not content!) |
| Use case | Fixed text, keys, constants | Building/modifying text in loops |

> **Exam trap**: `StringBuilder` does **not** override `equals()` from `Object`. Two `StringBuilder` instances with identical content are **not** equal via `equals()`.

```java
StringBuilder a = new StringBuilder("hello");
StringBuilder b = new StringBuilder("hello");
System.out.println(a.equals(b));  // false — reference comparison
System.out.println(a.toString().equals(b.toString())); // true
```

## Exam Tips

- `delete(start, end)` and `replace(start, end, str)` use **inclusive start, exclusive end**.
- `insert(offset, str)` inserts **before** the character currently at `offset`.
- Chained method calls modify the **same** object; no new `StringBuilder` is created.
- `length()` returns the number of characters currently in the buffer, not the capacity.
- Always call `toString()` when you need a `String` from a `StringBuilder`.
