---
version: 1.0
updatedAt: 2026-08-02
---
## Objective

Understand Project Valhalla: an OpenJDK effort, led by Brian Goetz since 2014, to close the gap between primitives and objects — "code like a class, work like an int" — by letting the JVM store certain classes as flat, identity-free values instead of heap-allocated objects behind a reference.

## Use Cases

- Modeling pure data types — `Money`, `Point`, `RGB`, `Complex`, `Duration` — where the *value* is the whole meaning of the instance and identity (`==`) is irrelevant.
- Storing large arrays or collections of small objects (e.g., millions of `Point` instances) without paying a per-object header, reference, and GC-tracking cost for each one.
- Avoiding the hidden cost of autoboxing when a primitive has to flow through a generic API like `List<Integer>`.
- Reasoning about why `List<int>` still isn't legal Java, and what would have to change (reified/specialized generics) for it to be.

## Deep Dive

### Two different worlds: primitives vs. objects

Since Java 1.0, primitives and objects have lived by different rules:

```java
int age = 30;        // stored directly, no identity, no header, minimal overhead
Integer boxed = 30;   // an object: identity, header, heap allocation, GC-tracked
```

A primitive `int` is just its bits. An `Integer` — even though it wraps the exact same 4 bytes — carries an object header, a reference indirection, and participates in garbage collection. The performance difference is not about the data; it's about everything Java attaches to an object on top of the data.

### The memory layout problem

Consider a simple two-field class:

```java
class Point {
    int x;
    int y;
}
```

A `Point[]` today is an array of *references*, not an array of `Point` data:

```
Point[]
 ↓
+-----+      +-------+
| ref |----->| Point |
+-----+      +-------+
+-----+      +-------+
| ref |----->| Point |
+-----+      +-------+
```

Each access means following a pointer to a separate heap location — "pointer chasing" — which defeats CPU cache locality. What Valhalla aims for instead is a flat, contiguous layout:

```
[x,y][x,y][x,y][x,y]
```

No indirection, no separate allocations — the values sit next to each other in memory, exactly like a primitive array.

### Value classes: identity vs. value

A **value class** is one whose meaning is entirely in its data — two instances with the same values *are* the same value. Ordinary object identity breaks this today:

```java
Point p1 = new Point(1, 2);
Point p2 = new Point(1, 2);

p1 == p2   // false — two distinct objects, even with identical data
```

Types like `Point`, `Money`, or `Complex` don't need that distinction — only their values matter. Types like `User`, `Customer`, `Order`, or `Session` still do: two instances can hold identical fields and still represent different entities, so they keep the traditional object model. Value classes give the JVM permission to drop identity (and the machinery that comes with it) for the types where identity was never meaningful in the first place.

### Boxing and its hidden cost

Generics only accept reference types, so `List<int>` has never been legal — only `List<Integer>`. Every `add`/`get` call quietly boxes and unboxes:

```java
List<Integer> numbers = new ArrayList<>();
numbers.add(10);                 // compiler emits: numbers.add(Integer.valueOf(10))
int n = numbers.get(0);          // compiler emits: numbers.get(0).intValue()
```

For a list of a million integers, that's a million independent `Integer` objects, each with its own header, alignment padding, and reference — on top of the actual 4 bytes of data each one represents. Most of the memory footprint is bookkeeping, not payload.

### Why generics can't see primitives: type erasure

Generics (Java 5) were implemented via **type erasure**: at compile time, `List<String>`, `List<User>`, and `List<Integer>` all collapse to the same raw `List`. Since `int` isn't a reference type, it was never able to participate in that scheme:

```java
List<String> strings = new ArrayList<>();
List<Integer> ints = new ArrayList<>();
// after erasure, both are backed by the same raw List at the bytecode level
```

This preserved backward compatibility with pre-generics code, but it's also exactly why a specialized, unboxed `List<int>` has never existed.

## Trade-offs

- **Identity vs. flattening** — a value class gives up `==` identity semantics in exchange for letting the JVM store it flat (in arrays, in other objects' fields) without a heap allocation per instance. Types that genuinely need identity (`User`, `Session`) can't adopt this model.
- **Preview status** — JEP 401 (Value Classes and Objects) targets JDK 28 as a preview feature; the API and exact semantics can still change before finalization, so production code shouldn't depend on it yet.
- **Migration is opt-in, not automatic** — existing classes like the wrapper types (`Integer`, `Double`) can be evolved toward value semantics (JEP 402), but arbitrary existing classes don't become value classes for free; a type has to be deliberately modeled as one.
- **Full `List<int>` still needs more than value classes** — flattened storage for value types is the first step; genuinely reified/specialized generics over primitives are a separate, still-in-study part of the project.

## Documentation Links

- [JEP 401: Value Classes and Objects (Preview)](https://openjdk.org/jeps/401) — doc
- [JEP 402: Enhanced Primitive Boxing (Preview)](https://openjdk.org/jeps/402) — doc
- [Project Valhalla — OpenJDK](https://openjdk.org/projects/valhalla/) — doc
- [Project Valhalla — State of Valhalla (Brian Goetz)](https://openjdk.org/projects/valhalla/design-notes/state-of-valhalla/01-background) — doc
