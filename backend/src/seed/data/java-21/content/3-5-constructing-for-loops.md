# Constructing for Loops

> Java provides two `for` loop forms: the **basic for loop** for index-controlled iteration, and the **enhanced for loop** (for-each) for iterating over arrays and `Iterable` collections without managing an index.

---

## The Basic for Loop

The basic `for` loop bundles initialization, condition, and update into one line:

```java
for (int i = 0; i < 5; i++) {
    System.out.println(i);
}
// Output: 0  1  2  3  4
```

**Three components:**

| Component | Purpose | Example |
|---|---|---|
| Initialization | Runs once before the loop starts | `int i = 0` |
| Condition | Evaluated before each iteration | `i < 5` |
| Update | Runs after each iteration body | `i++` |

**Execution order:** initialization → [condition → body → update] → ...

---

## Multiple Variables in for Loop

The initialization and update sections can contain comma-separated expressions:

```java
for (int i = 0, j = 10; i < j; i++, j--) {
    System.out.println("i=" + i + " j=" + j);
}
```

All variables declared in the initialization must be the **same type**.

---

## Optional Components

All three components are optional. Omitting all three creates an infinite loop:

```java
for (;;) {
    // infinite loop — equivalent to while (true)
}
```

Omitting only the initialization or update is legal too:

```java
int i = 0;
for (; i < 5; ) {
    System.out.println(i);
    i++;
}
```

---

## Variable Scope

A variable declared in the `for` initialization is scoped to the loop:

```java
for (int i = 0; i < 3; i++) {
    System.out.println(i);
}
// System.out.println(i);  // compile error: i is out of scope
```

---

## The Enhanced for Loop (for-each)

The enhanced `for` loop iterates over an array or any `Iterable` without an index:

```java
int[] numbers = {10, 20, 30, 40};

for (int n : numbers) {
    System.out.println(n);
}
// Output: 10  20  30  40
```

**Syntax:** `for (ElementType variable : arrayOrIterable) { body }`

---

## Iterating Over Collections

The enhanced for works with any class that implements `Iterable<T>`, including all standard collections:

```java
List<String> names = List.of("Alice", "Bob", "Charlie");

for (String name : names) {
    System.out.println(name.toUpperCase());
}
```

```java
Set<Integer> ids = new HashSet<>(Set.of(1, 2, 3));

for (int id : ids) {
    System.out.println("ID: " + id);
}
```

---

## Enhanced for vs Basic for — When to Use Each

| Scenario | Preferred form |
|---|---|
| Need the index | Basic `for` |
| Modifying array elements by index | Basic `for` |
| Iterating backwards | Basic `for` |
| Skipping elements | Basic `for` |
| Read-only traversal of array or collection | Enhanced `for` |
| Working with `Iterable` | Enhanced `for` |

---

## Modifying Arrays: Enhanced for Does Not Write Back

The enhanced for loop copies the value into the loop variable. Assigning to that variable does **not** change the original array:

```java
int[] nums = {1, 2, 3};

for (int n : nums) {
    n = n * 2;   // modifies the copy, NOT nums[i]
}
// nums is still {1, 2, 3}
```

Use the basic `for` loop when you need to update array elements:

```java
for (int i = 0; i < nums.length; i++) {
    nums[i] = nums[i] * 2;   // modifies the actual element
}
```

---

## Iterating a 2D Array

```java
int[][] matrix = {
    {1, 2, 3},
    {4, 5, 6}
};

for (int[] row : matrix) {
    for (int val : row) {
        System.out.print(val + " ");
    }
    System.out.println();
}
// Output:
// 1 2 3
// 4 5 6
```

---

## Common Pitfall: Off-by-One Errors

The most frequent bug in basic `for` loops is an incorrect boundary condition:

```java
int[] arr = {10, 20, 30};

// BUG: ArrayIndexOutOfBoundsException when i == 3
for (int i = 0; i <= arr.length; i++) {
    System.out.println(arr[i]);
}

// CORRECT: use <, not <=
for (int i = 0; i < arr.length; i++) {
    System.out.println(arr[i]);
}
```

The enhanced `for` eliminates this category of error entirely.

---

## Key Rules to Remember

- The three `for` components (init, condition, update) are each optional
- Variables declared in the `for` initialization are scoped to that loop only
- Multiple init/update expressions must be separated by commas; all declared vars must share the same type
- The enhanced `for` works with arrays and any `Iterable<T>`
- Assigning to the loop variable in an enhanced `for` does not modify the original array or collection
- Use `< array.length` (not `<=`) to avoid `ArrayIndexOutOfBoundsException`

---

## References

- [Oracle Docs — The for Statement (Java 21)](https://docs.oracle.com/javase/tutorial/java/nutsandbolts/for.html)
- [Java Language Specification — §14.14 The for Statement](https://docs.oracle.com/javase/specs/jls/se21/html/jls-14.html#jls-14.14)
