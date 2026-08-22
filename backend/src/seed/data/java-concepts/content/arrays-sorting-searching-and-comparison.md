---
version: 1.0
updatedAt: 2026-08-21
---
## Objective

`java.util.Arrays` is the utility class behind almost every array operation that isn't indexing or `.length` — sorting, searching, filling, copying, and comparing. Its methods look uniform across overloads, but two of its most-used operations hide sharp edges: sorting a primitive array in reverse order doesn't compile the way you'd expect, and both `binarySearch` and the equality/printing methods behave correctly only when you already know something about the array that the compiler cannot check for you.

## Use Cases

- Sorting an array of domain objects by natural order (`Comparable`) or by an ad-hoc rule (`Comparator`) before display, serialization, or a downstream algorithm that requires sorted input.
- Looking up a value's position in an already-sorted array in O(log n) instead of scanning linearly.
- Comparing two arrays — including arrays of arrays — for structural (content) equality, e.g. asserting expected vs. actual in a test.
- Producing a human-readable dump of an array's contents for logging or debugging.
- Copying an array into a new, possibly resized, array, or bulk-initializing an array to a constant value.

## Deep Dive

### `Arrays.sort(Object[])`: natural order or an explicit `Comparator`

For a reference-type array, `Arrays.sort` has two shapes: sort by natural order (the elements must implement `Comparable`), or sort by a `Comparator` passed as the second argument.

```java
Integer[] boxed = { 5, 3, 8, 1 };

Arrays.sort(boxed);                              // natural order: [1, 3, 5, 8]
Arrays.sort(boxed, Comparator.reverseOrder());    // explicit Comparator: [8, 5, 3, 1]

String[] names = { "Charlie", "alice", "Bob" };
Arrays.sort(names, String.CASE_INSENSITIVE_ORDER); // [alice, Bob, Charlie]
```

### The primitive-array trap: no `Comparator` overload exists

`Arrays.sort` for primitive arrays (`int[]`, `long[]`, `double[]`, ...) only has the no-argument-comparator overload — there is no `Arrays.sort(int[], Comparator<Integer>)`. This isn't a corner case to remember abstractly; it fails to compile the moment you reach for it:

```java
int[] scores = { 5, 3, 8, 1 };

// Arrays.sort(scores, Comparator.reverseOrder()); // does not compile:
// no method Arrays.sort(int[], Comparator<Object>) exists
```

`Comparator` operates on objects, and a primitive `int` is never boxed automatically for an array — only individual `int` values autobox, not `int[]` into `Integer[]`. There are two real fixes. Either box the array and sort with a `Comparator`:

```java
Integer[] boxedScores = { 5, 3, 8, 1 };
Arrays.sort(boxedScores, Comparator.reverseOrder());   // [8, 5, 3, 1]
```

Or sort ascending with the primitive overload and reverse the array manually, avoiding the boxing cost entirely:

```java
int[] scores2 = { 5, 3, 8, 1 };
Arrays.sort(scores2);                    // [1, 3, 5, 8]
for (int i = 0, j = scores2.length - 1; i < j; i++, j--) {
    int tmp = scores2[i];
    scores2[i] = scores2[j];
    scores2[j] = tmp;
}
// scores2 is now [8, 5, 3, 1]
```

### `Arrays.binarySearch`: requires a sorted array, silently, with no check

`Arrays.binarySearch` runs binary search, which only works correctly on a sorted array. The Javadoc states this as a precondition, not a runtime guarantee: **"If the array is not sorted, the results are undefined."** Nothing checks the precondition — no exception, no assertion, just an unspecified index. That makes it one of the more dangerous silent bugs in the standard library, because the call always returns *something* that looks plausible:

```java
int[] unsorted = { 5, 3, 8, 1, 9 };

int index = Arrays.binarySearch(unsorted, 8);
System.out.println(index); // may print 2 (correct by luck), or an unrelated,
                            // wrong index, or a negative "not found" result —
                            // the JDK makes no guarantee either way, and the
                            // outcome can differ across JDK versions or inputs
```

The only safe usage is to sort first, then search:

```java
int[] data = { 5, 3, 8, 1, 9 };
Arrays.sort(data);                         // [1, 3, 5, 8, 9] — precondition satisfied
int found = Arrays.binarySearch(data, 8);  // 3 — guaranteed correct
```

If the value is absent, `binarySearch` returns `-(insertion point) - 1` — always negative, never `-1` alone — so `index >= 0` is the correct "was it found" check, not `index != -1`.

### `Arrays.equals` vs `Arrays.deepEquals`: reference vs. content for nested arrays

