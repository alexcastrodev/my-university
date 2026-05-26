# Understanding Java Arrays

## What Is an Array?

An array is a **fixed-size**, ordered collection of elements of the same type. Once created, its length cannot change. Arrays are objects on the heap.

## Declaration

The brackets can appear after the type **or** after the variable name. The first style is preferred.

```java
int[] numbers;       // preferred
int numbers2[];      // valid but less common

String[] names;
double[] prices;
```

## Creation and Initialization

### Size-based (default values)

```java
int[] nums = new int[5];       // {0, 0, 0, 0, 0}
boolean[] flags = new boolean[3]; // {false, false, false}
String[] words = new String[4];   // {null, null, null, null}
```

Default values: `0` for numeric types, `false` for `boolean`, `null` for object types.

### Array Initializer (inline)

```java
int[] primes = {2, 3, 5, 7, 11};
String[] days = {"Mon", "Tue", "Wed", "Thu", "Fri"};
```

### Anonymous Array

```java
int[] primes = new int[]{2, 3, 5, 7, 11};
printArray(new int[]{1, 2, 3}); // pass directly without a variable
```

## Accessing Elements

Array indices are **zero-based**. Accessing an out-of-bounds index throws `ArrayIndexOutOfBoundsException` at runtime.

```java
int[] arr = {10, 20, 30};
System.out.println(arr[0]);  // 10
System.out.println(arr[2]);  // 30
arr[1] = 99;
System.out.println(arr.length); // 3 (field, not method!)
```

## Iterating Arrays

```java
int[] scores = {85, 90, 78, 92};

// Traditional for loop
for (int i = 0; i < scores.length; i++) {
    System.out.println(scores[i]);
}

// Enhanced for loop (read-only iteration)
for (int score : scores) {
    System.out.println(score);
}
```

The enhanced for loop cannot modify the array elements or track the current index.

## Multidimensional Arrays

Java supports arrays of arrays. Each "row" can have a different length (jagged arrays).

```java
// Rectangular 2D array
int[][] matrix = new int[3][4]; // 3 rows, 4 columns

// Inline initialization
int[][] grid = {
    {1, 2, 3},
    {4, 5, 6},
    {7, 8, 9}
};

System.out.println(grid[1][2]); // 6 (row 1, column 2)

// Jagged array
int[][] jagged = new int[3][];
jagged[0] = new int[]{1};
jagged[1] = new int[]{2, 3};
jagged[2] = new int[]{4, 5, 6};
```

## The Arrays Utility Class

`java.util.Arrays` provides static helper methods for common array operations.

### sort

Sorts the array **in place** in ascending order.

```java
int[] nums = {5, 3, 1, 4, 2};
Arrays.sort(nums);
System.out.println(Arrays.toString(nums)); // [1, 2, 3, 4, 5]

String[] words = {"banana", "apple", "cherry"};
Arrays.sort(words);
System.out.println(Arrays.toString(words)); // [apple, banana, cherry]
```

### binarySearch

Performs a binary search on a **sorted** array. Returns the index if found, or a negative value if not found. The array **must be sorted first**.

```java
int[] sorted = {1, 2, 3, 4, 5};
System.out.println(Arrays.binarySearch(sorted, 3));  // 2
System.out.println(Arrays.binarySearch(sorted, 9));  // negative (not found)
```

### equals

Returns `true` if two arrays have the same length and all corresponding elements are equal.

```java
int[] a = {1, 2, 3};
int[] b = {1, 2, 3};
int[] c = {1, 2, 4};

System.out.println(Arrays.equals(a, b)); // true
System.out.println(Arrays.equals(a, c)); // false
System.out.println(a == b);              // false (different objects)
```

### compare

Compares two arrays lexicographically. Returns negative, zero, or positive.

```java
System.out.println(Arrays.compare(new int[]{1, 2}, new int[]{1, 3})); // negative
System.out.println(Arrays.compare(new int[]{1, 2}, new int[]{1, 2})); // 0
```

### mismatch

Returns the index of the first element that differs, or `-1` if the arrays are equal.

```java
System.out.println(Arrays.mismatch(new int[]{1, 2, 3}, new int[]{1, 2, 4})); // 2
System.out.println(Arrays.mismatch(new int[]{1, 2}, new int[]{1, 2}));       // -1
```

### fill

Sets every element to a given value.

```java
int[] arr = new int[5];
Arrays.fill(arr, 7);
System.out.println(Arrays.toString(arr)); // [7, 7, 7, 7, 7]
```

### toString

Returns a readable string representation (use this for printing, not `arr.toString()`).

```java
int[] arr = {1, 2, 3};
System.out.println(arr.toString());          // [I@6d06d69c (not useful)
System.out.println(Arrays.toString(arr));    // [1, 2, 3]
```

## Arrays Summary Table

| Method | Purpose | Requires Sorted? |
|--------|---------|-----------------|
| `sort(arr)` | Sort ascending in place | No |
| `binarySearch(arr, key)` | Find element index | Yes |
| `equals(a, b)` | Content equality | No |
| `compare(a, b)` | Lexicographic order | No |
| `mismatch(a, b)` | First differing index | No |
| `fill(arr, val)` | Set all elements | No |
| `toString(arr)` | Printable string | No |

## Exam Tips

- `length` is a **field** on arrays, not a method (`arr.length`, not `arr.length()`).
- Using `binarySearch` on an **unsorted** array produces undefined results.
- `==` on arrays compares references; use `Arrays.equals()` for content.
- A multidimensional array declaration like `int[][] arr = new int[3][]` leaves the second dimension uninitialized — you must assign each row separately.
