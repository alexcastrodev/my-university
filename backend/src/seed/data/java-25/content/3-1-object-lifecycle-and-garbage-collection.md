# Object Life-Cycle and Garbage Collection

---

## Object Life-Cycle

Every Java object goes through three phases:

1. **Creation** — `new` allocates heap memory and calls a constructor.
2. **In use** — one or more references point to the object.
3. **Eligible for GC** — no reachable references remain; the GC may reclaim the memory.

---

## Creating Objects

```java
String s = new String("hello");   // explicit constructor
String t = "hello";               // string literal (pool)
var list = new ArrayList<String>(); // using var
```

---

## References vs Objects

A variable holds a **reference** (a pointer), not the object itself. Multiple references can point to the same object:

```java
StringBuilder a = new StringBuilder("hi");
StringBuilder b = a;   // both point to the same object
b.append("!");
System.out.println(a); // "hi!" — same object
```

Setting a reference to `null` does not destroy the object — it only removes that reference:

```java
a = null;  // a no longer refers to the object
           // if b still points to it, GC cannot collect it
```

---

## Eligibility for Garbage Collection

An object becomes GC-eligible when **no reachable chain of references leads to it**:

```java
StringBuilder sb = new StringBuilder("temp");
sb = new StringBuilder("new");   // original object is now unreachable → eligible
```

```java
void method() {
    String local = "inside";
}   // local goes out of scope → object may be eligible
```

**Island of isolation:** Two objects referencing each other but unreachable from any live variable are both eligible:

```java
class Node { Node next; }

Node n1 = new Node();
Node n2 = new Node();
n1.next = n2;
n2.next = n1;
n1 = null;
n2 = null;  // both eligible — no external references remain
```

---

## Garbage Collector Basics

- The GC runs automatically; you cannot force it (calling `System.gc()` is only a hint).
- Java uses generational GC — objects are collected in Eden, Survivor, and Old generations.
- The exam does **not** require knowledge of specific GC algorithms (G1, ZGC, etc.).

---

## finalize() — Deprecated and Gone

`Object.finalize()` was deprecated in Java 9 and **removed in Java 18**. Do not use or mention it as a cleanup mechanism.

Use `try-with-resources` / `AutoCloseable` for deterministic resource cleanup.

---

## Key Points

| Concept | Detail |
|---------|--------|
| Heap vs stack | Objects live on the heap; references live on the stack (or as fields) |
| GC trigger | Cannot be forced; happens when JVM decides |
| `null` reference | Makes that variable stop pointing — object may still be alive |
| `System.gc()` | Hint only — GC may or may not run |
| Island of isolation | Mutually referencing objects with no external root are eligible |