`Arrays.equals(Object[], Object[])` compares two arrays element-by-element using each element's own `.equals`. That is correct for an array of `String` or `Integer`, but for an array of arrays, each "element" is itself an array, and array `.equals` is inherited from `Object` — reference identity, not content:

```java
int[][] grid1 = { {1, 2}, {3, 4} };
int[][] grid2 = { {1, 2}, {3, 4} };   // same content, different sub-array objects

System.out.println(Arrays.equals(grid1, grid2));     // false — compares sub-array references
System.out.println(Arrays.deepEquals(grid1, grid2)); // true  — recurses into each sub-array's content
```

`Arrays.deepEquals` recursively applies the same logic at every nesting level, so it also handles arrays of arrays of arrays correctly, while `Arrays.equals` only ever looks one level deep.

### `Arrays.toString` vs `Arrays.deepToString`: the same shallow/deep split for printing

`Arrays.toString` has the identical limitation when printing: for a 2D array, each element passed to `String.valueOf` is a sub-array, and an array's default `toString` (inherited from `Object`) is its type descriptor plus its hash code, not its contents:

```java
int[][] grid = { {1, 2}, {3, 4} };

System.out.println(Arrays.toString(grid));      // e.g. [[I@1b6d3586, [I@4554617c]
System.out.println(Arrays.deepToString(grid));  // [[1, 2], [3, 4]]
```

`Arrays.toString` is correct and sufficient for a one-dimensional array (`Arrays.toString(new int[]{1,2,3})` prints `[1, 2, 3]`); it's specifically nesting that requires `deepToString`.

### `copyOf`, `copyOfRange`, and `fill`

`Arrays.copyOf` creates a new array of a given length, copying from the start of the source and padding with default values (or truncating) as needed. `Arrays.copyOfRange` copies an arbitrary `[from, to)` slice. `Arrays.fill` overwrites every slot (or a sub-range) with a constant value:

```java
int[] source = { 1, 2, 3 };

int[] grown = Arrays.copyOf(source, 5);          // [1, 2, 3, 0, 0]
int[] shrunk = Arrays.copyOf(source, 2);         // [1, 2]
int[] slice = Arrays.copyOfRange(source, 1, 3);  // [2, 3]

int[] zeros = new int[4];
Arrays.fill(zeros, 7);                           // [7, 7, 7, 7]
Arrays.fill(zeros, 1, 3, 9);                      // [7, 9, 9, 7] — fills only index 1..3 (exclusive)
```

## Trade-offs

- **Primitive arrays can't take a `Comparator`, so descending-order sorts need either boxing (extra allocation, `Integer[]` instead of `int[]`) or a manual post-sort reversal.** The boxed route is more readable; the manual reversal avoids the memory and autoboxing cost in a hot path.
  ```java
  Integer[] boxed = {3, 1, 2};
  Arrays.sort(boxed, Comparator.reverseOrder()); // simple, allocates boxed Integers
  ```
- **`binarySearch` on an unsorted array is a silent correctness bug, not a crash** — there's no exception to catch in testing, so the mistake tends to surface later, as a "lookup found the wrong item" defect far from the actual cause.
  ```java
  Arrays.binarySearch(new int[]{5, 3, 8}, 8); // undefined result — no exception thrown
  ```
- **`equals`/`toString` vs `deepEquals`/`deepToString` is easy to get wrong exactly once, in a test assertion, and then trust forever** — an `assertTrue(Arrays.equals(expected2D, actual2D))` that should be comparing content will pass or fail based on object identity of the rows, not their values.
  ```java
  Arrays.equals(new int[][]{{1}}, new int[][]{{1}}); // false — same content, different sub-array refs
  ```
- **`Arrays.asList`'s fixed-size backing-array gotcha is a related but separate pitfall**, covered in `varargs-pitfalls-and-safe-usage.md` — not repeated here, since it's about list mutation, not sorting/searching/comparison.
- **`copyOf`/`copyOfRange` always allocate a new array** — convenient, but each call is an O(n) copy; resizing an array repeatedly in a loop (instead of using a growable structure like `ArrayList`) pays that cost every iteration.

## Documentation Links

- [Arrays — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Arrays.html) — doc
- [Arrays.sort(Object[]) — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Arrays.html#sort(java.lang.Object%5B%5D)) — doc
- [Arrays.binarySearch(int[], int) — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Arrays.html#binarySearch(int%5B%5D,int)) — doc
- [Arrays.deepEquals(Object[], Object[]) — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Arrays.html#deepEquals(java.lang.Object%5B%5D,java.lang.Object%5B%5D)) — doc
- [Arrays.deepToString(Object[]) — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Arrays.html#deepToString(java.lang.Object%5B%5D)) — doc
