# Introducing Threads

> A **thread** is the smallest unit of execution in a Java program. Every program starts with at least one thread — the main thread. Creating additional threads allows a program to do multiple things at once.

---

## What Is a Thread?

Java threads are lightweight processes that share the same heap memory. The Java Virtual Machine schedules threads on available CPU cores. Because threads share memory, they can communicate efficiently — but they also introduce the risk of data corruption when not handled carefully.

> **Note:** Java 21 introduced Virtual Threads (Project Loom) as a preview feature. The OCP exam focuses on traditional platform threads. Virtual threads are a runtime implementation detail and do not change the core concurrency API.

---

## Thread Lifecycle

A thread passes through well-defined states during its lifetime:

| State | Description |
|---|---|
| `NEW` | Thread object created but `start()` not yet called |
| `RUNNABLE` | Thread is executing or ready to execute on the CPU |
| `BLOCKED` | Waiting to acquire an intrinsic lock (e.g., entering `synchronized` block) |
| `WAITING` | Waiting indefinitely for another thread (e.g., `join()`, `wait()`) |
| `TIMED_WAITING` | Waiting for a specified period (e.g., `sleep(ms)`, `join(ms)`) |
| `TERMINATED` | Thread has finished execution |

```java
Thread t = new Thread(() -> System.out.println("Hello"));
System.out.println(t.getState()); // NEW
t.start();
System.out.println(t.getState()); // RUNNABLE (or TERMINATED if very fast)
```

---

## Creating Threads: Two Approaches

### Option 1 — Extending `Thread`

```java
public class PrintTask extends Thread {
    private final String message;

    public PrintTask(String message) {
        this.message = message;
    }

    @Override
    public void run() {
        System.out.println(Thread.currentThread().getName() + ": " + message);
    }
}

PrintTask t = new PrintTask("Hello from thread");
t.start(); // starts a new thread; never call run() directly
```

### Option 2 — Implementing `Runnable`

```java
public class PrintRunnable implements Runnable {
    private final String message;

    public PrintRunnable(String message) {
        this.message = message;
    }

    @Override
    public void run() {
        System.out.println(Thread.currentThread().getName() + ": " + message);
    }
}

Thread t = new Thread(new PrintRunnable("Hello from Runnable"));
t.start();
```

**Prefer `Runnable`** over extending `Thread`. It keeps the task logic separate from thread management, and a class implementing `Runnable` can still extend another class.

Lambda shorthand (since `Runnable` is a functional interface):

```java
Thread t = new Thread(() -> System.out.println("Lambda thread"));
t.start();
```

---

## Key Thread Methods

### `Thread.sleep(long millis)`

Pauses the current thread for at least the specified duration. It **does not release any locks** the thread holds.

```java
try {
    System.out.println("Before sleep");
    Thread.sleep(1000); // sleep 1 second
    System.out.println("After sleep");
} catch (InterruptedException e) {
    Thread.currentThread().interrupt(); // restore interrupted status
}
```

> **Exam tip:** `sleep()` throws a checked `InterruptedException`. Always restore the interrupt flag by calling `Thread.currentThread().interrupt()` inside the catch block if you cannot propagate the exception.

### `join()`

Makes the calling thread wait until the target thread finishes.

```java
Thread worker = new Thread(() -> {
    // long computation
});
worker.start();
worker.join(); // main thread waits here until worker finishes
System.out.println("Worker is done");
```

`join(long millis)` is a timed variant — the calling thread waits at most the given number of milliseconds.

### `interrupt()`

Signals a thread to stop what it is doing. If the thread is blocked in `sleep()` or `join()`, it receives an `InterruptedException`. If the thread is running, the interrupt flag is set and the thread must check `Thread.interrupted()` or `isInterrupted()` to respond.

```java
Thread t = new Thread(() -> {
    while (!Thread.currentThread().isInterrupted()) {
        // do work
    }
    System.out.println("Thread interrupted, stopping");
});
t.start();
t.interrupt(); // request cancellation
```

---

## Daemon Threads

A **daemon thread** runs in the background and does not prevent the JVM from exiting. Mark a thread as daemon before calling `start()`:

```java
Thread logger = new Thread(() -> { /* background logging */ });
logger.setDaemon(true);
logger.start();
```

When all non-daemon (user) threads finish, the JVM exits even if daemon threads are still running.

---

## `start()` vs `run()`

| Call | Effect |
|---|---|
| `t.start()` | Spawns a new OS thread; `run()` executes in that thread |
| `t.run()` | Executes `run()` in the **calling** thread — no new thread created |

Calling `run()` directly is a common mistake. It compiles and runs, but no concurrency occurs.

---

## Key Rules Summary

- Use `implements Runnable` (or a lambda) rather than `extends Thread`.
- Call `start()`, never `run()`, to create a new thread.
- `sleep()` throws `InterruptedException` — always handle it.
- `join()` blocks the current thread until the target thread terminates.
- Restore the interrupt flag with `Thread.currentThread().interrupt()` when catching `InterruptedException`.

---

## References

- [Oracle Docs — Thread](https://docs.oracle.com/en/java/docs/api/java.base/java/lang/Thread.html)
- OCP Study Guide, Chapter 13 — Concurrency
