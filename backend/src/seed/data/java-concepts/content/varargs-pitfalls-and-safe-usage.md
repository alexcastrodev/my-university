---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

A varargs parameter (`T... args`) lets a method accept zero or more arguments of a type without the caller building an array explicitly — but the compiler builds that array anyway, on every single call, and when `T` is a generic type parameter that implicit array creation is exactly the kind of operation generics were designed to make impossible to get wrong. Knowing what varargs desugars to explains both its performance cost in hot paths and the runtime `ClassCastException`s it can produce when mixed with generics.

## Use Cases

- APIs with a genuinely variable-length argument list where the count isn't known until the call site — `String.format(fmt, Object... args)`, `Files.createDirectories(Path, FileAttribute<?>... attrs)`, reflective invocation.
- Convenience factory methods that gather arguments into a collection — `List.of(E... elements)`, `Set.of(E... elements)`.
- Methods where at least one argument is required — declared as one fixed parameter plus a varargs tail, so a zero-argument call is a compile error instead of a runtime `IllegalArgumentException`.

## Deep Dive

### How varargs desugars to an array

`args` inside the method body is an ordinary array — the `...` is purely call-site sugar. The compiler rewrites every call to build that array first:

```java
static int sum(int... args) {
    int total = 0;
    for (int arg : args) total += arg;
    return total;
}

sum(1, 2, 3);
// compiles roughly to:
sum(new int[] { 1, 2, 3 });
```

`sum()` with no arguments is legal and passes a zero-length array — `args.length == 0`, not `null`. That makes an unbounded `T...` a poor fit for "at least one argument required": checking `args.length == 0` and throwing at runtime works, but it turns a caller mistake into a runtime failure instead of a compile error. Declaring one fixed leading parameter plus a varargs tail fixes that at essentially no cost:

```java
// zero-argument call is now a compile error, not a runtime IllegalArgumentException
static int min(int first, int... rest) {
    int min = first;
    for (int r : rest) if (r < min) min = r;
    return min;
}
```

### The performance mitigation: overload for the common case

Every call to a varargs method allocates and initializes an array — including a call with a fixed, small number of arguments that could have been passed as ordinary parameters. In a hot path this allocation is pure overhead. The standard mitigation is to overload the common small-arity cases as fixed-parameter methods and reserve the varargs form for the rare large-N call:

```java
public void foo() { }
public void foo(int a1) { }
public void foo(int a1, int a2) { }
public void foo(int a1, int a2, int a3) { }
public void foo(int a1, int a2, int a3, int... rest) { }
```

If the overwhelming majority of calls pass three or fewer arguments, only the remaining calls pay for an array allocation — the rest resolve to a plain overload with no array at all. `EnumSet`'s static factories (`EnumSet.of(E)`, `EnumSet.of(E, E)`, ... up to five explicit-arity overloads, then `EnumSet.of(E first, E... rest)`) use exactly this pattern, because `EnumSet` is meant to be a performance-competitive replacement for bit-field constants and can't afford an array allocation on every call.

### Generic varargs and heap pollution

`generics.md` covers erasure in full — the short version needed here is that `List<String>` and `List<Integer>` erase to the same runtime type, `List`. A varargs parameter typed `List<String>... lists` is, underneath, a `List[]` — an array of raw `List`, because there's no such thing as a `List<String>[]` at the bytecode level. Arrays, unlike generic collections, are *reifiable*: they know and enforce their element type at runtime. Combining an array (runtime-checked) whose element type is itself erased (compile-time-only) is the exact combination that lets a generic-varargs call slip an incompatible object past the compiler undetected — a class of bug the language calls **heap pollution**, where a variable of a parameterized type ends up referring to an object that is not of that type.

```java
// compiles with an "unchecked generics array creation" warning
static void dangerous(List<String>... stringLists) {
    List<Integer> intList = List.of(42);
    Object[] objects = stringLists;   // List<String>[] is-a Object[] — legal, arrays are covariant
    objects[0] = intList;             // heap pollution: objects[0] now really holds a List<Integer>
    String s = stringLists[0].get(0); // compiles fine — get() returns "String" per erasure...
    // ...but throws ClassCastException at runtime: the actual object is a List<Integer>
}
```

