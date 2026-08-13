---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

In a single thread, a write followed by a read of the same variable always sees that write — there is nothing to reason about. Across threads, that guarantee disappears unless there is a *happens-before* edge between the write and the read: without one, the compiler, the JIT, and the CPU are all free to reorder, cache, or delay memory operations, so a reading thread can see a stale value, a torn 64-bit value, or a half-constructed object, indefinitely or forever. This concept covers the visibility problem itself, what `volatile` actually guarantees (visibility and ordering, not atomicity), how to publish an object to another thread safely, and the special guarantee the Java Memory Model (JLS Chapter 17) gives to `final` fields.

## Use Cases

- Diagnosing a background thread that spins forever, or reads a value that "should" have changed, when the field it checks is a plain (non-`volatile`, non-locked) `boolean`/`int`/reference.
- Deciding whether a shared field only needs `volatile` (single writer, no compound update, no cross-field invariant) or actually needs a `Lock`/`synchronized` block.
- Reviewing code that starts a thread, registers a listener, or hands a reference to another object from inside a constructor — recognizing that as a `this`-escape bug even when it "happens to work" in testing.
- Choosing how to publish a newly-built object to other threads: a static initializer, a `volatile` field, a `final` field, or a properly locked field — and knowing plain assignment to a public field is none of those.
- Explaining why an immutable class with all-`final` fields needs no synchronization at all to be read safely by other threads, once a reference to it is visible.

## Deep Dive

### The visibility problem: no happens-before, no guarantee

```java
public class NoVisibility {
    private static boolean ready;
    private static int number;

    private static class ReaderThread extends Thread {
        @Override
        public void run() {
            while (!ready) {
                Thread.yield();
            }
            System.out.println(number);
        }
    }

    public static void main(String[] args) {
        new ReaderThread().start();
        number = 42;
        ready = true;
    }
}
```

This looks like it must print `42`. It might instead print `0`, or never terminate at all. Neither `ready` nor `number` is `volatile`, `synchronized`, or otherwise ordered against the reader thread, so there is no happens-before edge between the main thread's writes and the reader thread's reads (JLS §17.4.5). Without one:

- The reader thread may never observe `ready` become `true` — the write can sit in a CPU cache or CPU/compiler-reordered position that this thread's own execution never has a reason to invalidate, so the loop spins forever.
- Even if it does see `ready == true`, the JVM is allowed to make that write visible *before* the write to `number` is visible, because reordering that isn't observable from the writing thread's own execution is legal — so the reader can print `0`.

This is not a JIT bug; it is the memory model doing exactly what it is specified to do so that compilers and CPUs can cache and reorder operations for performance in the (default) absence of synchronization. The fix is always the same: establish a happens-before edge — a lock, a `volatile` field, or one of the other constructs JLS §17.4.5 lists — between the write and the read.

### `volatile`: visibility and ordering, not atomicity

Declaring a field `volatile` guarantees that a read of it always sees the most recent write by any thread, and it prevents the compiler/runtime from reordering other memory operations around the volatile access. It does **not** make compound operations on that field atomic:

```java
class Counter {
    volatile int counter = 0;

    void increment() {
        counter++; // read, add 1, write — three steps, not one
    }
}
```

`counter++` is a read-modify-write: read `counter`, compute `counter + 1`, write it back. `volatile` guarantees each individual read and write is visible immediately, but it does nothing to stop two threads from both reading the same value, both computing the same incremented value, and both writing it back — one increment is silently lost. Run enough concurrent `increment()` calls and the final value of `counter` will be less than the number of calls made.

`volatile` is the right tool only when all of these hold: writes to the field don't depend on its current value (or only one thread ever writes it), the field doesn't participate in an invariant with other state, and no other reason requires locking while it's accessed. A pure status/completion flag — the `ready` field above, made `volatile` — is the textbook case. For a counter that multiple threads increment, use `java.util.concurrent.atomic.AtomicInteger` (covered in the companion concurrency-utilities concept) or a lock instead.

### Safe publication vs. letting a reference escape

*Publishing* an object means deliberately making it reachable from other code — storing it in a field another thread can read, returning it, passing it to another object. Doing that safely means the reference **and** the object's fully-initialized state become visible to the other thread together. Plain field assignment does not guarantee this:

```java
// Unsafe publication — compiles, runs, and can still hand another
// thread a reference to a partially-constructed Holder.
public Holder holder;

public void initialize() {
    holder = new Holder(42);
}
```

Without a happens-before edge between this write and another thread's read of `holder`, that thread might see a stale (`null`) reference, or — more surprisingly — an up-to-date reference to a `Holder` whose fields still hold their default values, because object construction and the field write can be observed out of order.

JLS-recognized ways to publish an object safely:

- Assign it from a **static initializer** (`public static Holder holder = new Holder(42);`) — the JVM's class-initialization locking (JLS §12.4.2) makes this safe automatically.
- Store it into a **`volatile`** field or an `AtomicReference`.
- Store it into a **`final`** field of a properly constructed object.
- Store it into a field that is **guarded by a lock** every time it's read or written.

