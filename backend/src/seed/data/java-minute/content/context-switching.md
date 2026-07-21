---
version: 1.0
updatedAt: 2026-07-20
---
## Question

# What is context switching?

## Short Answer

Context switching is when the operating system swaps out the context of one thread for another on the same CPU core. It's something we should generally **avoid**: it's directly tied to concurrency, and when it happens frequently, it hurts application performance.

## What It Is

A thread runs on a CPU core. While it's executing, it carries what we call its **context**: the data it's working with, the code being executed, the cache contents, and the CPU registers.

When the operating system decides another thread needs to run on that same core, it has to **pause the current thread** to make room for the next one. That means removing the paused thread's context from the core and, later, when it's that thread's turn to run again, loading that context back onto the core — as if "unpacking" everything all over again.

## The Process

1. The OS decides to interrupt the running thread (e.g., its time slice ended, or it got blocked waiting on something).
2. The thread's context (registers, data, state) is saved off the core.
3. The core is now free, and the OS loads the context of another thread that's ready to run.
4. That new thread executes.
5. When it's time for the original thread to run again, its context is reloaded onto the core — practically from scratch.

## Performance Impact

Each context switch takes, on average, about **100 microseconds**. That may sound small, but by CPU standards it's considered a **long** time: during that window, the core isn't doing useful work for either thread — it's just saving and restoring state.

In applications with many concurrent threads competing for few cores, this cost repeats constantly and can eat up a meaningful share of CPU time — time that should go toward real processing, not "changing clothes" between threads.

## Practical Example

The most common scenario: a thread makes a network call (for example, an HTTP request to another service) and that call is **blocking** — the thread sits idle waiting for the response to arrive.

While that thread waits, it isn't doing anything useful, but it's still occupying a core. To avoid wasting that core, the OS frequently performs a context switch: it pulls the blocked thread out and puts another one in its place. When the network response finally arrives, the original thread has to be brought back — another context switch.

## Solution and Conclusion

The practical recommendation is to use **virtual threads**. Since virtual threads don't hold a kernel thread exclusively while waiting on a blocking operation (such as network I/O), blocking a virtual thread doesn't tie up the kernel thread behind it.

This avoids much of the unnecessary context switching and, as a practical consequence, reduces concurrency-related bugs that tend to arise from the complexity of managing many traditional threads competing for few cores.

## References

- [Java Coding Tip #376: Context Switching](https://www.youtube.com/shorts/m7HvmcRAvac) — video
- [JEP 444: Virtual Threads](https://openjdk.org/jeps/444) — doc
- [java.lang.Thread — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Thread.html) — doc
