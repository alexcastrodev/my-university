---
version: 1.0
updatedAt: 2026-08-21
---
## Objective

The Java Memory Model (JLS Chapter 17, "Threads and Locks") is the formal specification that answers a question the language would otherwise leave open: given a write in one thread and a read of the same variable in another, when is the read *guaranteed* to see that write? The companion concept `visibility-and-safe-publication` covers this ground practically — spinning loops that never terminate, `volatile`, safe publication idioms, `final` fields. This concept is its formal complement: the *happens-before* relation itself, the exact rules the JLS uses to define it (§17.4.5), and why — in their absence — the compiler, the JIT, and the CPU are each independently licensed to reorder memory operations. Every practical rule in the sibling concept is a consequence of one or more of these formal rules.

## Use Cases

- Tracing a *specific* happens-before chain through a piece of concurrent code during review, instead of eyeballing "there's a lock somewhere, so it's probably fine."
- Explaining precisely why double-checked locking without `volatile` is broken, and why adding `volatile` fixes it — not just that it's a known anti-pattern.
- Justifying, with a spec citation, why a `join()` on a worker thread makes that thread's writes visible to the joining thread with no extra synchronization.
- Understanding why an immutable object built from `final` fields is safe to read across threads once a reference to it is visible — the guarantee JLS §17.5 grants, and where it stops.
- Answering exam- or interview-style questions about instruction reordering ("can this print 0?") by naming the actual rule that does or doesn't apply, rather than by intuition.

## Deep Dive

### Why the memory model exists: reordering is legal by default

Without an explicit ordering constraint, the JLS gives the compiler, the JIT, and the CPU permission to execute a thread's actions in any order that doesn't change what *that thread* observes of its own execution — including reordering statements that look sequential in source:

```java
class Reorder {
    static int x = 0;
    static int y = 0;

    // Thread A
    static void writer() {
        x = 1; // no data dependency between these two writes...
        y = 2; // ...so the compiler/JIT/CPU may make y visible before x
    }

    // Thread B
    static void reader() {
        if (y == 2) {
            System.out.println(x); // may print 0 — not a bug, it's the spec
        }
    }
}
```

`x` and `y` don't depend on each other, so nothing in the single-threaded semantics of `writer()` is violated by writing `y` before `x` becomes globally visible. This license is deliberate — it's what lets a compiler keep a value in a register instead of always going to main memory, and what lets a CPU pipeline independent stores. The Java Memory Model exists to draw the line: it defines exactly which orderings *are* guaranteed (the happens-before relation) so that code relying on synchronization can be reasoned about precisely, while code that doesn't synchronize gets no guarantee at all.

### The happens-before rules (JLS §17.4.5)

*Happens-before* is not "happened earlier in wall-clock time" — it's a specific ordering relation the JLS defines between actions, and it is the **only** thing that guarantees a write is visible to a later read. JLS §17.4.5 builds it from a small set of rules:

- **Program order rule** — within a single thread, every action happens-before every later action in that thread's program order.
- **Monitor lock rule** — an unlock of a monitor happens-before every later lock of that *same* monitor.
- **Volatile variable rule** — a write to a `volatile` field happens-before every later read of that *same* field.
- **Thread start rule** — a call to `Thread.start()` happens-before any action in the started thread.
- **Thread join rule** — every action in a thread happens-before another thread successfully returns from a `join()` on it.
- **Transitivity** — if A happens-before B, and B happens-before C, then A happens-before C.

```java
// Monitor lock rule
class Counter {
    private final Object lock = new Object();
    private int value;

    void increment() {
        synchronized (lock) {
            value++; // unlocking here happens-before the next thread's lock below
        }
    }

    int read() {
        synchronized (lock) {
            return value; // guaranteed to see every increment() that already returned
        }
    }
}
```

```java
// Volatile variable rule
class Flag {
    private volatile boolean ready;
    private int data;

    void writer() {
        data = 42;
        ready = true; // this write happens-before any later read of `ready`
    }

    void reader() {
        if (ready) {
            System.out.println(data); // guaranteed to be 42, never 0
        }
    }
}
```

```java
// Thread start and thread join rules
class StartJoin {
    static int data;

    public static void main(String[] args) throws InterruptedException {
        data = 42;
        Thread t = new Thread(() -> System.out.println(data)); // sees 42: start() happens-before it
        t.start();

        Thread writer = new Thread(() -> data = 99);
        writer.start();
        writer.join(); // writer's write to `data` happens-before this join() returns
        System.out.println(data); // guaranteed to be 99
    }
}
```

### Chaining edges with transitivity

No single rule above needs to connect two threads directly — transitivity lets happens-before edges chain through an intermediate action, including through a completely different thread:

```java
class Chain {
    static int payload;
    static volatile boolean stagePassed;

    // Thread A
    static void produce() {
        payload = 7;          // (1)
        stagePassed = true;   // (2) volatile write: (1) happens-before (2)
    }

    // Thread B
    static void relay() {
        while (!stagePassed) {} // (3) volatile read: (2) happens-before (3)
        // by transitivity, (1) happens-before (3), so B is guaranteed to see payload == 7 here
        System.out.println(payload); // (4)
    }
}
```

