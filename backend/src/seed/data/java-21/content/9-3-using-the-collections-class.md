# Using the Collections Class

## Overview

`java.util.Collections` is a **utility class** of static methods that operate on or return collections. It is the collections equivalent of `java.util.Arrays` — all methods are static and the class cannot be instantiated.

```java
import java.util.Collections;
import java.util.ArrayList;
import java.util.List;
```

All mutating methods (`sort`, `reverse`, `shuffle`, etc.) require a **mutable** `List`. Passing an immutable collection throws `UnsupportedOperationException`.

## Sorting

### `sort(List<T> list)`

Sorts a list into **natural order** (elements must implement `Comparable`).

```java
List<String> names = new ArrayList<>(List.of("Charlie", "Alice", "Bob"));
Collections.sort(names);
System.out.println(names); // [Alice, Bob, Charlie]
```

### `sort(List<T> list, Comparator<? super T> c)`

Sorts using a custom `Comparator`.

```java
List<String> names = new ArrayList<>(List.of("Charlie", "Alice", "Bob"));
Collections.sort(names, Comparator.comparingInt(String::length));
System.out.println(names); // [Bob, Alice, Charlie]  (by length)
```

The list's `sort(Comparator)` instance method (added in Java 8) is equivalent and generally preferred:

```java
names.sort(Comparator.reverseOrder());
```

## Binary Search

### `binarySearch(List<? extends Comparable<? super T>> list, T key)`

Searches a **sorted** list for a key and returns its index. Returns a **negative value** if not found. The list **must be sorted** before calling this method; results are undefined otherwise.

```java
List<Integer> nums = new ArrayList<>(List.of(1, 3, 5, 7, 9));
int idx = Collections.binarySearch(nums, 5);  // 2
int missing = Collections.binarySearch(nums, 4); // negative value
```

A custom comparator overload is also available:

```java
Collections.binarySearch(list, key, comparator);
```

## Reversing and Shuffling

### `reverse(List<?> list)`

Reverses the order of elements in a list in place.

```java
List<String> list = new ArrayList<>(List.of("A", "B", "C"));
Collections.reverse(list);
System.out.println(list); // [C, B, A]
```

### `shuffle(List<?> list)`

Randomly permutes the elements using a default source of randomness.

```java
List<Integer> cards = new ArrayList<>(List.of(1, 2, 3, 4, 5));
Collections.shuffle(cards); // order is random
```

A seeded overload accepts a `Random` instance for reproducible results:

```java
Collections.shuffle(list, new Random(42));
```

## Min and Max

### `min` and `max`

Find the smallest or largest element according to natural order or a supplied comparator.

```java
List<Integer> nums = List.of(3, 1, 4, 1, 5, 9, 2, 6);
int smallest = Collections.min(nums); // 1
int largest  = Collections.max(nums); // 9

List<String> words = List.of("banana", "apple", "cherry");
String first = Collections.min(words); // "apple"  (lexicographic)
String last  = Collections.max(words); // "cherry"
```

Both methods throw `NoSuchElementException` if the collection is empty.

## Frequency

### `frequency(Collection<?> c, Object o)`

Returns the number of times the specified element appears in the collection.

```java
List<String> list = List.of("a", "b", "a", "c", "a");
int count = Collections.frequency(list, "a"); // 3
```

## Unmodifiable Wrappers

These methods return a **view** backed by the original collection. Any attempt to mutate the view (add, remove, set) throws `UnsupportedOperationException`. However, mutations to the **underlying** collection are still reflected through the view.

```java
List<String>  original   = new ArrayList<>(List.of("X", "Y", "Z"));
List<String>  readOnly   = Collections.unmodifiableList(original);
Set<String>   readSet    = Collections.unmodifiableSet(new HashSet<>(Set.of("a", "b")));
Map<String,Integer> readMap = Collections.unmodifiableMap(new HashMap<>(Map.of("k", 1)));

// readOnly.add("W"); // throws UnsupportedOperationException
original.add("W");   // readOnly now also contains "W" — it is a view
```

For a truly independent immutable copy, use `List.copyOf` / `Set.copyOf` / `Map.copyOf` (Java 10+) or `List.of` directly.

## Singleton Collections

Factory methods that create **immutable** collections with exactly one element or entry.

```java
List<String>       single   = Collections.singletonList("only");
Set<String>        singleS  = Collections.singleton("only");
Map<String,Integer> singleM = Collections.singletonMap("key", 42);
```

These are useful when an API requires a `List` or `Set` but you only have one item. Unlike `List.of("only")`, the resulting type is guaranteed to be `java.util.Collections$SingletonList`, but both are immutable.

## nCopies

### `nCopies(int n, T o)`

Returns an **immutable** list containing `n` copies of the specified object. Useful for populating lists or initializing mutable lists.

```java
List<String> zeros = Collections.nCopies(5, "zero");
System.out.println(zeros); // [zero, zero, zero, zero, zero]

// Mutable copy that can be modified
List<String> mutable = new ArrayList<>(Collections.nCopies(3, "x"));
mutable.set(1, "y");
System.out.println(mutable); // [x, y, x]
```

## Quick Reference

| Method | Purpose |
|--------|---------|
| `sort(list)` | Sort in natural order |
| `sort(list, comparator)` | Sort with custom order |
| `binarySearch(list, key)` | Index of key in sorted list |
| `reverse(list)` | Reverse list in place |
| `shuffle(list)` | Randomly permute list |
| `min(collection)` | Smallest element |
| `max(collection)` | Largest element |
| `frequency(collection, obj)` | Count occurrences |
| `unmodifiableList(list)` | Read-only view of a list |
| `unmodifiableSet(set)` | Read-only view of a set |
| `unmodifiableMap(map)` | Read-only view of a map |
| `singletonList(e)` | Immutable single-element list |
| `singleton(e)` | Immutable single-element set |
| `singletonMap(k, v)` | Immutable single-entry map |
| `nCopies(n, e)` | Immutable list of n copies |

## Exam Tips

- `Collections.sort()` and `Collections.binarySearch()` require elements to implement `Comparable` unless a `Comparator` is provided.
- `binarySearch` on an **unsorted** list returns an unspecified (potentially positive) value — do not rely on the result.
- `unmodifiableList` creates a **view**, not a copy; changes to the backing list are visible through the view.
- `nCopies` stores only **one** object internally; all returned positions reference the same instance.
- `Collections.reverse()` is in-place and returns `void` — it does not return a new list.
- The `min` and `max` methods accept any `Collection`, not just `List`.
