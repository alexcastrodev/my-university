---
version: 1.0
updatedAt: 2026-09-03
---
## Question

# How can you reverse the elements of a list?

## Short Answer

It's a little more tricky than what it seems.

## Less Short Answer

There is a factory method in the `Collections` factory class simply called `reverse` that does exactly that.

```java
List<String> names = new ArrayList<>(List.of("Ana", "Bob", "Cid"));
Collections.reverse(names);
// names = ["Cid", "Bob", "Ana"]
```

Note that there are several traps in this method.

## Trap One: A List, Not a Collection

This method takes a `List` and not a `Collection`, because a `Collection` is not ordered, so it does not make sense to try to reverse it.

## Trap Two: It Modifies Your List

This method modifies your list, so your list needs to be modifiable, and it also needs to have a `ListIterator` that supports the `set` operation. That's the case for an `ArrayList`, a `LinkedList`, and even the list you get when you call `Arrays.asList(...)` — but this is still something you need to keep in mind if your application uses other implementations.

```java
List<Integer> fixedSize = Arrays.asList(1, 2, 3);
Collections.reverse(fixedSize); // OK: fixedSize = [3, 2, 1]

List<Integer> immutable = List.of(1, 2, 3);
Collections.reverse(immutable); // throws UnsupportedOperationException
```

## A View Instead: `reversed()`

You also have a `reversed()` method, added as part of the `SequencedCollection` interface extended by `List`. This `reversed()` method returns a *view* on your original list, without modifying it — so it also works on non-modifiable lists.

```java
List<Integer> immutable = List.of(1, 2, 3);
List<Integer> view = immutable.reversed();
// view = [3, 2, 1], immutable is untouched
```

Note that this view is modifiable if the original list is itself modifiable, and in that case, modifying the view modifies the original list.

```java
List<Integer> original = new ArrayList<>(List.of(1, 2, 3));
List<Integer> view = original.reversed();
view.set(0, 99);
// original = [1, 2, 99]
```

## One Last Word

Using `Collections.reverse` may be costly, as it needs to process your whole list to reverse it. Creating a view with `reversed()` is a lightweight process, because what you get is a wrapper that operates lazily on your list.

## References

- [Java Coding Tip #391: How Can You Reverse the Elements of a List?](https://youtube.com/shorts/zlEC4rVx6uA?is=jNVHRKysDO1etyh7) — video
- [Collections.reverse — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Collections.html#reverse(java.util.List)) — doc
- [SequencedCollection.reversed — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/SequencedCollection.html#reversed()) — doc
