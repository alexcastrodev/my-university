---
version: 1.0
updatedAt: 2026-08-19
---
## Objective

`String s1 = "hi"; String s2 = "hi"; s1 == s2` is `true`. `String s3 = new String("hi"); s1 == s3` is `false`. Both `s1.equals(s2)` and `s1.equals(s3)` are `true`. The reason isn't a language quirk to memorize — it's a single, consistent mechanism: the JVM maintains a **string pool**, a table of unique `String` instances, and every string *literal* is automatically interned into it at class-load time, so two literals with the same content are the *same object*. `new String(...)` explicitly opts out of that sharing and allocates a fresh, non-pooled object, even when its content is identical to something already in the pool. Knowing this turns `==` on strings from "sometimes works, sometimes doesn't" into a predictable consequence of where each string came from.

## Use Cases

- Explaining (and stopping) the classic bug: comparing user input or a value read from a file/database with `==` instead of `.equals()`, which "happens to work" in ad hoc testing with literals and then fails the moment the value is read at runtime.
- Deciding whether `.intern()` is worth calling on a large set of runtime-constructed strings with heavy duplication (parsed tokens, repeated config keys) to cut memory, and knowing what it actually costs to do so.
- Reading a heap dump or diagnosing unexpectedly high string memory usage, where knowing what does and doesn't get pooled explains why.
- Understanding why switch-on-String and certain reflection/annotation-value comparisons can rely on reference equality internally without it being a footgun for that specific, controlled use.

## Deep Dive

### Where a string comes from decides whether it's pooled

```java
String a = "hello";              // literal — interned automatically
String b = "hello";              // same literal — same pooled instance
System.out.println(a == b);      // true

String c = new String("hello");  // explicit new object, NOT pooled
System.out.println(a == c);      // false
System.out.println(a.equals(c)); // true — equals() compares content, always

String d = "hel" + "lo";         // both operands are compile-time constants
System.out.println(a == d);      // true — the compiler folds this into one literal "hello"

String e = "hel";
String f = e + "lo";             // built at runtime, e is a variable, not a constant
System.out.println(a == f);      // false — runtime concatenation allocates a new String
```

The rule that explains all four cases: a `String` is pooled only when the compiler can resolve it to a constant at compile time (a literal, or a `+` of literals/`final` compile-time constants). The moment a variable that isn't a compile-time constant is part of the expression, the result is a genuinely new object built at run time, and pooling doesn't apply.

### `.intern()`: opting a runtime string into the pool

```java
String g = new String("hello").intern();
System.out.println(a == g);      // true — g now points at the same pooled instance as a
```

`intern()` looks up the pool for a string with equal content; if found, it returns that pooled reference, otherwise it adds this string to the pool and returns it. This is the one way to make a *runtime-constructed* string participate in reference-equality sharing — useful specifically when you have many semantically-repeated strings (e.g., tens of thousands of parsed tokens where only a few hundred distinct values actually occur) and want them collapsed to shared instances rather than each holding its own `char[]`.

### Why this exists: `String` is immutable, so sharing is free

Pooling is only safe because `String` is immutable — two variables can point at the same object with zero risk that one caller's mutation surprises another, which is exactly the property that makes `String` usable as a `HashMap` key or shared across threads without defensive copying in the first place. A mutable type could never be pooled this way; `StringBuilder` isn't, and isn't meant to be.

### Where the pool actually lives

Since JDK 7 (JDK-6962931), the string pool lives in the regular heap, not the deprecated PermGen space it occupied before — a pooled string is garbage-collected like any other object once nothing references it, it's just deduplicated while it's alive. This matters practically: interning millions of unique strings doesn't create a fixed, un-collectible leak the way it could on pre-7 JVMs; it just puts memory pressure on the regular heap like any other large live-object set would.

## Trade-offs

- **`==` on strings is not "sometimes buggy" — it is a deterministic function of provenance**, and once that's clear, the fix is always the same: use `.equals()` for content comparison, full stop, and reserve `==` for the rare case where you deliberately want reference identity (e.g., a sentinel object).
- **`.equals()` should be the default even when `==` happens to work today.** Code compared with literals in a unit test and passing `==` checks will break the moment the same value arrives from user input, a file, `String.format`, or any other runtime construction path — the literal-vs-runtime distinction is invisible at the call site unless you specifically go looking for it.
- **`.intern()` isn't free, and isn't always a win.** Each call does a pool lookup (a hash-based comparison against existing pooled content), so interning strings that are mostly *not* duplicates costs CPU for no memory benefit — it pays off specifically when duplication is high and the strings are long-lived, not as a reflexive habit on every string you construct.
- **Compiler-folded constant concatenation (`"hel" + "lo"`) is a compile-time-only guarantee.** The same expression written with even one non-final local variable in the mix loses the folding and produces a genuinely new, unpooled object — a refactor that replaces a literal with a variable can silently change `==` behavior even though `.equals()` behavior is unaffected.
- **This is language-level behavior, not something `record`/`var`/newer syntax changes.** A `record` component holding a `String` and a `var` inferred as `String` follow exactly the same pooling rules as any other `String`-typed reference — there's no special case to remember for newer syntax.

## Documentation Links

- [String — Java SE 25 API (see `intern()`)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/String.html#intern()) — doc
- [JLS §3.10.5 — String Literals](https://docs.oracle.com/javase/specs/jls/se25/html/jls-3.html#jls-3.10.5) — doc
- [JDK-6962931: Move string pool out of PermGen](https://bugs.openjdk.org/browse/JDK-6962931) — doc
