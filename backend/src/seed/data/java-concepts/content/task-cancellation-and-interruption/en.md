---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

`Thread.interrupt()` does not stop anything. It flips a per-thread boolean — the interrupt status — and nothing more; whether that flag ever changes the target thread's behavior depends entirely on whether that thread's code bothers to check it, either explicitly via `Thread.isInterrupted()` or implicitly by being blocked inside a method that already checks it for you (`Thread.sleep()`, `Object.wait()`, `BlockingQueue.take()/put()`, and most other blocking `java.util.concurrent` calls, which respond by clearing the flag and throwing `InterruptedException`). Writing correct cancellable code means treating that flag correctly: checking it at safe points, and — critically — never catching `InterruptedException` and discarding it, since doing so silently makes a thread uninterruptible for the rest of its life.

## Use Cases

- Writing a long-running loop (a worker thread, a background poller, a batch job) that needs to stop promptly when asked, without corrupting whatever it was in the middle of.
- Reviewing a `catch (InterruptedException e) { }` block during code review — recognizing it as a bug, not a style nit.
- Deciding whether code you're writing may call `interrupt()` on a thread, or must instead cancel through that thread's owner (typically a `Future` from an `ExecutorService`).
- Combining a timeout with cancellation: giving a task a deadline and cancelling it if it overruns.

## Deep Dive

### 1. A status flag, not a stop signal

`interrupt()` sets a boolean on the target `Thread`. That's the entire mechanism. What happens next depends on where that thread is:

```java
Thread worker = new Thread(() -> System.out.println("running"));
worker.start();
worker.interrupt(); // sets the flag; does not pause, kill, or redirect anything
```

If the target thread is doing ordinary CPU-bound work, nothing happens until the thread's own code decides to look at the flag. A correct interrupt-aware loop checks it between units of work, at a point where stopping is safe:

```java
class Worker implements Runnable {
    @Override
    public void run() {
        while (!Thread.currentThread().isInterrupted()) {
            doUnitOfWork(); // one safe, self-contained chunk of work
        }
        // loop exits on its own terms — never mid-update
    }
}
```

If the target thread is instead blocked inside an *interruptible* method — `Thread.sleep()`, `Object.wait()`, `Thread.join()`, or a blocking call like `BlockingQueue.take()`/`put()` — the JVM notices the interrupt for you: it clears the flag and throws `InterruptedException` right there, waking the thread up immediately instead of making it wait for the next explicit poll:

```java
class Consumer implements Runnable {
    private final BlockingQueue<String> queue;

    Consumer(BlockingQueue<String> queue) {
        this.queue = queue;
    }

    @Override
    public void run() {
        try {
            while (!Thread.currentThread().isInterrupted()) {
                String item = queue.take(); // blocks — and IS interruptible
                process(item);
            }
        } catch (InterruptedException e) {
            // take() already cleared the interrupt status when it threw it;
            // see section 2 for what to do here instead of nothing.
            Thread.currentThread().interrupt();
        }
    }
}
```

Note the explicit `isInterrupted()` check even though `take()` is already interruptible: if the flag was set *before* the thread got around to calling `take()` again, the check catches it immediately rather than starting another blocking wait first.

### 2. The swallowed-`InterruptedException` bug

The single most common mistake in this area is catching `InterruptedException` and doing nothing with it:

```java
// WRONG — do not do this
public void run() {
    try {
        while (!Thread.currentThread().isInterrupted()) {
            queue.put(nextItem());
        }
    } catch (InterruptedException e) {
        // swallowed: nothing here restores the flag or tells anyone
    }
}
```

Recall that a blocking method clears the interrupt status the moment it throws `InterruptedException` to signal it. If the catch block does nothing, that clearing is permanent — every last trace that this thread was ever asked to stop is gone. Any code higher up the call stack that later checks `isInterrupted()` will see `false`, as if cancellation had never been requested. The thread is now effectively uninterruptible for the rest of its life, even though the API contract promised it could be interrupted.

There are exactly two correct responses. The best one, when your method's signature allows it, is to propagate the exception and let the caller deal with it:

```java
// RIGHT — propagate
public String getNextTask(BlockingQueue<String> queue) throws InterruptedException {
    return queue.take(); // let InterruptedException bubble up unmodified
}
```

When you can't propagate — most commonly because you're inside `Runnable.run()`, which has no `throws` clause to add `InterruptedException` to — restore the status instead of discarding it, by calling `Thread.currentThread().interrupt()` before returning:

```java
// RIGHT — restore, when propagation isn't possible
public void run() {
    try {
        while (!Thread.currentThread().isInterrupted()) {
            queue.put(nextItem());
        }
    } catch (InterruptedException e) {
        Thread.currentThread().interrupt(); // put the flag back before returning
    }
}
```

This puts the flag back so that whatever code checks `isInterrupted()` next — the thread pool that owns this thread, a caller further up the stack, another loop iteration — still finds out that a cancellation request happened, even though this particular method already handled its own local cleanup.