The `ClassCastException` doesn't surface at `objects[0] = intList` — that line compiles and runs without complaint, because arrays are covariant and erasure has already erased `stringLists`'s element type to raw `List` by the time the JVM checks the array store. It surfaces later, at `stringLists[0].get(0)`, far from where the actual mistake was made — the same "fails at the wrong call site" problem that makes heap pollution bugs hard to track down.

This is also why an unbounded generic varargs signature is one of the most suspect method shapes in the language: `<T> ReturnType m(T... args)` accepts *any* argument list with no compile-time checking between them, exactly like `Object...` would.

### `@SafeVarargs`: the actual contract

The compiler cannot prove a generic varargs method never does anything unsafe with its array, so it emits an "unchecked generics array creation" warning at every call site. `@SafeVarargs`, applied to the method declaration, is the author's assertion that the warning is a false positive for this specific method — it does not change what the method does, only which warnings the compiler suppresses (for the method body itself, and for its callers).

```java
@SafeVarargs
static <T> List<T> listOf(T... elements) {
    return List.of(elements);   // only reads from the array — never stores into it, never leaks the reference
}
```

The contract: a method may carry `@SafeVarargs` only if it neither stores anything into the varargs array nor lets a reference to that array escape to untrusted code (returning it, assigning it to a visible field, passing it to another method that might do either). `dangerous` above would still be unsafe with the annotation slapped on it — `@SafeVarargs` suppresses the warning, it doesn't verify the claim.

As of the current JLS and Javadoc, `@SafeVarargs` is restricted to declarations that can't be overridden — `static` methods, `final` instance methods, `private` instance methods, and constructors — because an override could reintroduce unsafe behavior underneath a caller who trusts the annotation on the base declaration. Applying it to a non-final, non-private, non-static, non-constructor varargs method is a compile-time error. Note the one change from the language's early releases: `private` instance methods became a legal target starting with Java 9 (they weren't overridable to begin with, but the compiler didn't recognize that until then) — before that, a private varargs method needing the annotation had to also be marked `final` to qualify.

## Trade-offs

- **Varargs convenience costs an array allocation on every call.** Fine for `String.format` or a rarely-called setup method; worth measuring before using it in a loop that runs millions of times.
  ```java
  static int sum(int... args) { /* ... */ }
  sum(1, 2);   // allocates a new int[2] just for this call
  ```
- **A generic varargs parameter (`T...`) trades compile-time array-store safety for convenience** — the array backing it is only checked as raw `Object[]`/`List[]` at the point it's created, not as `T[]`, so a bug can compile clean and only fail later as a `ClassCastException`.
- **`@SafeVarargs` is a promise, not a check.** Applying it to a method that does store into or leak its varargs array silences the warning without removing the bug — treat it as documentation the author is expected to have verified by hand, not a compiler-enforced guarantee.
- **Retrofitting an existing array-parameter API to varargs is a one-way door for its type-checking.** `Arrays.asList(Object...)` accepts a single `int[]` as one element instead of rejecting it, because `int[]` autoboxes-free into a one-element `Object[]`, producing `[[I@...]` instead of a compile error — a caller mistake that used to fail to compile now runs and produces silently wrong output.
  ```java
  int[] digits = {3, 1, 4, 1, 5};
  System.out.println(Arrays.asList(digits));  // prints something like [[I@1b6d3586], not the elements
  System.out.println(Arrays.toString(digits)); // the correct way: [3, 1, 4, 1, 5]
  ```

## Documentation Links

- [SafeVarargs — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/SafeVarargs.html) — doc
- [Java Language Specification — Chapter 8.4.1, Formal Parameters and Varargs](https://docs.oracle.com/javase/specs/jls/se25/html/jls-8.html#jls-8.4.1) — doc
- [Arrays.asList — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Arrays.html#asList(T...)) — doc
- [EnumSet — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/EnumSet.html) — doc