The other side of the same problem is letting `this` escape *during construction*, before any of the above has had a chance to apply:

```java
// this escapes before the constructor finishes — don't do this.
public class ThisEscape {
    public ThisEscape(EventSource source) {
        source.registerListener(event -> doSomething(event)); // captures `this`
    }
}
```

The lambda's enclosing instance is `this`, and `registerListener` can hand that reference to another thread before the `ThisEscape` constructor returns — even if the call is the constructor's last statement. The fix is to keep construction and registration in two steps, so nothing outside the constructor can see the object until it's finished:

```java
public class SafeListener {
    private final EventListener listener;

    private SafeListener() {
        listener = event -> doSomething(event);
    }

    public static SafeListener newInstance(EventSource source) {
        SafeListener safe = new SafeListener();
        source.registerListener(safe.listener); // registered only after construction returns
        return safe;
    }
}
```

A private constructor plus a static factory method applies the same fix to any "start a thread in the constructor" or "register a callback in the constructor" pattern: build the object fully first, publish it second.

### `final` fields' special guarantee

`final` fields get a guarantee the rest of the memory model doesn't hand out for free: as long as an object is *properly constructed* (its `this` reference didn't escape during construction), any thread that gets a reference to it — through any means, safe or not — is guaranteed to see the values its `final` fields were initialized to (JLS §17.5, "initialization safety"). No `volatile`, no lock, no happens-before edge is required for that particular guarantee.

```java
public final class Point {
    private final int x;
    private final int y;

    public Point(int x, int y) {
        this.x = x;
        this.y = y;
    }
    // getters omitted
}
```

Hand a `Point` reference to another thread through any channel — even an unsafely published one — and that thread is guaranteed to see the `x`/`y` values set in the constructor, not `0`/`0`. This is exactly what makes a properly-constructed immutable object thread-safe to read without synchronization: with every field `final` (and no field referring to a mutable object whose *own* state can still change), there is nothing left that needs a happens-before edge to be observed correctly. The sibling `immutability-and-defensive-copying` concept covers immutability from the API-correctness angle — protecting invariants and preventing external mutation; this is the same `final`-fields discipline viewed from the thread-safety angle — why it lets threads skip synchronization entirely.

The guarantee is narrower than it sounds: it covers the `final` field's own value, not the state of whatever mutable object that field might point to. A `final Set<String>` field guarantees every thread sees the same `Set` reference correctly initialized — it says nothing about whether concurrent mutation of that `Set`'s contents is safe.

## Trade-offs

- **A stale read is not the only failure mode — reordering is.** Even after `ready` finally becomes visible, `number` might not be, because writes made in program order are not guaranteed to become visible in that same order without a happens-before edge.
  ```java
  // main thread:
  number = 42;
  ready = true; // reader could observe ready==true, number==0
  ```
- **`volatile` is cheap but narrow.** It removes the need to block for visibility, but only covers a single field's visibility and ordering — reach for a `Lock`/`synchronized` block (or an atomic class) the moment two fields need to change together as one unit, or a field's next value depends on its current one under concurrent writers.
- **Escaping `this` from a constructor is easy to miss in review.** Starting a thread, registering a listener, or calling an overridable instance method from a constructor all leak `this` before the object is finished — none of it fails to compile, and it can pass every test that happens not to race the constructor's remaining statements.
- **The `final`-fields guarantee only reaches as deep as the field itself.** Marking a field `final` is enough for the field's own value to be safely visible without synchronization; it does nothing for the internal state of a mutable object that field refers to — that object still needs its own synchronization policy if other threads mutate it.
- **Thread confinement sidesteps visibility entirely, at the cost of not sharing.** Keeping an object reachable only from one thread (a local variable, or a `ThreadLocal`) needs no synchronization at all — but it only works as long as nothing publishes that reference elsewhere, and nothing in the language enforces that boundary for you.

## Documentation Links

- [Chapter 17. Threads and Locks — Java Language Specification (JLS SE 25)](https://docs.oracle.com/javase/specs/jls/se25/html/jls-17.html) — doc
- [JLS §17.4 Memory Model](https://docs.oracle.com/javase/specs/jls/se25/html/jls-17.html#jls-17.4) — doc
- [JLS §17.5 final Field Semantics](https://docs.oracle.com/javase/specs/jls/se25/html/jls-17.html#jls-17.5) — doc
- [JLS §17.7 Non-Atomic Treatment of double and long](https://docs.oracle.com/javase/specs/jls/se25/html/jls-17.html#jls-17.7) — doc
- [volatile — Java Language Keywords (Java SE tutorials)](https://docs.oracle.com/javase/tutorial/java/javaOO/variables.html) — doc
- [AtomicReference — java.util.concurrent.atomic](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/atomic/AtomicReference.html) — doc
