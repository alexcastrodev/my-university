# Runnable, Callable, and Thread Lifecycle

---

## Runnable vs Callable

| | `Runnable` | `Callable<V>` |
|---|---|---|
| Package | `java.lang` | `java.util.concurrent` |
| Method | `void run()` | `V call() throws Exception` |
| Return value | None | Returns `V` |
| Checked exceptions | Not allowed | Allowed |
| Use with `Thread` | Yes | No (wrap or use `ExecutorService`) |
| Use with `ExecutorService` | Yes | Yes |

```java
Runnable r = () -> System.out.println("runnable — no return");

Callable<Integer> c = () -> {
    Thread.sleep(100);
    return 42;
};
```

---

## Creating Threads with Runnable

```java
// Pass to Thread constructor
Thread t = new Thread(() -> System.out.println("hello"));
t.start();

// Subclassing Thread (less common)
class MyThread extends Thread {
    public void run() {
        System.out.println("subclass");
    }
}
new MyThread().start();
```

> **Exam tip:** Calling `t.run()` directly does NOT start a new thread — it executes on the calling thread. Always use `t.start()`.

---

## Using Callable with ExecutorService

`Thread` does not accept `Callable` directly. Use an `ExecutorService` to submit a `Callable` and retrieve the result through a `Future<V>`.

```java
ExecutorService exec = Executors.newSingleThreadExecutor();
Future<Integer> future = exec.submit(() -> 7 * 6);   // Callable<Integer>
Integer result = future.get();                        // blocks until done → 42
exec.shutdown();
```

---

## Thread Lifecycle

```
NEW → RUNNABLE → (BLOCKED | WAITING | TIMED_WAITING) → TERMINATED
```

| State | Description |
|-------|-------------|
| `NEW` | Thread created but `start()` not yet called |
| `RUNNABLE` | Running or ready to run (waiting for CPU) |
| `BLOCKED` | Waiting to acquire a monitor lock (`synchronized`) |
| `WAITING` | Waiting indefinitely: `Object.wait()`, `Thread.join()`, `LockSupport.park()` |
| `TIMED_WAITING` | Waiting with a timeout: `Thread.sleep(ms)`, `Object.wait(ms)`, `Thread.join(ms)` |
| `TERMINATED` | `run()` has completed or thrown an uncaught exception |

```java
Thread t = new Thread(() -> {});
System.out.println(t.getState());   // NEW
t.start();
// after completion:
System.out.println(t.getState());   // TERMINATED
```

---

## Thread.sleep()

Pauses the current thread for at least the given duration. The thread moves to `TIMED_WAITING`.

```java
Thread.sleep(500);                          // milliseconds
Thread.sleep(Duration.ofSeconds(1));        // Duration overload (Java 21+)
```

`sleep()` throws `InterruptedException` if another thread interrupts the sleeping thread. Always handle it.

```java
try {
    Thread.sleep(1000);
} catch (InterruptedException e) {
    Thread.currentThread().interrupt();   // restore interrupted status
}
```

---

## join()

Causes the calling thread to wait until the target thread finishes.

```java
Thread worker = new Thread(() -> heavyComputation());
worker.start();
worker.join();           // main thread waits here
worker.join(5000);       // wait at most 5 seconds
System.out.println("worker done");
```

---

## interrupt(), isInterrupted(), interrupted()

| Method | Description |
|--------|-------------|
| `t.interrupt()` | Sets the interrupted flag on thread `t`; if `t` is sleeping/waiting, throws `InterruptedException` |
| `t.isInterrupted()` | Returns the interrupted flag without clearing it |
| `Thread.interrupted()` | Returns and **clears** the interrupted flag of the current thread |

```java
Thread worker = new Thread(() -> {
    while (!Thread.currentThread().isInterrupted()) {
        doWork();
    }
    System.out.println("stopped cleanly");
});
worker.start();
worker.interrupt();   // signals the worker to stop
```

```java
// Blocking methods throw InterruptedException — must restore flag
try {
    Thread.sleep(10_000);
} catch (InterruptedException e) {
    Thread.currentThread().interrupt();   // restore so callers can detect it
    return;
}
```

> **Exam tip:** `Thread.interrupted()` is static and clears the flag. `isInterrupted()` is instance-based and does not clear it.

---

## Thread Priority

```java
thread.setPriority(Thread.MIN_PRIORITY);    // 1
thread.setPriority(Thread.NORM_PRIORITY);   // 5 (default)
thread.setPriority(Thread.MAX_PRIORITY);    // 10
```

Priority is a hint to the OS scheduler — it does not guarantee execution order.

---

## Daemon Threads

```java
Thread daemon = new Thread(() -> monitorSystem());
daemon.setDaemon(true);   // must be called before start()
daemon.start();
```

The JVM exits when only daemon threads remain. Virtual threads are always daemon threads.

---

## Key Rules

- `start()` registers the thread with the JVM scheduler; `run()` executes synchronously on the caller.
- A thread can only be started once — calling `start()` a second time throws `IllegalThreadStateException`.
- `InterruptedException` clears the interrupted flag; always re-interrupt when catching it if you cannot handle it fully.
- `Callable` requires `ExecutorService` or a `FutureTask` wrapper to run on a thread.

---

## References

- [Oracle Docs — Thread (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Thread.html)
- [Oracle Docs — Runnable (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Runnable.html)
- [Oracle Docs — Callable (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Callable.html)
