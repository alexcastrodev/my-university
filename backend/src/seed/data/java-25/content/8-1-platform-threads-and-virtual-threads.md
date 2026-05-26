---
version: 1.1
updatedAt: 2026-05-26
---
# Platform Threads and Virtual Threads

---

## Overview

Java distinguishes between two kinds of threads since **Java 21 (JEP 444 — finalized)**:

| | Platform Thread | Virtual Thread |
|---|---|---|
| Backed by | OS thread (1-to-1) | JVM-managed, mounted on a carrier thread |
| Cost to create | High (~1 MB stack, OS call) | Very low (a few hundred bytes) |
| Blocking behaviour | Blocks the OS thread | Unmounts from carrier; carrier is reused |
| Ideal for | CPU-bound, few threads | I/O-bound, high-concurrency (millions) |
| Stack | Fixed, allocated up-front | Growable, heap-backed |

---

## Creating Platform Threads

```java
// Traditional — subclass Thread
Thread t1 = new Thread(() -> System.out.println("platform"));
t1.start();

// Builder API (Java 21+)
Thread t2 = Thread.ofPlatform().name("worker").start(() -> System.out.println("platform builder"));
```

---

## Creating Virtual Threads

```java
// Convenience factory
Thread vt1 = Thread.ofVirtual().start(() -> System.out.println("virtual"));

// Static shortcut
Thread vt2 = Thread.startVirtualThread(() -> System.out.println("virtual shortcut"));

// Through an ExecutorService (preferred for bulk work)
try (var exec = Executors.newVirtualThreadPerTaskExecutor()) {
    exec.submit(() -> System.out.println("virtual via executor"));
}
```

> **Exam tip:** `Thread.startVirtualThread(Runnable)` is the shortest way to create and start a virtual thread in a single call.

---

## Identifying Thread Type

```java
Thread vt = Thread.startVirtualThread(() -> {});
System.out.println(vt.isVirtual());   // true

Thread pt = Thread.ofPlatform().start(() -> {});
System.out.println(pt.isVirtual());   // false
```

---

## Carrier Threads and Pinning

Virtual threads run on top of platform threads called **carrier threads**. The JVM scheduler mounts a virtual thread onto a carrier when it is ready to run, and unmounts it when it blocks (e.g., on I/O or `Object.wait()`).

**Pinning** occurs when a virtual thread cannot be unmounted from its carrier:
- Inside a native method or foreign function call

> **Java 24 — JEP 491:** `synchronized` blocks and methods **no longer pin** virtual threads to their carrier. A virtual thread that blocks inside `synchronized` now unmounts normally, just like it does with `ReentrantLock`. This removes the main scalability concern with `synchronized` in virtual-thread code.

Before Java 24, the guidance was to replace `synchronized` with `ReentrantLock` for I/O-bound virtual-thread code. From Java 24 onward that workaround is no longer necessary for correctness, although `ReentrantLock` still offers extra features (timed tries, fairness, condition variables).

```java
// Java 21–23: synchronized pins the carrier — avoid with blocking I/O
synchronized (lock) {
    doBlockingIO();   // carrier thread was held
}

// Java 21–23: preferred workaround — ReentrantLock allowed unmounting
lock.lock();
try {
    doBlockingIO();
} finally {
    lock.unlock();
}

// Java 24+: synchronized no longer pins — both forms are equally safe
synchronized (lock) {
    doBlockingIO();   // virtual thread unmounts normally
}
```

---

## Cost Comparison

```java
// Creating 100 000 platform threads — may exhaust OS resources
for (int i = 0; i < 100_000; i++) {
    Thread.ofPlatform().start(() -> {
        Thread.sleep(Duration.ofSeconds(1));
    });
}

// Creating 100 000 virtual threads — lightweight, designed for this
for (int i = 0; i < 100_000; i++) {
    Thread.startVirtualThread(() -> {
        Thread.sleep(Duration.ofSeconds(1));
    });
}
```

---

## Structured Concurrency (JEP 480 — Preview / Finalized Java 25)

**Structured Concurrency** treats a group of related tasks launched in different threads as a single unit of work. If any task fails, siblings are cancelled automatically.

```java
try (var scope = new StructuredTaskScope.ShutdownOnFailure()) {
    Future<String> user  = scope.fork(() -> fetchUser(id));
    Future<Order>  order = scope.fork(() -> fetchOrder(id));
    scope.join().throwIfFailed();
    return new Response(user.resultNow(), order.resultNow());
}
```

> **Exam tip:** Structured Concurrency is designed for virtual threads. It is in the `java.util.concurrent` package under `StructuredTaskScope`.

---

## When to Use Each

| Scenario | Recommended |
|----------|-------------|
| CPU-intensive computation | Platform thread |
| High-volume I/O (HTTP servers, DB queries) | Virtual thread |
| Legacy code with `synchronized` + blocking I/O | Virtual thread (Java 24+ — no pinning) |
| New concurrent code with many tasks | Virtual thread |

---

## Key Rules

- `Thread.ofVirtual()` and `Thread.ofPlatform()` return a `Thread.Builder`.
- Virtual threads are always **daemon** threads; setting them as non-daemon throws `IllegalArgumentException`.
- Virtual threads should not be pooled — create a new one per task.
- `Executors.newVirtualThreadPerTaskExecutor()` creates a new virtual thread for every submitted task.

---

## References

- [JEP 444 — Virtual Threads (Java 21)](https://openjdk.org/jeps/444)
- [JEP 491 — Synchronize Virtual Threads without Pinning (Java 24)](https://openjdk.org/jeps/491)
- [JEP 480 — Structured Concurrency (Java 25)](https://openjdk.org/jeps/480)
- [Oracle Docs — Thread (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Thread.html)
