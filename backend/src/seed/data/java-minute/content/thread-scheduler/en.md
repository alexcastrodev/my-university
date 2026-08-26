---
version: 1.0
updatedAt: 2026-08-01
---
## Question

# What is a thread scheduler?

## Short Answer

An object that schedules threads.

## What It Is

A thread is a piece of code that is executed independently of other threads. While doing so, it uses some CPU resource. If there are many threads running at the same time, you need to be able to **suspend** a thread so that the others get a chance to run.

This suspension should happen if the thread is **blocked** — for instance, waiting for data coming from the disk or the network, or waiting for a monitor that is preventing it from executing a synchronized piece of code.

That is the role of the thread scheduler: making sure that the CPU resource is evenly shared among threads, and that the active threads are indeed using the CPU resource and not waiting on it, doing nothing.

## Preemptiveness

This capacity of suspending a thread is called **preemptiveness**. A thread scheduler can be **preemptive** or **non-preemptive**.

## Practical Example

Virtual threads use a specific scheduler that is **not preemptive**. That is the reason why you should never run long-running in-memory computations on a virtual thread: if you do, you could block the entire carrier thread — and with it, the other virtual threads scheduled on it.

## References

- [Java Coding Tip #308: Thread Scheduler](https://www.youtube.com/shorts/VCXDZKcVNR4) — video
- [java.lang.Thread — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Thread.html) — doc