### 3. Interruption policy: you don't own the thread

An interruption policy is the answer to "what does this thread do when it's interrupted?" — usually "stop as soon as practical, clean up, exit." The important rule is *who* gets to define that policy: whoever owns the thread, not whoever happens to be running on it. Code submitted to a thread pool is a guest on a thread it doesn't own; the `ExecutorService` is the owner, and it has already committed to treating interruption as "cancel the current task." Inventing a second, private cancellation mechanism on top of that borrowed thread creates two competing signals instead of one:

```java
// Avoid on a pooled task — this is a private cancellation channel
// competing with the pool's own interruption-based one.
class MyTask implements Runnable {
    private volatile boolean stop;

    void requestStop() {
        stop = true;
    }

    @Override
    public void run() {
        while (!stop) {
            doWork();
        }
    }
}
```

```java
// Prefer this on a pooled task: rely on the interruption
// mechanism the ExecutorService already implements.
class MyTask implements Runnable {
    @Override
    public void run() {
        while (!Thread.currentThread().isInterrupted()) {
            doWork();
        }
    }
}

ExecutorService pool = Executors.newFixedThreadPool(4);
Future<?> handle = pool.submit(new MyTask());
handle.cancel(true); // the pool's interruption policy takes it from here
```

The flip side of the same rule: don't call `interrupt()` directly on a thread you don't own either — you don't know what task is currently running on it or what that task's interruption policy is. Cancel through the abstraction the owner gave you (a `Future`, a `cancel()`/`shutdown()` method), not by reaching into the thread itself.

### 4. `Future.cancel(boolean mayInterruptIfRunning)`

For a task submitted to an `ExecutorService`, `Future.cancel(boolean)` is the standard, higher-level cancellation API — it's what section 3's `handle.cancel(true)` was already calling. When `mayInterruptIfRunning` is `true` and the task is currently running, the executor calls `interrupt()` on the thread running it internally; when `false`, the task is only prevented from starting if it hasn't started yet. Combined with a timeout, this gives you "run this, but give up and cancel it if it takes too long":

```java
ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();
Future<String> future = executor.submit(this::slowComputation);

try {
    String result = future.get(2, TimeUnit.SECONDS);
    System.out.println(result);
} catch (TimeoutException e) {
    future.cancel(true); // interrupt the task if it's still running
} catch (ExecutionException e) {
    throw new RuntimeException(e.getCause());
} finally {
    executor.close();
}
```

Calling `cancel(true)` is harmless even if the task already finished — cancelling a completed task simply has no effect — which is why it's safe to call unconditionally in a `finally` block whenever the result is no longer needed, whether `get()` timed out, threw, or you simply stopped caring about the answer.

## Trade-offs

- **Interruption is advisory, not preemptive** — a thread that never checks `isInterrupted()` and never calls an interruptible blocking method simply never notices it was interrupted; there is no way to force it to stop from the outside.
```java
Thread t = new Thread(() -> {
    long x = 0;
    while (true) { x++; } // no isInterrupted() check, no blocking call
});
t.start();
t.interrupt(); // flag is set; the loop above never looks at it
```
- **Restore-vs-propagate is a real design decision, not boilerplate** — propagating pushes `InterruptedException` (and the `throws` clause) onto every caller up the chain; restoring keeps your method's signature clean but means the flag sits unchecked until whatever code polls it next gets around to doing so.
- **Some blocking calls don't respond to interruption at all** — classic synchronous socket I/O (`InputStream.read()`/`OutputStream.write()` on a plain `Socket`) ignores `interrupt()` entirely; the usual workaround is closing the underlying socket so the blocked call fails with an exception instead, and there's no clean general fix beyond that.
```java
Socket socket = new Socket(host, port);
Thread reader = new Thread(() -> {
    try {
        socket.getInputStream().read(); // blocks; interrupt() has no effect here
    } catch (IOException e) {
        // thrown once the socket is closed from outside
    }
});
reader.start();
reader.interrupt(); // does nothing to unblock read()
socket.close();     // this is what actually unblocks it
```
- **`cancel(true)` only guarantees delivery, not compliance** — it tells you the interrupt was successfully sent to the running thread, not that the task noticed and actually stopped; a task ignoring its own interrupt status keeps running regardless of how many times `cancel()` is called.

## Documentation Links

- [Thread.interrupt() — java.lang.Thread API docs](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Thread.html#interrupt()) — doc
- [Thread.isInterrupted() — java.lang.Thread API docs](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Thread.html#isInterrupted()) — doc
- [Thread.interrupted() — java.lang.Thread API docs](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Thread.html#interrupted()) — doc
- [InterruptedException — java.lang API docs](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/InterruptedException.html) — doc
- [Future.cancel(boolean) — java.util.concurrent.Future API docs](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Future.html#cancel(boolean)) — doc
