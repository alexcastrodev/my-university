---
version: 1.0
updatedAt: 2026-05-26
---
# break, continue, and Labeled Statements

---

## break

`break` immediately exits the **innermost** enclosing loop or `switch`:

```java
for (int i = 0; i < 10; i++) {
    if (i == 5) break;
    System.out.println(i);  // prints 0, 1, 2, 3, 4
}
```

Inside a `switch`, `break` prevents fall-through (colon syntax):

```java
switch (value) {
    case 1:
        System.out.println("one");
        break;  // exits switch
    case 2:
        System.out.println("two");
        break;
}
```

---

## continue

`continue` skips the remainder of the **current iteration** and jumps to the next:

```java
for (int i = 0; i < 10; i++) {
    if (i % 2 == 0) continue;
    System.out.println(i);  // prints 1, 3, 5, 7, 9
}
```

In a `while` or `do-while`, `continue` jumps back to the condition check:

```java
int i = 0;
while (i < 10) {
    i++;
    if (i % 2 == 0) continue;
    System.out.println(i);  // prints 1, 3, 5, 7, 9
}
```

---

## Labeled Statements

A label is an identifier followed by `:` placed before a loop or block. Labels allow `break` and `continue` to target an **outer** loop instead of the innermost one.

### Labeled break

```java
outer:
for (int i = 0; i < 3; i++) {
    for (int j = 0; j < 3; j++) {
        if (i == 1 && j == 1) break outer;
        System.out.println(i + "," + j);
    }
}
// Output:
// 0,0
// 0,1
// 0,2
// 1,0
// (loop exits entirely when i=1, j=1)
```

### Labeled continue

```java
outer:
for (int i = 0; i < 3; i++) {
    for (int j = 0; j < 3; j++) {
        if (j == 1) continue outer;
        System.out.println(i + "," + j);
    }
}
// Output:
// 0,0
// 1,0
// 2,0
// (inner loop restarts outer iteration when j == 1)
```

---

## Where Each Statement Is Valid

| Statement | Valid in | Targets |
|-----------|----------|---------|
| `break` | `for`, `while`, `do-while`, `switch` | Innermost enclosing construct |
| `break label` | Any labeled `for`, `while`, `do-while`, block | Labeled construct |
| `continue` | `for`, `while`, `do-while` | Innermost enclosing loop |
| `continue label` | Any labeled `for`, `while`, `do-while` | Labeled loop |

> `continue` is **not** valid inside a `switch` statement (only loops).

---

## Unreachable Code

The compiler rejects code that can never be reached:

```java
for (int i = 0; i < 5; i++) {
    break;
    System.out.println(i);  // Compile error: unreachable statement
}
```

---

## Quick Reference

```java
// break — exit loop early
for (int i = 0; i < 100; i++) {
    if (found(i)) break;
}

// continue — skip one iteration
for (int i = 0; i < 10; i++) {
    if (i == 3) continue;  // skip 3
    process(i);
}

// labeled break — exit nested loops
search:
for (int row = 0; row < grid.length; row++) {
    for (int col = 0; col < grid[row].length; col++) {
        if (grid[row][col] == target) {
            System.out.println("Found at " + row + "," + col);
            break search;
        }
    }
}
```
