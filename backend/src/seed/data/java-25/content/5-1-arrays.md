# Arrays

---

## Declaration and Initialisation

```java
// declaration
int[] numbers;
String[] names;

// allocation
numbers = new int[5];          // default values: 0
names   = new String[3];       // default values: null

// declaration + allocation
double[] prices = new double[10];

// array initialiser (size inferred)
int[] primes = {2, 3, 5, 7, 11};
String[] days = new String[]{"Mon", "Tue", "Wed"};
```

The `[]` can go after the type or after the variable name — both compile, but after the type is conventional:

```java
int[] a;   // preferred
int a[];   // also valid
```

---

## Accessing Elements

```java
int[] arr = {10, 20, 30, 40, 50};

System.out.println(arr[0]);      // 10  (zero-based)
System.out.println(arr[arr.length - 1]);  // 50 (last element)

arr[2] = 99;
// arr = {10, 20, 99, 40, 50}
```

Accessing an index outside `[0, length-1]` throws `ArrayIndexOutOfBoundsException`.

---

## Iterating

```java
// traditional for — gives index control
for (int i = 0; i < arr.length; i++) {
    System.out.println(arr[i]);
}

// enhanced for — cleaner when index not needed
for (int n : arr) {
    System.out.println(n);
}
```

---

## Multidimensional Arrays

```java
int[][] matrix = new int[3][4];   // 3 rows, 4 columns
matrix[1][2] = 42;

// initialiser
int[][] grid = {
    {1, 2, 3},
    {4, 5, 6}
};

// jagged array — rows of different lengths
int[][] jagged = new int[3][];
jagged[0] = new int[2];
jagged[1] = new int[4];
jagged[2] = new int[1];
```

---

## Arrays Utility Class

```java
import java.util.Arrays;

int[] a = {5, 3, 1, 4, 2};

Arrays.sort(a);                         // sorts in place: [1,2,3,4,5]
int idx = Arrays.binarySearch(a, 3);    // 2 (array must be sorted first)
int[] copy = Arrays.copyOf(a, 7);       // [1,2,3,4,5,0,0] — pads with 0
int[] part = Arrays.copyOfRange(a, 1, 4); // [2,3,4] — indices 1..3
System.out.println(Arrays.toString(a)); // "[1, 2, 3, 4, 5]"
boolean eq = Arrays.equals(a, copy);    // false (different lengths)
Arrays.fill(a, 0);                      // [0,0,0,0,0]
```

`Arrays.binarySearch()` returns a **negative** value if the element is not found.

---

## Copying Arrays

| Method | Notes |
|--------|-------|
| `Arrays.copyOf(arr, len)` | New array of given length; pads or truncates |
| `Arrays.copyOfRange(arr, from, to)` | Copies `[from, to)` |
| `System.arraycopy(src, srcPos, dest, destPos, len)` | Low-level, fastest |
| `arr.clone()` | Shallow copy, same length |

---

## Arrays as Objects

- Arrays are objects on the heap.
- `arr.length` is a field (not a method).
- `==` compares references; use `Arrays.equals()` for value equality.
- Passing an array to a method passes the **reference** — the method can mutate the contents.

---

## Key Rules

| Rule | Detail |
|------|--------|
| Size | Fixed at creation; cannot grow or shrink |
| Default values | Numeric: `0`; `boolean`: `false`; reference: `null` |
| `length` | Field, not method (`list.size()` is a method) |
| Covariance | `String[]` is a subtype of `Object[]` — can cause `ArrayStoreException` |
