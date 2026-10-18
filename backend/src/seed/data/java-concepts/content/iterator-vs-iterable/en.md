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
- **Standalone `Iterator` loses `for-each`** — skipping `Iterable` is simpler when you only need one-shot manual traversal, but callers lose the ability to use `for-each` and any API that expects an `Iterable`:

  ```java
  CustomIterator it = new CustomIterator();
  for (String s : it) { ... } // error: CustomIterator is not Iterable
  ```
- **Mutating during iteration** — removing directly from a collection inside a `for-each` loop throws `ConcurrentModificationException`, because the collection's internal modification count changes underneath the iterator. `Iterator.remove()` is the only safe way to delete elements mid-traversal:

  ```java
  for (String s : list) {
      if (s.isEmpty()) list.remove(s); // ConcurrentModificationException
  }

  Iterator<String> it = list.iterator();
  while (it.hasNext()) {
      if (it.next().isEmpty()) it.remove(); // safe
  }
  ```
- **`remove()` is optional** — many `Iterator` implementations (e.g., over immutable or fixed-size structures) throw `UnsupportedOperationException` from `remove()`, so it can't be relied on universally:

  ```java
  Iterator<String> it = List.of("a", "b").iterator();
  it.next();
  it.remove(); // UnsupportedOperationException
  ```

## Lab

In this lab you get the `NameRoster` class, which already stores names in an internal list and implements `Iterable<String>`, but whose `Iterator` is still missing. Your job is to build that iterator from scratch. The core idea is to feel in practice why `Iterable` forces you to supply an `Iterator`: the `for-each` loop only works because of it, and the tricky part is removing an element mid-traversal without skipping the next one.

**The scenario**

A roster of names that must be traversable with `for-each`, with manual `hasNext()`/`next()` calls and with safe removal.

- `NameRoster`: stores the names in a `List<String>`, with `add()` and `size()` ready and `iterator()` left to implement.
- `RosterIterator` (private inner class): has two fields, `cursor` (the next position to read) and `lastReturned` (the position of the last name `next()` returned, or -1).

Notice that the iterator is an inner class, so it can see the roster's `names` list. Each call to `iterator()` creates a new iterator with its own cursor, which is why two iterators over the same roster move independently (there is a test for that).

**What you will do, step by step**

1. **Return the iterator (TODO-00).** In `iterator()`, return a new `RosterIterator` instance.
2. **Implement `hasNext()` (TODO-01).** Return `true` while the cursor is still inside the list size.
3. **Implement `next()` (TODO-02).** Throw `NoSuchElementException` if `hasNext()` is false. Otherwise store the position in `lastReturned`, advance the cursor and return the name.
4. **Implement `remove()` (TODO-03).** Remove the element at `lastReturned` from the list with `names.remove(lastReturned)` and move the cursor back by one. The reason: after the removal the next name slides into the removed slot, and without stepping back it would be skipped. A test covers exactly that.

**How you know you are done**

`mvn test` is all green. You should be able to explain, with a three-name example, why `remove()` has to touch the cursor, and why `Iterable` and `Iterator` are two separate contracts (one is a factory, the other holds the traversal state).

**Optional challenges**

- **BONUS-00:** make `remove()` throw `IllegalStateException` if it is called before `next()` or twice in a row without a `next()` in between, as the real `Iterator` contract requires.

**Prerequisites:** basic Java syntax, `List`/`ArrayList` and a notion of interfaces. The project uses Java 21 and Maven.

**How to run it:** clone the repository, go into `java-concepts/iterator-vs-iterable` and run `mvn test` (from the repository root: `mvn -pl java-concepts/iterator-vs-iterable test`). The methods start out throwing `UnsupportedOperationException("Not implemented yet.")` and the `TODO-NN` comments in the code carry the hints, so the list of red tests is your checklist.

## Documentation Links

- [Iterable — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Iterable.html) — doc
- [Iterator — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Iterator.html) — doc
- [Collection — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Collection.html) — doc
