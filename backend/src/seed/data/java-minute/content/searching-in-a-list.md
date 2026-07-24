---
version: 1.0
updatedAt: 2026-07-24
---
## Question

# How can you search for an element in a list?

## Short Answer

There is a very good pattern for that: `Collections.binarySearch`, which searches a sorted list in logarithmic time instead of scanning it linearly.

## What It Is

Of course, you can call `list.contains(...)`, which tells you whether the object you pass is present, or `list.indexOf(...)`, which gives you the first index of that object. Both methods are slow because they scan every element of the list one after the other — with many elements, that can take a while.

If your list is already sorted, you can call `Collections.binarySearch` instead. It works if your objects are `Comparable`, or it can take a `Comparator` as an argument. The implementation uses a binary search algorithm, which has O(log n) complexity.

## Two Caveats

First, if your list is not sorted, `binarySearch` will not throw any exception — it will still return something, but that result is meaningless, and the search may still take some time.

Second, if the object you're looking for appears several times in the list, you'll get any one of the valid indexes, not necessarily the first or last occurrence.

## Handling the Not-Found Case

If the object is not in the list, you get `-(insertionPoint) - 1`, where `insertionPoint` is the index at which the object would have been inserted without breaking the sorted order. The number is negative specifically to signal that the object was not found, while still encoding where it would belong.

## Practical Example

```java
List<Integer> sorted = new ArrayList<>(List.of(1, 3, 5, 7, 9));

int found = Collections.binarySearch(sorted, 5);   // 2
int notFound = Collections.binarySearch(sorted, 4); // -(2) - 1 = -3
```

## Solution and Conclusion

Only use this pattern on an `ArrayList` — the O(log n) complexity is achieved only if you can access any element in constant time. Running `binarySearch` on a `LinkedList` loses that guarantee, since each element access becomes O(n) on its own.

## References

- [Java Coding Tip #380: Searching in a List](https://www.youtube.com/watch?v=hrLJTsM9c4M) — video
- [Collections.binarySearch — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Collections.html#binarySearch(java.util.List,java.lang.Object)) — doc
