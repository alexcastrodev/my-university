# Destroying Objects and Garbage Collection

> **OCP Exam Topic** — Know when an object becomes eligible for garbage collection, what `System.gc()` does, why `finalize()` is deprecated, and the difference between soft, weak, and phantom references. Covered in Chapter 1 of *OCP Java SE 21 Developer Study Guide* (Selikoff & Boyarsky).

---

## The Garbage Collector

Java manages heap memory automatically through the **garbage collector (GC)**. When an object can no longer be reached by any live thread through any chain of references, the GC is free to reclaim the memory occupied by that object.

You never `delete` or `free` memory in Java. The JVM decides when and how to run the GC.

---

## Eligibility for Garbage Collection

An object is eligible for garbage collection when **no strong references to it exist** in any reachable part of the program. The most common ways this happens:

### 1. Reference Set to `null`

```java
String s = new String("Hello");  // object on heap, one strong reference
s = null;                        // reference dropped — object eligible for GC
```

### 2. Reference Goes Out of Scope

```java
void process() {
    String temp = new String("temporary");
    System.out.println(temp);
}   // temp goes out of scope here — object eligible for GC
```

### 3. Reference Reassigned

```java
String a = new String("first");
a = new String("second");  // "first" object now has zero references — eligible for GC
```

### 4. Island of Isolation

Two or more objects that reference each other but are unreachable from any live thread form an **island of isolation**. The GC can collect the entire island even though the objects reference each other.

```java
class Node {
    Node next;
}

void createIsland() {
    Node a = new Node();
    Node b = new Node();
    a.next = b;
    b.next = a;     // a and b reference each other
    a = null;
    b = null;       // both local references dropped
    // a and b form an island — both are eligible for GC
}
```

---

## `System.gc()` — A Hint, Not a Command

Calling `System.gc()` **requests** that the JVM run garbage collection. The JVM is free to ignore the request entirely. It does not guarantee:

- That GC runs immediately.
- That any specific object is collected.
- That all eligible objects are collected.

```java
System.gc();  // a suggestion, not a guaranteed trigger
```

> On the exam, remember: `System.gc()` is a hint. You cannot rely on it to collect any particular object at any particular time.

---

## `finalize()` — Deprecated and Unreliable

Historically, `Object.finalize()` was called by the GC before reclaiming an object's memory, allowing cleanup logic. It has been **deprecated since Java 9** and **deprecated for removal since Java 18**.

Reasons to avoid `finalize()`:

- No guarantee it will ever be called (GC may never run, or the JVM may exit first).
- No guarantee about the order or timing of calls.
- Can cause objects to be resurrected, delaying collection.
- Causes significant performance overhead.

```java
// Deprecated — do NOT use in new code
@Deprecated(since = "9", forRemoval = true)
protected void finalize() throws Throwable { }
```

Use `try`-with-resources and `AutoCloseable` for deterministic resource cleanup instead.

---

## Reference Types

The `java.lang.ref` package provides reference types that interact with the GC in different ways. They allow an object to be held "softly" while memory is abundant, or tracked through and after collection.

### Strong References (Default)

The normal Java reference. The GC will never collect an object that has at least one strong reference.

```java
String s = "Hello";  // s is a strong reference
```

### Soft References

A `SoftReference` allows the GC to collect the referent **when the JVM is low on memory**. Useful for memory-sensitive caches.

```java
SoftReference<String> soft = new SoftReference<>(new String("cached data"));
String value = soft.get();  // returns null if collected
if (value == null) {
    // reload the data
}
```

### Weak References

A `WeakReference` allows the GC to collect the referent at the **next GC cycle**, regardless of available memory. Used in `WeakHashMap` and canonical mappings.

```java
WeakReference<String> weak = new WeakReference<>(new String("short-lived"));
String value = weak.get();  // may return null very quickly
```

### Phantom References

A `PhantomReference` cannot be used to access the referent at all — `get()` always returns `null`. It is used with a `ReferenceQueue` to perform post-mortem cleanup after an object has been finalized but before its memory is reclaimed.

```java
ReferenceQueue<Object> queue = new ReferenceQueue<>();
PhantomReference<Object> phantom = new PhantomReference<>(new Object(), queue);
// phantom.get() always returns null
```

### Reference Strength Summary

| Type | Collected When | Primary Use |
|---|---|---|
| **Strong** | Never (while reachable) | Normal variables |
| **Soft** | JVM is low on memory | Memory-sensitive caches |
| **Weak** | Next GC cycle | Canonical mappings, `WeakHashMap` |
| **Phantom** | After finalization | Post-mortem cleanup with `ReferenceQueue` |

> The exam may ask which type is collected first. The order is: weak → soft → strong (never collected by GC while reachable).

---

## Counting References — Exam Pattern

The exam often asks you to identify how many objects are eligible for GC after a block of code executes. Work through the references methodically:

```java
1:  String a = new String("alpha");   // Object 1 has 1 reference (a)
2:  String b = new String("beta");    // Object 2 has 1 reference (b)
3:  a = b;                            // a now points to Object 2; Object 1 has 0 references
4:  b = null;                         // b dropped; Object 2 still has reference via a
```

After line 4: **Object 1** is eligible for GC (0 references). Object 2 still has one reference (`a`).

---

## Key Points to Remember

- An object is eligible for GC when no strong reference to it exists from any live thread.
- Setting a reference to `null`, letting it go out of scope, or reassigning it all remove strong references.
- An **island of isolation** — a group of mutually referencing objects with no external strong references — is eligible for GC as a whole.
- `System.gc()` is a hint; the JVM may ignore it.
- `finalize()` is deprecated; use `try`-with-resources for cleanup.
- Weak references are collected at the next GC cycle; soft references survive until the JVM is low on memory; phantom references can never be dereferenced.

---

## References

- *OCP Oracle Certified Professional Java SE 21 Study Guide* — Chapter 1
- [JEP 421 — Deprecate Finalization for Removal](https://openjdk.org/jeps/421)
- [java.lang.ref package Javadoc](https://docs.oracle.com/en/java/docs/api/java.base/java/lang/ref/package-summary.html)
