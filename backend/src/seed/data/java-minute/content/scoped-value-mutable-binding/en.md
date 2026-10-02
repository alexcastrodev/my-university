---
version: 1.0
updatedAt: 2026-10-02
---
## Question

# Can you bind mutable objects to scoped values?

## Short Answer

Yes, but I don't think you should.

## Less Short Answer

Mutability always comes with race condition problems. The only way you can be sure that there is no possible race condition in your code is when you have only one thread that executes everything, and that is also true for scoped values.

## Scoped Values Are Not About Threads

Scoped values are not related to multithreading. You call a task, modeled by a `Runnable` or a `Callable`, and define a binding for a scoped value variable that is available in the scope of this task. If you are sure that no thread is created in this task, then binding a mutable value is safe. If not, then you need to manage the possible race conditions yourself.

```java
static final ScopedValue<List<String>> LOG = ScopedValue.newInstance();

// one thread only: the mutable list is never shared, so this is safe
ScopedValue.where(LOG, new ArrayList<>()).run(() -> {
    LOG.get().add("start");
    LOG.get().add("end");
});
```

## Where It Breaks

Subtasks forked from a `StructuredTaskScope` see the binding of the parent. With a mutable value, they all share the same object, from different threads:

```java
ScopedValue.where(LOG, new ArrayList<>()).run(() -> {
    try (var scope = StructuredTaskScope.open()) {
        for (int i = 0; i < 1_000; i++) {
            int n = i;
            scope.fork(() -> LOG.get().add("task " + n)); // ArrayList is not thread-safe
        }
        scope.join();
    } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
    }
    System.out.println(LOG.get().size()); // may print less than 1000, or throw
});
```

Binding an immutable value instead removes the problem: every subtask reads the same value, and no one can change it.

```java
static final ScopedValue<String> REQUEST_ID = ScopedValue.newInstance();

ScopedValue.where(REQUEST_ID, "req-42").run(() -> {
    // safe to read from any subtask: a String cannot change
});
```

## One Last Word

Stay safe, stay away from binding mutable values. It is not because you can do something that you should do it.

## References

- [Java Coding Tip #400: Can You Bind Mutable Objects to Scoped Values?](https://youtube.com/shorts/S5d3H01efbw) (video)
- [ScopedValue (Java SE 25 API)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ScopedValue.html) (doc)
- [StructuredTaskScope (Java SE 25 API)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/StructuredTaskScope.html) (doc)
- [JEP 506: Scoped Values](https://openjdk.org/jeps/506) (doc)
