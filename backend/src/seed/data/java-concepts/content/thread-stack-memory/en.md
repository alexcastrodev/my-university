---
version: 1.0
updatedAt: 2026-08-19
---
## Objective

Every thread gets its own stack: a region of memory used to run the code it executes. Each method call pushes a new *stack frame* holding that call's local variables, method parameters, and the return address; the frame is popped when the method returns. A local variable of a reference type stores only a reference — a pointer-sized value — while the object it points to lives on the heap, the single region shared by every thread in the JVM. That split is why the stack needs no synchronization at all: nothing on it is visible to any other thread, so there is nothing to race over. Everything that *is* shared — heap objects, static fields — lives outside the stack, which is exactly where race conditions become possible. The stack's size is also fixed per thread at JVM/OS level (typically around 512KB–1MB by default, tunable with `-Xss`), which is why unbounded recursion eventually fails with `StackOverflowError` rather than growing forever.

## Use Cases

- Explaining why two threads running the exact same method never corrupt each other's local variables, even with no `synchronized` or lock anywhere in that method.
- Diagnosing a `StackOverflowError` in a recursive algorithm (parsing a deeply nested structure, a recursive tree walk) and knowing the fix is either bounding the recursion depth or raising `-Xss`, not adding synchronization.
- Reasoning about why a data race can only happen on heap state (instance fields, static fields, array/collection contents) — never on a method's own local variables, parameters, or the frame's return address.
- Sizing a thread pool for platform threads: each platform thread reserves stack memory up front, so thousands of them can exhaust address space or physical memory well before CPU becomes the bottleneck — one reason virtual threads (companion `thread-model-legacy-vs-virtual-threads` concept) exist.
- Reading a stack trace and understanding it is a literal snapshot of that thread's stack frames at the moment of the exception, most recent call first.

## Deep Dive

### A stack frame: locals, parameters, and the call chain

```java
public class FrameDemo {
    static int addOne(int n) {
        int result = n + 1; // local variable, lives in addOne's frame
        return result;
    }

    public static void main(String[] args) {
        int x = 41;          // local variable, lives in main's frame
        int y = addOne(x);   // pushes a new frame for addOne
        System.out.println(y); // 42
    }
}
```

Calling `addOne` pushes a frame on top of `main`'s frame, holding the parameter `n` and the local `result`. When `addOne` returns, its frame is popped and its locals cease to exist — `main`'s frame, with `x` and `y`, is unaffected because it never shared memory with `addOne`'s frame in the first place. This nesting is exactly what a stack trace shows: `main` at the bottom, the currently executing method at the top.

### References live on the stack, the objects they point to live on the heap

```java
class Counter {
    int value;
}

static void bump(Counter c) {
    Counter local = c;   // a new stack slot: a *copy* of the reference
    local.value++;        // dereferences into the heap — same object as c
}
```

`local` is a stack-resident reference — a small, fixed-size pointer to a `Counter` object. Copying it into `local` copies the pointer, not the object: `local` and `c` are two separate stack slots (possibly in two different threads' stacks) that happen to point at the same heap object. Reassigning `local` to point elsewhere would not affect `c` at all — but mutating `local.value` mutates the one `Counter` instance both references point to. That `Counter` object is the part that lives on the heap, is visible to every thread that holds a reference to it, and is the part that needs synchronization under concurrent mutation (see the companion `visibility-and-safe-publication` concept).

### No shared stack, no race on locals

```java
static long factorial(int n) {
    long acc = 1; // acc lives in *this call's* frame only
    for (int i = 2; i <= n; i++) {
        acc *= i;
    }
    return acc;
}

// two threads, same method, no coordination needed:
new Thread(() -> System.out.println(factorial(10))).start();
new Thread(() -> System.out.println(factorial(12))).start();
```

Both threads execute the identical bytecode for `factorial`, but each gets its own frame with its own `acc` and `i` — the JVM allocates one stack per thread precisely so this is true. There is no shared memory between the two calls, so there is nothing to lock, no interleaving to reason about, and no possibility that one thread's `acc` corrupts the other's. This is the flip side of the heap: a `static` or instance field mutated the same way *would* be shared and *would* need synchronization.

### Fixed stack size and `StackOverflowError`

```java
static long recurse(int n) {
    return n == 0 ? 0 : 1 + recurse(n - 1); // no way out for a huge n
}

recurse(1_000_000); // throws java.lang.StackOverflowError
```

Each recursive call pushes another frame; with no base case reached before the stack's fixed capacity is used up, the JVM throws `StackOverflowError` rather than let one thread grow its stack indefinitely and starve the rest of the process's address space. The default per-thread stack size is JVM/OS-dependent — commonly several hundred KB to a couple of MB — and can be changed process-wide with the `-Xss<size>` JVM flag, or per-thread via the `Thread(ThreadGroup, Runnable, String, long stackSize)` constructor. Raising it postpones the error for a given recursion depth; it does not remove the underlying fixed-size trade-off. Virtual threads (JEP 444) sidestep this differently: their stacks start tiny and grow/shrink on the heap as needed, which is part of why the JVM can run millions of them where it could only run thousands of platform threads.

## Trade-offs

- **No synchronization needed for locals — but also no sharing.** A method's local variables and parameters are invisible to every other thread by construction, which is exactly why they need no lock; the same isolation means you cannot use a local variable to pass data between threads — only a heap reference (a field, a queue, a `Runnable`'s captured variable) crosses that boundary.
- **Stack size is fixed, so recursion depth is bounded.** A correct-looking recursive method can still fail in production once inputs get deep enough.
  ```java
  static long recurse(int n) {
      return n == 0 ? 0 : 1 + recurse(n - 1);
  }
  // recurse(50) succeeds, recurse(1_000_000) throws StackOverflowError
  ```
- **Each platform thread's stack is memory committed up front.** Thousands of platform threads each reserving ~1MB of stack adds up to real memory pressure independent of how much CPU work they're actually doing — a major reason to prefer thread pools over unbounded thread creation, or virtual threads when the workload is I/O-bound and highly concurrent.
- **Copying a reference doesn't copy the object.** It's easy to assume passing an object "protects" it from concurrent mutation because the reference itself was copied onto a new stack frame — but every copy still points at the same shared heap object, which is where the actual thread-safety work has to happen.

## Documentation Links

- [Chapter 2.5.2: Java Virtual Machine Stacks — JVM Specification (SE 25)](https://docs.oracle.com/javase/specs/jvms/se25/html/jvms-2.html#jvms-2.5.2) — doc
- [StackOverflowError — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/StackOverflowError.html) — doc
- [java — the `-Xss` option — Java SE Tools Reference](https://docs.oracle.com/en/java/javase/25/docs/specs/man/java.html) — doc
- [Thread — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Thread.html) — doc
- [JEP 444: Virtual Threads](https://openjdk.org/jeps/444) — doc
