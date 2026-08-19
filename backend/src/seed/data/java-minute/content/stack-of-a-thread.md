---
version: 1.0
updatedAt: 2026-08-19
---
## Question

# What is the stack of a thread?

## Short Answer

A portion of memory. Fortunately, this is something you do not need to take care of in Java — it is managed for you by the JVM.

## What It Is

The stack of a thread is the portion of memory used by that thread to store everything it needs while it executes. It holds all the **local variables** created by the code being run, and it can hold **references** to objects on the heap.

The references themselves live on the stack; the memory they point to lives on the **heap**.

## Stack vs. Heap

What lives on the stack is not shared: **each thread has its own stack**. That is not the case for the heap, where all the threads of your application can read and write data.

Because the heap is shared, it is where **race conditions** can happen. There is no race condition for what lives on the stack, since no other thread can see or touch it.

## Stack Size

Threads are a system resource, and the size of a thread's stack is fixed at the system level. It may vary from one operating system to another, but it is typically **several megabytes** of memory.

## Practical Example

This is also why deep, unbounded recursion eventually throws a `StackOverflowError`: each recursive call pushes a new frame with its own local variables onto the thread's stack, and once that fixed-size stack is exhausted, there is no more room left.

### Watch it happen: frames pushed and popped by `fib(3)`

A naive recursive `fib(n)` calls itself twice per level. Each call pushes a new frame onto the thread's stack; each `return` pops it back off. Watch the depth grow to 3 and shrink back to 0 as `fib(3)` unwinds:

```viz
type: moves
mark 0 | Call fib(3): push a frame at depth 0.
mark 1 | fib(3) calls fib(2): push a frame at depth 1.
mark 2 | fib(2) calls fib(1): push a frame at depth 2 — base case, returns 1 immediately.
mark 3 | fib(2) then calls fib(0): push a frame at depth 2 — base case, returns 0.
mark 2 | fib(2) = fib(1) + fib(0) = 1: its frame at depth 1 pops back off the stack.
mark 1 | fib(3) now calls fib(1): push a frame at depth 1 — base case, returns 1 immediately.
mark 0 | fib(3) = fib(2) + fib(1) = 2: its frame at depth 0 pops off. Stack is empty again.
---
depth 0
depth 1
depth 2
depth 3
```

Only 4 levels deep here, so it fits comfortably. Remove the base case, or recurse thousands of levels deep, and this same growth pattern runs straight into `StackOverflowError` — the thread's fixed-size stack has no more room for another frame.

## References

- [Java Coding Tip #387: What Is the Stack of a Thread?](https://www.youtube.com/watch?v=pcyxXj-YH4s) — video
- [java.lang.Thread — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Thread.html) — doc
- [-Xss (Thread Stack Size) — java Tool Reference](https://docs.oracle.com/en/java/javase/25/docs/specs/man/java.html) — doc
