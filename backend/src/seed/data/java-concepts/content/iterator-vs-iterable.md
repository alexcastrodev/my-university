---
version: 1.0
updatedAt: 2026-07-25
---
## Objective

Understand the difference between `Iterable` and `Iterator`: `Iterable` is a contract that says "I can be iterated" and forces you to provide an `Iterator`, while `Iterator` is the object that actually walks the elements, one by one, through `hasNext()` and `next()`.

## Use Cases

- Making a custom class traversable with a `for-each` loop by implementing `Iterable`.
- Exposing a read-only, one-directional traversal over a data structure without leaking its internal representation (array, linked list, tree, ...).
- Removing elements safely while iterating, using `Iterator.remove()` instead of mutating the collection directly.
- Building a standalone traversal object (implementing only `Iterator`) when `for-each` support isn't needed.
- Understanding why every JDK collection (`ArrayList`, `LinkedList`, `HashSet`, ...) can be used in a `for-each` loop.

## Deep Dive

### Iterable: the contract

`Iterable<T>` declares a single abstract method:

```java
public interface Iterable<T> {
    Iterator<T> iterator();
}
```

By implementing `Iterable`, a class is forced to produce an `Iterator` — that's the whole point of the interface. In exchange, it gets `for-each` support for free, since the loop is desugared by the compiler into calls to `iterator()`, `hasNext()`, and `next()`.

```java
public class MyCollection implements Iterable<String> {
    private final String[] items = new String[10];

    @Override
    public Iterator<String> iterator() {
        return new MyIterator();
    }
}
```

If you remove the `iterator()` method here, the compiler complains — implementing `Iterable` without providing an `Iterator` isn't allowed.

### Iterator: the worker

`Iterator<E>` is where the actual traversal logic lives, through two methods you must implement plus one optional one:

```java
public interface Iterator<E> {
    boolean hasNext();
    E next();
    default void remove() { ... } // optional
}
```

- `hasNext()` — checks whether another element is available before you access it.
- `next()` — returns the current element and advances the cursor.
- `remove()` — optional; removes the last element returned by `next()` from the underlying collection.

```java
private class MyIterator implements Iterator<String> {
    private int cursor = 0;

    @Override
    public boolean hasNext() {
        return cursor < items.length && items[cursor] != null;
    }

    @Override
    public String next() {
        return items[cursor++];
    }
}
```

### Iterator without Iterable

`Iterator` doesn't need `Iterable` to exist. A class can implement `Iterator` directly and be used standalone:

```java
public class CustomIterator implements Iterator<String> {
    private final List<String> elements = List.of("element one", "element two", "element three");
    private int cursor = 0;

    public boolean hasNext() { return cursor < elements.size(); }
    public String next() { return elements.get(cursor++); }
}
```

This works fine with manual `hasNext()` / `next()` calls, but since it isn't `Iterable`, it cannot be used in a `for-each` loop — the compiler has nothing to call `iterator()` on.

### Why the JDK pairs them

Every collection in the JDK follows this same pattern: `Collection` extends `Iterable`, so `List`, `Set`, and every implementation (`ArrayList`, `LinkedList`, `HashSet`, ...) must supply an `iterator()`. `ArrayList.iterator()`, for example, returns a private inner class implementing `Iterator<E>` with its own `hasNext()`, `next()`, and `remove()` — the exact same shape shown above. This is also a textbook application of the Iterator design pattern: sequential access to elements without exposing the underlying structure.

## Trade-offs

- **Coupling vs. convenience** — implementing `Iterable` couples your class to `Iterator`, but the payoff (`for-each` support) is almost always worth it for anything collection-like.
- **Standalone `Iterator` loses `for-each`** — skipping `Iterable` is simpler when you only need one-shot manual traversal, but callers lose the ability to use `for-each` and any API that expects an `Iterable`.
- **Mutating during iteration** — removing directly from a collection inside a `for-each` loop throws `ConcurrentModificationException`, because the collection's internal modification count changes underneath the iterator. `Iterator.remove()` is the only safe way to delete elements mid-traversal.
- **`remove()` is optional** — many `Iterator` implementations (e.g., over immutable or fixed-size structures) throw `UnsupportedOperationException` from `remove()`, so it can't be relied on universally.

## Documentation Links

- [Iterable — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Iterable.html) — doc
- [Iterator — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Iterator.html) — doc
- [Collection — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Collection.html) — doc