(1) happens-before (2) by the volatile variable rule at the write side, (2) happens-before (3) by the volatile variable rule at the read side, and (3) happens-before (4) by program order — so transitivity guarantees (1) happens-before (4) even though `payload` itself is never synchronized. This is exactly the mechanism that makes safe-publication idioms work: the published reference (or flag) carries a happens-before edge that drags everything written *before* it along, transitively.

### Double-checked locking: the classic reordering trap

Double-checked locking tries to avoid the cost of acquiring a lock on every call by checking a field twice — once unlocked, once inside the lock:

```java
// BROKEN: no happens-before edge for readers that skip the synchronized block
public class Singleton {
    private static Singleton instance;

    public static Singleton getInstance() {
        if (instance == null) {                  // first check, unlocked
            synchronized (Singleton.class) {
                if (instance == null) {           // second check, locked
                    instance = new Singleton();   // construction + field write
                }
            }
        }
        return instance;
    }
}
```

The monitor lock rule only orders threads that both go through the `synchronized` block. A thread that sees `instance != null` on the *first*, unlocked check never acquires the lock at all, so it gets no happens-before edge back to the write inside it — it can observe a non-null `instance` reference to an object whose constructor hasn't finished writing its fields yet, because the field write and the constructor's internal writes are not ordered with respect to that reader.

```java
// FIXED: volatile gives every reader — locked or not — a happens-before edge
public class Singleton {
    private static volatile Singleton instance;

    public static Singleton getInstance() {
        if (instance == null) {
            synchronized (Singleton.class) {
                if (instance == null) {
                    instance = new Singleton();   // volatile write happens-after full construction
                }
            }
        }
        return instance;
    }
}
```

Making `instance` `volatile` invokes the volatile variable rule directly: the write to `instance` happens-before *every* later read of it, synchronized or not, so any thread that observes a non-null reference on the unlocked first check is guaranteed to see the fully constructed object. Nothing about the broken version fails to compile or run — it just fails intermittently, on a schedule the JMM never promised to avoid.

### `final` field semantics (JLS §17.5)

`visibility-and-safe-publication` covers the practical payoff of `final` fields: an immutable, properly-constructed object needs no synchronization to read safely. JLS §17.5 is the formal source of that guarantee, called *initialization safety*: once an object's constructor finishes without letting `this` escape, every `final` field is guaranteed to be visible, correctly initialized, to any thread that later obtains a reference to that object — through *any* means, not only a happens-before-ordered one.

```java
public final class Point {
    private final int x;
    private final int y;

    public Point(int x, int y) {
        this.x = x;
        this.y = y;
    } // §17.5 "freezes" x and y here, if `this` never escaped before this point
}
```

"Properly constructed" is the entire condition, and it means exactly what `visibility-and-safe-publication`'s `ThisEscape` example shows: nothing derived from `this` may be handed to another thread, another object, or a callback registry *before* the constructor returns.

```java
// Escaping `this` during construction voids the §17.5 guarantee for this object
public class Broken {
    final int value;

    Broken(EventSource source) {
        source.registerListener(this); // `this` escapes before `value` is set
        value = 42;
    }
}
```

A thread that receives `this` through that listener callback can run before `value = 42` executes, so it may observe `value == 0` — the default — even though `value` is declared `final`. The guarantee only holds for objects that are properly constructed; an escaped `this` sidesteps it entirely, regardless of the field's modifiers.

## Trade-offs

- **Happens-before is a partial order, not "everything before it in time."** Two actions with no rule connecting them are unordered no matter how many *other* happens-before edges exist elsewhere in the program — an unsynchronized read/write pair on a shared field is a data race even in a heavily-synchronized codebase, if nothing specifically orders that pair.
- **Each rule only orders what it names.** The monitor lock rule only orders threads that both go through the *same* lock; the volatile rule only orders accesses to that *one* field. Reaching for a broader guarantee (e.g., ordering two independent fields together) needs a rule that actually spans them — a shared lock, or a single `volatile` gate as in the transitivity example above — not an assumption that "some synchronization nearby" is enough.
- **The break in double-checked locking without `volatile` is invisible in the source and in most test runs.** The code compiles, and on many machines and JIT configurations it appears to work every time, because the reordering the JMM merely *permits* isn't guaranteed to actually happen on a given run:
  ```java
  private static Singleton instance; // missing volatile — compiles fine, races silently
  ```
- **The memory model reasons about an abstract execution, not the source text a developer reads.** A reordering that looks "obviously impossible" from the sequence of statements on the page can be entirely legal per JLS §17.4, because compiler, JIT, and hardware reordering are licensed by the *absence* of a happens-before edge, not ruled out by how the code visually reads top to bottom.
- **The `final`-field guarantee is voided by any construction-time escape, however indirect.** Passing `this` to a listener, starting a thread, or invoking an overridable method from inside the constructor all leak the reference before §17.5's "freeze" applies — and none of them is a compile error.

## Documentation Links

- [Chapter 17. Threads and Locks — Java Language Specification (JLS SE 25)](https://docs.oracle.com/javase/specs/jls/se25/html/jls-17.html) — doc
- [JLS §17.4.5 Happens-before Order](https://docs.oracle.com/javase/specs/jls/se25/html/jls-17.html#jls-17.4.5) — doc
- [JLS §17.5 final Field Semantics](https://docs.oracle.com/javase/specs/jls/se25/html/jls-17.html#jls-17.5) — doc
- [Thread — java.lang (Java SE 25 & JDK 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Thread.html) — doc
