---
version: 1.0
updatedAt: 2026-10-07
---
## Question

# What is the difference between a stream and an iterator?

## Short Answer

They are not the same interface.

## Less Short Answer

There are some similarities between both. For instance, both can be defined on almost any source of data, or even no source at all: you can create iterators and streams that are not backed by any kind of in-memory data structure.

```java
// an iterator with no backing collection: it computes its elements
Iterator<Integer> counter = new Iterator<>() {
    private int next = 0;
    public boolean hasNext() { return next < 5; }
    public Integer next() { return next++; }
};

// a stream with no backing collection either
Stream<Integer> evens = Stream.iterate(0, n -> n + 2).limit(5);
```

## Iterator: One Element After the Other

An iterator has two main methods: `hasNext()`, to check if there are more elements to consume, and `next()`, that returns the next element. You can also call `remove()` to remove the current element from the source, and `forEachRemaining()` to pass the remaining elements to a consumer.

```java
List<String> names = new ArrayList<>(List.of("Ana", "Bob", "Carl", "Dan"));
Iterator<String> it = names.iterator();

String first = it.next();           // "Ana", pulled by you
if (it.next().startsWith("B")) {
    it.remove();                    // removes "Bob" from the list itself
}
it.forEachRemaining(System.out::println); // Carl, Dan

System.out.println(names); // [Ana, Carl, Dan]: the source was modified
```

## Stream: A Processing Pipeline

A stream, on the other hand, does not give you elements one after the other. A stream defines a data processing pipeline, made of map, filter and reduce calculations mostly, and that you can decide to conduct in parallel.

```java
List<String> names = List.of("Ana", "Bob", "Carl", "Dan");

int totalLength = names.parallelStream()
        .filter(name -> name.length() == 3)
        .map(String::length)
        .reduce(0, Integer::sum);   // 9
```

Where an iterator can remove elements from its source of data, the specification of a stream states that it should not modify its source. `filter()` builds a new result, the list is left untouched:

```java
List<String> names = new ArrayList<>(List.of("Ana", "Bob", "Carl"));
List<String> withoutBob = names.stream()
        .filter(name -> !name.equals("Bob"))
        .toList();

System.out.println(names);      // [Ana, Bob, Carl]: unchanged
System.out.println(withoutBob); // [Ana, Carl]
```

## ListIterator: Going Backward

One last word: for lists, you also have the `ListIterator` interface, that gives you the classical forward iteration, but also a backward navigation with `hasPrevious()` and `previous()`.

```java
List<String> names = List.of("Ana", "Bob", "Carl");
ListIterator<String> it = names.listIterator(names.size()); // start at the end

while (it.hasPrevious()) {
    System.out.println(it.previous()); // Carl, Bob, Ana
}
```

## One Last Word

Neat!

## References

- [Java Coding Tip #401: What Is the Difference Between a Stream and an Iterator?](https://youtube.com/shorts/oLbaRK87JdI) (video)
- [Iterator (Java SE 25 API)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Iterator.html) (doc)
- [ListIterator (Java SE 25 API)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/ListIterator.html) (doc)
- [java.util.stream, Non-interference (Java SE 25 API)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/package-summary.html#NonInterference) (doc)
