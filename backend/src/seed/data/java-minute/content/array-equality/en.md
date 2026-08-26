---
version: 1.0
updatedAt: 2026-07-29
---
## Question

# How can you compare arrays for equality?

## Short Answer

There is a pattern for that: `Arrays.equals`. But it can be a little more complex than what you may think at first.

## What It Is

An array is itself an object in Java, so it inherits `Object.equals`, which compares the two **references**. In that sense, an array is only ever equal to itself — two distinct arrays with the exact same elements are still considered different objects.

Most of the time, what you actually want is to compare the **content** of your arrays: two arrays are equal if they contain the same elements, in the same order. That's what `Arrays.equals` gives you. It takes two arrays and returns whether their contents match — there are also overloads that take index ranges, so you can compare only a portion of the first array to a portion of the second.

## The Multi-Dimensional Case

You may think you're done, but you're not — an array can itself contain subarrays. If you compare a two-dimensional array with `Arrays.equals`, each subarray is compared with `Object.equals`, i.e. by reference, which is almost never what you want.

For that case, you need `Arrays.deepEquals`, which recurses into subarrays and compares their content as well.

## Practical Example

```java
int[] a1 = {1, 2, 3};
int[] a2 = {1, 2, 3};

a1.equals(a2);          // false — reference comparison
Arrays.equals(a1, a2);  // true  — content comparison

int[][] m1 = {{1, 2}, {3, 4}};
int[][] m2 = {{1, 2}, {3, 4}};

Arrays.equals(m1, m2);      // false — subarrays compared by reference
Arrays.deepEquals(m1, m2);  // true  — subarrays compared by content
```

## Solution and Conclusion

Rule of thumb: use `Arrays.equals` for simple, single-dimensional arrays, and `Arrays.deepEquals` for multi-dimensional (or otherwise nested) arrays.

One last detail: both methods support `null` elements. The convention is that two `null` values are considered equal, so they won't fail if your array contains nulls. That said — don't put null values in your arrays if you can avoid it.

## References

- [Java Coding Tip #381: Array Equality](https://www.youtube.com/shorts/4f2MDQg15J8) — video
- [Arrays.equals — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Arrays.html#equals(java.lang.Object%5B%5D,java.lang.Object%5B%5D)) — doc
- [Arrays.deepEquals — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Arrays.html#deepEquals(java.lang.Object%5B%5D,java.lang.Object%5B%5D)) — doc
